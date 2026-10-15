'use strict';
/** Хранилище настроек и профилей: обычный JSON в userData. */

const fs = require('fs');
const path = require('path');
const { normalizeRule, validateRules } = require('./domain-rules');

const DEFAULTS = {
  profiles: [],
  subs: [],
  activeId: null,
  settings: {
    mode: 'tun',                 // tun | proxy
    autoConnect: false,
    autoStart: false,
    blockTrackers: true,
    ruDirect: true,
    kodikDirect: true,
    torrentDirect: false,
    trustedDirect: true,
    killSwitch: false,
    vpnPriority: true,
    blockIpv6: true,
    allowLan: false,
    bypassPrivate: true,
    splitMode: 'off',          // off | exclude | include
    splitApps: [],
    domainRules: [],
    tunStack: 'gvisor',          // gvisor | mixed | system
    mtu: 9000,
    connectTimeout: 30,
    mixedPort: 2080,
    clashPort: 19090,
    dnsRemote: 'https://1.1.1.1/dns-query',
    dnsDirect: '77.88.8.8',
    logLevel: 'info',
    language: 'auto',             // auto | ru | en
    minimizeToTray: true,
    siteBase: ''            // пусто = https://vpn.theeva.ai
  }
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      const known = {};
      for (const key of Object.keys(DEFAULTS.settings)) {
        if (parsed.settings && key in parsed.settings) known[key] = parsed.settings[key];
      }
      this.data = {
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        subs: Array.isArray(parsed.subs) ? parsed.subs : [],
        activeId: parsed.activeId || null,
        settings: Object.assign({}, DEFAULTS.settings, known)
      };
    } catch {
      /* первый запуск — остаются значения по умолчанию */
    }
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('store.save', e);
    }
  }

  get settings() {
    return this.data.settings;
  }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.save();
    return this.data.settings;
  }

  get profiles() {
    return this.data.profiles;
  }

  activeProfile() {
    return this.data.profiles.find((p) => p.id === this.data.activeId) || this.data.profiles[0] || null;
  }

  setActive(id) {
    if (this.data.profiles.some((p) => p.id === id)) {
      this.data.activeId = id;
      this.save();
    }
    return this.activeProfile();
  }

  /** Добавляет профили, отбрасывая дубликаты по ссылке. Возвращает число добавленных. */
  addProfiles(list, source) {
    let added = 0;
    for (const p of list) {
      if (!p || !p.server) continue;
      if (this.data.profiles.some((x) => x.link === p.link)) continue;
      p.source = source || 'manual';
      this.data.profiles.push(p);
      added++;
    }
    if (added && !this.data.activeId) this.data.activeId = this.data.profiles[0].id;
    if (added) this.save();
    return added;
  }

  /** Цвет ключа: метка страны или сервера, видна в скважине сердца. */
  setProfileColor(id, hex) {
    const p = this.data.profiles.find((x) => x.id === id);
    if (!p) return false;
    p.color = hex;
    this.save();
    return true;
  }

  removeProfile(id) {
    const idx = this.data.profiles.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.data.profiles.splice(idx, 1);
    if (this.data.activeId === id) {
      this.data.activeId = this.data.profiles.length ? this.data.profiles[0].id : null;
    }
    this.save();
    return true;
  }

  saveDomainRule(input) {
    const current = this.settings.domainRules;
    const existing = input?.id ? current.find((rule) => rule.id === input.id) : null;
    if (input?.id && !existing) throw new Error('Правило уже удалено. Создайте его заново.');
    const rule = normalizeRule(input, existing?.id);
    if (rule.target.type === 'profile') {
      const profile = this.profiles.find((p) => p.id === rule.target.profileId);
      if (!profile) throw new Error('Выбранный ключ удалён. Выберите другой ключ.');
      rule.target.profileName = profile.name;
    }
    const next = existing ? current.map((r) => r.id === rule.id ? rule : r) : [...current, rule];
    this.settings.domainRules = validateRules(next);
    this.save();
    return rule;
  }

  toggleDomainRule(id, enabled) {
    const next = this.settings.domainRules.map((rule) => rule.id === id ? { ...rule, enabled: Boolean(enabled) } : rule);
    this.settings.domainRules = validateRules(next);
    this.save();
  }

  removeDomainRule(id) {
    this.settings.domainRules = this.settings.domainRules.filter((rule) => rule.id !== id);
    this.save();
  }

  /** Заменяет все профили подписки на новые. */
  replaceSubProfiles(subId, list) {
    const active = this.activeProfile();
    const remaining = this.profiles.filter((p) => p.source === subId);
    const others = this.profiles.filter((p) => p.source !== subId);
    const incoming = [];
    for (const p of list) {
      let index = remaining.findIndex((old) => old.link && old.link === p.link);
      if (index < 0) index = remaining.findIndex((old) => old.type === p.type && old.name === p.name && old.server === p.server && old.port === p.port);
      // Keep bindings across address/key rotation only when the name/type
      // identifies one server unambiguously in both subscription versions.
      if (index < 0) {
        const oldMatches = remaining.map((old, i) => ({ old, i })).filter(({ old }) => old.type === p.type && old.name === p.name);
        if (oldMatches.length === 1 && list.filter((item) => item.type === p.type && item.name === p.name).length === 1) index = oldMatches[0].i;
      }
      if (index >= 0) {
        const old = remaining.splice(index, 1)[0];
        p.id = old.id;
        if (old.color) p.color = old.color;
      }
      p.source = subId;
      incoming.push(p);
    }
    this.data.profiles = others.concat(incoming);
    const same = this.data.profiles.find((p) => p.id === active?.id);
    if (same) this.data.activeId = same.id;
    else if (!this.data.profiles.some((p) => p.id === this.data.activeId)) {
      this.data.activeId = this.data.profiles.length ? this.data.profiles[0].id : null;
    }
    this.save();
    return list.length;
  }

  addSub(url, name) {
    const existing = this.data.subs.find((s) => s.url === url);
    if (existing) return existing;
    const sub = { id: 'sub_' + Date.now().toString(36), url, name: name || url, lastUpdate: 0, userinfo: null };
    this.data.subs.push(sub);
    this.save();
    return sub;
  }

  removeSub(id) {
    this.data.subs = this.data.subs.filter((s) => s.id !== id);
    this.data.profiles = this.data.profiles.filter((p) => p.source !== id);
    if (!this.data.profiles.some((p) => p.id === this.data.activeId)) {
      this.data.activeId = this.data.profiles.length ? this.data.profiles[0].id : null;
    }
    this.save();
  }
}

module.exports = { Store, DEFAULTS };
