/**
 * Проверка мобильной конфигурации настоящим ядром.
 *
 *   node scripts/check-android-config.mjs
 *
 * Что делает: гоняет проверки Android-проекта на JVM (они кладут готовые
 * конфигурации в android/app/build/configs), а затем скармливает каждую
 * настоящему sing-box командой check.
 *
 * Зачем: генератор конфигурации живёт в Kotlin и выполняется на телефоне.
 * Без этого шага об ошибке в нём мы узнавали бы уже по молчащему туннелю
 * на чужом устройстве — самый дорогой способ находить опечатки.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = path.join(ROOT, 'android');
const CORE = path.join(ROOT, 'core', 'sing-box.exe');
const TOOLS = process.env.EVA_ANDROID_TOOLS || path.join(process.env.USERPROFILE || '', 'android-build');
const GRADLE = path.join(TOOLS, 'gradle-8.9', 'bin', 'gradle.bat');
const JDK = path.join(TOOLS, 'jdk');

if (!existsSync(CORE)) {
  console.error(`не найдено ядро: ${CORE}\nсначала: node scripts/fetch-core.mjs`);
  process.exit(1);
}
if (!existsSync(GRADLE)) {
  console.error(`не найден Gradle: ${GRADLE}\nсм. заголовок scripts/build-libbox.mjs`);
  process.exit(1);
}

console.log('прогоняю проверки Android-проекта...');
// shell: true обязателен — Node с версии 20 отказывается запускать .bat
// напрямую (защита после уязвимости с подстановкой аргументов).
execFileSync(`"${GRADLE}"`, ['testDebugUnitTest', '--console=plain'], {
  cwd: ANDROID,
  env: { ...process.env, JAVA_HOME: JDK },
  stdio: 'inherit',
  shell: true,
});

const dir = path.join(ANDROID, 'app', 'build', 'configs');
if (!existsSync(dir)) {
  console.error('проверки не создали ни одной конфигурации — смотрите вывод выше');
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
if (!files.length) {
  console.error('в build/configs пусто');
  process.exit(1);
}

console.log('');
console.log(`проверяю ${files.length} конфигураций настоящим ядром:`);

let bad = 0;
for (const name of files) {
  const file = path.join(dir, name);
  try {
    execFileSync(CORE, ['check', '-c', file], { stdio: 'pipe' });
    console.log(`  ок      ${name}`);
  } catch (e) {
    bad++;
    const text = String(e.stderr || e.stdout || e.message).trim().split('\n')[0];
    console.log(`  ОШИБКА  ${name}`);
    console.log(`          ${text}`);
  }
}

console.log('');
if (bad) {
  console.error(`не принято ядром: ${bad} из ${files.length}`);
  process.exit(1);
}
console.log(`всё в порядке: ядро приняло все ${files.length}`);
