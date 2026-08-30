'use strict';
/** Менеджер ядра sing-box: запуск, остановка, статистика через Clash API. */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const { buildConfig, TUN_IPV4 } = require('./config');
const netfix = require('./netfix');

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
    this.proxyWasSet = false;
    this.starting = false;
    this.intentionalStop = false;
    this.priorityApplied = false;
    this.killSwitchOn = false;
    this.lastError = '';
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

  async start(profile, mode, settings, attempt = 1) {
    // Два запуска одновременно — это два ядра, дерущихся за один сетевой
    // адаптер и один файл кэша. Именно так рождались «Cannot create a file
    // when that file already exists» и «initialize cache-file: timeout».
    if (this.starting) {
      this.log('Запуск уже идёт — повторный запрос отброшен');
      return { ok: false, error: 'Подключение уже выполняется' };
    }
    this.starting = true;
    try {
      return await this.startInner(profile, mode, settings, attempt);
    } finally {
      this.starting = false;
    }
  }

  async startInner(profile, mode, settings, attempt = 1) {
    // при перезапуске killswitch не снимаем: иначе на несколько секунд
    // открывается прямой выход в сеть — ровно то, от чего он защищает
    if (this.proc) await this.stop({ keepGuards: true });

    this.profile = profile;
    this.mode = mode;
    this.clashPort = settings.clashPort || 19090;
    this.mixedPort = settings.mixedPort || 2080;
    this.lastError = '';
    this.setState('starting');

    // подчищаем возможные хвосты прошлого запуска
    await netfix.killOrphanCores();
    // старое ядро держит файл кэша эксклюзивно: новое молча зависнет на его открытии
    await netfix.waitProcessGone('sing-box');
    if (mode === 'tun') {
      // адаптер прошлой сессии умирает не мгновенно; если начать раньше,
      // новое ядро молча зависнет на создании туннеля
      const gone = await netfix.waitAdapterGone(settings.tunName || netfix.tunAlias());
      if (!gone) this.log('Прошлый адаптер ещё в системе — поднимаем туннель поверх');
    }

    const cfg = buildConfig({
      profile,
      mode,
      opts: settings,
      paths: { srss: this.paths.srss, cache: path.join(this.paths.userData, 'cache.db') }
    });
    const file = this.configPath();
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');

    this.log('$ sing-box run  (' + (mode === 'tun' ? 'туннель' : 'системный прокси') + ', ' + profile.name + ')');

    this.proc = spawn(this.paths.coreExe, ['run', '-c', file, '--disable-color'], {
      cwd: path.dirname(this.paths.coreExe),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.proc.stdout.on('data', (b) => String(b).split(/\r?\n/).forEach((l) => this.log(l)));
    this.proc.stderr.on('data', (b) => String(b).split(/\r?\n/).forEach((l) => this.log(l)));

    this.proc.on('error', (e) => {
      this.lastError = 'Не удалось запустить ядро: ' + e.message;
      this.log(this.lastError);
      // пока идёт запуск, наружу об ошибке сообщает только сам запуск:
      // иначе снаружи планируется повтор поверх ещё не законченной попытки
      if (!this.starting) this.setState('error', { error: this.lastError });
    });

    this.proc.on('exit', (code) => {
      // Ядро могли остановить мы сами — при перезапуске или повторной попытке.
      // Раньше такой выход считался аварией, снаружи планировался автоповтор,
      // и он стартовал поверх уже поднявшегося туннеля: два ядра дрались за адаптер.
      const wasRunning =
        !this.intentionalStop && !this.starting &&
        (this.state === 'running' || this.state === 'starting');
      this.proc = null;
      this.stopStats();
      if (this.proxyWasSet) {
        netfix.clearSystemProxy();
        this.proxyWasSet = false;
      }
      if (wasRunning) {
        this.lastError = this.lastError || guessError(this.logs) || ('Ядро завершилось (код ' + code + ')');
        this.setState('error', { error: this.lastError });
      } else {
        this.setState('stopped');
      }
    });

    // создание TUN-адаптера на медленной машине занимает заметно дольше
    const ready = await this.waitReady(mode === 'tun' ? 25000 : 15000);
    if (!ready) {
      const err = guessError(this.logs) || 'Ядро не ответило вовремя';
      this.log('Ядро не поднялось: ' + err);
      await this.stop();
      // wintun иногда не отдаёт устройство с первого раза — вторая попытка обычно проходит
      if (attempt < 2) {
        this.log('Повторная попытка запуска: убираю хвосты прошлой');
        await netfix.killOrphanCores();
        await netfix.waitProcessGone('sing-box');
        if (mode === 'tun') await netfix.waitAdapterGone(settings.tunName || netfix.tunAlias());
        await new Promise((r) => setTimeout(r, 1500));
        return this.startInner(profile, mode, settings, attempt + 1);
      }
      this.lastError = err;
      this.setState('error', { error: err });
      return { ok: false, error: err };
    }

    if (mode === 'proxy') {
      await netfix.setSystemProxy(settings.mixedPort || 2080);
      this.proxyWasSet = true;
      this.log('Системный прокси включён: 127.0.0.1:' + (settings.mixedPort || 2080));
    }

    if (mode === 'tun') {
      const alias = settings.tunName || netfix.tunAlias();

      // Уже запущенные программы помнят, каким интерфейсом ходить к адресу.
      // Сброс кэшей заставляет их принять решение заново.
      await netfix.flushRouteCaches();

      // наш туннель должен быть главным, иначе чужой VPN перетянет маршрут на себя
      if (settings.vpnPriority !== false) {
        const demoted = await netfix.applyPriority(alias);
        this.priorityApplied = true;
        this.log(
          'Приоритет туннеля: метрика 1' +
          (demoted.length
            ? ' · подавлены: ' + demoted.map((d) =>
                d.name + ' (метрика 9000' +
                (d.routes && d.routes.length ? ', снято маршрутов ' + d.routes.length : '') +
                (d.dns && d.dns.length ? ', DNS очищен' : '') + ')'
              ).join(', ')
            : '')
        );
      }

      // всё, что попытается уйти мимо туннеля, брандмауэр не выпустит
      if (settings.killSwitch !== false) {
        const ks = await netfix.enableKillSwitch({
          alias,
          coreExe: this.paths.coreExe,
          appExe: this.paths.appExe,
          tunAddr: TUN_IPV4.split('/')[0]
        });
        this.killSwitchOn = true;
        this.log('Killswitch включён: исходящий трафик мимо туннеля заблокирован');
        if (ks && ks.disabledProfiles && ks.disabledProfiles.length) {
          const msg =
            'Брандмауэр Windows выключен (' + ks.disabledProfiles.join(', ') +
            ') — killswitch не удержит трафик. Включите брандмауэр.';
          this.log(msg);
          this.emit('notice', msg);
        }
      }
    }

    this.startedAt = Date.now();
    this.stats = { up: 0, down: 0, upTotal: 0, downTotal: 0, connections: 0 };
    this.startStats();
    this.setState('running');
    return { ok: true };
  }

  async waitReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.proc) return false;
      try {
        const r = await fetch('http://127.0.0.1:' + this.clashPort + '/version', {
          signal: AbortSignal.timeout(1500)
        });
        if (r.ok) return true;
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
      this.log('Killswitch снят');
    }
    if (this.priorityApplied) {
      await netfix.restorePriority();
      this.priorityApplied = false;
    }
  }

  async stop({ keepGuards = false } = {}) {
    if (!this.proc) {
      if (this.proxyWasSet) {
        await netfix.clearSystemProxy();
        this.proxyWasSet = false;
      }
      if (!keepGuards) await this.releaseGuards();
      this.stopStats();
      this.setState('stopped');
      return;
    }
    this.setState('stopping');
    this.intentionalStop = true;
    const proc = this.proc;
    this.proc = null;
    this.stopStats();

    try {
      proc.kill();
    } catch { /* уже мёртв */ }
    await netfix.runCmd('taskkill', ['/F', '/T', '/PID', String(proc.pid)]).catch(() => {});
    await netfix.waitProcessGone('sing-box');

    if (this.proxyWasSet) {
      await netfix.clearSystemProxy();
      this.proxyWasSet = false;
    }
    if (!keepGuards) await this.releaseGuards();
    this.startedAt = 0;
    this.intentionalStop = false;
    this.setState('stopped');
  }

  startStats() {
    this.stopStats();
    let prev = null;
    this.statsTimer = setInterval(async () => {
      try {
        const r = await fetch('http://127.0.0.1:' + this.clashPort + '/connections', {
          signal: AbortSignal.timeout(2000)
        });
        if (!r.ok) return;
        const d = await r.json();
        const now = { up: d.uploadTotal || 0, down: d.downloadTotal || 0, t: Date.now() };
        if (prev) {
          const dt = Math.max(0.2, (now.t - prev.t) / 1000);
          this.stats.up = Math.max(0, Math.round((now.up - prev.up) / dt));
          this.stats.down = Math.max(0, Math.round((now.down - prev.down) / dt));
        }
        this.stats.upTotal = now.up;
        this.stats.downTotal = now.down;
        this.stats.connections = (d.connections || []).length;
        prev = now;
        this.emit('stats', { ...this.stats, uptime: this.startedAt ? Date.now() - this.startedAt : 0 });
      } catch {
        /* ядро могло уйти — увидим по событию exit */
      }
    }, 1000);
  }

  stopStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
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
      ? 'трафик системы идёт через туннель'
      : out.viaCore
        ? 'ядро работает, но трафик системы наружу не выпускается (killswitch или маршруты)'
        : 'ядро не отдаёт трафик';

    this.log(
      'Самопроверка: ' + out.diagnosis +
      ' · системой ' + (out.direct ? out.direct.code + ' за ' + out.direct.time + ' с' : 'нет') +
      ' · через ядро ' + (out.viaCore ? out.viaCore.code : 'нет') +
      ' · задержка ' + (out.delay != null ? out.delay + ' мс' : 'нет')
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
    return 'Сетевой адаптер занят прошлым запуском';
  }
  if (/cache-file: timeout|initialize cache-file/i.test(tail)) {
    return 'Ядро уже запущено: файл кэша занят другим экземпляром';
  }
  if (/permission denied|access is denied|Отказано в доступе/i.test(tail)) {
    return 'Нет прав администратора для режима туннеля';
  }
  if (/address already in use|Только один раз/i.test(tail)) {
    return 'Порт занят другим приложением';
  }
  if (/decode config|unmarshal|invalid config|parse config/i.test(tail)) {
    return 'Ключ не поддерживается ядром';
  }
  if (/reality|handshake|tls: /i.test(tail)) {
    return 'Сервер отклонил подключение (проверьте ключ)';
  }
  const err = logs.slice(-40).reverse().find((l) => /FATAL|ERROR/i.test(l));
  return err ? err.replace(/^.*?(FATAL|ERROR)\s*/i, '').slice(0, 160) : '';
}

module.exports = { Core };
