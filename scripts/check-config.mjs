/**
 * Самопроверка: разбираем эталонные ссылки, собираем конфиги для обоих режимов
 * и скармливаем их `sing-box check`. Ловит расхождения со схемой ядра при обновлении.
 *
 * Запуск: node scripts/check-config.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseLink, parseMany } = require(path.join(ROOT, 'src/main/parse.js'));
const { buildConfig } = require(path.join(ROOT, 'src/main/config.js'));

const CORE = path.join(ROOT, 'core', 'sing-box.exe');
const SRSS = path.join(ROOT, 'core', 'srss');
const PBK = 'qF79-3Hn7wBEfANaVGjJTNEAEDwUfxffj5Y0mcpUTxc'; // случайный публичный ключ для проверки схемы

const LINKS = [
  ['vless + reality + vision', `vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=${PBK}&sid=ab&type=tcp&flow=xtls-rprx-vision#Reality`],
  ['vless + ws + tls', 'vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=tls&sni=a.example.com&type=ws&path=%2Fws&host=a.example.com#WS'],
  ['vless + grpc', 'vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=tls&type=grpc&serviceName=grpcsvc#GRPC'],
  ['vmess', 'vmess://' + Buffer.from(JSON.stringify({ v: '2', ps: 'VM', add: 'example.com', port: '443', id: '11111111-2222-3333-4444-555555555555', aid: '0', net: 'ws', path: '/p', host: 'example.com', tls: 'tls', scy: 'auto' })).toString('base64')],
  ['trojan', 'trojan://password123@example.com:443?security=tls&sni=example.com&type=tcp#TJ'],
  ['shadowsocks', 'ss://' + Buffer.from('aes-256-gcm:password123').toString('base64') + '@example.com:8388#SS'],
  ['hysteria2', 'hysteria2://password123@example.com:443?sni=example.com#HY2']
];

let failed = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evacheck-'));

for (const [name, link] of LINKS) {
  const profile = parseLink(link);
  if (!profile || profile.error) {
    console.error(`✗ ${name}: разбор — ${profile ? profile.error : 'null'}`);
    failed++;
    continue;
  }
  for (const mode of ['tun', 'proxy']) {
    const cfg = buildConfig({
      profile,
      mode,
      opts: { adblock: true, mixedPort: 2080, clashPort: 19090 },
      paths: { srss: SRSS, cache: path.join(tmp, 'cache.db') }
    });
    const file = path.join(tmp, `${name.replace(/\W+/g, '_')}-${mode}.json`);
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    try {
      execFileSync(CORE, ['check', '-c', file], { stdio: 'pipe' });
      console.log(`✓ ${name} [${mode}]`);
    } catch (e) {
      console.error(`✗ ${name} [${mode}]: ${String(e.stderr || e.message).trim()}`);
      failed++;
    }
  }
}

// подписка: base64 от списка ссылок
const subBody = Buffer.from(LINKS.map(([, l]) => l).join('\n')).toString('base64');
const parsed = parseMany(subBody);
if (parsed.length !== LINKS.length) {
  console.error(`✗ подписка: разобрано ${parsed.length} из ${LINKS.length}`);
  failed++;
} else {
  console.log(`✓ подписка base64: ${parsed.length} серверов`);
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failed) {
  console.error(`\nОшибок: ${failed}`);
  process.exit(1);
}
console.log('\nВсё в порядке.');
