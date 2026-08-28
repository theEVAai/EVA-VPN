'use strict';
/**
 * Автозапуск. Если приложение запущено с правами администратора — заводим
 * задачу в планировщике с повышенными правами (иначе Windows не даст поднять
 * туннель молча). Без прав — обычная запись автозапуска.
 */

const { app } = require('electron');
const { runCmd } = require('./netfix');

const TASK = 'EVA VPN Autostart';

async function taskExists() {
  const r = await runCmd('schtasks', ['/Query', '/TN', TASK]);
  return r.code === 0;
}

async function enable(elevated) {
  const exe = process.execPath;
  if (elevated && app.isPackaged) {
    await runCmd('schtasks', [
      '/Create', '/TN', TASK,
      '/TR', '"' + exe + '" --hidden',
      '/SC', 'ONLOGON',
      '/RL', 'HIGHEST',
      '/F'
    ]);
    return true;
  }
  app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
  return true;
}

async function disable() {
  if (await taskExists()) await runCmd('schtasks', ['/Delete', '/TN', TASK, '/F']);
  app.setLoginItemSettings({ openAtLogin: false });
  return true;
}

async function isEnabled() {
  if (await taskExists()) return true;
  return app.getLoginItemSettings().openAtLogin;
}

module.exports = { enable, disable, isEnabled, TASK };
