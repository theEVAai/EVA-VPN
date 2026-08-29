'use strict';
/**
 * Сборка конфигурации sing-box из профиля.
 * Схема — sing-box 1.12+ (новые DNS-сервера, route actions, rule_set).
 */

const path = require('path');
const { MODULES } = require('./rules');

const TUN_IPV4 = '172.19.0.1/30';
const TUN_IPV6 = 'fdfe:dcba:9876::1/126';

/** Профиль -> outbound sing-box */
function buildOutbound(p, tag) {
  const out = { type: p.type, tag };
  out.server = p.server;
  out.server_port = p.port;

  switch (p.type) {
    case 'vless':
      out.uuid = p.uuid;
      if (p.flow) out.flow = p.flow;
      out.packet_encoding = 'xudp';
      break;
    case 'vmess':
      out.uuid = p.uuid;
      out.security = p.security || 'auto';
      out.alter_id = p.alter_id || 0;
      out.packet_encoding = 'xudp';
      break;
    case 'trojan':
      out.password = p.password;
      break;
    case 'shadowsocks':
      out.method = p.method;
      out.password = p.password;
      break;
    case 'hysteria2':
      out.password = p.password;
      if (p.obfs && p.obfs.type) out.obfs = { type: p.obfs.type, password: p.obfs.password || '' };
      break;
    default:
      throw new Error('Неподдерживаемый тип ключа: ' + p.type);
  }

  if (p.tls && p.tls.enabled) {
    const tls = { enabled: true };
    if (p.tls.server_name) tls.server_name = p.tls.server_name;
    if (p.tls.insecure) tls.insecure = true;
    if (p.tls.alpn && p.tls.alpn.length) tls.alpn = p.tls.alpn;
    if (p.tls.utls && p.tls.utls.enabled) {
      tls.utls = { enabled: true, fingerprint: p.tls.utls.fingerprint || 'chrome' };
    }
    if (p.tls.reality && p.tls.reality.enabled) {
      tls.reality = {
        enabled: true,
        public_key: p.tls.reality.public_key,
        short_id: p.tls.reality.short_id || ''
      };
      // Reality всегда идёт с подделкой отпечатка TLS
      if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' };
    }
    out.tls = tls;
  }

  if (p.transport && p.transport.type) out.transport = p.transport;
  return out;
}

/**
 * @param {object} args
 * @param {object} args.profile   нормализованный профиль (см. parse.js)
 * @param {'tun'|'proxy'} args.mode
 * @param {object} args.opts      настройки приложения
 * @param {object} args.paths     { srss, cache }
 */
function buildConfig({ profile, mode, opts, paths }) {
  const o = Object.assign(
    {
      mixedPort: 2080,
      clashPort: 19090,
      clashSecret: '',
      allowLan: false,
      ipv6: false,
      tunStack: 'mixed',
      tunName: 'EVA',
      mtu: 9000,
      blockAds: false,
      blockQuic: true,
      bypassPrivate: true,
      dnsRemote: 'https://1.1.1.1/dns-query',
      dnsDirect: '77.88.8.8',
      logLevel: 'info'
    },
    opts || {}
  );

  const srss = (paths && paths.srss) || '';
  const ruleSets = [];
  const routeRules = [];
  const dnsRules = [];

  // --- DNS ---
  const dnsServers = [];
  const remote = String(o.dnsRemote || '').trim();
  if (remote.startsWith('https://')) {
    const u = new URL(remote);
    dnsServers.push({
      type: 'https',
      tag: 'dns-remote',
      server: u.hostname,
      path: u.pathname && u.pathname !== '/' ? u.pathname : undefined,
      detour: 'proxy',
      domain_resolver: 'dns-direct'
    });
  } else {
    dnsServers.push({ type: 'udp', tag: 'dns-remote', server: remote || '1.1.1.1', detour: 'proxy' });
  }
  dnsServers.push({ type: 'udp', tag: 'dns-direct', server: String(o.dnsDirect || '77.88.8.8') });
  dnsServers.push({ type: 'hosts', tag: 'dns-hosts' });

  const config = {
    log: { level: o.logLevel, timestamp: true },
    dns: {
      servers: dnsServers,
      rules: dnsRules,
      final: 'dns-remote',
      strategy: o.ipv6 ? 'prefer_ipv4' : 'ipv4_only',
      independent_cache: true
    },
    inbounds: [],
    outbounds: [
      buildOutbound(profile, 'proxy'),
      { type: 'direct', tag: 'direct' }
    ],
    route: {
      rules: routeRules,
      rule_set: ruleSets,
      final: 'proxy',
      auto_detect_interface: true,
      default_domain_resolver: { server: 'dns-direct' }
    },
    experimental: {
      clash_api: {
        external_controller: '127.0.0.1:' + o.clashPort,
        secret: o.clashSecret || ''
      }
    }
  };

  if (paths && paths.cache) {
    config.experimental.cache_file = { enabled: true, path: paths.cache, store_fakeip: false };
  }

  // --- Inbounds ---
  const listen = o.allowLan ? '0.0.0.0' : '127.0.0.1';
  config.inbounds.push({
    type: 'mixed',
    tag: 'mixed-in',
    listen,
    listen_port: o.mixedPort
  });

  if (mode === 'tun') {
    const tun = {
      type: 'tun',
      tag: 'tun-in',
      interface_name: o.tunName || 'EVA',
      address: o.ipv6 ? [TUN_IPV4, TUN_IPV6] : [TUN_IPV4],
      mtu: o.mtu,
      auto_route: true,
      strict_route: true,
      stack: o.tunStack
    };
    config.inbounds.push(tun);
  }

  // --- Правила маршрутизации ---
  routeRules.push({ action: 'sniff' });
  routeRules.push({ protocol: 'dns', action: 'hijack-dns' });
  // Windows-специфика: NetBIOS/LLMNR/mDNS мимо туннеля, иначе локальная сеть тормозит
  routeRules.push({ network: 'udp', port: [135, 137, 138, 139, 5353], action: 'reject' });

  if (o.bypassPrivate) {
    routeRules.push({ ip_is_private: true, action: 'route', outbound: 'direct' });
    if (srss) {
      ruleSets.push({ type: 'local', tag: 'geosite-private', format: 'binary', path: path.join(srss, 'geosite-private.srs') });
      dnsRules.push({ rule_set: ['geosite-private'], action: 'route', server: 'dns-direct' });
      routeRules.push({ rule_set: ['geosite-private'], action: 'route', outbound: 'direct' });
    }
  }

  // --- модули блокировок и обходов (см. rules.js) ---
  // DIRECT-правила идут первыми: то, что уходит мимо VPN, важнее того, что режется
  for (const mod of MODULES.filter((m) => m.action === 'direct')) {
    if (!o[mod.key]) continue;

    // обход по имени процесса: домены тут ни при чём, важно кто именно ходит
    if (mod.processes && mod.processes.length) {
      routeRules.push({ process_name: mod.processes.slice(), action: 'route', outbound: 'direct' });
      continue;
    }

    const rule = { action: 'route', outbound: 'direct' };
    if (mod.suffixes) rule.domain_suffix = mod.suffixes.slice();
    if (mod.domains) rule.domain_suffix = (rule.domain_suffix || []).concat(mod.domains);
    routeRules.push(rule);
    dnsRules.push({ domain_suffix: rule.domain_suffix.slice(), action: 'route', server: 'dns-direct' });
  }

  for (const mod of MODULES.filter((m) => m.action === 'reject')) {
    if (!o[mod.key]) continue;
    if (mod.ruleSet && srss) {
      const tag = mod.ruleSet;
      if (!ruleSets.some((r) => r.tag === tag)) {
        ruleSets.push({ type: 'local', tag, format: 'binary', path: path.join(srss, tag + '.srs') });
      }
      routeRules.push({ rule_set: [tag], action: 'reject' });
      dnsRules.push({ rule_set: [tag], action: 'predefined', rcode: 'NXDOMAIN' });
    }
    if (mod.domains && mod.domains.length) {
      routeRules.push({ domain_suffix: mod.domains.slice(), action: 'reject' });
      dnsRules.push({ domain_suffix: mod.domains.slice(), action: 'predefined', rcode: 'NXDOMAIN' });
    }
  }

  // QUIC через туннель ведёт себя хуже TCP: потери множатся, а браузер
  // не понижает скорость. Все клиенты прокси режут его по этой же причине,
  // после чего браузер сам откатывается на HTTP/2 поверх TCP.
  if (o.blockQuic) {
    routeRules.push({ network: 'udp', port: [443], action: 'reject' });
  }

  if (!o.ipv6) {
    routeRules.push({ ip_version: 6, action: 'reject' });
  }

  return config;
}

module.exports = { buildConfig, buildOutbound, TUN_IPV4, TUN_IPV6 };
