'use strict';
/**
 * Обновление приложения из релизов GitHub.
 *
 * Почему не electron-updater: он требует лежащего в релизе манифеста
 * latest.yml, а в релизе договорились держать только установщики. Всё, что
 * нужно для проверки версии и целостности, GitHub и так отдаёт в API:
 * список файлов, их размер и sha256 каждого. Манифест не нужен.
 *
 * Что здесь есть от безопасности, при отсутствии подписи кода:
 *   - адрес загрузки принимается только с github.com и только из релизов
 *     нашего репозитория: подменить ссылку ответом API не выйдет;
 *   - sha256 берётся из API (api.github.com), а файл качается с другого
 *     хоста (objects.githubusercontent.com), то есть подделать нужно оба;
 *   - если API не дал контрольную сумму, обновление не ставится вообще.
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { t } = require('../renderer/i18n');

const OWNER = 'theEVAai';
const REPO = 'EVA-VPN';
const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/releases/latest';
const DOWNLOAD_PREFIX = '/' + OWNER + '/' + REPO + '/releases/download/';
const ALLOWED_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
];

/** Сравнение версий вида 1.2.3. Возвращает 1, если a новее b. */
function compare(a, b) {
  const norm = (v) => String(v || '').replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const x = norm(a);
  const y = norm(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) > (y[i] || 0)) return 1;
    if ((x[i] || 0) < (y[i] || 0)) return -1;
  }
  return 0;
}

class Updater extends EventEmitter {
  constructor(o) {
    super();
    this.version = o.version;
    this.dir = path.join(o.userData, 'updates');
    this.log = o.log || (() => {});
    this.markerFile = path.join(o.userData, 'updated.json');

    this.latest = null;
    this.file = null;
    this.state = 'idle';   // idle | checking | available | downloading | ready | installing | error
    this.progress = null;
    this.error = null;
    this.abort = null;
  }

  snapshot() {
    return {
      state: this.state,
      current: this.version,
      latest: this.latest,
      progress: this.progress,
      error: this.error
    };
  }

  emitState() {
    this.emit('update', this.snapshot());
  }

  setState(state, extra) {
    this.state = state;
    if (extra && 'error' in extra) this.error = extra.error;
    this.emitState();
  }

  /** Ссылку принимаем только с известных хостов GitHub и только из нашего репозитория. */
  trusted(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return false;
      if (!ALLOWED_HOSTS.includes(u.hostname)) return false;
      if (u.hostname === 'github.com' && !u.pathname.startsWith(DOWNLOAD_PREFIX)) return false;
      return true;
    } catch {
      return false;
    }
  }

  /** Есть ли релиз новее нашего. Ошибок не бросает: обновление не повод падать. */
  async check() {
    if (this.state === 'downloading' || this.state === 'installing') return this.snapshot();
    this.setState('checking', { error: null });
    try {
      const r = await fetch(API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EVA VPN' },
        signal: AbortSignal.timeout(15000)
      });
      if (!r.ok) throw new Error(t('GitHub ответил ') + r.status);
      const rel = await r.json();
      if (rel.draft || rel.prerelease) throw new Error(t('последний релиз черновой'));

      const version = String(rel.tag_name || '').replace(/^v/, '');
      if (!version) throw new Error(t('в релизе нет номера версии'));

      if (compare(version, this.version) <= 0) {
        this.latest = null;
        this.setState('idle');
        return this.snapshot();
      }

      // нужен установщик, а не портативная сборка: она ничего не обновляет
      const asset = (rel.assets || []).find(
        (a) => /\.exe$/i.test(a.name) && !/portable/i.test(a.name)
      );
      if (!asset) throw new Error(t('в релизе нет установщика'));

      const url = String(asset.browser_download_url || '');
      if (!this.trusted(url)) throw new Error(t('ссылка на файл ведёт не на GitHub'));

      const sha256 = String(asset.digest || '').replace(/^sha256:/, '');
      if (!/^[0-9a-f]{64}$/.test(sha256)) {
        throw new Error(t('GitHub не дал контрольную сумму, ставить такое нельзя'));
      }

      this.latest = {
        version,
        notes: String(rel.body || '').trim(),
        name: asset.name,
        url,
        size: asset.size || 0,
        sha256
      };
      this.log(t('Доступно обновление ') + version + ' (' + Math.round((asset.size || 0) / 1048576) + t(' МБ)'));
      this.setState('available');
    } catch (e) {
      this.latest = null;
      this.setState('idle', { error: e.message });
    }
    return this.snapshot();
  }

  async download() {
    if (!this.latest) return { ok: false, error: t('нечего скачивать') };
    if (this.state === 'downloading') return { ok: false, error: t('уже качается') };

    const target = path.join(this.dir, this.latest.name);
    this.abort = new AbortController();
    this.progress = { received: 0, total: this.latest.size, percent: 0, speed: 0 };
    this.setState('downloading', { error: null });

    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.sweep(this.latest.name);

      const r = await fetch(this.latest.url, {
        headers: { 'User-Agent': 'EVA VPN' },
        signal: this.abort.signal,
        redirect: 'follow'
      });
      if (!r.ok) throw new Error(t('сервер ответил ') + r.status);
      if (!this.trusted(r.url)) throw new Error(t('загрузка увела на посторонний адрес'));

      const total = Number(r.headers.get('content-length')) || this.latest.size;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(target);

      let received = 0;
      let mark = Date.now();
      let markBytes = 0;
      let speed = 0;
      let shown = 0;

      for await (const chunk of r.body) {
        const buf = Buffer.from(chunk);
        hash.update(buf);
        if (!out.write(buf)) await new Promise((res) => out.once('drain', res));

        received += buf.length;
        markBytes += buf.length;
        const dt = Date.now() - mark;
        if (dt >= 400) {
          speed = Math.round((markBytes * 1000) / dt);
          mark = Date.now();
          markBytes = 0;
        }
        this.progress = {
          received,
          total,
          percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
          speed
        };
        // Кусок приходит по 16 КБ: на 80 мегабайтах это пять тысяч событий.
        // Глазу хватает восьми в секунду, окну — тем более.
        if (Date.now() - shown >= 120) {
          shown = Date.now();
          this.emitState();
        }
      }
      this.emitState();

      await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));

      const got = hash.digest('hex');
      if (got !== this.latest.sha256) {
        fs.rmSync(target, { force: true });
        throw new Error(t('контрольная сумма не сошлась: файл повреждён или подменён'));
      }
      if (this.latest.size && received !== this.latest.size) {
        fs.rmSync(target, { force: true });
        throw new Error(t('размер файла не совпал с заявленным'));
      }

      this.file = target;
      this.log(t('Обновление ') + this.latest.version + t(' загружено и проверено по sha256'));
      this.setState('ready');
      return { ok: true };
    } catch (e) {
      try { fs.rmSync(target, { force: true }); } catch { /* уже нет */ }
      const cancelled = e.name === 'AbortError';
      this.progress = null;
      this.setState(cancelled ? 'available' : 'error', { error: cancelled ? null : e.message });
      if (!cancelled) this.log(t('Обновление не загрузилось: ') + e.message);
      return { ok: false, error: cancelled ? t('отменено') : e.message };
    } finally {
      this.abort = null;
    }
  }

  cancel() {
    if (this.abort) this.abort.abort();
    return { ok: true };
  }

  /** Чистим прошлые загрузки: держать по 85 МБ от каждой версии незачем. */
  sweep(keep) {
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (f !== keep) fs.rmSync(path.join(this.dir, f), { force: true });
      }
    } catch { /* каталога может ещё не быть */ }
  }

  /**
   * Запускает установщик и уходит. Метку читает уже новая версия при первом
   * запуске: по ней показывается благодарность и восстанавливается подключение.
   *
   * /S — тихая установка, путь берётся из записи о прошлой установке.
   * --force-run — запустить приложение, когда установка закончится.
   */
  install(o) {
    const opts = o || {};
    if (this.state !== 'ready' || !this.file || !fs.existsSync(this.file)) {
      return { ok: false, error: t('файл обновления не готов') };
    }
    try {
      fs.writeFileSync(this.markerFile, JSON.stringify({
        from: this.version,
        to: this.latest.version,
        at: Date.now(),
        connect: Boolean(opts.connect)
      }), 'utf8');
    } catch { /* без метки просто не будет благодарности */ }

    this.setState('installing');
    this.log(t('Запускаю установку ') + this.latest.version);

    const child = spawn(this.file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  }

  /** Метка «только что обновились». Читается один раз: файл сразу удаляется. */
  takeMarker() {
    try {
      const raw = fs.readFileSync(this.markerFile, 'utf8');
      fs.rmSync(this.markerFile, { force: true });
      const m = JSON.parse(raw);
      if (!m || Date.now() - (m.at || 0) > 24 * 3600 * 1000) return null;
      return m;
    } catch {
      return null;
    }
  }
}

module.exports = { Updater, compare };
