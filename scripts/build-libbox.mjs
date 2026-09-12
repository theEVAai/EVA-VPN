/**
 * Сборка ядра sing-box в виде библиотеки для Android (libbox.aar).
 *
 *   node scripts/build-libbox.mjs [--all-arch]
 *
 * По умолчанию собирается только arm64 — это ~95% телефонов и в несколько
 * раз быстрее. С флагом --all-arch собираются все четыре архитектуры, как
 * для публикации.
 *
 * ---------------------------------------------------------------------------
 * Что нужно установить (переносимо, без прав администратора)
 * ---------------------------------------------------------------------------
 * Каталог инструментов задаётся переменной EVA_ANDROID_TOOLS,
 * по умолчанию %USERPROFILE%\android-build. Внутри ожидается:
 *
 *   jdk/      Temurin JDK 17
 *   go1.25/   Go 1.25.x
 *   sdk/      Android SDK: platforms;android-35, build-tools;35.0.0,
 *             ndk;28.0.13004108
 *   gopath/   сюда ставятся gomobile и gobind
 *   src/sing-box/  исходники sing-box нужной версии
 *
 * ---------------------------------------------------------------------------
 * Три вещи, на которых легко потерять час. Все три проверены на практике.
 * ---------------------------------------------------------------------------
 * 1. В пути к инструментам НЕ ДОЛЖНО быть пробелов. sdkmanager — пакетный
 *    файл, он рвёт путь по пробелу; NDK и gomobile тоже этого не переживают.
 *
 * 2. Go должен быть версии 1.25.x, а не самой свежей. На Go 1.27 сборка
 *    падает с «undefined: json.SkipFunc»: библиотека go-json-experiment/json
 *    подменяет себя стандартным encoding/json/v2 по условию сборки
 *    goexperiment.jsonv2 && go1.25, а состав этого пакета в 1.27 уже другой.
 *    В CI самого sing-box стоит ~1.25.9.
 *
 * 3. gomobile нужен из ветки SagerNet (github.com/sagernet/gomobile@v0.1.12),
 *    а не апстримный golang.org/x/mobile. Апстримный не понимает того, как
 *    sing-box описывает интерфейс платформы. И собран он должен быть тем же
 *    Go, что и само ядро.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = process.env.EVA_ANDROID_TOOLS || path.join(process.env.USERPROFILE || '', 'android-build');

const JDK = path.join(TOOLS, 'jdk');
const GO = path.join(TOOLS, 'go1.25');
const SDK = path.join(TOOLS, 'sdk');
const GOPATH = path.join(TOOLS, 'gopath');
const SRC = path.join(TOOLS, 'src', 'sing-box');
const NDK_VERSION = '28.0.13004108';
const GOMOBILE_VERSION = 'v0.1.12';

const allArch = process.argv.includes('--all-arch');

function need(what, where) {
  if (!existsSync(where)) {
    console.error(`не найдено: ${what}\n  ожидалось в ${where}`);
    console.error('\nсм. заголовок этого файла — там список того, что нужно поставить');
    process.exit(1);
  }
}

need('JDK 17', JDK);
need('Go 1.25', GO);
need('Android SDK', SDK);
need('NDK ' + NDK_VERSION, path.join(SDK, 'ndk', NDK_VERSION));
need('исходники sing-box', SRC);

if (TOOLS.includes(' ')) {
  console.error(`в пути к инструментам есть пробел: ${TOOLS}`);
  console.error('Android SDK и NDK с пробелами не работают — перенесите каталог');
  process.exit(1);
}

const env = {
  ...process.env,
  JAVA_HOME: JDK,
  GOROOT: GO,
  GOPATH,
  ANDROID_HOME: SDK,
  ANDROID_NDK_HOME: path.join(SDK, 'ndk', NDK_VERSION),
  PATH: [path.join(GO, 'bin'), path.join(GOPATH, 'bin'), path.join(JDK, 'bin'), process.env.PATH].join(path.delimiter),
};

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, env, stdio: 'inherit', maxBuffer: 1 << 28 });

const goExe = path.join(GO, 'bin', 'go.exe');

console.log('версия Go:');
run(goExe, ['version']);

console.log('\nставлю gomobile ' + GOMOBILE_VERSION + ' (ветка SagerNet, тем же Go)');
run(goExe, ['install', `github.com/sagernet/gomobile/cmd/gomobile@${GOMOBILE_VERSION}`], SRC);
run(goExe, ['install', `github.com/sagernet/gomobile/cmd/gobind@${GOMOBILE_VERSION}`], SRC);

const args = ['run', './cmd/internal/build_libbox', '-target', 'android'];
if (!allArch) args.push('-platform', 'android/arm64');

console.log(`\nсобираю libbox (${allArch ? 'все архитектуры' : 'только arm64'})`);
run(goExe, args, SRC);

const libs = path.join(ROOT, 'android', 'app', 'libs');
mkdirSync(libs, { recursive: true });

let copied = 0;
for (const name of readdirSync(SRC).filter((f) => f.endsWith('.aar'))) {
  const from = path.join(SRC, name);
  copyFileSync(from, path.join(libs, name));
  console.log(`  ${name} — ${(statSync(from).size / 1048576).toFixed(1)} МБ`);
  copied++;
}

if (!copied) {
  console.error('сборка прошла, но .aar не найден — смотрите вывод выше');
  process.exit(1);
}
console.log(`\nготово: ${copied} файл(ов) в android/app/libs`);
