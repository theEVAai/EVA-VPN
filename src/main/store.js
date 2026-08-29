'use strict';
/** Хранилище настроек и профилей: обычный JSON в userData. */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  profiles: [],
  subs: [],
  activeId: null,
  settings: {
    mode: 'tun',                 // tun | proxy
    autoConnect: false,
    autoStart: false,
    blockAds: true,
    blockTrackers: true,
    blockYoutubeAds: false,
    ruDirect: true,
    kodikDirect: true,
    trustedDirect: true,
    selfHostedDirect: true,
    killSwitch: true,
    vpnPriority: true,
    blockIpv6: true,
    allowLan: false,
    bypassPrivate: true,
    tunStack: 'mixed',           // mixed | system | gvisor
    mtu: 9000,
    mixedPort: 2080,
    clashPort: 19090,
    dnsRemote: 'https://1.1.1.1/dns-query',
    dnsDirect: '77.88.8.8',
    logLevel: 'info',
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
      this.data = {
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        subs: Array.isArray(parsed.subs) ? parsed.subs : [],
        activeId: parsed.activeId || null,
        settings: Object.assign({}, DEFAULTS.settings, parsed.settings || {})
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

  /** Заменяет все профили подписки на новые. */
  replaceSubProfiles(subId, list) {
    const activeLink = (this.activeProfile() || {}).link;
    this.data.profiles = this.data.profiles.filter((p) => p.source !== subId);
    for (const p of list) {
      p.source = subId;
      this.data.profiles.push(p);
    }
    const same = this.data.profiles.find((p) => p.link === activeLink);
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
