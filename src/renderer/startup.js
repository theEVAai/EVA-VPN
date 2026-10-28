'use strict';

// Keep this separate from the main renderer: an error there must stay visible.
window.Startup = (() => {
  let ready = false;
  let failed = false;
  const show = (error) => {
    if (ready || failed) return;
    failed = true;
    const panel = document.getElementById('startupError');
    panel.hidden = false;
    document.getElementById('startupDetails').textContent = String(error?.message || error || 'Ошибка запуска');
  };
  window.addEventListener('error', (event) => show(event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => show(event.reason));
  document.getElementById('startupReload').addEventListener('click', () => location.reload());
  document.getElementById('startupQuit').addEventListener('click', () => window.eva?.quit());
  window.eva?.getState().then((state) => {
    document.getElementById('version').textContent = 'v' + state.version;
    document.getElementById('startupVersion').textContent = 'EVA VPN ' + state.version;
  }).catch(show);
  const timer = setTimeout(() => show('Запуск интерфейса занял слишком много времени.'), 15000);
  return { ready() { ready = true; clearTimeout(timer); } };
})();
