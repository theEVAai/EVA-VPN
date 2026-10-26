'use strict';
/** Менеджер ядра sing-box: запуск, остановка, статистика через Clash API. */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const { buildConfig, TUN_IPV4 } = require('./config');
const netfix = require('./netfix');
const { t } = require('../renderer/i18n');

const LOG_LIMIT = 500;

class Core extends EventEmitter {
  /**
   * @param {object} paths { coreExe, srss, userData }
   */
  constructor(paths) {
    super();
    this.paths = paths;
    this.proc = null;
    this.state = 'stopped'; // stopped | starting | running | stopping | error
    this.mode = null;
    this.profile = null;
    this.logs = [];
    this.stats = { up: 0, down: 0, upTotal: 0, downTotal: 0, connections: 0 };
    this.startedAt = 0;
    this.clashPort = 19090;
    this.statsTimer = null;
    this.pingTimer = null;
    this.statsAbort = null;
    this.proxyWasSet = false;
    this.starting = false;
    this.intentionalStop = false;
    this.priorityApplied = false;
    this.killSwitchOn = false;
    this.lastError = '';
    this.startAbort = null;
    this.stopPromise = null;
    this.exitCleanup = Promise.resolve();
    this.run = null;
    this.initialPing = null;
  }

  log(line) {
    const text = String(line).replace(/\r?\n$/, '');
    if (!text.trim()) return;
    if (this.paths.logFile) this.paths.logFile.write(text);
    this.logs.push(text);
    if (this.logs.length > LOG_LIMIT) this.logs.splice(0, this.logs.length - LOG_LIMIT);
    this.emit('log', text);
  }

  setState(state, extra) {
    this.state = state;
    this.emit('state', { state, ...(extra || {}) });
  }

  configPath() {
    return path.join(this.paths.userData, 'current-config.json');
  }

  cancelStart() {
    if (this.startAbort) this.startAbort.abort();
  }

  validate(profile, mode, settings) {
    return buildConfig({ profile, profiles: settings.profiles || [], mode, opts: settings,
      paths: { srss: this.paths.srss, cache: path.join(this.paths.userData, 'cache.db') } });
  }

  async start(profile, mode, settings) {
    // Два запуска одновременно — это два ядра, дерущихся за один сетевой
    // адаптер и один файл кэша. Именно так рождались «Cannot create a file
    // when that file already exists» и «initialize cache-file: timeout».
    if (this.starting) {
      this.log(t('Запуск уже идёт — повторный запрос отброшен'));
      return { ok: false, error: t('Подключение уже выполняется') };
    }
    // Configuration errors must leave an existing working tunnel intact.
    const cfg = this.validate(profile, mode, settings);
    this.starting = true;
    const controller = new AbortController();
    this.startAbort = controller;
    try {
      return await this.startInner(profile, mode, settings, controller.signal, cfg);
    } catch (e) {
      const cancelled = controller.signal.aborted;
      const error = e.message || String(e);
      try { await this.stop({ keepGuards: cancelled || this.killSwitchOn }); }
      catch (cleanupError) {
        this.lastError = cleanupError.message;
        this.setState('error', { error: this.lastError });
        return { ok: false, error: this.lastError };
      }
      if (cancelled) return { ok: false, cancelled: true };
      this.lastError = error;
      this.setState('error', { error });
      return { ok: false, error };
    } finally {
      this.starting = false;
      if (this.startAbort === controller) this.startAbort = null;
    }
  }

  async startInner(profile, mode, settings, signal, cfg) {
    const current = () => signal.throwIfAborted();
    // Reject unsupported saved keys before stopping a working tunnel or
    // changing any network state.
    // при перезапуске killswitch не снимаем: иначе на несколько секунд
    // открывается прямой выход в сеть — ровно то, от чего он защищает
    const replacing = Boolean(this.proc);
    if (this.proc) await this.stop({ keepGuards: this.mode === mode });
    await this.exitCleanup;
    current();

    this.profile = profile;
    this.mode = mode;
    this.clashPort = settings.clashPort || 19090;
    this.mixedPort = settings.mixedPort || 2080;
    this.lastError = '';
    this.setState('starting');

    // подчищаем возможные хвосты прошлого запуска
    if (!replacing) await netfix.killOrphanCores(this.paths.coreExe, this.configPath(), signal);
    current();
    if (mode === 'tun') {
      // адаптер прошлой сессии умирает не мгновенно; если начать раньше,
      // новое ядро молча зависнет на создании туннеля
      const gone = await netfix.waitAdapterGone(settings.tunName || netfix.tunAlias(), 4000, signal);
      current();
      if (!gone) throw new Error(t('Сетевой адаптер занят прошлым запуском'));
    }

    if (mode !== 'tun' || settings.killSwitch === false) {
      if (this.killSwitchOn) { await netfix.disableKillSwitch(); this.killSwitchOn = false; }
    }
    if (mode !== 'tun' || settings.vpnPriority === false) {
      if (this.priorityApplied) { await netfix.restorePriority(); this.priorityApplied = false; }
    }
    current();

    const file = this.configPath();
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');

    this.log('$ sing-box run  (' + (mode === 'tun' ? t('туннель') : t('системный прокси')) + ', ' + profile.name + ')');

    const proc = spawn(this.paths.coreExe, ['run', '-c', file, '--disable-color'], {
      cwd: path.dirname(this.paths.coreExe),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.proc = proc;
    const run = { proc, stopped: false, logs: [], exited: false };
    this.run = run;
    const output = (b) => {
      if (this.run !== run) return;
      for (const line of String(b).split(/\r?\n/)) {
        run.logs.push(line);
        if (run.logs.length > LOG_LIMIT) run.logs.shift();
        this.log(line);
      }
    };
    proc.stdout.on('data', output);
    proc.stderr.on('data', output);

    proc.on('error', (e) => {
      if (!proc.pid) run.exited = true;
      if (this.run !== run || run.stopped) return;
      this.lastError = t('Не удалось запустить ядро: ') + e.message;
      this.log(this.lastError);
      // пока идёт запуск, наружу об ошибке сообщает только сам запуск:
      // иначе снаружи планируется повтор поверх ещё не законченной попытки
      if (!this.starting) this.setState('error', { error: this.lastError });
    });

    proc.on('exit', (code) => {
      run.exited = true;
      if (this.proc !== proc || this.run !== run || run.stopped) return;
      // Ядро могли остановить мы сами — при перезапуске или повторной попытке.
      // Раньше такой выход считался аварией, снаружи планировался автоповтор,
      // и он стартовал поверх уже поднявшегося туннеля: два ядра дрались за адаптер.
      const wasRunning =
        !this.starting &&
        (this.state === 'running' || this.state === 'starting');
      this.proc = null;
      this.stopStats();
      const clearProxy = this.proxyWasSet;
      this.proxyWasSet = false;
      this.exitCleanup = (async () => {
        if (clearProxy) await netfix.clearSystemProxy();
        if (this.run !== run || run.stopped || this.starting) return;
        if (wasRunning) {
          this.lastError = this.lastError || guessError(run.logs) || (t('Ядро завершилось (код ') + code + ')');
          this.setState('error', { error: this.lastError });
        }
      })().catch((e) => this.log(String(e.message || e)));
    });

    // создание TUN-адаптера на медленной машине занимает заметно дольше
    const ready = await this.waitReady(mode === 'tun' ? 25000 : 15000, run, signal);
    current();
    if (!ready) {
      throw new Error(this.lastError || guessError(run.logs) || t('Ядро не ответило вовремя'));
    }

    if (mode === 'proxy') {
      await netfix.setSystemProxy(settings.mixedPort || 2080);
      this.proxyWasSet = true;
      current();
      this.log(t('Системный прокси включён: 127.0.0.1:') + (settings.mixedPort || 2080));
    }

    if (mode === 'tun') {
      const alias = settings.tunName || netfix.tunAlias();

      // Уже запущенные программы помнят, каким интерфейсом ходить к адресу.
      // Сброс кэшей заставляет их принять решение заново.
      await netfix.flushRouteCaches();
      current();

      // наш туннель должен быть главным, иначе чужой VPN перетянет маршрут на себя
      if (settings.vpnPriority !== false && this.priorityApplied) {
        await netfix.refreshTunPriority(alias);
        current();
      }
      if (settings.vpnPriority !== false && !this.priorityApplied) {
        const demoted = await netfix.applyPriority(alias);
        this.priorityApplied = true;
        current();
        this.log(
          t('Приоритет туннеля: метрика 1') +
          (demoted.length
            ? t(' · подавлены: ') + demoted.map((d) =>
                d.name + t(' (метрика 9000') +
                (d.routes && d.routes.length ? t(', снято маршрутов ') + d.routes.length : '') +
                (d.dns && d.dns.length ? t(', DNS очищен') : '') + ')'
              ).join(', ')
            : '')
        );
      }

      // всё, что попытается уйти мимо туннеля, брандмауэр не выпустит
      if (settings.killSwitch !== false && !this.killSwitchOn) {
        const ks = await netfix.enableKillSwitch({
          alias,
          coreExe: this.paths.coreExe,
          appExe: this.paths.appExe,
          tunAddr: TUN_IPV4.split('/')[0]
        });
        this.killSwitchOn = true;
        current();
        this.log(t('Killswitch включён: исходящий трафик мимо туннеля заблокирован'));
        if (ks && ks.disabledProfiles && ks.disabledProfiles.length) {
          const msg =
            t('Брандмауэр Windows выключен (') + ks.disabledProfiles.join(', ') +
            t(') — killswitch не удержит трафик. Включите брандмауэр.');
          this.log(msg);
          this.emit('notice', msg);
        }
      }
    }

    current();
    if (this.proc !== proc || run.exited) throw new Error(guessError(run.logs) || t('Ядро завершилось во время подключения'));
    this.startedAt = Date.now();
    this.stats = { up: 0, down: 0, upTotal: 0, downTotal: 0, connections: 0 };
    this.startStats();
    this.setState('running');
    return { ok: true };
  }

  async waitReady(timeoutMs, run, signal) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (this.run !== run || this.proc !== run.proc || run.exited) return false;
      try {
        const r = await fetch('http://127.0.0.1:' + this.clashPort + '/version', {
          signal: AbortSignal.any([signal, AbortSignal.timeout(1500)])
        });
        if (r.ok && this.proc === run.proc && !run.exited) return true;
      } catch {
        /* ещё не поднялось */
      }
      await new Promise((res) => setTimeout(res, 300));
    }
    return false;
  }

  /** Снимает всё, что мы навязали системе: killswitch и метрики адаптеров. */
  async releaseGuards() {
    if (this.killSwitchOn) {
      await netfix.disableKillSwitch();
      this.killSwitchOn = false;
      this.log(t('Killswitch снят'));
    }
    if (this.priorityApplied) {
      await netfix.restorePriority();
      this.priorityApplied = false;
    }
  }

  async stop({ keepGuards = false } = {}) {
    if (!this.stopPromise) {
      this.stopPromise = this.stopProcess();
    }
    const pending = this.stopPromise;
    try { await pending; }
    finally { if (this.stopPromise === pending) this.stopPromise = null; }
    if (!keepGuards) await this.releaseGuards();
    this.setState('stopped');
  }

  async stopProcess() {
    this.stopStats();
    await this.exitCleanup;
    const proc = this.proc;
    const run = this.run;
    if (proc) {
      this.setState('stopping');
      if (run && run.proc === proc) run.stopped = true;
      const gone = () => proc.exitCode !== null || proc.signalCode !== null || (run && run.exited);
      const wait = (ms) => new Promise((resolve) => {
        if (gone()) return resolve(true);
        const done = () => { clearTimeout(timer); proc.removeListener('exit', done); resolve(gone()); };
        const timer = setTimeout(done, ms);
        proc.once('exit', done);
      });
      if (!gone()) {
        try { proc.kill(); } catch { /* bounded wait below confirms exit */ }
        if (!await wait(1500)) {
          if (Number.isInteger(proc.pid)) await netfix.runCmd('taskkill', ['/F', '/T', '/PID', String(proc.pid)], 5000);
          if (!await wait(5000)) throw new Error(t('Не удалось остановить предыдущее ядро. Повторите отключение.'));
        }
      }
      if (this.proc === proc) this.proc = null;
    }
    if (this.proxyWasSet) {
      await netfix.clearSystemProxy();
      this.proxyWasSet = false;
    }
    this.startedAt = 0;
  }

  /**
   * Статистика. Скорость приходит потоком с /traffic — это 25 байт в секунду.
   * Раньше ради тех же двух чисел раз в секунду выкачивался весь список
   * соединений: на пустом туннеле 16 КБ, а на долгой сессии сотни килобайт,
   * и всё это разбиралось в главном процессе. Итоги и число соединений
   * берём оттуда же, но раз в пять секунд.
   */
  startStats() {
    this.stopStats();
    this.statsAbort = new AbortController();
    this.streamTraffic();
    const run = this.run;

    this.statsTimer = setInterval(async () => {
      try {
        const r = await fetch('http://127.0.0.1:' + this.clashPort + '/connections', {
          signal: AbortSignal.timeout(4000)
        });
        if (!r.ok) return;
        const d = await r.json();
        if (this.run !== run || this.state !== 'running') return;
        this.stats.upTotal = d.uploadTotal || 0;
        this.stats.downTotal = d.downloadTotal || 0;
        this.stats.connections = (d.connections || []).length;
      } catch {
        /* ядро могло уйти — увидим по событию exit */
      }
    }, 5000);

    this.pingTimer = setInterval(() => {
      this.testDelay().then((delay) => {
        if (this.run === run && this.state === 'running') this.emit('ping', { delay });
      });
    }, 30000);
    // первая проба сразу после того, как маршруты успели встать
    this.initialPing = setTimeout(() => {
      if (this.run === run && this.state === 'running') this.testDelay().then((delay) => {
        if (this.run === run) this.emit('ping', { delay });
      });
    }, 2500);
  }

  /**
   * /traffic отдаёт по строке JSON в секунду и держит соединение открытым.
   * Если поток оборвался, а туннель жив — переоткрываем.
   */
  async streamTraffic() {
    const ac = this.statsAbort;
    if (!ac) return;
    try {
      const r = await fetch('http://127.0.0.1:' + this.clashPort + '/traffic', { signal: ac.signal });
      if (!r.ok || !r.body) throw new Error(t('нет потока'));
      let tail = '';
      for await (const chunk of r.body) {
        tail += Buffer.from(chunk).toString('utf8');
        const lines = tail.split('\n');
        tail = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const t = JSON.parse(line);
            this.stats.up = Math.max(0, t.up || 0);
            this.stats.down = Math.max(0, t.down || 0);
          } catch { continue; }
          this.emit('stats', { ...this.stats, uptime: this.startedAt ? Date.now() - this.startedAt : 0 });
        }
      }
    } catch {
      /* оборвался — ниже решим, стоит ли возвращаться */
    }
    // this.statsAbort мог смениться на новый — тогда поток уже ведёт другой вызов
    if (this.statsAbort !== ac || ac.signal.aborted) return;
    setTimeout(() => {
      if (this.statsAbort === ac && !ac.signal.aborted) this.streamTraffic();
    }, 1000);
  }

  stopStats() {
    if (this.initialPing) clearTimeout(this.initialPing);
    this.initialPing = null;
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.statsAbort) this.statsAbort.abort();
    this.statsAbort = null;
  }

  /**
   * Проверка «а работает ли вообще»: резолв имени и живой HTTP через ядро.
   * Отвечает на вопрос, который иначе выясняется методом тыка в браузере.
   */
  async selfTest() {
    const out = { direct: null, viaCore: null, delay: null, ok: false };
    const port = this.mixedPort || 2080;

    out.delay = await this.testDelay(8000);

    // Главная проверка — обычный запрос, как из браузера: он идёт по системному
    // маршруту, то есть через сам туннель и через правила брандмауэра.
    // Раньше проверка ходила только через петлю в ядро, а ей killswitch
    // разрешён всегда, — и она бодро рапортовала «работает», когда всем
    // остальным приложениям выход был закрыт.
    const direct = await netfix.runCmd(
      'curl',
      ['-s', '-o', 'NUL', '-w', '%{http_code}|%{time_total}', '--max-time', '12',
       'http://cp.cloudflare.com/generate_204'],
      20000
    );
    const [dCode, dTime] = String(direct.stdout || '').trim().split('|');
    out.direct = dCode === '204' || dCode === '200' ? { code: dCode, time: dTime } : null;

    // Вторая проверка — через вход ядра. Она отвечает на вопрос «ядро вообще живо»
    // и вместе с первой различает два разных диагноза.
    const viaCore = await netfix.runCmd(
      'curl',
      ['-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '12',
       '-x', 'socks5h://127.0.0.1:' + port, 'http://cp.cloudflare.com/generate_204'],
      20000
    );
    const cCode = String(viaCore.stdout || '').trim();
    out.viaCore = cCode === '204' || cCode === '200' ? { code: cCode } : null;

    out.ok = Boolean(out.direct);
    out.diagnosis = out.direct
      ? t('трафик системы идёт через туннель')
      : out.viaCore
        ? t('ядро работает, но трафик системы наружу не выпускается (killswitch или маршруты)')
        : t('ядро не отдаёт трафик');

    this.log(
      t('Самопроверка: ') + out.diagnosis +
      t(' · системой ') + (out.direct ? out.direct.code + t(' за ') + out.direct.time + t(' с') : t('нет')) +
      t(' · через ядро ') + (out.viaCore ? out.viaCore.code : t('нет')) +
      t(' · задержка ') + (out.delay != null ? out.delay + t(' мс') : t('нет'))
    );
    return out;
  }

  /** Задержка до сервера через Clash API (мс) или null. */
  async testDelay(timeoutMs = 5000) {
    if (this.state !== 'running') return null;
    try {
      const url =
        'http://127.0.0.1:' + this.clashPort +
        '/proxies/proxy/delay?timeout=' + timeoutMs +
        '&url=' + encodeURIComponent('http://cp.cloudflare.com/generate_204');
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs + 2000) });
      if (!r.ok) return null;
      const d = await r.json();
      return typeof d.delay === 'number' ? d.delay : null;
    } catch {
      return null;
    }
  }
}

/** Достаём человекочитаемую причину падения из логов ядра. */
function guessError(logs) {
  const tail = logs.slice(-40).join('\n');
  if (/already exists|уже существует/i.test(tail)) {
    return t('Сетевой адаптер занят прошлым запуском');
  }
  if (/cache-file: timeout|initialize cache-file/i.test(tail)) {
    return t('Ядро уже запущено: файл кэша занят другим экземпляром');
  }
  if (/permission denied|access is denied|Отказано в доступе/i.test(tail)) {
    return t('Нет прав администратора для режима туннеля');
  }
  if (/address already in use|Только один раз/i.test(tail)) {
    return t('Порт занят другим приложением');
  }
  if (/decode config|unmarshal|invalid config|parse config/i.test(tail)) {
    return t('Ключ не поддерживается ядром');
  }
  if (/reality|handshake|tls: /i.test(tail)) {
    return t('Сервер отклонил подключение (проверьте ключ)');
  }
  const err = logs.slice(-40).reverse().find((l) => /FATAL|ERROR/i.test(l));
  return err ? err.replace(/^.*?(FATAL|ERROR)\s*/i, '').slice(0, 160) : '';
}

module.exports = { Core };
