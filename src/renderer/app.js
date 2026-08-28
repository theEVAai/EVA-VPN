'use strict';

const $ = (id) => document.getElementById(id);
const api = window.eva;

let state = null;
let pingTimer = null;

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

function fmtSpeed(bytes) {
  if (bytes < 1024) return bytes + ' Б/с';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' КБ/с';
  return (bytes / 1048576).toFixed(1) + ' МБ/с';
}

function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' КБ';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' МБ';
  return (bytes / 1073741824).toFixed(2) + ' ГБ';
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

let toastTimer = null;
function toast(text, kind) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2600);
}

function keyIdOf(p) {
  if (!p) return '';
  return p.uuid || p.password || p.server;
}

function esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ------------------------------------------------------------------ */
/* Цвет ключа                                                          */
/* ------------------------------------------------------------------ */

const KEY_COLORS = [
  ['#2450e8', 'EVA'],       ['#4a6ff0', 'Лазурь'],   ['#00b4d8', 'Циан'],
  ['#00d0a4', 'Мята'],      ['#14b88a', 'Изумруд'],  ['#64c832', 'Лайм'],
  ['#e8c020', 'Янтарь'],    ['#f08a24', 'Оранж'],    ['#e8503a', 'Алый'],
  ['#a8324f', 'Вино'],      ['#e0447a', 'Розовый'],  ['#b44ae8', 'Фиолет'],
  ['#7a5cff', 'Индиго'],    ['#8892a8', 'Сталь'],    ['#d8cdb8', 'Крем']
];

const DEFAULT_COLOR = KEY_COLORS[0][0];

let currentColor = null;
let firstPaint = true;

/** Цвет активного ключа виден в скважине сердца. Само сердце остаётся фирменным. */
function applyColor(hex) {
  const color = hex || DEFAULT_COLOR;
  if (color === currentColor) return;
  const changed = currentColor !== null;
  currentColor = color;
  document.documentElement.style.setProperty('--accent', color);
  if (changed && !firstPaint) {
    document.body.classList.remove('keyswap');
    void document.body.offsetWidth; // перезапуск анимации
    document.body.classList.add('keyswap');
    setTimeout(() => document.body.classList.remove('keyswap'), 950);
  }
}

function openPalette(chip, id, active) {
  const pop = $('palettePop');
  pop.innerHTML = KEY_COLORS.map(
    ([hex, name]) =>
      `<button class="swatch${hex === active ? ' active' : ''}" data-color="${hex}" data-for="${id}" style="background:${hex}" title="${name}"></button>`
  ).join('');
  pop.hidden = false;

  // держим меню в пределах окна
  const r = chip.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let left = r.left - 4;
  let top = r.bottom + 6;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (top + h > window.innerHeight - 8) top = r.top - h - 6;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
}

function closePalette() {
  const pop = $('palettePop');
  if (pop) pop.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Отрисовка состояния                                                 */
/* ------------------------------------------------------------------ */

function render(s) {
  state = s;
  const running = s.state === 'running';
  const busy = s.state === 'starting' || s.state === 'stopping';

  // туннеля нет, а killswitch ещё держит трафик — это не ошибка, это защита
  const locked = !running && !busy && s.guard && s.guard.killSwitch;

  document.body.classList.toggle('on', running);
  document.body.classList.toggle('busy', busy);
  document.body.classList.toggle('locked', locked);

  $('statusText').textContent = busy
    ? (s.state === 'starting' ? 'ПОДКЛЮЧЕНИЕ' : 'ОТКЛЮЧЕНИЕ')
    : running
      ? 'ЗАЩИЩЕНО'
      : locked
        ? 'СЕТЬ ЗАБЛОКИРОВАНА'
        : 'НЕ ЗАЩИЩЕНО';

  const p = s.profile;
  if (locked) {
    $('subText').textContent = '// killswitch держит трафик — нажмите сердце, чтобы снять';
  } else if (running && p) {
    $('subText').textContent = '// ' + p.name + ' · ' + (s.mode === 'tun' ? 'туннель' : 'прокси');
  } else if (p) {
    $('subText').textContent = '// ' + p.name;
  } else {
    $('subText').textContent = '// ключ не добавлен';
  }

  // служебная строка
  const guard = [];
  if (s.settings.killSwitch) guard.push('KILLSWITCH');
  if (s.settings.vpnPriority) guard.push('ПРИОРИТЕТ');
  if (s.settings.blockIpv6) guard.push('IPV6 OFF');
  $('stripMode').textContent = '// ' + (s.settings.mode === 'tun' ? 'туннель' : 'прокси');
  $('stripGuard').textContent = guard.length ? '// ' + guard.join(' · ') : '// защита выкл';
  $('stripGuard').classList.toggle('on', running && guard.length > 0);

  $('applyBar').hidden = !s.pendingRestart;
  $('metrics').hidden = !running;
  $('keyVal').textContent = p ? keyIdOf(p) : 'ключ не добавлен';
  $('version').textContent = 'v' + s.version;
  $('aboutVer').textContent = 'ВЕРСИЯ ' + s.version + ' · SING-BOX';
  $('keysCount').textContent = s.profiles.length ? s.profiles.length + ' шт.' : 'нет';

  applyColor(p && p.color);

  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.checked = r.value === s.settings.mode;
  });
  document.querySelectorAll('[data-set]').forEach((el) => {
    const key = el.dataset.set;
    if (el.type === 'checkbox') el.checked = !!s.settings[key];
    else if (document.activeElement !== el) el.value = s.settings[key];
  });

  renderKeys(s);
  renderBlocks(s);
  if (panelStack.includes('panelAccount')) renderAccount();
}

/* ------------------------------------------------------------------ */
/* Блокировки и обходы                                                 */
/* ------------------------------------------------------------------ */

function renderBlocks(s) {
  const box = $('blocksList');
  if (!box || !s.modules) return;

  const groups = [
    ['// что режем', 'reject'],
    ['// что пускаем мимо vpn', 'direct']
  ];
  box.innerHTML = groups
    .map(([label, action]) => {
      const rows = s.modules
        .filter((m) => m.action === action)
        .map(
          (m) =>
            `<label class="sw"><span>${esc(m.title)}<em>${esc(m.hint)}</em></span>` +
            `<input type="checkbox" data-mod="${m.key}"${s.settings[m.key] ? ' checked' : ''} /><i></i></label>`
        )
        .join('');
      return `<div class="blockgroup"><div class="glabel">${label}</div>${rows}</div>`;
    })
    .join('');

  const on = s.modules.filter((m) => s.settings[m.key]).length;
  $('blocksCount').textContent = on + ' из ' + s.modules.length + ' включено';
}

let siteData = null;
let siteBusy = false;
let needCode = false;

function accountLoginHtml(error) {
  return `
    <div class="group">
      <div class="glabel">// вход в кабинет</div>
      <label class="field"><span>Почта</span><input type="email" id="siteEmail" spellcheck="false" autocomplete="off" /></label>
      <label class="field"><span>Пароль</span><input type="password" id="sitePass" autocomplete="off" /></label>
      ${needCode ? '<label class="field"><span>Код 2FA</span><input type="text" id="siteCode" inputmode="numeric" autocomplete="off" /></label>' : ''}
      ${error ? `<p class="note" style="color:var(--danger)">${esc(error)}</p>` : ''}
      <div class="btnrow" style="padding:8px 10px 10px">
        <button class="ghost" data-link="https://vpn.theeva.ai/login">РЕГИСТРАЦИЯ</button>
        <button class="primary" id="siteLoginBtn">ВОЙТИ</button>
      </div>
    </div>
    <p class="hint">Вход тот же, что на сайте. После входа ключ выдаётся прямо здесь —
    копировать ссылку вручную больше не нужно.</p>`;
}

const POOL_NAMES = {
  AUTO_GAMING: ['Игровой', 'ровный низкий пинг'],
  AUTO_GENERAL: ['Общий', 'обычный выход в интернет'],
  AUTO: ['Каскад', 'переживает блокировки'],
  AUTO_DIRECT: ['Прямой', 'быстрее, блокируется первым']
};

function accountDashHtml(d) {
  const me = d.me || {};
  const plan = me.plan;
  const key = d.key;
  const srv = d.servers;

  const rows = [];
  rows.push('<div class="accrow"><span>Аккаунт</span><b>' + esc(me.displayName || '—') + '</b></div>');
  rows.push('<div class="accrow"><span>Тариф</span><b>' + (plan ? esc(plan.nameRu) : 'нет') + '</b></div>');
  rows.push('<div class="accrow"><span>Баланс</span><b>' + (me.balanceRub != null ? me.balanceRub + ' ₽' : '—') + '</b></div>');
  if (me.daysUnlimited) {
    rows.push('<div class="accrow"><span>Срок</span><b>без ограничения</b></div>');
  } else if (me.expiresAt) {
    rows.push(
      '<div class="accrow"><span>Осталось</span><b>' + me.daysLeft + ' дн. · до ' +
      new Date(me.expiresAt).toLocaleDateString('ru-RU') + '</b></div>'
    );
  }
  if (plan && plan.trafficGb) {
    const used = key && key.trafficUsedGb != null ? key.trafficUsedGb : (srv && srv.trafficUsedGb) || 0;
    if (plan.trafficGb >= 99999) {
      // безлимит на спец-тарифах: полоса тут только вводит в заблуждение
      rows.push('<div class="accrow"><span>Трафик</span><b>' + used + ' ГБ · без ограничения</b></div>');
    } else {
      const pct = Math.min(100, Math.round((used / plan.trafficGb) * 100));
      rows.push('<div class="accrow"><span>Трафик</span><b>' + used + ' из ' + plan.trafficGb + ' ГБ</b></div>');
      rows.push('<div class="accbar"><i style="width:' + pct + '%"></i></div>');
    }
  }

  const current = (srv && srv.currentServer) || (key && key.server);
  const currentLabel = current
    ? [current.flagEmoji, current.cityName].filter(Boolean).join(' ')
    : 'ключ ещё не выдан';

  let serversHtml = '';
  if (srv && srv.options && srv.options.length) {
    serversHtml = srv.options
      .map((opt) => {
        const [name, hint] = POOL_NAMES[opt.kind] || [opt.kind, ''];
        const members = (opt.members || [])
          .map((m) => {
            const cur = srv.currentServerId && m.choice.endsWith('#' + srv.currentServerId);
            return `<button class="srv${cur ? ' current' : ''}" data-choice="${esc(m.choice)}">` +
              esc([m.flagEmoji, m.cityName].filter(Boolean).join(' ')) + '</button>';
          })
          .join('');
        return (
          '<div class="srvgroup"><div class="srvhead"><span>' + esc(name) + ' · ' + esc(hint) + '</span>' +
          `<button class="srvauto" data-choice="${esc(opt.choice)}">АВТО</button></div>` +
          (members ? '<div class="srvlist">' + members + '</div>' : '') +
          '</div>'
        );
      })
      .join('');
    if (srv && !srv.manualAllowed) {
      serversHtml += '<p class="note">Выбор конкретной страны доступен на тарифе PRO и выше — ' +
        'сейчас работает автоподбор внутри режима.</p>';
    }
  }

  return `
    <div class="group">
      <div class="glabel">// аккаунт</div>
      <div class="acccard">${rows.join('')}</div>
    </div>
    <div class="group">
      <div class="glabel">// ключ для этого компьютера</div>
      <div class="acccard">
        <div class="accrow"><span>Сервер</span><b>${esc(currentLabel)}</b></div>
      </div>
      <div class="btnrow" style="padding:0 10px 10px">
        <button class="primary" id="siteImportBtn">ОБНОВИТЬ КЛЮЧ</button>
      </div>
    </div>
    ${serversHtml ? '<div class="group"><div class="glabel">// сменить сервер</div>' + serversHtml + '</div>' : ''}
    ${(d.errors || []).length ? '<p class="note" style="color:var(--danger)">' + esc(d.errors.join(' · ')) + '</p>' : ''}
    <div class="btnrow">
      <button class="ghost" data-link="https://vpn.theeva.ai/login">ОТКРЫТЬ САЙТ</button>
      <button class="ghost" id="siteLogoutBtn">ВЫЙТИ</button>
    </div>`;
}

function renderAccount(error) {
  const box = $('accountBox');
  if (!box || !state) return;
  if (siteBusy) {
    box.innerHTML = '<div class="emptyhint">ЗАГРУЗКА…</div>';
    return;
  }
  if (!state.site || !state.site.authorized) {
    box.innerHTML = accountLoginHtml(error);
    return;
  }
  if (!siteData) {
    box.innerHTML = '<div class="emptyhint">' + (error ? esc(error) : 'НЕТ ДАННЫХ') +
      '<br><br></div><div class="btnrow"><button class="primary" id="siteReloadBtn">ОБНОВИТЬ</button></div>';
    return;
  }
  box.innerHTML = accountDashHtml(siteData);
}

async function refreshAccount() {
  if (!state || !state.site || !state.site.authorized) return renderAccount();
  siteBusy = true;
  renderAccount();
  const res = await api.siteRefresh();
  siteBusy = false;
  if (res.ok) {
    siteData = res.data;
    renderAccount();
  } else {
    siteData = null;
    if (res.code === 'UNAUTHORIZED') render(await api.getState());
    renderAccount(res.error);
  }
}

function renderKeys(s) {
  const box = $('keysList');
  if (!s.profiles.length) {
    box.innerHTML = '<div class="emptyhint">ПОКА НЕТ НИ ОДНОГО КЛЮЧА<br>Добавьте vless:// или ссылку на подписку</div>';
    return;
  }
  const subName = (id) => {
    const sub = s.subs.find((x) => x.id === id);
    return sub ? sub.name : null;
  };
  box.innerHTML = s.profiles
    .map((p) => {
      const active = p.id === s.activeId;
      const from = p.source && p.source !== 'manual' ? subName(p.source) : null;
      const meta = [p.type, p.server + ':' + p.port, from ? 'из ' + from : null].filter(Boolean).join(' · ');
      const color = p.color || DEFAULT_COLOR;
      return `<div class="keyitem">
        <div class="keycard${active ? ' active' : ''}${from ? ' subcard' : ''}" data-id="${p.id}">
          <button class="kcolor" data-colorbtn="${p.id}" title="Цвет ключа"><i style="background:${color}"></i></button>
          <span class="kinfo"><span class="kname">${esc(p.name)}</span><span class="kmeta">${esc(meta)}</span></span>
          <button class="kdel" data-del="${p.id}" title="Удалить">
            <svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V5h6v2"/></svg>
          </button>
        </div>
      </div>`;
    })
    .join('');
}

/* ------------------------------------------------------------------ */
/* Панели                                                              */
/* ------------------------------------------------------------------ */

const panelStack = [];

function openPanel(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add('open');
  panelStack.push(id);
  document.body.classList.add('panelopen');
  if (id === 'panelLogs') loadLogs();
  if (id === 'panelAccount') refreshAccount();
}

function closePanel() {
  closePalette();
  const id = panelStack.pop();
  if (id) $(id).classList.remove('open');
  if (!panelStack.length) document.body.classList.remove('panelopen');
}

function closeAllPanels() {
  while (panelStack.length) closePanel();
}

async function loadLogs() {
  const lines = await api.logs();
  const box = $('logsBox');
  box.textContent = lines.join('\n');
  box.parentElement.scrollTop = box.parentElement.scrollHeight;
}

/* ------------------------------------------------------------------ */
/* Действия                                                            */
/* ------------------------------------------------------------------ */

let toggleBusy = false;

async function toggleVpn() {
  // клик во время подключения раньше отменял его и запускал заново
  if (toggleBusy || document.body.classList.contains('busy')) return;

  if (document.body.classList.contains('locked')) {
    toggleBusy = true;
    await api.releaseGuards();
    toggleBusy = false;
    toast('Блокировка снята', 'ok');
    render(await api.getState());
    return;
  }
  toggleBusy = true;
  const res = await api.toggle();
  toggleBusy = false;
  if (res && res.error === 'busy') return;
  if (res && res.error === 'need-admin') {
    $('modalAdmin').classList.add('show');
    return;
  }
  if (res && res.ok === false && res.error) toast(res.error, 'err');
}

async function addFromInput() {
  const text = $('addInput').value.trim();
  if (!text) return toast('Вставьте ключ или ссылку', 'err');
  $('btnAdd').disabled = true;
  $('btnAdd').textContent = 'ЗАГРУЗКА…';
  const res = await api.addKey(text);
  $('btnAdd').disabled = false;
  $('btnAdd').textContent = 'ДОБАВИТЬ';
  if (!res.ok) return toast(res.error, 'err');
  $('addInput').value = '';
  toast(res.kind === 'sub' ? `Подписка добавлена: ${res.added} серверов` : `Добавлено ключей: ${res.added}`, 'ok');
  render(await api.getState());
  closePanel();
  if (!panelStack.includes('panelKeys')) openPanel('panelKeys');
}

function schedulePing() {
  clearInterval(pingTimer);
  pingTimer = setInterval(async () => {
    if (!state || state.state !== 'running') return;
    const { delay } = await api.ping();
    $('mPing').textContent = delay ? delay + ' мс' : '—';
  }, 30000);
}

/* ------------------------------------------------------------------ */
/* Слушатели                                                           */
/* ------------------------------------------------------------------ */

function wire() {
  $('btnPower').addEventListener('click', toggleVpn);
  $('btnMin').addEventListener('click', () => api.minimize());
  $('btnClose').addEventListener('click', () => api.close());
  $('btnMenu').addEventListener('click', () => openPanel('panelMenu'));

  $('btnShare').addEventListener('click', async () => {
    if (!state || !state.profile) return toast('Нет активного ключа', 'err');
    await api.copyKey(state.profile.id);
    toast('Ссылка на ключ скопирована', 'ok');
  });

  $('btnCopy').addEventListener('click', () => {
    if (!state || !state.profile) return;
    api.copy(keyIdOf(state.profile));
    toast('ID ключа скопирован', 'ok');
  });

  $('scrim').addEventListener('click', closeAllPanels);

  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePanel));
  document.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => openPanel(b.dataset.open))
  );
  document.querySelectorAll('[data-link]').forEach((b) =>
    b.addEventListener('click', () => api.openExternal(b.dataset.link))
  );

  $('btnAdd').addEventListener('click', addFromInput);
  $('btnPaste').addEventListener('click', async () => {
    $('addInput').value = await api.paste();
  });

  $('keysList').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      render(await api.removeKey(del.dataset.del));
      return;
    }

    const colorBtn = e.target.closest('[data-colorbtn]');
    if (colorBtn) {
      const id = colorBtn.dataset.colorbtn;
      const profile = state.profiles.find((x) => x.id === id);
      const pop = $('palettePop');
      if (!pop.hidden && pop.dataset.owner === id) closePalette();
      else {
        pop.dataset.owner = id;
        openPalette(colorBtn, id, (profile && profile.color) || DEFAULT_COLOR);
      }
      return;
    }

    const card = e.target.closest('.keycard');
    if (card) {
      render(await api.selectKey(card.dataset.id));
      toast('Ключ выбран', 'ok');
    }
  });

  $('btnRefreshAccount').addEventListener('click', refreshAccount);

  $('accountBox').addEventListener('click', async (e) => {
    if (e.target.closest('#siteLoginBtn')) {
      const email = ($('siteEmail') || {}).value;
      const pass = ($('sitePass') || {}).value;
      const code = ($('siteCode') || {}).value;
      if (!email || !pass) return renderAccount('Заполните почту и пароль');
      siteBusy = true;
      renderAccount();
      const res = await api.siteLogin(email, pass, code);
      siteBusy = false;
      if (!res.ok) {
        needCode = res.code === 'TOTP_REQUIRED' || res.code === 'TOTP_BAD_CODE';
        renderAccount(res.error);
        return;
      }
      needCode = false;
      render(await api.getState());
      await refreshAccount();
      toast('Вход выполнен', 'ok');
      return;
    }

    if (e.target.closest('#siteLogoutBtn')) {
      await api.siteLogout();
      siteData = null;
      render(await api.getState());
      renderAccount();
      return;
    }

    if (e.target.closest('#siteReloadBtn')) return refreshAccount();

    if (e.target.closest('#siteImportBtn')) {
      toast('Запрашиваю ключ…');
      const res = await api.siteImport();
      if (!res.ok) return toast(res.error, 'err');
      toast('Ключ обновлён: ' + res.name, 'ok');
      render(await api.getState());
      await refreshAccount();
      return;
    }

    const srv = e.target.closest('[data-choice]');
    if (srv) {
      toast('Меняю сервер…');
      const res = await api.siteSwitch(srv.dataset.choice);
      if (!res.ok) return toast(res.error, 'err');
      toast('Сервер сменён: ' + res.name, 'ok');
      render(await api.getState());
      await refreshAccount();
    }
  });

  $('blocksList').addEventListener('change', async (e) => {
    const el = e.target.closest('[data-mod]');
    if (!el) return;
    const wasRunning = state && state.state === 'running';
    render(await api.setSetting(el.dataset.mod, el.checked));
    if (wasRunning) toast('Применится после переподключения');
  });

  $('applyBtn').addEventListener('click', async () => {
    toast('Переподключаю…');
    const res = await api.reapply();
    if (res && res.ok === false && res.error) toast(res.error, 'err');
    else toast('Изменения применены', 'ok');
    render(await api.getState());
  });

  $('palettePop').addEventListener('click', async (e) => {
    const sw = e.target.closest('[data-color]');
    if (!sw) return;
    closePalette();
    render(await api.setKeyColor(sw.dataset.for, sw.dataset.color));
  });

  document.addEventListener('mousedown', (e) => {
    if (!$('palettePop').hidden && !e.target.closest('#palettePop') && !e.target.closest('[data-colorbtn]')) {
      closePalette();
    }
  });

  $('btnRefreshSubs').addEventListener('click', async () => {
    toast('Обновляю подписки…');
    const res = await api.updateSubs(null);
    if (!res.ok) return toast(res.error, 'err');
    toast(`Обновлено серверов: ${res.added}`, 'ok');
    render(await api.getState());
  });

  $('btnRepair').addEventListener('click', async () => {
    toast('Восстанавливаю сеть…');
    const report = await api.repairNetwork(false);
    toast(report[report.length - 1] || 'Готово', 'ok');
    render(await api.getState());
  });

  $('btnOpenLogs').addEventListener('click', () => api.openLogs());

  $('btnSelfTest').addEventListener('click', async () => {
    toast('Проверяю соединение…');
    const res = await api.selfTest();
    if (!res.ok) return toast(res.error || 'Проверка не удалась', 'err');
    const t = res.test;
    const foreign = (res.foreign || []).map((x) => x.name).join(', ');
    if (t.ok) {
      toast('Трафик проходит · ' + (t.delay != null ? t.delay + ' мс' : 'без пинга') +
        (foreign ? ' · рядом: ' + foreign : ''), 'ok');
    } else {
      toast('Трафик НЕ проходит' + (foreign ? ' · мешает ' + foreign : '') + ' — смотрите журнал', 'err');
    }
    loadLogs();
  });

  $('btnCopyLogs').addEventListener('click', async () => {
    const lines = await api.logs();
    api.copy(lines.join('\n'));
    toast('Журнал скопирован', 'ok');
  });

  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', async () => {
      if (r.checked) render(await api.setSetting('mode', r.value));
    })
  );

  document.querySelectorAll('[data-set]').forEach((el) => {
    const key = el.dataset.set;
    if (el.type === 'checkbox') {
      el.addEventListener('change', async () => render(await api.setSetting(key, el.checked)));
    } else {
      el.addEventListener('change', async () => {
        const val = el.type === 'number' ? Number(el.value) : el.value.trim();
        render(await api.setSetting(key, val));
      });
    }
  });

  $('admProxy').addEventListener('click', async () => {
    $('modalAdmin').classList.remove('show');
    await api.setSetting('mode', 'proxy');
    toggleVpn();
  });
  $('admRestart').addEventListener('click', () => {
    $('modalAdmin').classList.remove('show');
    api.relaunchAdmin();
  });
  $('modalAdmin').addEventListener('click', (e) => {
    if (e.target === $('modalAdmin')) $('modalAdmin').classList.remove('show');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('palettePop').hidden) closePalette();
      else if ($('modalAdmin').classList.contains('show')) $('modalAdmin').classList.remove('show');
      else if (panelStack.length) closePanel();
    }
  });

  api.on('state', (s) => render(s));
  api.on('stats', (s) => {
    $('mDown').textContent = fmtSpeed(s.down);
    $('mUp').textContent = fmtSpeed(s.up);
    if (state && state.state === 'running') {
      $('subText').textContent =
        '// ' + (state.profile ? state.profile.name : '') + ' · ' + fmtUptime(s.uptime) + ' · ' + fmtBytes(s.downTotal + s.upTotal);
    }
  });
  api.on('ping', ({ delay }) => {
    $('mPing').textContent = delay ? delay + ' мс' : '—';
  });
  api.on('toast', ({ text, kind }) => toast(text, kind));
  api.on('selftest', (t) => {
    if (t && !t.ok) toast('Туннель поднят, но трафик не проходит', 'err');
  });
  api.on('log', () => {
    if (panelStack.includes('panelLogs')) loadLogs();
  });
}

/* ------------------------------------------------------------------ */

(async function init() {
  wire();
  render(await api.getState());
  firstPaint = false;
  schedulePing();
})();
