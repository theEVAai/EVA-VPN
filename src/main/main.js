'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, shell, clipboard, nativeImage, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { Core } = require('./core');
const { Store } = require('./store');
const parse = require('./parse');
const netfix = require('./netfix');
const { MODULES } = require('./rules');
const { Site } = require('./site');
const { LogFile } = require('./logfile');
const autostart = require('./autostart');

const isDev = !app.isPackaged;
const ROOT = path.join(__dirname, '..', '..');
const RES = isDev ? ROOT : process.resourcesPath;

const logFile = new LogFile(app.getPath('userData'));

const paths = {
  coreExe: path.join(RES, 'core', 'sing-box.exe'),
  srss: path.join(RES, 'core', 'srss'),
  appExe: process.execPath,
  userData: app.getPath('userData'),
  logFile
};

// Первые строки журнала отвечают на вопрос «какая сборка запущена»:
// без этого разбор жалобы начинается с гадания, старый бинарник или новый.
try {
  const exe = process.execPath;
  const built = fs.statSync(app.isPackaged ? exe : __filename).mtime;
  logFile.write(
    'версия ' + app.getVersion() +
    ' · сборка от ' + built.toLocaleString('ru-RU') +
    ' · ' + (app.isPackaged ? 'упакована' : 'режим разработки') +
    ' · ' + exe
  );
} catch { /* журнал не повод падать */ }

/** Событие приложения: попадает и в журнал ядра, и в файл. */
function note(text) {
  logFile.write('[app] ' + text);
  if (core) core.log(text);
}

let win = null;
let tray = null;
let store = null;
let core = null;
let site = null;
let adminRights = false;
let quitting = false;
let intended = false;      // пользователь хочет быть подключённым
let retryTimer = null;
let flaps = [];            // метки обрывов: ловим «поднялся и сразу упал»
const FLAP_WINDOW = 10 * 60 * 1000;
const FLAP_LIMIT = 3;
const RETRY_DELAYS = [3000, 10000, 30000];
let pendingRestart = false;   // настройки, которые ждут переподключения
const startHidden = process.argv.includes('--hidden');

/* ------------------------------------------------------------------ */
/* Окно                                                                */
/* ------------------------------------------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 360,
    height: 660,
    minWidth: 360,
    minHeight: 620,
    maxWidth: 460,
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#0d1207',
    show: false,
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.removeMenu();
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });

  win.on('close', (e) => {
    if (!quitting && store.settings.minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* ------------------------------------------------------------------ */
/* Трей                                                                */
/* ------------------------------------------------------------------ */

function trayIcon(connected) {
  const file = path.join(ROOT, 'build', connected ? 'tray-on.png' : 'tray-off.png');
  if (fs.existsSync(file)) return nativeImage.createFromPath(file);
  return nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png'));
}

function updateTray() {
  if (!tray) return;
  const connected = core.state === 'running';
  const p = store.activeProfile();
  tray.setImage(trayIcon(connected));
  tray.setToolTip('EVA VPN — ' + (connected ? 'подключён' : 'отключён') + (p ? '\n' + p.name : ''));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: p ? p.name : 'Ключ не добавлен', enabled: false },
      { type: 'separator' },
      {
        label: connected ? 'Отключить' : 'Подключить',
        click: () => (connected ? doDisconnect() : doConnect())
      },
      {
        label: 'Показать окно',
        click: () => {
          if (!win) createWindow();
          else {
            win.show();
            win.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Снять блокировку сети',
        click: async () => {
          await netfix.disableKillSwitch();
          await netfix.restorePriority();
          send('toast', { text: 'Блокировка снята', kind: 'ok' });
        }
      },
      {
        label: 'Восстановить сеть',
        click: async () => {
          await netfix.repairNetwork({ deep: false });
          send('toast', { text: 'Сеть восстановлена', kind: 'ok' });
        }
      },
      {
        label: 'Выход',
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
}

function createTray() {
  tray = new Tray(trayIcon(false));
  tray.on('click', () => {
    if (!win) createWindow();
    else if (win.isVisible()) win.hide();
    else {
      win.show();
      win.focus();
    }
  });
  updateTray();
}

/* ------------------------------------------------------------------ */
/* Подключение                                                         */
/* ------------------------------------------------------------------ */

function snapshot() {
  return {
    state: core.state,
    mode: core.mode,
    error: core.lastError,
    isAdmin: adminRights,
    version: app.getVersion(),
    activeId: store.data.activeId,
    profile: store.activeProfile(),
    profiles: store.profiles,
    subs: store.data.subs,
    settings: store.settings,
    stats: core.stats,
    uptime: core.startedAt ? Date.now() - core.startedAt : 0,
    guard: { killSwitch: core.killSwitchOn, priority: core.priorityApplied },
    pendingRestart,
    modules: MODULES.map((m) => ({ key: m.key, action: m.action, title: m.title, hint: m.hint, badge: m.badge || null })),
    site: { authorized: Boolean(site && site.authorized) }
  };
}

/**
 * Все операции с туннелем идут по одной очереди. Пользователь кликает по
 * сердцу быстрее, чем поднимается адаптер, — и без очереди подключение
 * стартовало поверх отключения, а два ядра дрались за один адаптер.
 */
let opChain = Promise.resolve();

function serialize(label, fn) {
  const run = async () => {
    note('операция: ' + label);
    return fn();
  };
  const next = opChain.then(run, run);
  opChain = next.then(
    () => {},
    () => {}
  );
  return next;
}

/** Настройки приложения -> опции для конфига ядра. */
function coreSettings() {
  const s = store.settings;
  return Object.assign({}, s, {
    ipv6: !s.blockIpv6,
    tunName: netfix.tunAlias()
  });
}

async function doConnectInner() {
  const profile = store.activeProfile();
  if (!profile) {
    send('toast', { text: 'Сначала добавьте ключ доступа', kind: 'err' });
    return { ok: false, error: 'Нет ключа' };
  }
  let mode = store.settings.mode;
  if (mode === 'tun' && !adminRights) {
    return { ok: false, error: 'need-admin' };
  }
  intended = true;
  note('Подключение: ' + profile.name + ' (' + profile.server + ':' + profile.port + '), режим ' + mode);

  const res = await core.start(profile, mode, coreSettings());
  if (!res.ok) {
    note('Не удалось подключиться: ' + res.error);
    return res;
  }

  pendingRestart = false;
  core.testDelay().then((d) => send('ping', { delay: d }));

  // Два туннеля одновременно — самая частая причина «сайты не открываются»
  if (mode === 'tun') {
    netfix.foreignTunnels().then((list) => {
      const rivals = list.filter((t) => t.defaultRoutes > 0 || t.dns);
      if (!rivals.length) return;
      const names = rivals.map((t) => t.name).join(', ');
      note('Рядом работает чужой туннель: ' + names + ' (маршрутов по умолчанию: ' +
        rivals.map((t) => t.defaultRoutes).join(',') + ', DNS: ' + rivals.map((t) => t.dns || '—').join(',') + ')');
      send('toast', {
        text: store.settings.vpnPriority
          ? 'Рядом работает ' + names + ' — подавлен на время сессии'
          : 'Рядом работает ' + names + ' — включите приоритет или выключите соседа',
        kind: store.settings.vpnPriority ? 'ok' : 'err'
      });
    });
  }

  // Через пару секунд проверяем, что трафик реально ходит
  setTimeout(async () => {
    if (core.state !== 'running') return;
    const t = await core.selfTest();
    send('selftest', t);
    if (t.ok) return;

    // Туннель есть, ядро отвечает, а система наружу не ходит — значит наши же
    // правила брандмауэра и режут. Защита не должна оставлять человека без сети:
    // снимаем её сами и говорим об этом, вместо молчаливого «ЗАЩИЩЕНО».
    if (t.viaCore && core.killSwitchOn) {
      note('Killswitch блокировал системный трафик — снимаю его');
      await netfix.disableKillSwitch();
      core.killSwitchOn = false;
      send('state', snapshot());
      const again = await core.selfTest();
      send('selftest', again);
      send('toast', {
        text: again.ok
          ? 'Killswitch блокировал трафик — снят, соединение работает'
          : 'Трафик не проходит даже без killswitch — смотрите журнал',
        kind: 'err'
      });
      return;
    }

    send('toast', { text: 'Туннель поднят, но трафик не проходит — смотрите журнал', kind: 'err' });
  }, 2500);

  return res;
}

async function doDisconnectInner() {
  intended = false;
  flaps = [];
  clearTimeout(retryTimer);
  note('Отключение по команде пользователя');
  await core.stop();
  return { ok: true };
}

/**
 * Ядро упало само — поднимаем обратно. Считаем обрывы в скользящем окне:
 * раньше счётчик обнулялся при каждом удачном старте, и «поднялся-упал»
 * крутилось бесконечно. Теперь после трёх обрывов за десять минут
 * приложение останавливается и говорит об этом прямо.
 */
function scheduleRetry() {
  if (!intended || quitting) return false;

  const now = Date.now();
  flaps = flaps.filter((t) => now - t < FLAP_WINDOW);
  flaps.push(now);

  if (flaps.length > FLAP_LIMIT) {
    intended = false;
    clearTimeout(retryTimer);
    note('Переподключение остановлено: ' + flaps.length + ' обрывов за 10 минут. Смотрите журнал выше.');
    send('toast', { text: 'Туннель падает раз за разом — переподключение остановлено', kind: 'err' });
    return false;
  }

  const delay = RETRY_DELAYS[Math.min(flaps.length - 1, RETRY_DELAYS.length - 1)];
  note('Обрыв ' + flaps.length + ' из ' + FLAP_LIMIT + ', повтор через ' + Math.round(delay / 1000) + ' с');
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    if (intended && core.state !== 'running') {
      send('toast', { text: 'Переподключение (' + flaps.length + '/' + FLAP_LIMIT + ')…' });
      serialize('автоповтор', doConnectInner);
    }
  }, delay);
  return true;
}

const doConnect = () => serialize('подключение', doConnectInner);
const doDisconnect = () => serialize('отключение', doDisconnectInner);

function relaunchAsAdmin() {
  const exe = process.execPath;
  let args;
  if (isDev) args = [ROOT];
  else args = process.argv.slice(1);
  const argList = args.length ? ", -ArgumentList " + args.map((a) => "'" + a.replace(/'/g, "''") + "'").join(',') : '';
  const cmd = "Start-Process -FilePath '" + exe.replace(/'/g, "''") + "' -Verb RunAs" + argList;
  try {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
  } catch (e) {
    return false;
  }
  quitting = true;
  setTimeout(() => app.quit(), 400);
  return true;
}

/* ------------------------------------------------------------------ */
/* Подписки                                                            */
/* ------------------------------------------------------------------ */

async function fetchSub(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'EVA VPN/' + app.getVersion() + ' sing-box' },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  const userinfo = parse.parseUserInfo(res.headers.get('subscription-userinfo'));
  return { text, userinfo };
}

async function updateSub(sub) {
  const { text, userinfo } = await fetchSub(sub.url);
  const list = parse.parseMany(text);
  if (!list.length) throw new Error('В подписке нет ключей');
  store.replaceSubProfiles(sub.id, list);
  sub.lastUpdate = Date.now();
  sub.userinfo = userinfo;
  store.save();
  return list.length;
}

/* ------------------------------------------------------------------ */
/* Ключ из личного кабинета                                            */
/* ------------------------------------------------------------------ */

/**
 * Сайт выдаёт по одному ключу на платформу, поэтому в приложении он тоже
 * один: старый заменяется новым, но цвет и выбор пользователя сохраняются.
 */
function importSiteKey(data) {
  if (!data || !data.connectionUrl) return null;
  const profile = parse.parseLink(data.connectionUrl);
  if (!profile || profile.error) return null;

  if (data.server) {
    const label = [data.server.flagEmoji, data.server.cityName].filter(Boolean).join(' ');
    if (label) profile.name = label;
  }
  const prev = store.profiles.find((x) => x.source === 'site');
  if (prev && prev.color) profile.color = prev.color;

  store.replaceSubProfiles('site', [profile]);
  const added = store.profiles.find((x) => x.source === 'site');
  if (added) store.setActive(added.id);
  updateTray();
  return added || null;
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('app:state', () => snapshot());

  ipcMain.handle('vpn:toggle', async () => {
    // пока идёт переход, повторные нажатия игнорируем: раньше они
    // отменяли начатое подключение и запускали новое поверх него
    if (core.state === 'starting' || core.state === 'stopping' || core.starting) {
      return { ok: false, error: 'busy' };
    }
    if (core.state === 'running') return doDisconnect();
    return doConnect();
  });

  ipcMain.handle('vpn:connect', () => doConnect());
  ipcMain.handle('vpn:disconnect', () => doDisconnect());

  ipcMain.handle('app:relaunchAdmin', () => relaunchAsAdmin());

  ipcMain.handle('keys:add', async (_e, text) => {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, error: 'Пусто' };

    if (/^https?:\/\//i.test(raw)) {
      try {
        const sub = store.addSub(raw, new URL(raw).hostname);
        const n = await updateSub(sub);
        return { ok: true, added: n, kind: 'sub' };
      } catch (e) {
        return { ok: false, error: 'Подписка не загрузилась: ' + e.message };
      }
    }

    const list = parse.parseMany(raw);
    if (!list.length) {
      const one = parse.parseLink(raw);
      return { ok: false, error: one && one.error ? one.error : 'Не похоже на ключ или ссылку подписки' };
    }
    const added = store.addProfiles(list, 'manual');
    return { ok: true, added, kind: 'key' };
  });

  ipcMain.handle('keys:select', async (_e, id) => {
    store.setActive(id);
    if (core.state === 'running') await doConnect();
    updateTray();
    return snapshot();
  });

  ipcMain.handle('keys:remove', (_e, id) => {
    store.removeProfile(id);
    updateTray();
    return snapshot();
  });

  ipcMain.handle('keys:color', (_e, id, hex) => {
    store.setProfileColor(id, hex);
    return snapshot();
  });

  ipcMain.handle('keys:copy', (_e, id) => {
    const p = store.profiles.find((x) => x.id === id) || store.activeProfile();
    if (!p) return false;
    clipboard.writeText(p.link || '');
    return true;
  });

  ipcMain.handle('subs:update', async (_e, id) => {
    const list = id ? store.data.subs.filter((s) => s.id === id) : store.data.subs;
    if (!list.length) return { ok: false, error: 'Нет подписок' };
    let total = 0;
    for (const s of list) {
      try {
        total += await updateSub(s);
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    return { ok: true, added: total };
  });

  ipcMain.handle('subs:remove', (_e, id) => {
    store.removeSub(id);
    return snapshot();
  });

  ipcMain.handle('settings:set', async (_e, key, value) => {
    store.setSetting(key, value);
    if (key === 'autoStart') {
      if (value) await autostart.enable(adminRights);
      else await autostart.disable();
    }
    const running = core.state === 'running';

    // Killswitch и приоритет живут в системе, а не в конфиге ядра:
    // их можно включить и снять на лету, не трогая туннель
    if (running && core.mode === 'tun' && key === 'killSwitch') {
      if (value) {
        const ks = await netfix.enableKillSwitch({
          alias: netfix.tunAlias(),
          coreExe: paths.coreExe,
          appExe: paths.appExe,
          tunAddr: '172.19.0.1'
        });
        core.killSwitchOn = true;
        if (ks && ks.disabledProfiles && ks.disabledProfiles.length) {
          send('toast', { text: 'Брандмауэр Windows выключен — killswitch не удержит трафик', kind: 'err' });
        }
      } else {
        await netfix.disableKillSwitch();
        core.killSwitchOn = false;
      }
    }

    if (running && core.mode === 'tun' && key === 'vpnPriority') {
      if (value) {
        await netfix.applyPriority(netfix.tunAlias());
        core.priorityApplied = true;
      } else {
        await netfix.restorePriority();
        core.priorityApplied = false;
      }
    }

    // Смена режима — осознанное действие, её применяем сразу.
    if (key === 'mode' && running) {
      await doConnect();
      return snapshot();
    }

    // Остальное меняет конфиг ядра. Перезапуск туннеля рвёт все живые
    // соединения, поэтому не делаем его исподтишка: копим и ждём кнопку.
    const configKeys = [
      'blockIpv6', 'tunStack', 'allowLan', 'mixedPort', 'dnsRemote', 'dnsDirect',
      'blockTrackers', 'ruDirect', 'kodikDirect', 'trustedDirect'
    ];
    if (running && configKeys.includes(key)) {
      pendingRestart = true;
    }
    return snapshot();
  });

  ipcMain.handle('net:repair', async (_e, deep) => {
    if (core.state === 'running') await core.stop();
    const report = await netfix.repairNetwork({ deep: !!deep });
    return report;
  });

  ipcMain.handle('site:login', async (_e, email, password, code) => {
    try {
      await site.login(email, password, code);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message, code: e.code };
    }
  });

  ipcMain.handle('site:logout', async () => {
    await site.logout();
    send('state', snapshot());
    return { ok: true };
  });

  ipcMain.handle('site:refresh', async () => {
    if (!site.authorized) return { ok: false, error: 'Не выполнен вход', code: 'UNAUTHORIZED' };
    try {
      const data = await site.dashboard('PC');
      return { ok: true, data };
    } catch (e) {
      if (e.code === 'UNAUTHORIZED') send('state', snapshot());
      return { ok: false, error: e.message, code: e.code };
    }
  });

  ipcMain.handle('site:import', async () => {
    if (!site.authorized) return { ok: false, error: 'Не выполнен вход' };
    try {
      const key = await site.keys('PC');
      const profile = importSiteKey(key);
      if (!profile) return { ok: false, error: 'Сайт не отдал ключ' };
      if (core.state === 'running') await doConnect();
      return { ok: true, name: profile.name };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('site:switch', async (_e, choice) => {
    if (!site.authorized) return { ok: false, error: 'Не выполнен вход' };
    try {
      await site.switchServer(choice, 'PC');
      const key = await site.keys('PC');
      const profile = importSiteKey(key);
      if (core.state === 'running') await doConnect();
      return { ok: true, name: profile ? profile.name : '' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('vpn:reapply', async () => {
    if (core.state !== 'running') {
      pendingRestart = false;
      return { ok: true };
    }
    const res = await doConnect();
    return res;
  });

  ipcMain.handle('net:release', () =>
    serialize('снятие блокировки', async () => {
      await netfix.disableKillSwitch();
      await netfix.restorePriority();
      core.killSwitchOn = false;
      core.priorityApplied = false;
      note('Блокировка сети снята вручную');
      send('state', snapshot());
      return true;
    })
  );

  ipcMain.handle('net:ping', async () => {
    const delay = await core.testDelay();
    return { delay };
  });

  ipcMain.handle('core:logs', () => core.logs.slice(-200));

  ipcMain.handle('logs:open', () => {
    shell.openPath(path.join(paths.userData, 'logs'));
    return true;
  });

  ipcMain.handle('net:selftest', async () => {
    if (core.state !== 'running') return { ok: false, error: 'Туннель не запущен' };
    const t = await core.selfTest();
    const tunnels = await netfix.foreignTunnels();
    return { ok: true, test: t, foreign: tunnels };
  });

  ipcMain.handle('shell:open', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('window:minimize', () => win && win.minimize());
  ipcMain.handle('window:close', () => win && win.close());
  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text || '')));
  ipcMain.handle('clipboard:read', () => clipboard.readText());
}

/* ------------------------------------------------------------------ */
/* Запуск                                                              */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    store = new Store(paths.userData);
    core = new Core(paths);
    site = new Site(paths.userData, safeStorage, store.settings.siteBase || undefined);

    core.on('state', (s) => {
      send('state', snapshot());
      updateTray();
      if (s.state === 'error') {
        note('Ошибка ядра: ' + (s.error || 'без описания'));
        if (!scheduleRetry() && s.error) send('toast', { text: s.error, kind: 'err' });
      }
    });
    core.on('notice', (text) => send('toast', { text, kind: 'err' }));
    core.on('stats', (s) => send('stats', s));
    core.on('log', (l) => send('log', l));

    adminRights = await netfix.isAdmin();

    // если прошлый запуск завершился аварийно — снимаем оставшиеся блокировки
    const leftovers = await netfix.guardCleanup();
    leftovers.forEach((l) => core.log('Восстановление после сбоя: ' + l));

    if (!fs.existsSync(paths.coreExe)) {
      dialog.showErrorBox('EVA VPN', 'Не найдено ядро sing-box:\n' + paths.coreExe);
    }

    registerIpc();
    createWindow();
    createTray();

    // состояние автозапуска берём из системы, а не из своего файла
    try {
      const real = await autostart.isEnabled();
      if (real !== store.settings.autoStart) store.setSetting('autoStart', real);
    } catch { /* не критично */ }

    if (store.settings.autoConnect && store.activeProfile()) {
      setTimeout(() => doConnect(), 800);
    }

    // подписки обновляем при старте (если давно) и раз в 12 часов
    const HALF_DAY = 12 * 3600 * 1000;
    const refreshStale = async () => {
      for (const sub of store.data.subs) {
        if (Date.now() - (sub.lastUpdate || 0) < HALF_DAY) continue;
        try {
          await updateSub(sub);
          send('state', snapshot());
        } catch { /* сервер подписки недоступен — попробуем позже */ }
      }
    };
    setTimeout(refreshStale, 5000);
    setInterval(refreshStale, HALF_DAY);
  });

  app.on('window-all-closed', (e) => {
    // живём в трее
  });

  app.on('quit', () => logFile.close());

  app.on('before-quit', async (e) => {
    if (core && (core.proc || core.proxyWasSet)) {
      e.preventDefault();
      quitting = true;
      await core.stop();
      app.exit(0);
    }
  });
}

process.on('exit', () => {
  try {
    if (core && core.proc) core.proc.kill();
  } catch { /* всё равно уходим */ }
});
