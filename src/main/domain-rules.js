'use strict';

const { randomBytes, createHash } = require('crypto');
const { domainToASCII } = require('url');
const { isIP } = require('net');

const MAX_RULES = 300;
const MAX_DOMAINS = 1000;
const TARGETS = new Set(['active', 'direct', 'block', 'profile']);

/** Domain suffixes match a hostname and its subdomains, never a URL path. */
function normalizeDomain(input) {
  let value = String(input || '').trim();
  if (!value || value.length > 4096) throw new Error('Укажите домен или HTTP(S)-ссылку.');
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Не удалось прочитать адрес сайта.'); }
    if (url.username || url.password) throw new Error('Ссылка не должна содержать логин или пароль.');
    value = url.hostname;
  } else {
    value = value.replace(/^\*\./, '').replace(/^\./, '');
    // A bare address may include a path or port, just like a pasted URL.
    try {
      const url = new URL('https://' + value);
      if (url.username || url.password) throw new Error('credentials');
      value = url.hostname;
    } catch { throw new Error('Укажите домен, например example.com.'); }
  }
  value = domainToASCII(value.toLowerCase().replace(/\.$/, ''));
  const labels = value.split('.');
  if (!value || value.length > 253 || isIP(value.replace(/^\[|\]$/g, '')) || labels.length < 2 ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('Нужен полный домен, например example.com. IP-адреса и маски внутри домена не поддерживаются.');
  }
  return value;
}

function normalizeDomains(input) {
  const items = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  if (items.length > MAX_DOMAINS) throw new Error('В одном правиле может быть не больше 1000 доменов.');
  const domains = [...new Set(items.filter((item) => String(item).trim()).map(normalizeDomain))];
  if (!domains.length) throw new Error('Добавьте хотя бы один домен.');
  return domains;
}

function normalizeRule(input, id) {
  if (!input || typeof input !== 'object') throw new Error('Не удалось прочитать правило.');
  const type = input.target?.type;
  if (!TARGETS.has(type)) throw new Error('Выберите действие для доменов.');
  const target = { type };
  if (type === 'profile') {
    if (typeof input.target.profileId !== 'string' || !input.target.profileId || input.target.profileId.length > 200) {
      throw new Error('Выберите ключ для этого правила.');
    }
    target.profileId = input.target.profileId;
    if (typeof input.target.profileName === 'string') target.profileName = input.target.profileName.slice(0, 200);
  }
  return {
    id: id || randomBytes(8).toString('hex'),
    name: String(input.name || '').trim().slice(0, 80),
    domains: normalizeDomains(input.domains),
    target,
    enabled: input.enabled !== false
  };
}

function validateRules(input) {
  if (!Array.isArray(input) || input.length > MAX_RULES) throw new Error('Список доменных правил повреждён или содержит больше 300 правил.');
  const domains = new Set();
  const ids = new Set();
  return input.map((rule) => {
    if (typeof rule?.id !== 'string' || !rule.id || ids.has(rule.id)) throw new Error('В списке доменных правил повторяется идентификатор.');
    ids.add(rule.id);
    const normalized = normalizeRule(rule, rule.id);
    for (const domain of normalized.domains) {
      if (domains.has(domain)) throw new Error('Этот домен уже есть в другом правиле: ' + domain);
      domains.add(domain);
    }
    return normalized;
  });
}

function profileTag(id) {
  return 'profile-' + createHash('sha256').update(String(id)).digest('hex').slice(0, 20);
}

/** More specific suffixes win, regardless of the order of groups in the UI. */
function orderedDomains(rules) {
  return validateRules(rules).filter((rule) => rule.enabled)
    .flatMap((rule) => rule.domains.map((domain) => ({ domain, target: rule.target })))
    .sort((a, b) => b.domain.split('.').length - a.domain.split('.').length || b.domain.length - a.domain.length);
}

module.exports = { normalizeDomains, normalizeRule, validateRules, orderedDomains, profileTag };
