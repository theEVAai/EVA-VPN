/**
 * Складывает расширение в архив для загрузки в магазины.
 *
 *   node scripts/pack-extension.mjs
 *
 * На выходе dist/EVA-VPN-extension-<версия>.zip. Версия берётся из
 * манифеста расширения, а не из package.json: у расширения свой цикл
 * обновлений, магазины проверяют сборку по несколько дней.
 *
 * Архив собирается вручную, а не средствами Windows. Причина проверена:
 * и Compress-Archive, и ZipFile.CreateFromDirectory в Windows PowerShell
 * пишут пути с обратными слэшами (icons\icon.png), а формат ZIP требует
 * прямых — магазины такой архив могут не принять.
 *
 * В релиз GitHub архив не кладётся: там только установщики.
 */
import { deflateRawSync, crc32 } from 'node:zlib';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'extension');
const OUT_DIR = path.join(ROOT, 'dist');

/** Все файлы каталога, путями через прямой слэш, в устойчивом порядке. */
function listFiles(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = prefix ? prefix + '/' + name : name;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push({ name: rel, data: readFileSync(full) });
  }
  return out;
}

/** Дата в формате MS-DOS, как того требует ZIP. */
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function buildZip(files, when = new Date()) {
  const { time, date } = dosTime(when);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const raw = file.data;
    const packed = deflateRawSync(raw, { level: 9 });
    // если сжатие не помогло, кладём как есть: так делают все упаковщики
    const useStore = packed.length >= raw.length;
    const body = useStore ? raw : packed;
    const method = useStore ? 0 : 8;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // версия, нужная для распаковки
    local.writeUInt16LE(0x0800, 6);      // флаг: имена в UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);            // версия упаковщика
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);            // extra
    dir.writeUInt16LE(0, 32);            // комментарий
    dir.writeUInt16LE(0, 34);            // номер диска
    dir.writeUInt16LE(0, 36);            // внутренние атрибуты
    dir.writeUInt32LE(0, 38);            // внешние атрибуты
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

const manifest = JSON.parse(readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const out = path.join(OUT_DIR, `EVA-VPN-extension-${manifest.version}.zip`);

mkdirSync(OUT_DIR, { recursive: true });
if (existsSync(out)) rmSync(out);

const files = listFiles(SRC);
writeFileSync(out, buildZip(files));

console.log(`готово: ${path.relative(ROOT, out)} — ${(statSync(out).size / 1024).toFixed(0)} КБ`);
for (const f of files) console.log(`   ${f.name}`);
console.log('Chrome Web Store и Firefox Add-ons принимают этот архив как есть.');
