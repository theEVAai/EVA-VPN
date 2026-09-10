'use strict';
/**
 * Всплывающее окно расширения.
 *
 * Всё состояние живёт в фоновой части: здесь только показ и команды.
 * Тексты берутся из _locales через api.i18n — язык расширения выбирает
 * сам браузер по своим настройкам, отдельного переключателя нет.
 */

const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = (id) => document.getElementById(id);

let current = null;

/** Перевод по ключу из _locales. Если ключа нет — оставляем русский текст разметки. */
function t(key, fallback) {
  try {
    const s = api.i18n.getMessage(key);
    return s || fallback || key;
  } catch {
    return fallback || key;
  }
}

function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n, el.textContent);
  }
  document.documentElement.lang = (api.i18n.getUILanguage && api.i18n.getUILanguage()) || 'ru';
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

function send(msg) {
  return new Promise((resolve) => api.runtime.sendMessage(msg, resolve));
}

/* ------------------------------------------------------------------ */
/* Отрисовка                                                           */
/* ------------------------------------------------------------------ */

function render(payload) {
  current = payload;
  const s = payload.state;
  const st = payload.status;

  document.body.classList.toggle('on', s.enabled);
  $('statusText').textContent = s.enabled ? t('on', 'БРАУЗЕР ЗАЩИЩЁН') : t('off', 'БРАУЗЕР НЕ ЗАЩИЩЁН');
  $('subText').textContent = s.enabled
    ? '// socks5 ' + s.host + ':' + s.port
    : '// ' + t('direct', 'напрямую');

  const dot = $('appDot');
  dot.className = 'dot ' + (st.app ? 'ok' : 'bad');
  $('appText').textContent = st.app
    ? t('appOn', 'приложение на связи') + ' · ' + st.connections + ' · ' + fmtBytes(st.down + st.up)
    : t('appOff', 'приложение не запущено');

  // Расширение без приложения бесполезно: прокси некому держать.
  $('hintText').textContent = st.app
    ? t('hint', 'Защищает только браузер')
    : t('hintNoApp', 'Запустите EVA VPN — прокси держит оно');

  renderBypass(s.bypass);
  $('portProxy').value = s.port;
  $('portApi').value = s.apiPort;
}

function renderBypass(list) {
  const box = $('bypassList');
  if (!list.length) {
    box.innerHTML = '<div class="empty">' + t('bypassEmpty', 'список пуст') + '</div>';
    return;
  }
  box.textContent = '';
  for (const name of list) {
    const row = document.createElement('div');
    row.className = 'item';

    const label = document.createElement('span');
    label.textContent = name;

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.title = t('remove', 'Убрать');
    del.addEventListener('click', async () => {
      const next = current.state.bypass.filter((x) => x !== name);
      const r = await send({ type: 'setBypass', value: next });
      current.state = r.state;
      renderBypass(r.state.bypass);
    });

    row.append(label, del);
    box.append(row);
  }
}

/* ------------------------------------------------------------------ */
/* Действия                                                            */
/* ------------------------------------------------------------------ */

async function refresh() {
  render(await send({ type: 'getState' }));
}

async function addBypass() {
  const input = $('bypassInput');
  const value = input.value.trim().toLowerCase();
  if (!value) return;
  const next = current.state.bypass.concat(value);
  const r = await send({ type: 'setBypass', value: next });
  current.state = r.state;
  input.value = '';
  renderBypass(r.state.bypass);
}

async function savePorts() {
  const r = await send({
    type: 'setPorts',
    port: Number($('portProxy').value),
    apiPort: Number($('portApi').value)
  });
  current.state = r.state;
  await refresh();
}

function wire() {
  $('btnPower').addEventListener('click', async () => {
    const r = await send({ type: 'setEnabled', value: !current.state.enabled });
    current.state = r.state;
    await refresh();
  });

  $('tabRules').addEventListener('click', () => {
    const showRules = $('viewRules').hidden;
    $('viewRules').hidden = !showRules;
    $('viewMain').hidden = showRules;
    $('tabRules').classList.toggle('active', showRules);
  });

  $('btnBypassAdd').addEventListener('click', addBypass);
  $('bypassInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBypass();
  });

  for (const id of ['portProxy', 'portApi']) {
    $(id).addEventListener('change', savePorts);
  }
}

applyI18n();
wire();
refresh();
// пока окно открыто, состояние приложения обновляем — оно может подняться
setInterval(refresh, 4000);
