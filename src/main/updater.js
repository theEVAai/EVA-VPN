'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { openResponse, readJSON, fail } = require('./update-http');
const { t } = require('../renderer/i18n');
const elevation = require('./elevation');
const netfix = require('./netfix');

const ROOT = '/theEVAai/EVA-VPN/releases/';
const API_ROOT = '/repos/theEVAai/EVA-VPN/releases/';
const API = 'https://api.github.com' + API_ROOT + 'latest';
const VERSION = /^\d+\.\d+\.\d+$/;
const HASH = /^[0-9a-f]{64}$/;

function compare(a, b) {
  const x = String(a || '').replace(/^v/, '').split('.').map(Number);
  const y = String(b || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  }
  return 0;
}

function trusted(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
    if (u.hostname === 'github.com') return u.pathname.startsWith(ROOT + 'download/');
    if (u.hostname === 'api.github.com') return u.pathname.startsWith(API_ROOT);
    return ['objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(u.hostname);
  } catch { return false; }
}

async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const data of fs.createReadStream(file)) hash.update(data);
  return hash.digest('hex');
}

class Updater extends EventEmitter {
  constructor(o) {
    super();
    this.version = o.version;
    this.dir = path.join(o.userData, 'updates');
    this.markerFile = path.join(o.userData, 'updated.json');
    this.portablePath = o.portablePath || '';
    this.installDir = o.installDir || '';
    this.log = o.log || (() => {});
    this.latest = null;
    this.file = null;
    this.state = 'idle';
    this.progress = null;
    this.error = null;
    this.abort = null;
    this.checking = null;
    this.downloadBusy = false;
  }

  snapshot() { return { state: this.state, current: this.version, latest: this.latest, progress: this.progress, error: this.error }; }
  emitState() { this.emit('update', this.snapshot()); }
  setState(state, extra = {}) {
    this.state = state;
    if ('error' in extra) this.error = extra.error;
    this.emitState();
  }
  trusted(url) { return trusted(url); }

  check() {
    if (this.checking) return this.checking;
    if (['downloading', 'ready', 'installing'].includes(this.state)) return Promise.resolve(this.snapshot());
    this.checking = this.checkInner().finally(() => { this.checking = null; });
    return this.checking;
  }

  async checkInner() {
    this.setState('checking', { error: null });
    try {
      const rel = await readJSON(API, { trusted, signal: AbortSignal.timeout(20000),
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
      const version = String(rel.tag_name || '').replace(/^v/, '');
      if (rel.draft || rel.prerelease || !VERSION.test(version)) throw fail(t('В релизе нет подходящей версии'));
      this.file = null;
      this.progress = null;
      if (compare(version, this.version) <= 0) {
        this.latest = null;
        this.setState('idle');
        return this.snapshot();
      }
      const name = 'EVA-VPN-' + version + (this.portablePath ? '-portable.exe' : '-x64.exe');
      const asset = (rel.assets || []).find((a) => a.name === name && a.state === 'uploaded');
      if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 512 * 1024 * 1024) throw fail(t('В релизе нет подходящего файла обновления'));
      const url = String(asset.browser_download_url || '');
      const u = new URL(url);
      if (!trusted(url) || u.hostname !== 'github.com' || u.pathname !== ROOT + 'download/v' + version + '/' + name) throw fail(t('Неверная ссылка на обновление'));
      const sha256 = String(asset.digest || '').replace(/^sha256:/, '').toLowerCase();
      if (!HASH.test(sha256)) throw fail(t('GitHub не дал контрольную сумму, ставить такое нельзя'));
      this.latest = { version, name, url, size: asset.size, sha256, notes: String(rel.body || '').trim(),
        apiUrl: Number.isSafeInteger(asset.id) ? 'https://api.github.com' + API_ROOT + 'assets/' + asset.id : null };
      this.log(t('Доступно обновление ') + version);
      this.setState('available');
    } catch (error) {
      this.latest = null;
      this.setState('error', { error: error.name === 'TimeoutError' ? t('GitHub не отвечает. Повторите проверку.') : error.message });
    }
    return this.snapshot();
  }

  async download() {
    if (!this.latest) return { ok: false, error: t('Нечего скачивать') };
    if (this.downloadBusy || ['checking', 'downloading', 'installing'].includes(this.state)) return { ok: false, error: t('Обновление уже выполняется') };
    if (this.state === 'ready' && this.file) return { ok: true };
    this.downloadBusy = true;
    const release = this.latest;
    const target = path.join(this.dir, release.name);
    const part = target + '.part';
    const controller = new AbortController();
    this.abort = controller;
    this.file = null;
    let cancelled = false;
    this.cancelDownload = () => {
      cancelled = true;
      controller.abort(Object.assign(new Error(t('отменено')), { name: 'AbortError' }));
    };
    const deadline = setTimeout(() => controller.abort(fail(t('Время загрузки истекло. Повторите обновление.'), true)), 10 * 60 * 1000);
    this.progress = { received: 0, total: release.size, percent: 0, speed: 0, attempt: 1 };
    this.setState('downloading', { error: null });
    try {
      await fs.promises.mkdir(this.dir, { recursive: true });
      this.sweep(release.name);
      const urls = [release.url, release.apiUrl || release.url, release.url];
      for (let attempt = 0; attempt < urls.length; attempt++) {
        controller.signal.throwIfAborted();
        await fs.promises.rm(part, { force: true });
        let stream;
        try {
          this.progress = { received: 0, total: release.size, percent: 0, speed: 0, attempt: attempt + 1 };
          this.emitState();
          stream = await openResponse(urls[attempt], { trusted, signal: controller.signal,
            headers: { Accept: 'application/octet-stream', 'Cache-Control': 'no-cache' } });
          const headerSize = Number(stream.response.headers['content-length']);
          if (headerSize && headerSize !== release.size) throw fail(t('Размер файла не совпал с заявленным'), true);
          const hash = crypto.createHash('sha256');
          let received = 0;
          let mark = Date.now();
          let markBytes = 0;
          let shown = 0;
          let speed = 0;
          const measure = new Transform({ transform: (chunk, _encoding, callback) => {
            stream.touch();
            received += chunk.length;
            if (received > release.size) return callback(fail(t('Размер файла не совпал с заявленным')));
            hash.update(chunk);
            markBytes += chunk.length;
            const dt = Date.now() - mark;
            if (dt >= 400) { speed = Math.round(markBytes * 1000 / dt); mark = Date.now(); markBytes = 0; }
            this.progress = { received, total: release.size, percent: Math.min(99, Math.floor(received * 100 / release.size)), speed, attempt: attempt + 1 };
            if (Date.now() - shown >= 120) { shown = Date.now(); this.emitState(); }
            callback(null, chunk);
          } });
          await pipeline(stream.response, measure, fs.createWriteStream(part, { flags: 'wx' }), { signal: controller.signal });
          controller.signal.throwIfAborted();
          if (received !== release.size || hash.digest('hex') !== release.sha256) throw fail(t('Контрольная сумма или размер файла не совпали. Установка отменена.'));
          await fs.promises.rm(target, { force: true });
          await fs.promises.rename(part, target);
          controller.signal.throwIfAborted();
          this.file = target;
          this.progress = { received, total: received, percent: 100, speed: 0, attempt: attempt + 1 };
          this.log(t('Обновление загружено и проверено по SHA-256: ') + release.version);
          this.setState('ready');
          return { ok: true };
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          if (!error.retryable || attempt === urls.length - 1) throw error;
          this.log(t('GitHub не отдал файл, повторяю загрузку: ') + (attempt + 2) + '/3');
        } finally { if (stream) stream.close(); }
      }
    } catch (error) {
      this.progress = null;
      this.setState(cancelled ? 'available' : 'error', { error: cancelled ? null : error.message });
      if (!cancelled) this.log(t('Обновление не загрузилось: ') + error.message);
      return { ok: false, cancelled, error: error.message };
    } finally {
      clearTimeout(deadline);
      this.abort = null;
      this.cancelDownload = null;
      await fs.promises.rm(part, { force: true }).catch(() => {});
      this.downloadBusy = false;
    }
  }

  cancel() { if (this.cancelDownload) this.cancelDownload(); return { ok: true }; }

  sweep(keep) {
    try {
      for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
        if (entry.isFile() && /^EVA-VPN-\d+\.\d+\.\d+-(x64|portable)\.exe(\.part)?$/.test(entry.name) && entry.name !== keep) {
          fs.rmSync(path.join(this.dir, entry.name), { force: true });
        }
      }
    } catch { /* a previous installer may still be using its file */ }
  }

  async install(o = {}) {
    if (this.state !== 'ready' || !this.file || !this.latest) return { ok: false, error: t('Файл обновления не готов') };
    const release = this.latest;
    this.setState('installing', { error: null });
    try {
      if ((await fs.promises.stat(this.file)).size !== release.size || await fileHash(this.file) !== release.sha256) throw fail(t('Файл обновления изменился. Скачайте его заново.'));
      fs.writeFileSync(this.markerFile, JSON.stringify({ from: this.version, to: release.version, at: Date.now(), connect: Boolean(o.connect) }), 'utf8');
      let child;
      let installerArgs;
      if (this.portablePath) {
        const source = path.join(__dirname, 'portable-update.ps1');
        // Windows PowerShell cannot read inside app.asar.
        const script = path.join(this.dir, 'portable-update.ps1');
        await fs.promises.writeFile(script, await fs.promises.readFile(source));
        const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script,
          '-ParentId', String(process.pid), '-Target', this.portablePath, '-Source', this.file, '-ExpectedHash', release.sha256],
        { detached: true, stdio: 'ignore', windowsHide: true });
      } else {
        const args = ['--updated', '/S', '--force-run'];
        if (this.installDir) args.push('/D=' + this.installDir);
        installerArgs = args;
        // NSIS requires /D= to be the unquoted remainder of the command line.
        // Quote argv[0] ourselves and leave the last argument verbatim.
        child = spawn(this.file, args, { detached: true, stdio: 'ignore', windowsHide: true,
          windowsVerbatimArguments: true, argv0: '"' + this.file + '"' });
      }
      try {
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      } catch (error) {
        if (!installerArgs || !['EACCES', 'EPERM', 'UNKNOWN'].includes(error.code)) throw error;
        // A proxy-mode client may be unelevated. ShellExecute requests UAC for
        // the checked NSIS installer and confirms that it actually started.
        const result = await netfix.runPs(elevation.command(this.file, installerArgs, { nsis: true }), 120000);
        if (result.code !== 0) throw fail(t('Установка отменена или не удалось получить права администратора'));
        child = null;
      }
      child?.unref();
      this.log(t('Запущено обновление ') + release.version);
      return { ok: true };
    } catch (error) {
      try { fs.rmSync(this.markerFile, { force: true }); } catch { /* no marker */ }
      this.setState('error', { error: error.message });
      return { ok: false, error: error.message };
    }
  }

  takeMarker() {
    try {
      const marker = JSON.parse(fs.readFileSync(this.markerFile, 'utf8'));
      fs.rmSync(this.markerFile, { force: true });
      if (!marker || marker.to !== this.version || !Number.isFinite(marker.at) || Date.now() - marker.at > 24 * 3600 * 1000 || marker.at > Date.now() + 60000) return null;
      return marker;
    } catch { return null; }
  }
}

module.exports = { Updater, compare };
