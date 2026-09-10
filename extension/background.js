'use strict';
/**
 * Фоновая часть расширения.
 *
 * Чего расширение НЕ делает и не может: само поднять VLESS/Reality. Браузер
 * не даёт расширению работать с сокетами и шифрованием на таком уровне.
 * Поэтому оно занимается тем, что браузеру доступно, — направляет трафик
 * вкладок в локальный прокси, который поднимает настольное приложение
 * EVA VPN (по умолчанию 127.0.0.1:2080).
 *
 * Что это даёт: защиту только браузера, без прав администратора и без
 * виртуального адаптера. Остальные программы идут напрямую — обратная
 * сторона раздельного туннелирования из настольного приложения.
 *
 * Два браузера — два разных API прокси:
 *   Chromium: chrome.proxy.settings, одна настройка на весь браузер;
 *   Firefox:  browser.proxy.onRequest, решение принимается на каждый запрос.
 * Обе ветки живут ниже и выбираются по наличию API.
 */

// В Node ни browser, ни chrome не существуют: тогда api = null, браузерная
// часть не запускается, а чистые функции остаются доступны для проверок.
const api =
  typeof browser !== 'undefined' ? browser
  : typeof chrome !== 'undefined' ? chrome
  : null;

const DEFAULTS = {
  enabled: false,
  host: '127.0.0.1',
  port: 2080,
  apiPort: 19090,
  /** Домены, которые ходят мимо прокси даже при включённом расширении. */
  bypass: ['localhost', '127.0.0.1', '::1', '*.local']
};

/* ------------------------------------------------------------------ */
/* Настройки                                                           */
/* ------------------------------------------------------------------ */

let state = Object.assign({}, DEFAULTS);

async function loadState() {
  const stored = await api.storage.local.get(Object.keys(DEFAULTS));
  state = Object.assign({}, DEFAULTS, stored || {});
  return state;
}

async function saveState(patch) {
  state = Object.assign({}, state, patch);
  await api.storage.local.set(patch);
  return state;
}

/* ------------------------------------------------------------------ */
/* Список исключений                                                   */
/* ------------------------------------------------------------------ */

/**
 * Совпадает ли адрес с записью списка исключений.
 * Поддерживаем «example.com» (домен и поддомены) и «*.example.com».
 * Вынесено отдельной функцией, потому что в Firefox решение принимается
 * на каждый запрос и логика должна быть одинаковой с Chromium.
 */
function bypassMatches(hostname, pattern) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  let rule = String(pattern || '').trim().toLowerCase();
  if (!host || !rule) return false;
  if (rule.startsWith('*.')) rule = rule.slice(2);
  if (host === rule) return true;
  return host.endsWith('.' + rule);
}

function isBypassed(hostname) {
  return state.bypass.some((p) => bypassMatches(hostname, p));
}

/* ------------------------------------------------------------------ */
/* Chromium: одна настройка на браузер                                 */
/* ------------------------------------------------------------------ */

const hasChromiumProxy = Boolean(api && api.proxy && api.proxy.settings && api.proxy.settings.set);

function chromiumApply() {
  return new Promise((resolve) => {
    api.proxy.settings.set(
      {
        scope: 'regular',
        value: {
          mode: 'fixed_servers',
          rules: {
            singleProxy: { scheme: 'socks5', host: state.host, port: Number(state.port) },
            // Chromium сам не понимает «*.example.com» — приводим к его виду
            bypassList: state.bypass.map((p) => (p.startsWith('*.') ? p.slice(2) : p))
          }
        }
      },
      resolve
    );
  });
}

function chromiumClear() {
  return new Promise((resolve) => api.proxy.settings.clear({ scope: 'regular' }, resolve));
}

/* ------------------------------------------------------------------ */
/* Firefox: решение на каждый запрос                                   */
/* ------------------------------------------------------------------ */

const hasFirefoxProxy = Boolean(api && api.proxy && api.proxy.onRequest);

function firefoxDecide(request) {
  if (!state.enabled) return { type: 'direct' };
  let hostname = '';
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return { type: 'direct' };
  }
  if (isBypassed(hostname)) return { type: 'direct' };
  return {
    type: 'socks',
    host: state.host,
    port: Number(state.port),
    // имена тоже резолвим через туннель, иначе провайдер видит, куда мы идём
    proxyDNS: true
  };
}

/* ------------------------------------------------------------------ */
/* Включение и выключение                                              */
/* ------------------------------------------------------------------ */

async function applyProxy() {
  if (hasChromiumProxy) {
    if (state.enabled) await chromiumApply();
    else await chromiumClear();
  }
  // в Firefox слушатель уже стоит и смотрит на state.enabled сам
  await updateBadge();
}

async function updateBadge() {
  const action = api && (api.action || api.browserAction);
  if (!action) return;
  try {
    await action.setBadgeText({ text: state.enabled ? 'ON' : '' });
    if (action.setBadgeBackgroundColor) {
      await action.setBadgeBackgroundColor({ color: '#2450e8' });
    }
  } catch { /* значок не повод падать */ }
}

/* ------------------------------------------------------------------ */
/* Состояние туннеля из настольного приложения                         */
/* ------------------------------------------------------------------ */

/**
 * Спрашивает Clash API приложения: живо ли ядро и сколько сейчас идёт
 * трафика. Приложение может быть выключено — это не ошибка, просто
 * «нет связи», и расширение показывает это честно.
 */
async function readAppStatus() {
  const base = 'http://' + state.host + ':' + state.apiPort;
  const out = { app: false, version: null, connections: 0, down: 0, up: 0, error: null };
  try {
    const ctrl = AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined;
    const v = await fetch(base + '/version', { signal: ctrl });
    if (!v.ok) throw new Error('HTTP ' + v.status);
    const info = await v.json();
    out.app = true;
    out.version = info.version || null;

    const c = await fetch(base + '/connections', {
      signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined
    });
    if (c.ok) {
      const d = await c.json();
      out.connections = (d.connections || []).length;
      out.down = d.downloadTotal || 0;
      out.up = d.uploadTotal || 0;
    }
  } catch (e) {
    out.error = e.name === 'TimeoutError' ? 'timeout' : e.message;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Связь с всплывающим окном                                           */
/* ------------------------------------------------------------------ */

if (api && api.runtime) api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'getState': {
        const status = await readAppStatus();
        sendResponse({ state, status });
        break;
      }
      case 'setEnabled': {
        await saveState({ enabled: Boolean(msg.value) });
        await applyProxy();
        sendResponse({ state });
        break;
      }
      case 'setBypass': {
        const list = (msg.value || [])
          .map((x) => String(x).trim().toLowerCase())
          .filter(Boolean);
        await saveState({ bypass: [...new Set(list)] });
        if (state.enabled) await applyProxy();
        sendResponse({ state });
        break;
      }
      case 'setPorts': {
        const port = Number(msg.port) || DEFAULTS.port;
        const apiPort = Number(msg.apiPort) || DEFAULTS.apiPort;
        await saveState({ port, apiPort });
        if (state.enabled) await applyProxy();
        sendResponse({ state });
        break;
      }
      default:
        sendResponse({ error: 'unknown message' });
    }
  })();
  return true; // ответ асинхронный
});

/* ------------------------------------------------------------------ */
/* Запуск                                                              */
/* ------------------------------------------------------------------ */

async function init() {
  await loadState();
  if (hasFirefoxProxy) {
    api.proxy.onRequest.addListener(firefoxDecide, { urls: ['<all_urls>'] });
  }
  await applyProxy();
}

if (api) init();

// Chromium усыпляет служебный поток: после пробуждения состояние надо
// перечитать, иначе значок и решения окажутся от прошлой сессии.
if (api && api.runtime && api.runtime.onStartup) api.runtime.onStartup.addListener(init);
if (api && api.runtime && api.runtime.onInstalled) api.runtime.onInstalled.addListener(init);

// экспорт для проверок в Node — в браузере этой ветки не существует
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { bypassMatches, DEFAULTS };
}
