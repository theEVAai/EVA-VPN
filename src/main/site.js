'use strict';
/**
 * Клиент API vpn.theeva.ai: вход, кабинет, выдача ключа, смена сервера.
 *
 * Сессия — та же кука `session`, что и у сайта. Хранится на диске в
 * зашифрованном виде (DPAPI через safeStorage), потому что это фактически
 * пароль от кабинета.
 */

const fs = require('fs');
const path = require('path');

const BASE = 'https://vpn.theeva.ai';
const TIMEOUT = 20000;

/** Коды ошибок бэкенда -> человеческий текст. */
const ERRORS = {
  UNAUTHORIZED: 'Сессия истекла, войдите заново',
  TOTP_REQUIRED: 'Нужен код из приложения',
  TOTP_BAD_CODE: 'Код не подошёл',
  NO_PLAN: 'На аккаунте нет активного тарифа',
  PC_NOT_IN_PLAN: 'Тариф BASIC не включает ПК — нужен PRO или выше',
  EMAIL_NOT_VERIFIED: 'Подтвердите почту в кабинете',
  NO_BALANCE: 'Закончился баланс — пополните в кабинете',
  MANUAL_NOT_ALLOWED: 'Выбор страны не входит в ваш тариф',
  NO_SERVERS: 'Свободных серверов сейчас нет',
  NO_SERVERS_AVAILABLE: 'В этом направлении нет серверов',
  RATE_LIMITED: 'Слишком часто — подождите минуту',
  '502': 'Сайт не ответил вовремя (502) — панель могла не успеть выдать ключ',
  '504': 'Сайт не ответил вовремя (504)',
  BAD_REQUEST: 'Сервер не принял запрос'
};

class Site {
  constructor(userData, safeStorage, base) {
    this.file = path.join(userData, 'session.dat');
    this.safeStorage = safeStorage;
    this.base = base || BASE;
    this.cookie = '';
    this.load();
  }

  /* --------------------------- сессия --------------------------- */

  load() {
    try {
      const raw = fs.readFileSync(this.file);
      if (this.safeStorage && this.safeStorage.isEncryptionAvailable()) {
        this.cookie = this.safeStorage.decryptString(raw);
      } else {
        this.cookie = raw.toString('utf8');
      }
    } catch {
      this.cookie = '';
    }
  }

  save() {
    try {
      if (!this.cookie) {
        fs.rmSync(this.file, { force: true });
        return;
      }
      const data =
        this.safeStorage && this.safeStorage.isEncryptionAvailable()
          ? this.safeStorage.encryptString(this.cookie)
          : Buffer.from(this.cookie, 'utf8');
      fs.writeFileSync(this.file, data);
    } catch (e) {
      console.error('site.save', e);
    }
  }

  get authorized() {
    return Boolean(this.cookie);
  }

  /* --------------------------- запросы --------------------------- */

  async request(pathname, { method = 'GET', body, timeout = TIMEOUT } = {}) {
    const headers = {
      'User-Agent': 'EVA VPN desktop',
      Accept: 'application/json'
    };
    if (this.cookie) headers.Cookie = this.cookie;
    if (body) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(this.base + pathname, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error('Сайт недоступен: ' + (e.name === 'TimeoutError' ? 'нет ответа' : e.message));
    }

    // сервер мог обновить куку
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    const session = set.map((c) => c.split(';')[0]).find((c) => c.startsWith('session='));
    if (session) {
      this.cookie = session;
      this.save();
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const code = (data && data.error) || (res.status === 429 ? 'RATE_LIMITED' : String(res.status));
      if (code === 'UNAUTHORIZED') {
        this.cookie = '';
        this.save();
      }
      const err = new Error(ERRORS[code] || code);
      err.code = code;
      throw err;
    }
    return data;
  }

  /* --------------------------- методы --------------------------- */

  async login(email, password, code) {
    const body = { email: String(email || '').trim(), password: String(password || '') };
    if (code) body.code = String(code).trim();
    await this.request('/api/auth/login', { method: 'POST', body });
    if (!this.cookie) throw new Error('Сайт не выдал сессию');
    return true;
  }

  async logout() {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch { /* сессия могла протухнуть — всё равно забываем */ }
    this.cookie = '';
    this.save();
    return true;
  }

  me() {
    return this.request('/api/me');
  }

  keys(platform = 'PC') {
    // создание клиента в панели и рестарт ядра на сервере занимают время
    return this.slow('/api/keys?platform=' + platform);
  }

  /**
   * Тяжёлые запросы. Первая выдача ключа создаёт клиента в панели и
   * перезапускает Xray — прокси перед сайтом успевает отдать 502 раньше,
   * чем сайт ответит. Работа при этом доходит до конца, поэтому повтор
   * почти всегда возвращает готовый ключ.
   */
  async slow(pathname, options = {}) {
    const opts = Object.assign({ timeout: 90000 }, options);
    try {
      return await this.request(pathname, opts);
    } catch (e) {
      if (e.code !== '502' && e.code !== '504' && !/недоступен/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 4000));
      return this.request(pathname, opts);
    }
  }

  servers(platform = 'PC') {
    return this.request('/api/servers?platform=' + platform);
  }

  switchServer(choice, platform = 'PC') {
    return this.slow('/api/servers', { method: 'POST', body: { choice, platform } });
  }

  /** Всё, что нужно панели кабинета, одним запросом. */
  async dashboard(platform = 'PC') {
    const out = { authorized: true, errors: [] };
    out.me = await this.me();

    for (const [field, fn] of [['key', () => this.keys(platform)], ['servers', () => this.servers(platform)]]) {
      try {
        out[field] = await fn();
      } catch (e) {
        out[field] = null;
        out.errors.push(e.message);
        if (e.code === 'UNAUTHORIZED') throw e;
      }
    }
    return out;
  }
}

module.exports = { Site, ERRORS, BASE };
