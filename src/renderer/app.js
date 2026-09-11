'use strict';

const $ = (id) => document.getElementById(id);
const api = window.eva;

let state = null;

/* ------------------------------------------------------------------ */
/* Язык                                                                */
/* ------------------------------------------------------------------ */

let lang = 'ru';
/** Последняя удачная задержка: показывается, пока новая проба не пройдёт. */
let lastPing = null;
/** Перевод. До первого applyLang — тождество, то есть русский оригинал. */
let t = (s) => s;

/**
 * Статический текст разметки. Оригиналы снимаются один раз, до первой
 * отрисовки: иначе в «оригинал» попало бы уже подставленное значение
 * (например, имя ключа вместо «ключ не добавлен»).
 */
let i18nNodes = null;

function collectI18n() {
  i18nNodes = [];
  const cyr = /[А-Яа-яЁё]/;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeValue && cyr.test(n.nodeValue)) i18nNodes.push({ node: n, orig: n.nodeValue });
  }
  for (const el of document.querySelectorAll('[aria-label],[title],[placeholder]')) {
    for (const a of ['aria-label', 'title', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && cyr.test(v)) i18nNodes.push({ el, attr: a, orig: v });
    }
  }
}

function applyLang(next) {
  lang = next;
  t = window.I18N.translator(lang);
  if (!i18nNodes) collectI18n();
  for (const item of i18nNodes) {
    // пробелы по краям сохраняем: в разметке они держат вёрстку
    const lead = item.orig.match(/^\s*/)[0];
    const tail = item.orig.match(/\s*$/)[0];
    // Абзацы в разметке разбиты на строки, а в словаре записаны одной.
    // Без схлопывания пробелов такой текст просто не находится.
    const value = t(item.orig.trim().replace(/\s+/g, ' '));
    if (item.node) item.node.nodeValue = lead + value + tail;
    else item.el.setAttribute(item.attr, value);
  }
  document.documentElement.lang = lang;
}
/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

function fmtSpeed(bytes) {
  if (bytes < 1024) return bytes + t(' Б/с');
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + t(' КБ/с');
  return (bytes / 1048576).toFixed(1) + t(' МБ/с');
}

function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + t(' Б');
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + t(' КБ');
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + t(' МБ');
  return (bytes / 1073741824).toFixed(2) + t(' ГБ');
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
  el.textContent = t(text);
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
      `<button class="swatch${hex === active ? ' active' : ''}" data-color="${hex}" data-for="${id}" style="background:${hex}" title="${t(name)}"></button>`
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
  if (s.lang && s.lang !== lang) applyLang(s.lang);
  const running = s.state === 'running';
  const busy = s.state === 'starting' || s.state === 'stopping';

  // туннеля нет, а killswitch ещё держит трафик — это не ошибка, это защита
  const locked = !running && !busy && s.guard && s.guard.killSwitch;

  document.body.classList.toggle('on', running);
  document.body.classList.toggle('busy', busy);
  document.body.classList.toggle('locked', locked);

  $('statusText').textContent = busy
    ? (s.state === 'starting' ? t('ПОДКЛЮЧЕНИЕ') : t('ОТКЛЮЧЕНИЕ'))
    : running
      ? t('ЗАЩИЩЕНО')
      : locked
        ? t('СЕТЬ ЗАБЛОКИРОВАНА')
        : t('НЕ ЗАЩИЩЕНО');

  const p = s.profile;
  if (locked) {
    $('subText').textContent = t('// killswitch держит трафик — нажмите сердце, чтобы снять');
  } else if (running && p) {
    $('subText').textContent = '// ' + p.name + ' · ' + (s.mode === 'tun' ? t('туннель') : t('прокси'));
  } else if (p) {
    $('subText').textContent = '// ' + p.name;
  } else {
    $('subText').textContent = t('// ключ не добавлен');
  }

  // служебная строка
  const guard = [];
  if (s.settings.killSwitch) guard.push('KILLSWITCH');
  if (s.settings.vpnPriority) guard.push(t('ПРИОРИТЕТ'));
  if (s.settings.blockIpv6) guard.push('IPV6 OFF');
  $('stripMode').textContent = '// ' + (s.settings.mode === 'tun' ? t('туннель') : t('прокси'));
  $('stripGuard').textContent = guard.length ? '// ' + guard.join(' · ') : t('// защита выкл');
  $('stripGuard').classList.toggle('on', running && guard.length > 0);

  $('applyBar').hidden = !s.pendingRestart;
  $('metrics').hidden = !running;
  // после отключения старая задержка ничего не значит
  if (!running && lastPing) {
    lastPing = null;
    $('mPing').textContent = '—';
    $('mPing').classList.remove('stale');
  }
  $('keyVal').textContent = p ? keyIdOf(p) : t('ключ не добавлен');
  $('version').textContent = 'v' + s.version;
  $('aboutVer').textContent = t('ВЕРСИЯ ') + s.version + ' · SING-BOX';
  $('keysCount').textContent = s.profiles.length ? s.profiles.length + t(' шт.') : t('нет');

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
  renderSplit(s);
  renderUpdate(s.update);
  if (s.justUpdated) showThanks(s.justUpdated);
  if (panelStack.includes('panelAccount')) renderAccount();
}

/* ------------------------------------------------------------------ */
/* Раздельное туннелирование                                           */
/* ------------------------------------------------------------------ */

const SPLIT_ROW = {
  off: 'выключено',
  exclude: 'мимо VPN: ',
  include: 'через VPN только: '
};

function renderSplit(s) {
  const mode = s.settings.splitMode || 'off';
  const apps = s.settings.splitApps || [];

  document.querySelectorAll('input[name="splitMode"]').forEach((r) => {
    r.checked = r.value === mode;
  });

  $('splitRow').textContent =
    mode === 'off' || !apps.length ? t(SPLIT_ROW.off) : t(SPLIT_ROW[mode]) + apps.length + t(' шт.');

  const box = $('splitList');
  if (!apps.length) {
    box.innerHTML = t('<div class="appempty">список пуст — режим не действует</div>');
    return;
  }
  box.innerHTML = apps
    .map(
      (name) =>
        '<div class="appitem"><span>' + esc(name) + '</span>' +
        '<button class="appdel" data-app="' + esc(name) + t('" aria-label="Убрать">') +
        '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
    )
    .join('');
}

async function splitAddTyped() {
  const el = $('splitName');
  const text = el.value.trim();
  if (!text) return;
  const r = await api.splitAdd(text);
  el.value = '';
  render(await api.getState());
  toast(r.added ? t('Добавлено: ') + r.added : t('Уже в списке'), r.added ? 'ok' : 'err');
}
/* ------------------------------------------------------------------ */
/* Обновление                                                          */
/* ------------------------------------------------------------------ */

let upd = null;

/** Что делает большая кнопка в каждом из состояний. */
/**
 * Одна кнопка на весь путь: нажатие скачивает и ставит без второго
 * подтверждения. Промежуточные состояния только сообщают, что идёт работа.
 */
const UPD_BUTTON = {
  idle:        { text: 'ПРОВЕРИТЬ', on: true },
  checking:    { text: 'ПРОВЕРЯЮ…', on: false },
  available:   { text: 'ОБНОВИТЬ', on: true },
  downloading: { text: 'ПОДОЖДИТЕ…', on: false },
  ready:       { text: 'ОБНОВИТЬ', on: true },
  installing:  { text: 'ПОДОЖДИТЕ…', on: false },
  error:       { text: 'ПОПРОБОВАТЬ СНОВА', on: true }
};

/** Момент запуска окна: по нему решаем, показывать ли полосу проверки. */
const BOOT_AT = Date.now();

function renderUpdate(u) {
  if (!u) return;
  upd = u;
  const has = Boolean(u.latest);

  // намёки снаружи панели
  $('menuDot').hidden = !has;
  $('rowUpdate').hidden = !has;
  if (has) $('updateRow').textContent = t('версия ') + u.latest.version + t(' готова к установке');

  $('updFrom').textContent = 'v' + u.current;
  $('updTo').textContent = has ? 'v' + u.latest.version : 'v' + u.current;

  const hint = $('updHint');
  if (u.state === 'error') hint.textContent = t('Не получилось: ') + (u.error || t('без описания'));
  else if (u.state === 'checking') hint.textContent = t('Смотрю, нет ли новой версии…');
  else if (u.state === 'installing') hint.textContent = t('Запускаю установщик. Приложение сейчас закроется и откроется заново.');
  else if (u.state === 'ready') hint.textContent = t('Файл загружен и проверен по контрольной сумме. Можно ставить.');
  else if (u.state === 'downloading') hint.textContent = t('Подождите чуть-чуть — приложение обновится и запустится само.');
  else if (has) {
    const mb = (u.latest.size / 1048576).toFixed(1);
    hint.textContent = t('Скачать нужно ') + mb + t(' МБ. ') +
      (u.latest.notes ? u.latest.notes.split('\n')[0] : t('Установка идёт поверх текущей версии.'));
  } else {
    hint.textContent = u.error
      ? t('Проверить не вышло: ') + u.error
      : t('У вас последняя версия.');
  }

  // полоса прогресса
  const p = u.progress;
  const showProg = u.state === 'downloading' && p;
  $('updProg').hidden = !showProg;
  if (showProg) {
    $('updFill').style.width = p.percent + '%';
    $('updPct').textContent = p.percent + '%';
    $('updBytes').textContent = fmtBytes(p.received) + t(' из ') + fmtBytes(p.total);
    $('updSpeed').textContent = p.speed ? fmtSpeed(p.speed) : '';
  }

  const btn = UPD_BUTTON[u.state] || UPD_BUTTON.idle;
  $('btnUpdGo').textContent = t(btn.text);
  $('btnUpdGo').disabled = !btn.on;
  $('btnUpdCancel').hidden = u.state !== 'downloading';

  renderUpdateBar(u);
}

/**
 * Полоса внизу окна. При запуске показывает, что идёт проверка; дальше
 * живёт только когда есть о чём сказать. Прогресс рисуется заливкой самой
 * полосы, поэтому она остаётся одной строкой и ничего не загораживает.
 */
function renderUpdateBar(u) {
  const bar = $('updateBar');
  const btn = $('updateBarBtn');

  let show = true;
  let label = '';
  let action = null;
  let width = 0;

  switch (u.state) {
    case 'checking':
      // раз в шесть часов мигать полосой незачем: показываем только на старте
      show = Date.now() - BOOT_AT < 90000;
      label = t('// проверяю обновления…');
      break;
    case 'available':
      label = t('// вышла версия ') + u.latest.version;
      action = 'update';
      break;
    case 'downloading':
      width = u.progress ? u.progress.percent : 0;
      label = t('// подождите чуть-чуть · ') + width + '%';
      action = 'cancel';
      break;
    case 'ready':
      label = t('// подождите чуть-чуть · ставлю');
      width = 100;
      break;
    case 'installing':
      label = t('// подождите, приложение перезапустится');
      width = 100;
      break;
    case 'error':
      label = t('// не получилось обновиться');
      action = 'update';
      break;
    default:
      show = false;
  }

  bar.hidden = !show;
  bar.classList.toggle('ready', u.state !== 'checking');
  $('updateBarText').textContent = label;
  $('updateBarFill').style.width = width + '%';

  btn.hidden = !action;
  if (action) {
    btn.textContent = action === 'cancel' ? t('ОТМЕНИТЬ') : t('ОБНОВИТЬ');
    btn.dataset.act = action;
  }

  // две полосы в одном месте наложились бы: сдвигаем «применить» выше
  $('applyBar').style.bottom = show ? '112px' : '';
}

/**
 * Весь путь обновления по одному нажатию: проверить, скачать, поставить.
 * Второго подтверждения нет — человек уже сказал «обнови».
 */
async function runUpdate() {
  if (!upd) return;

  // ещё не знаем, есть ли что ставить
  if (!upd.latest) {
    const s = await api.updateCheck();
    renderUpdate(s);
    if (!s.latest) {
      toast(s.error ? t('Проверить не вышло: ') + s.error : t('Установлена последняя версия'),
            s.error ? 'err' : 'ok');
      return;
    }
  }

  // файл ещё не лежит на диске — качаем и сразу ставим
  if (upd.state !== 'ready') {
    const r = await api.updateDownload();
    if (!r.ok) {
      if (!r.cancelled) toast(r.error, 'err');
      return;
    }
  }

  const i = await api.updateInstall();
  if (!i.ok) toast(i.error, 'err');
}

/** Кнопка в панели: у неё же роль «просто проверить», когда обновления нет. */
async function updateAction() {
  if (!upd) return;
  if (upd.state === 'idle') {
    const s = await api.updateCheck();
    renderUpdate(s);
    if (!s.latest && !s.error) toast(t('Установлена последняя версия'), 'ok');
    return;
  }
  return runUpdate();
}

let thanksShown = false;

function showThanks(m) {
  if (thanksShown) return;
  thanksShown = true;
  $('thanksVer').textContent = t('Версия ') + m.to + t(' на месте. Ключи, вход в кабинет и настройки остались как были.');
  $('modalThanks').classList.add('show');
  api.updateSeen();
}

/* ------------------------------------------------------------------ */
/* Блокировки и обходы                                                 */
/* ------------------------------------------------------------------ */

function renderBlocks(s) {
  const box = $('blocksList');
  if (!box || !s.modules) return;

  const groups = [
    [t('// что режем'), 'reject'],
    [t('// что пускаем мимо vpn'), 'direct']
  ];
  box.innerHTML = groups
    .map(([label, action]) => {
      const rows = s.modules
        .filter((m) => m.action === action)
        .map(
          (m) =>
            `<label class="sw"><span>${esc(m.title)}` +
            (m.badge ? `<b class="must">${esc(m.badge)}</b>` : '') +
            `<em>${esc(m.hint)}</em></span>` +
            `<input type="checkbox" data-mod="${m.key}"${s.settings[m.key] ? ' checked' : ''} /><i></i></label>`
        )
        .join('');
      return `<div class="blockgroup"><div class="glabel">${label}</div>${rows}</div>`;
    })
    .join('');

  const on = s.modules.filter((m) => s.settings[m.key]).length;
  $('blocksCount').textContent = on + t(' из ') + s.modules.length + t(' включено');
}

let siteData = null;
let siteBusy = false;
let needCode = false;

function accountLoginHtml(error) {
  return `
    <div class="group">
      <div class="glabel">${t('// вход в кабинет')}</div>
      <label class="field"><span>${t('Почта')}</span><input type="email" id="siteEmail" spellcheck="false" autocomplete="off" /></label>
      <label class="field"><span>${t('Пароль')}</span><input type="password" id="sitePass" autocomplete="off" /></label>
      ${needCode ? t('<label class="field"><span>Код 2FA</span><input type="text" id="siteCode" inputmode="numeric" autocomplete="off" /></label>') : ''}
      ${error ? `<p class="note" style="color:var(--danger)">${esc(error)}</p>` : ''}
      <div class="btnrow" style="padding:8px 10px 10px">
        <button class="ghost" data-link="https://vpn.theeva.ai/login">${t('РЕГИСТРАЦИЯ')}</button>
        <button class="primary" id="siteLoginBtn">${t('ВОЙТИ')}</button>
      </div>
    </div>
    <p class="hint">${t('Вход тот же, что на сайте. После входа ключ выдаётся прямо здесь — копировать ссылку вручную больше не нужно.')}</p>`;
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
  rows.push(t('<div class="accrow"><span>Аккаунт</span><b>') + esc(me.displayName || '—') + '</b></div>');
  rows.push(t('<div class="accrow"><span>Тариф</span><b>') + (plan ? esc(plan.nameRu) : t('нет')) + '</b></div>');
  rows.push(t('<div class="accrow"><span>Баланс</span><b>') + (me.balanceRub != null ? me.balanceRub + ' ₽' : '—') + '</b></div>');
  if (me.daysUnlimited) {
    rows.push(t('<div class="accrow"><span>Срок</span><b>без ограничения</b></div>'));
  } else if (me.expiresAt) {
    rows.push(
      t('<div class="accrow"><span>Осталось</span><b>') + me.daysLeft + t(' дн. · до ') +
      new Date(me.expiresAt).toLocaleDateString('ru-RU') + '</b></div>'
    );
  }
  if (plan && plan.trafficGb) {
    const used = key && key.trafficUsedGb != null ? key.trafficUsedGb : (srv && srv.trafficUsedGb) || 0;
    if (plan.trafficGb >= 99999) {
      // безлимит на спец-тарифах: полоса тут только вводит в заблуждение
      rows.push(t('<div class="accrow"><span>Трафик</span><b>') + used + t(' ГБ · без ограничения</b></div>'));
    } else {
      const pct = Math.min(100, Math.round((used / plan.trafficGb) * 100));
      rows.push(t('<div class="accrow"><span>Трафик</span><b>') + used + t(' из ') + plan.trafficGb + t(' ГБ</b></div>'));
      rows.push('<div class="accbar"><i style="width:' + pct + '%"></i></div>');
    }
  }

  const current = (srv && srv.currentServer) || (key && key.server);
  const currentLabel = current
    ? [current.flagEmoji, current.cityName].filter(Boolean).join(' ')
    : t('ключ ещё не выдан');

  let serversHtml = '';
  if (srv && srv.options && srv.options.length) {
    serversHtml = srv.options
      .map((opt) => {
        const [rawName, rawHint] = POOL_NAMES[opt.kind] || [opt.kind, ''];
        const name = t(rawName);
        const hint = t(rawHint);
        const members = (opt.members || [])
          .map((m) => {
            const cur = srv.currentServerId && m.choice.endsWith('#' + srv.currentServerId);
            return `<button class="srv${cur ? ' current' : ''}" data-choice="${esc(m.choice)}">` +
              esc([m.flagEmoji, m.cityName].filter(Boolean).join(' ')) + '</button>';
          })
          .join('');
        return (
          '<div class="srvgroup"><div class="srvhead"><span>' + esc(name) + ' · ' + esc(hint) + '</span>' +
          `<button class="srvauto" data-choice="${esc(opt.choice)}">${t('АВТО')}</button></div>` +
          (members ? '<div class="srvlist">' + members + '</div>' : '') +
          '</div>'
        );
      })
      .join('');
    if (srv && !srv.manualAllowed) {
      serversHtml += t('<p class="note">Выбор конкретной страны доступен на тарифе PRO и выше — ') +
        t('сейчас работает автоподбор внутри режима.</p>');
    }
  }

  return `
    <div class="group">
      <div class="glabel">${t('// аккаунт')}</div>
      <div class="acccard">${rows.join('')}</div>
    </div>
    <div class="group">
      <div class="glabel">${t('// ключ для этого компьютера')}</div>
      <div class="acccard">
        <div class="accrow"><span>${t('Сервер')}</span><b>${esc(currentLabel)}</b></div>
      </div>
      <div class="btnrow" style="padding:0 10px 10px">
        <button class="primary" id="siteImportBtn">${t('ОБНОВИТЬ КЛЮЧ')}</button>
      </div>
    </div>
    ${serversHtml ? t('<div class="group"><div class="glabel">// сменить сервер</div>') + serversHtml + '</div>' : ''}
    ${(d.errors || []).length ? '<p class="note" style="color:var(--danger)">' + esc(d.errors.map(t).join(' · ')) + '</p>' : ''}
    <div class="btnrow">
      <button class="ghost" data-link="https://vpn.theeva.ai/login">${t('ОТКРЫТЬ САЙТ')}</button>
      <button class="ghost" id="siteLogoutBtn">${t('ВЫЙТИ')}</button>
    </div>`;
}

function renderAccount(error) {
  const box = $('accountBox');
  if (!box || !state) return;
  if (siteBusy) {
    box.innerHTML = t('<div class="emptyhint">ЗАГРУЗКА…</div>');
    return;
  }
  if (!state.site || !state.site.authorized) {
    box.innerHTML = accountLoginHtml(error);
    return;
  }
  if (!siteData) {
    box.innerHTML = '<div class="emptyhint">' + (error ? esc(error) : t('НЕТ ДАННЫХ')) +
      t('<br><br></div><div class="btnrow"><button class="primary" id="siteReloadBtn">ОБНОВИТЬ</button></div>');
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
    box.innerHTML = t('<div class="emptyhint">ПОКА НЕТ НИ ОДНОГО КЛЮЧА<br>Добавьте vless:// или ссылку на подписку</div>');
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
      const meta = [p.type, p.server + ':' + p.port, from ? t('из ') + from : null].filter(Boolean).join(' · ');
      const color = p.color || DEFAULT_COLOR;
      return `<div class="keyitem">
        <div class="keycard${active ? ' active' : ''}${from ? ' subcard' : ''}" data-id="${p.id}">
          <button class="kcolor" data-colorbtn="${p.id}" title="${t('Цвет ключа')}"><i style="background:${color}"></i></button>
          <span class="kinfo"><span class="kname">${esc(p.name)}</span><span class="kmeta">${esc(meta)}</span></span>
          <button class="kdel" data-del="${p.id}" title="${t('Удалить')}">
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
    toast(t('Блокировка снята'), 'ok');
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
  if (!text) return toast(t('Вставьте ключ или ссылку'), 'err');
  $('btnAdd').disabled = true;
  $('btnAdd').textContent = t('ЗАГРУЗКА…');
  const res = await api.addKey(text);
  $('btnAdd').disabled = false;
  $('btnAdd').textContent = t('ДОБАВИТЬ');
  if (!res.ok) return toast(res.error, 'err');
  $('addInput').value = '';
  toast(
    res.kind === 'sub'
      ? t('Подписка добавлена: ') + res.added + t(' серверов')
      : t('Добавлено ключей: ') + res.added,
    'ok'
  );
  render(await api.getState());
  closePanel();
  if (!panelStack.includes('panelKeys')) openPanel('panelKeys');
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
    if (!state || !state.profile) return toast(t('Нет активного ключа'), 'err');
    await api.copyKey(state.profile.id);
    toast(t('Ссылка на ключ скопирована'), 'ok');
  });

  $('btnCopy').addEventListener('click', () => {
    if (!state || !state.profile) return;
    api.copy(keyIdOf(state.profile));
    toast(t('ID ключа скопирован'), 'ok');
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
      toast(t('Ключ выбран'), 'ok');
    }
  });

  $('btnRefreshAccount').addEventListener('click', refreshAccount);

  $('accountBox').addEventListener('click', async (e) => {
    if (e.target.closest('#siteLoginBtn')) {
      const email = ($('siteEmail') || {}).value;
      const pass = ($('sitePass') || {}).value;
      const code = ($('siteCode') || {}).value;
      if (!email || !pass) return renderAccount(t('Заполните почту и пароль'));
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
      toast(t('Вход выполнен'), 'ok');
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
      toast(t('Запрашиваю ключ…'));
      const res = await api.siteImport();
      if (!res.ok) return toast(res.error, 'err');
      toast(t('Ключ обновлён: ') + res.name, 'ok');
      render(await api.getState());
      await refreshAccount();
      return;
    }

    const srv = e.target.closest('[data-choice]');
    if (srv) {
      toast(t('Меняю сервер…'));
      const res = await api.siteSwitch(srv.dataset.choice);
      if (!res.ok) return toast(res.error, 'err');
      toast(t('Сервер сменён: ') + res.name, 'ok');
      render(await api.getState());
      await refreshAccount();
    }
  });

  $('blocksList').addEventListener('change', async (e) => {
    const el = e.target.closest('[data-mod]');
    if (!el) return;
    const wasRunning = state && state.state === 'running';
    render(await api.setSetting(el.dataset.mod, el.checked));
    if (wasRunning) toast(t('Применится после переподключения'));
  });

  $('applyBtn').addEventListener('click', async () => {
    toast(t('Переподключаю…'));
    const res = await api.reapply();
    if (res && res.ok === false && res.error) toast(res.error, 'err');
    else toast(t('Изменения применены'), 'ok');
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
    toast(t('Обновляю подписки…'));
    const res = await api.updateSubs(null);
    if (!res.ok) return toast(res.error, 'err');
    toast(t('Обновлено серверов: ') + res.added, 'ok');
    render(await api.getState());
  });

  $('btnRepair').addEventListener('click', async () => {
    toast(t('Восстанавливаю сеть…'));
    const report = await api.repairNetwork(false);
    toast(report[report.length - 1] || t('Готово'), 'ok');
    render(await api.getState());
  });

  $('btnOpenLogs').addEventListener('click', () => api.openLogs());

  $('btnSelfTest').addEventListener('click', async () => {
    toast(t('Проверяю соединение…'));
    const res = await api.selfTest();
    if (!res.ok) return toast(res.error || t('Проверка не удалась'), 'err');
    const t = res.test;
    const foreign = (res.foreign || []).map((x) => x.name).join(', ');
    if (t.ok) {
      toast(t('Трафик проходит · ') + (t.delay != null ? t.delay + t(' мс') : t('без пинга')) +
        (foreign ? t(' · рядом: ') + foreign : ''), 'ok');
    } else {
      toast(t('Трафик НЕ проходит') + (foreign ? t(' · мешает ') + foreign : '') + t(' — смотрите журнал'), 'err');
    }
    loadLogs();
  });

  $('btnCopyLogs').addEventListener('click', async () => {
    const lines = await api.logs();
    api.copy(lines.join('\n'));
    toast(t('Журнал скопирован'), 'ok');
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

  document.querySelectorAll('input[name="splitMode"]').forEach((r) => {
    r.addEventListener('change', async () => {
      if (!r.checked) return;
      await api.setSetting('splitMode', r.value);
      render(await api.getState());
    });
  });
  $('btnSplitAdd').addEventListener('click', async () => {
    const r = await api.splitPick();
    render(await api.getState());
    if (r.added) toast(t('Добавлено: ') + r.added, 'ok');
  });
  $('btnSplitName').addEventListener('click', splitAddTyped);
  $('splitName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') splitAddTyped();
  });
  $('splitList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.appdel');
    if (!btn) return;
    render(await api.splitRemove(btn.dataset.app));
  });

  $('btnUpdGo').addEventListener('click', updateAction);
  $('updateBarBtn').addEventListener('click', () => {
    if ($('updateBarBtn').dataset.act === 'cancel') api.updateCancel();
    else runUpdate();
  });
  $('btnUpdCancel').addEventListener('click', () => api.updateCancel());
  $('thanksOk').addEventListener('click', () => $('modalThanks').classList.remove('show'));

  api.on('update', (u) => renderUpdate(u));
  api.on('state', (s) => render(s));
  api.on('stats', (s) => {
    $('mDown').textContent = fmtSpeed(s.down);
    $('mUp').textContent = fmtSpeed(s.up);
    if (state && state.state === 'running') {
      $('subText').textContent =
        '// ' + (state.profile ? state.profile.name : '') + ' · ' + fmtUptime(s.uptime) + ' · ' + fmtBytes(s.downTotal + s.upTotal);
    }
  });
  // Одна неудачная проба — не повод стирать значение: раньше именно из-за
  // этого поле подолгу стояло прочерком, и живой туннель выглядел мёртвым.
  // Последнее значение остаётся, но приглушается, пока проба не пройдёт.
  api.on('ping', ({ delay }) => {
    const el = $('mPing');
    if (delay) {
      lastPing = delay;
      el.textContent = delay + t(' мс');
      el.classList.remove('stale');
    } else if (lastPing) {
      el.classList.add('stale');
    } else {
      el.textContent = '—';
    }
  });
  api.on('toast', ({ text, kind }) => toast(text, kind));
  api.on('selftest', (t) => {
    if (t && !t.ok) toast(t('Туннель поднят, но трафик не проходит'), 'err');
  });
  api.on('log', () => {
    if (panelStack.includes('panelLogs')) loadLogs();
  });
}

/* ------------------------------------------------------------------ */

(async function init() {
  collectI18n();
  wire();
  render(await api.getState());
  firstPaint = false;
})();
