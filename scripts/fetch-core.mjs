/**
 * Скачивает ядро sing-box и наборы правил в ./core.
 * Запуск: node scripts/fetch-core.mjs [версия]
 * Используется и локально, и в CI — бинарник ядра не хранится в репозитории.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(ROOT, 'core');
const SRSS = path.join(CORE, 'srss');

const VERSION = process.argv[2] || '1.13.12';
const ARCH = 'amd64';
const NAME = `sing-box-${VERSION}-windows-${ARCH}`;
const ZIP_URL = `https://github.com/SagerNet/sing-box/releases/download/v${VERSION}/${NAME}.zip`;

const RULE_SETS = [
  'geosite-category-ads-all',
  'geosite-private'
];

async function download(url, dest) {
  process.stdout.write(`↓ ${url}\n`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

function unzip(zip, out) {
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`
  ], { stdio: 'inherit' });
}

fs.mkdirSync(CORE, { recursive: true });
fs.mkdirSync(SRSS, { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evacore-'));
const zip = path.join(tmp, NAME + '.zip');

await download(ZIP_URL, zip);
unzip(zip, tmp);
fs.copyFileSync(path.join(tmp, NAME, 'sing-box.exe'), path.join(CORE, 'sing-box.exe'));
console.log('✓ sing-box.exe', VERSION);

for (const rs of RULE_SETS) {
  await download(
    `https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/${rs}.srs`,
    path.join(SRSS, rs + '.srs')
  );
}
console.log('✓ наборы правил:', RULE_SETS.join(', '));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('Готово →', CORE);
