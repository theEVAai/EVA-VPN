'use strict';
/**
 * Работа с сетью Windows: системный прокси, проверка прав, «Восстановить сеть».
 *
 * Философия: приложение не должно оставлять после себя следов. Всё, что мы меняем,
 * мы умеем откатить — и кнопкой, и автоматически при выходе.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const INET_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const BYPASS = 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>';

function runPs(script, timeout = 30000) {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), 'evavpn-' + crypto.randomBytes(6).toString('hex') + '.ps1');
    try {
      fs.writeFileSync(file, '﻿' + script, 'utf8');
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: String(e) });
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { timeout, windowsHide: true },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(file); } catch { /* не важно */ }
        resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

function runCmd(cmd, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** Права администратора (нужны для TUN-режима). */
async function isAdmin() {
  const r = await runPs(
    '$id=[Security.Principal.WindowsIdentity]::GetCurrent();' +
    '$p=New-Object Security.Principal.WindowsPrincipal($id);' +
    'if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Write-Output "yes"}else{Write-Output "no"}',
    10000
  );
  return r.stdout.trim().endsWith('yes');
}

const REFRESH_INET =
  '$sig = @"\n' +
  '[DllImport("wininet.dll", SetLastError = true, CharSet = CharSet.Auto)]\n' +
  'public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);\n' +
  '"@\n' +
  '$w = Add-Type -MemberDefinition $sig -Name WinINet -Namespace Eva -PassThru\n' +
  '$w::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null\n' +
  '$w::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null\n';

async function setSystemProxy(port) {
  const script =
    `Set-ItemProperty -Path '${INET_KEY}' -Name ProxyEnable -Value 1 -Type DWord\n` +
    `Set-ItemProperty -Path '${INET_KEY}' -Name ProxyServer -Value '127.0.0.1:${port}'\n` +
    `Set-ItemProperty -Path '${INET_KEY}' -Name ProxyOverride -Value '${BYPASS}'\n` +
    REFRESH_INET;
  const r = await runPs(script);
  await runCmd('netsh', ['winhttp', 'set', 'proxy', `127.0.0.1:${port}`, 'localhost;127.*;<local>']);
  return r.code === 0;
}

async function clearSystemProxy() {
  const script =
    `Set-ItemProperty -Path '${INET_KEY}' -Name ProxyEnable -Value 0 -Type DWord\n` +
    `Remove-ItemProperty -Path '${INET_KEY}' -Name ProxyServer -ErrorAction SilentlyContinue\n` +
    REFRESH_INET;
  const r = await runPs(script);
  await runCmd('netsh', ['winhttp', 'reset', 'proxy']);
  return r.code === 0;
}

/** Системный прокси включён и указывает на нас? */
async function systemProxyState() {
  const r = await runPs(
    `$p = Get-ItemProperty -Path '${INET_KEY}' -ErrorAction SilentlyContinue;` +
    'Write-Output ("" + $p.ProxyEnable + "|" + $p.ProxyServer)',
    10000
  );
  const [enabled, server] = r.stdout.trim().split('|');
  return { enabled: enabled === '1', server: server || '' };
}

/**
 * Чужие живые туннели. Два VPN одновременно — это два маршрута по умолчанию
 * и два перехватчика DNS; трафик начинает ходить через раз, и виноватым
 * выглядит тот клиент, который включили последним.
 */
async function foreignTunnels(ourAlias = TUN_NAME) {
  const r = await runPs(
    "$pat = '" + VPN_PATTERN + "'\n" +
    "$out = @()\n" +
    "foreach ($a in Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and $_.Name -ne '" + ourAlias + "' -and ($_.InterfaceDescription -match $pat -or $_.Name -match $pat) }) {\n" +
    "  $dns = (Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses -join ','\n" +
    "  $def = @(Get-NetRoute -InterfaceIndex $a.ifIndex -DestinationPrefix '0.0.0.0/0','0.0.0.0/1','128.0.0.0/1' -ErrorAction SilentlyContinue).Count\n" +
    "  $out += ('{0}|{1}|{2}' -f $a.Name, $dns, $def)\n" +
    "}\n" +
    "Write-Output ('TUNNELS:' + ($out -join ';'))"
  );
  const m = /TUNNELS:(.*)/.exec(r.stdout);
  if (!m || !m[1].trim()) return [];
  return m[1].trim().split(';').filter(Boolean).map((x) => {
    const [name, dns, routes] = x.split('|');
    return { name, dns: dns || '', defaultRoutes: Number(routes) || 0 };
  });
}

/** Ждёт, пока процесс ядра действительно исчезнет: taskkill возвращается раньше. */
async function waitProcessGone(name = 'sing-box', timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await runPs("Write-Output (@(Get-Process '" + name + "' -ErrorAction SilentlyContinue).Count)", 8000);
    if (r.stdout.trim().endsWith('0')) return true;
    await new Promise((res) => setTimeout(res, 300));
  }
  return false;
}

/** Ждёт, пока адаптер прошлой сессии окончательно исчезнет из системы. */
async function waitAdapterGone(alias, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await runPs(
      "Write-Output (@(Get-NetAdapter -Name '" + String(alias).replace(/'/g, "''") + "' -ErrorAction SilentlyContinue).Count)",
      8000
    );
    if (r.stdout.trim().endsWith('0')) return true;
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

/** Снимает зависшие процессы ядра (например, после падения приложения). */
async function killOrphanCores() {
  const r = await runCmd('taskkill', ['/F', '/IM', 'sing-box.exe', '/T']);
  return r.code === 0;
}

/**
 * Сброс кэшей, из-за которых уже запущенные программы продолжают ходить
 * прежним путём: Windows помнит, через какой интерфейс идти к адресу,
 * и новые соединения приложения повторяют старое решение.
 */
async function flushRouteCaches() {
  await runCmd('netsh', ['interface', 'ip', 'delete', 'destinationcache']);
  await runCmd('netsh', ['interface', 'ipv6', 'delete', 'destinationcache']);
  await runCmd('arp', ['-d', '*']);
  await runCmd('ipconfig', ['/flushdns']);
  return true;
}

async function flushDns() {
  await runCmd('ipconfig', ['/flushdns']);
  return true;
}

/**
 * «Восстановить сеть» — чинит последствия любого VPN-клиента, не только нашего:
 * снимает системный прокси, убирает мёртвые маршруты и DNS от исчезнувших TUN-адаптеров,
 * сбрасывает кэш DNS. Не трогает то, что настроил пользователь.
 */
async function repairNetwork({ deep = false } = {}) {
  const report = [];

  await killOrphanCores();
  report.push('Остановлены зависшие процессы ядра');

  // снимаем блокировки, которые мог оставить упавший клиент (наш или чужой)
  const guardReport = await guardCleanup();
  report.push(...guardReport);
  await runPs(
    "Remove-NetFirewallRule -Group '" + FW_GROUP + "' -ErrorAction SilentlyContinue" + NL +
    "Set-NetFirewallProfile -All -DefaultOutboundAction Allow -ErrorAction SilentlyContinue"
  );
  report.push('Блокировка исходящего трафика снята');

  await clearSystemProxy();
  report.push('Системный прокси выключен (WinINET + WinHTTP)');

  // Маршруты, ведущие в несуществующий туннель
  const routes = await runPs(
    'try {\n' +
    '  $alive = Get-NetIPInterface -ErrorAction Stop | Select-Object -ExpandProperty ifIndex -Unique\n' +
    '  $dead = Get-NetRoute -ErrorAction Stop | Where-Object { $alive -notcontains $_.ifIndex }\n' +
    '  foreach ($r in $dead) { Remove-NetRoute -InputObject $r -Confirm:$false -ErrorAction SilentlyContinue }\n' +
    '  Write-Output ("routes:" + @($dead).Count)\n' +
    '} catch { Write-Output "routes:0" }'
  );
  const rm = /routes:(\d+)/.exec(routes.stdout);
  report.push('Удалено мёртвых маршрутов: ' + (rm ? rm[1] : '0'));

  // DNS, прописанный туннелем на физических адаптерах (172.19.x, 172.18.x, 198.18.x)
  const dns = await runPs(
    'try {\n' +
    '  $bad = 0\n' +
    '  foreach ($a in Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction Stop) {\n' +
    '    if ($a.ServerAddresses | Where-Object { $_ -like "172.19.*" -or $_ -like "172.18.*" -or $_ -like "198.18.*" }) {\n' +
    '      Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ResetServerAddresses -ErrorAction SilentlyContinue\n' +
    '      $bad++\n' +
    '    }\n' +
    '  }\n' +
    '  Write-Output ("dns:" + $bad)\n' +
    '} catch { Write-Output "dns:0" }'
  );
  const dm = /dns:(\d+)/.exec(dns.stdout);
  report.push('Адаптеров с чужим DNS сброшено: ' + (dm ? dm[1] : '0'));

  await flushDns();
  report.push('Кэш DNS очищен');

  if (deep) {
    await runCmd('netsh', ['winsock', 'reset']);
    await runCmd('netsh', ['int', 'ip', 'reset']);
    report.push('Winsock и стек IP сброшены (нужна перезагрузка)');
  }

  return report;
}

/* ------------------------------------------------------------------ */
/* Приоритет туннеля и killswitch                                      */
/* ------------------------------------------------------------------ */

const TUN_NAME = 'EVA';
const FW_GROUP = 'EVA VPN';
const NL = String.fromCharCode(10);
/** Метка «мы изменили системные настройки». Переживает падение и перезагрузку. */
const GUARD_FILE = path.join(os.homedir(), '.eva-vpn-guard.json');

function tunAlias() {
  return TUN_NAME;
}

function readGuard() {
  try {
    return JSON.parse(fs.readFileSync(GUARD_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeGuard(data) {
  try {
    fs.writeFileSync(GUARD_FILE, JSON.stringify(data), 'utf8');
  } catch { /* не критично */ }
}

function dropGuard() {
  try { fs.unlinkSync(GUARD_FILE); } catch { /* уже нет */ }
}

const VPN_PATTERN = 'Wintun|TAP-Windows|TAP-NDIS|OpenVPN|WireGuard|NordLynx|Amnezia|Proton|Outline|Cloudflare WARP|Tunnel';

/**
 * Делает наш туннель главным: метрика 1 у нас, чужие туннели отодвигаем на 9000.
 * Именно это решает конфликт «два VPN одновременно» — маршрут выбирается по метрике.
 */
async function applyPriority(alias = TUN_NAME) {
  const r = await runPs(
    "$ours = '" + alias + "'\n" +
    "$out = @()\n" +
    "foreach ($fam in @('IPv4','IPv6')) {\n" +
    "  Set-NetIPInterface -InterfaceAlias $ours -AddressFamily $fam -InterfaceMetric 1 -ErrorAction SilentlyContinue\n" +
    "}\n" +
    "$pat = '" + VPN_PATTERN + "'\n" +
    "foreach ($a in Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and $_.Name -ne $ours -and ($_.InterfaceDescription -match $pat -or $_.Name -match $pat) }) {\n" +
    "  $i = Get-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1\n" +
    "  if ($i) {\n" +
    "    $dns = @((Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)\n" +
    "    $rt = @(Get-NetRoute -InterfaceIndex $a.ifIndex -DestinationPrefix '0.0.0.0/0','0.0.0.0/1','128.0.0.0/1' -ErrorAction SilentlyContinue |\n" +
    "      ForEach-Object { $_.DestinationPrefix + '>' + $_.NextHop + '>' + $_.RouteMetric })\n" +
    "    $out += ('{0}|{1}|{2}|{3}|{4}|{5}' -f $a.Name, $i.InterfaceMetric, $i.AutomaticMetric, $a.ifIndex, ($dns -join ','), ($rt -join '!'))\n" +
    "    Set-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -InterfaceMetric 9000 -ErrorAction SilentlyContinue\n" +
    "    if ($dns.Count -gt 0) { Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses -ErrorAction SilentlyContinue }\n" +
    "    Get-NetRoute -InterfaceIndex $a.ifIndex -DestinationPrefix '0.0.0.0/0','0.0.0.0/1','128.0.0.0/1' -ErrorAction SilentlyContinue |\n" +
    "      Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue\n" +
    "  }\n" +
    "}\n" +
    "Write-Output ('DEMOTED:' + ($out -join ';'))"
  );
  const m = /DEMOTED:(.*)/.exec(r.stdout);
  const demoted = m && m[1].trim()
    ? m[1].trim().split(';').filter(Boolean).map((x) => {
        const [name, metric, auto, ifIndex, dns, routes] = x.split('|');
        return {
          name,
          metric: Number(metric),
          auto: String(auto).toLowerCase() === 'enabled' || auto === 'True',
          ifIndex: Number(ifIndex),
          dns: dns ? dns.split(',').filter(Boolean) : [],
          routes: routes ? routes.split('!').filter(Boolean) : []
        };
      })
    : [];

  const guard = readGuard() || {};
  // Запоминаем только первый проход: повторные вызовы видят уже отобранное
  // и записали бы пустоту как «исходное состояние».
  if (!guard.demoted || !guard.demoted.length) {
    guard.demoted = demoted;
    writeGuard(guard);
  }
  return demoted;
}

/** Возвращает чужим туннелям их прежние метрики. */
async function restorePriority() {
  const guard = readGuard();
  const demoted = (guard && guard.demoted) || [];
  if (!demoted.length) return 0;
  const lines = [];
  for (const d of demoted) {
    const target = d.ifIndex
      ? '-InterfaceIndex ' + d.ifIndex
      : "-InterfaceAlias '" + String(d.name).replace(/'/g, "''") + "'";

    lines.push(
      d.auto
        ? 'Set-NetIPInterface ' + target + ' -AddressFamily IPv4 -AutomaticMetric enabled -ErrorAction SilentlyContinue'
        : 'Set-NetIPInterface ' + target + ' -AddressFamily IPv4 -InterfaceMetric ' + d.metric + ' -ErrorAction SilentlyContinue'
    );

    if (d.dns && d.dns.length) {
      lines.push(
        'Set-DnsClientServerAddress ' + target + ' -ServerAddresses ' +
        d.dns.map((x) => "'" + x + "'").join(',') + ' -ErrorAction SilentlyContinue'
      );
    }

    for (const route of d.routes || []) {
      const [prefix, hop, metric] = route.split('>');
      if (!prefix || !d.ifIndex) continue;
      lines.push(
        "if (-not (Get-NetRoute -InterfaceIndex " + d.ifIndex + " -DestinationPrefix '" + prefix + "' -ErrorAction SilentlyContinue)) { " +
        "New-NetRoute -InterfaceIndex " + d.ifIndex + " -DestinationPrefix '" + prefix + "' -NextHop '" + (hop || '0.0.0.0') + "' -RouteMetric " + (Number(metric) || 0) +
        ' -PolicyStore ActiveStore -Confirm:$false -ErrorAction SilentlyContinue | Out-Null }'
      );
    }
  }
  await runPs(lines.join(NL));
  if (guard) {
    delete guard.demoted;
    if (Object.keys(guard).length) writeGuard(guard);
    else dropGuard();
  }
  return demoted.length;
}

/**
 * Killswitch: исходящий трафик по умолчанию запрещён, разрешены только
 * сам туннель, ядро, приложение и локальная сеть. Мимо VPN не уходит ничего.
 */
async function enableKillSwitch({ alias = TUN_NAME, coreExe, appExe, tunAddr }) {
  const q = (v) => String(v || '').replace(/'/g, "''");
  const r = await runPs(
    "Remove-NetFirewallRule -Group '" + FW_GROUP + "' -ErrorAction SilentlyContinue\n" +
    "$prev = ((Get-NetFirewallProfile -All | ForEach-Object { $_.Name + '=' + $_.DefaultOutboundAction }) -join ';')\n" +
    "New-NetFirewallRule -DisplayName 'EVA VPN tunnel' -Group '" + FW_GROUP + "' -Direction Outbound -Action Allow -InterfaceAlias '" + q(alias) + "' -Profile Any -ErrorAction SilentlyContinue | Out-Null\n" +
    // второе правило — по локальному адресу туннеля: имя интерфейса живёт
    // только до пересоздания адаптера, а адрес у нас фиксирован конфигом
    "New-NetFirewallRule -DisplayName 'EVA VPN tunnel addr' -Group '" + FW_GROUP + "' -Direction Outbound -Action Allow -LocalAddress '" + (tunAddr || '172.19.0.1') + "' -Profile Any -ErrorAction SilentlyContinue | Out-Null\n" +
    "New-NetFirewallRule -DisplayName 'EVA VPN core' -Group '" + FW_GROUP + "' -Direction Outbound -Action Allow -Program '" + q(coreExe) + "' -Profile Any -ErrorAction SilentlyContinue | Out-Null\n" +
    (appExe
      ? "New-NetFirewallRule -DisplayName 'EVA VPN app' -Group '" + FW_GROUP + "' -Direction Outbound -Action Allow -Program '" + q(appExe) + "' -Profile Any -ErrorAction SilentlyContinue | Out-Null\n"
      : '') +
    "New-NetFirewallRule -DisplayName 'EVA VPN local' -Group '" + FW_GROUP + "' -Direction Outbound -Action Allow -RemoteAddress LocalSubnet,127.0.0.0/8,224.0.0.0/4,255.255.255.255 -Profile Any -ErrorAction SilentlyContinue | Out-Null\n" +
    "New-NetFirewallRule -DisplayName 'EVA VPN dhcp' -Group '" + FW_GROUP + "' -Direction Outbound -Action Allow -Protocol UDP -LocalPort 68 -RemotePort 67 -Profile Any -ErrorAction SilentlyContinue | Out-Null\n" +
    "Set-NetFirewallProfile -All -DefaultOutboundAction Block -ErrorAction SilentlyContinue\n" +
    "$off = ((Get-NetFirewallProfile -All | Where-Object { -not $_.Enabled }) | ForEach-Object { $_.Name }) -join ','" + NL +
    "Write-Output ('OFF:' + $off)" + NL +
    "Write-Output ('PREV:' + $prev)"
  );
  const m = /PREV:(.*)/.exec(r.stdout);
  const guard = readGuard() || {};
  // База для отката пишется один раз. Если killswitch включается поверх уже
  // включённого, прежнее значение не трогаем — иначе Block запомнится как
  // «исходное состояние» и пользователь останется без сети навсегда.
  if (!guard.firewall) {
    const prev = (m && m[1].trim()) || '';
    guard.firewall = prev
      // Block в базе — почти наверняка наш же незакрытый хвост, а не выбор пользователя
      .replace(/=Block/g, '=NotConfigured') || 'Domain=NotConfigured;Private=NotConfigured;Public=NotConfigured';
    writeGuard(guard);
  }
  // брандмауэр Windows могли выключить — тогда правила ничего не значат
  const off = /OFF:(.*)/.exec(r.stdout);
  const disabled = off && off[1].trim() ? off[1].trim().split(',').filter(Boolean) : [];
  return { ok: r.code === 0, disabledProfiles: disabled };
}

/** Снимает killswitch и возвращает прежнюю политику брандмауэра. */
async function disableKillSwitch() {
  const guard = readGuard();
  // без метки мы ничего не включали — только подчищаем свои правила,
  // чтобы не переписать политику, которую выставил сам пользователь
  if (!guard || !guard.firewall) {
    await runPs("Remove-NetFirewallRule -Group '" + FW_GROUP + "' -ErrorAction SilentlyContinue");
    return true;
  }
  const prev = guard.firewall;
  const restore = prev
    .split(';')
    .map((pair) => pair.split('='))
    .filter(([name, action]) => name && action)
    .map(([name, action]) => "Set-NetFirewallProfile -Name " + name + " -DefaultOutboundAction " + action + " -ErrorAction SilentlyContinue")
    .join('\n');
  await runPs(
    "Remove-NetFirewallRule -Group '" + FW_GROUP + "' -ErrorAction SilentlyContinue\n" +
    (restore || "Set-NetFirewallProfile -All -DefaultOutboundAction Allow -ErrorAction SilentlyContinue")
  );
  if (guard) {
    delete guard.firewall;
    if (Object.keys(guard).length) writeGuard(guard);
    else dropGuard();
  }
  return true;
}

/**
 * Страховка на случай падения приложения: при старте проверяем метку и
 * откатываем всё, что не успели откатить в прошлый раз.
 */
async function guardCleanup() {
  const guard = readGuard();
  if (!guard) return [];
  const report = [];
  if (guard.firewall) {
    await disableKillSwitch();
    report.push('Killswitch с прошлого запуска снят');
  }
  if (guard.demoted && guard.demoted.length) {
    await restorePriority();
    report.push('Метрики чужих адаптеров возвращены');
  }
  dropGuard();
  return report;
}

module.exports = {
  GUARD_FILE,
  flushRouteCaches,
  foreignTunnels,
  waitProcessGone,
  waitAdapterGone,
  tunAlias,
  applyPriority,
  restorePriority,
  enableKillSwitch,
  disableKillSwitch,
  guardCleanup,
  isAdmin,
  setSystemProxy,
  clearSystemProxy,
  systemProxyState,
  killOrphanCores,
  flushDns,
  repairNetwork,
  runPs,
  runCmd
};
