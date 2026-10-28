'use strict';

window.DomainRoutes = (() => {
  const $ = (id) => document.getElementById(id);
  let api, renderRoot, t, esc;
  let current = null;
  let editingId = null;
  let saving = false;
  let changing = false;
  let previewTimer = null;
  let previewSequence = 0;
  let splitView = 'domains';

  function feedback(id, message) {
    $(id).textContent = message;
    $(id).hidden = !message;
  }

  function selectTab(view, focus = false) {
    splitView = view;
    document.querySelectorAll('[data-split-view]').forEach((button) => {
      const active = button.dataset.splitView === view;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      $(button.getAttribute('aria-controls')).hidden = !active;
      if (active && focus) button.focus();
    });
  }

  function routeLabel(rule) {
    switch (rule.target.type) {
      case 'direct': return t('Напрямую · Direct');
      case 'block': return t('Заблокировать · Block');
      case 'active': return t('Активный ключ') + (current?.profile ? ' · ' + current.profile.name : '');
      case 'profile': {
        const profile = current.profiles.find((p) => p.id === rule.target.profileId);
        return profile ? profile.name : t('Ключ удалён') + (rule.target.profileName ? ' · ' + rule.target.profileName : '');
      }
      default: return t('Неизвестный маршрут');
    }
  }

  function targetHint() {
    const value = $('domainTarget').value;
    const text = value === 'direct' ? 'Сайт увидит ваш обычный IP. DNS-запросы идут напрямую.'
      : value === 'block' ? 'Соединения и DNS-запросы к этим доменам блокируются.'
        : value === 'active' ? 'Используется ключ с главного экрана. При смене активного ключа маршрут изменится после переподключения.'
          : 'Трафик и DNS идут через этот ключ. Смена активного ключа не меняет привязку.';
    $('domainTargetHint').textContent = t(text);
  }

  function renderTargets() {
    const select = $('domainTarget');
    const selected = select.value || 'active';
    const options = [
      new Option(t('Через активный ключ'), 'active'),
      new Option(t('Напрямую · Direct'), 'direct'),
      new Option(t('Заблокировать · Block'), 'block')
    ];
    const group = document.createElement('optgroup');
    group.label = t('Через выбранный ключ');
    for (const profile of current.profiles) {
      const repeated = current.profiles.filter((p) => p.name === profile.name).length > 1;
      const label = profile.name + ' · ' + profile.type.toUpperCase() + (repeated ? ' · ' + profile.id.slice(-4) : '');
      group.append(new Option(label, 'profile:' + profile.id));
    }
    select.replaceChildren(...options);
    if (group.children.length) select.append(group);
    if (selected.startsWith('profile:') && !current.profiles.some((p) => 'profile:' + p.id === selected)) {
      const missing = new Option(t('Ключ удалён — выберите другой'), selected);
      missing.disabled = true;
      select.append(missing);
    }
    select.value = selected;
    targetHint();
  }

  function renderList() {
    if (!current) return;
    const rules = current.settings.domainRules || [];
    const search = $('domainSearch').value.trim().toLowerCase();
    const filter = $('domainFilter').value;
    $('domainCount').textContent = String(rules.length);
    const shown = rules.filter((rule) => {
      const missing = rule.target.type === 'profile' && !current.profiles.some((p) => p.id === rule.target.profileId);
      if (filter === 'missing' ? !missing : filter !== 'all' && filter !== rule.target.type) return false;
      return !search || [rule.name, ...rule.domains, routeLabel(rule)].join(' ').toLowerCase().includes(search);
    });
    const box = $('domainList');
    if (!shown.length) {
      const text = rules.length ? 'По этому запросу правил нет.' : 'Правил пока нет. Добавьте домен и выберите, через какой ключ его открывать.';
      box.innerHTML = '<p class="domain-empty">' + esc(t(text)) + '</p>';
      return;
    }
    box.innerHTML = shown.map((rule) => {
      const missing = rule.target.type === 'profile' && !current.profiles.some((p) => p.id === rule.target.profileId);
      const name = rule.name || rule.domains[0];
      return `<article class="domain-rule${rule.enabled ? '' : ' is-disabled'}" data-rule="${esc(rule.id)}">` +
        `<div class="domain-rule-top"><h4>${esc(name)}</h4>` +
        `<label class="domain-enable"><input type="checkbox" data-domain-toggle="${esc(rule.id)}"${rule.enabled ? ' checked' : ''}${changing ? ' disabled' : ''} />` +
        `<span>${esc(t(rule.enabled ? 'Включено' : 'Выключено'))}</span></label></div>` +
        `<div class="domain-rule-domains">${rule.domains.map((domain) => `<div>${esc(domain)}</div>`).join('')}</div>` +
        `<p class="domain-rule-route">${esc(routeLabel(rule))}</p>` +
        (missing ? `<p class="domain-missing">${esc(t('Выберите другой ключ. Пока правило включено, эти домены заблокированы.'))}</p>` : '') +
        `<div class="domain-rule-actions"><button type="button" data-domain-edit="${esc(rule.id)}">${esc(t('Изменить'))}</button>` +
        `<button type="button" data-domain-remove="${esc(rule.id)}" aria-label="${esc(t('Удалить правило'))}: ${esc(name)}"${changing ? ' disabled' : ''}>` +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg></button></div></article>';
    }).join('');
  }

  function render(state) {
    current = state;
    if (!api) return;
    renderTargets();
    renderList();
    if (!$('domainForm').hidden) {
      $('domainEditorTitle').textContent = t(editingId ? 'Изменить правило' : 'Новое правило');
      $('domainSave').textContent = t(saving ? 'СОХРАНЯЮ…' : editingId ? 'СОХРАНИТЬ' : 'ДОБАВИТЬ ПРАВИЛО');
    }
  }

  function clearEditor(focus = false) {
    clearTimeout(previewTimer);
    previewSequence++;
    editingId = null;
    $('domainForm').reset();
    $('domainForm').hidden = true;
    $('domainNew').hidden = false;
    $('domainPreview').textContent = '';
    feedback('domainFormError', '');
    if (focus) $('domainNew').focus();
  }

  function openEditor(rule = null) {
    if (saving || changing) return;
    clearEditor();
    editingId = rule?.id || null;
    $('domainLabel').value = rule?.name || '';
    $('domainInput').value = rule ? rule.domains.join('\n') : '';
    $('domainTarget').value = rule ? (rule.target.type === 'profile' ? 'profile:' + rule.target.profileId : rule.target.type) : 'active';
    // A missing target has to remain visible until the user picks a new one.
    if (rule?.target.type === 'profile' && !$('domainTarget').value) {
      $('domainTarget').append(new Option(t('Ключ удалён — выберите другой'), 'profile:' + rule.target.profileId));
      $('domainTarget').value = 'profile:' + rule.target.profileId;
    }
    $('domainForm').hidden = false;
    $('domainNew').hidden = true;
    render(current);
    $('domainInput').focus();
    updatePreview();
  }

  async function updatePreview() {
    const text = $('domainInput').value.trim();
    const sequence = ++previewSequence;
    if (!text) { $('domainPreview').textContent = ''; return; }
    try {
      const result = await api.domainPreview(text);
      if (sequence !== previewSequence || $('domainForm').hidden) return;
      $('domainPreview').textContent = result.ok
        ? t('Будут сохранены: ') + result.domains.slice(0, 3).join(', ') + (result.domains.length > 3 ? ' …' : '')
        : t(result.error);
    } catch { /* Form submission also validates the input. */ }
  }

  function savedMessage(state) {
    return t('Правило сохранено.') + ' ' + t(state.pendingRestart
      ? 'Нажмите «Применить», чтобы переподключить VPN с новыми правилами.'
      : 'Применится при следующем подключении.');
  }

  async function save(event) {
    event.preventDefault();
    if (saving || !current) return;
    saving = true;
    feedback('domainFormError', '');
    const value = $('domainTarget').value;
    const input = {
      id: editingId || undefined,
      name: $('domainLabel').value,
      domains: $('domainInput').value,
      target: value.startsWith('profile:') ? { type: 'profile', profileId: value.slice(8) } : { type: value },
      enabled: editingId ? current.settings.domainRules.find((rule) => rule.id === editingId)?.enabled !== false : true
    };
    [...$('domainForm').elements].forEach((el) => { el.disabled = true; });
    $('domainSave').textContent = t('СОХРАНЯЮ…');
    try {
      const result = await api.domainSave(input);
      if (!result.ok) { feedback('domainFormError', t(result.error)); return; }
      clearEditor(true);
      $('domainSearch').value = '';
      $('domainFilter').value = 'all';
      renderRoot(result.state);
      feedback('domainFeedback', savedMessage(result.state));
    } catch { feedback('domainFormError', t('Не удалось сохранить правило. Повторите попытку.')); }
    finally {
      saving = false;
      [...$('domainForm').elements].forEach((el) => { el.disabled = false; });
      $('domainSave').textContent = t(editingId ? 'СОХРАНИТЬ' : 'ДОБАВИТЬ ПРАВИЛО');
    }
  }

  async function changeRule(work, removed = false) {
    if (changing || saving) return;
    changing = true;
    renderList();
    try {
      const result = await work();
      if (!result.ok) { feedback('domainFeedback', t(result.error)); return; }
      renderRoot(result.state);
      feedback('domainFeedback', removed ? t('Правило удалено.') + ' ' + t(result.state.pendingRestart
        ? 'Нажмите «Применить», чтобы переподключить VPN с новыми правилами.' : 'Применится при следующем подключении.') : savedMessage(result.state));
    } catch { feedback('domainFeedback', t('Не удалось сохранить правило. Повторите попытку.')); }
    finally { changing = false; renderList(); }
  }

  function init(dependencies) {
    api = dependencies.api;
    renderRoot = dependencies.render;
    t = dependencies.translate;
    esc = dependencies.esc;
    document.querySelectorAll('[data-split-view]').forEach((button) => {
      button.addEventListener('click', () => selectTab(button.dataset.splitView));
      button.addEventListener('keydown', (event) => {
        const views = ['domains', 'apps', 'presets'];
        const index = views.indexOf(splitView);
        let next;
        if (event.key === 'ArrowRight') next = views[(index + 1) % views.length];
        else if (event.key === 'ArrowLeft') next = views[(index + views.length - 1) % views.length];
        else if (event.key === 'Home') next = views[0];
        else if (event.key === 'End') next = views[views.length - 1];
        if (next) { event.preventDefault(); selectTab(next, true); }
      });
    });
    $('domainNew').addEventListener('click', () => openEditor());
    $('domainCancel').addEventListener('click', () => clearEditor(true));
    $('domainForm').addEventListener('submit', save);
    $('domainTarget').addEventListener('change', targetHint);
    $('domainInput').addEventListener('input', () => {
      clearTimeout(previewTimer);
      previewSequence++;
      feedback('domainFormError', '');
      previewTimer = setTimeout(updatePreview, 300);
    });
    $('domainSearch').addEventListener('input', renderList);
    $('domainFilter').addEventListener('change', renderList);
    $('domainList').addEventListener('click', (event) => {
      const edit = event.target.closest('[data-domain-edit]');
      if (edit) openEditor(current.settings.domainRules.find((rule) => rule.id === edit.dataset.domainEdit));
      const remove = event.target.closest('[data-domain-remove]');
      if (remove) {
        if (editingId === remove.dataset.domainRemove) clearEditor();
        changeRule(() => api.domainRemove(remove.dataset.domainRemove), true);
      }
    });
    $('domainList').addEventListener('change', (event) => {
      const toggle = event.target.closest('[data-domain-toggle]');
      if (toggle) changeRule(() => api.domainToggle(toggle.dataset.domainToggle, toggle.checked));
    });
    selectTab('domains');
  }

  return { init, render };
})();
