'use strict';
/**
 * Парсер ссылок и подписок.
 * Поддержка: vless://, vmess://, trojan://, ss://, hysteria2:// (hy2://)
 * Подписка: сырой список ссылок или base64 от него.
 */

const crypto = require('crypto');

function b64decode(str) {
  let s = String(str || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  s = s.replace(/\s+/g, '');
  while (s.length % 4 !== 0) s += '=';
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function looksBase64(str) {
  const s = String(str || '').trim().replace(/\s+/g, '');
  if (s.length < 24) return false;
  return /^[A-Za-z0-9+/\-_=]+$/.test(s);
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function num(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

/** Транспорт из query-параметров xray/v2ray -> формат sing-box */
function buildTransport(net, q) {
  const type = String(net || 'tcp').toLowerCase();
  const path = q.get('path') || '';
  const host = q.get('host') || '';
  switch (type) {
    case '':
    case 'tcp':
    case 'raw':
      return null;
    case 'ws': {
      const t = { type: 'ws', path: path || '/' };
      if (host) t.headers = { Host: host };
      const ed = num(q.get('ed'), 0);
      if (ed) {
        t.max_early_data = ed;
        t.early_data_header_name = q.get('eh') || 'Sec-WebSocket-Protocol';
      }
      return t;
    }
    case 'httpupgrade': {
      const t = { type: 'httpupgrade', path: path || '/' };
      if (host) t.host = host;
      return t;
    }
    case 'grpc':
      return { type: 'grpc', service_name: q.get('serviceName') || q.get('servicename') || path || '' };
    case 'http':
    case 'h2': {
      const t = { type: 'http', path: path || '/' };
      if (host) t.host = host.split(',').map((s) => s.trim()).filter(Boolean);
      return t;
    }
    default:
      return null;
  }
}

function buildTls(q, defaultSni, forceTls) {
  const security = String(q.get('security') || (forceTls ? 'tls' : 'none')).toLowerCase();
  if (security === 'none' || security === '') return null;
  const sni = q.get('sni') || q.get('peer') || defaultSni || '';
  const fp = q.get('fp') || 'chrome';
  const alpnRaw = q.get('alpn') || '';
  const tls = {
    enabled: true,
    insecure: q.get('allowInsecure') === '1' || q.get('insecure') === '1',
    utls: { enabled: true, fingerprint: fp }
  };
  if (sni) tls.server_name = sni;
  if (alpnRaw) tls.alpn = alpnRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (security === 'reality') {
    tls.reality = {
      enabled: true,
      public_key: q.get('pbk') || '',
      short_id: q.get('sid') || ''
    };
  }
  return tls;
}

function parseVless(url) {
  const u = new URL(url);
  const q = u.searchParams;
  const p = {
    id: newId(),
    type: 'vless',
    name: decodeURIComponent(u.hash.slice(1)) || u.hostname,
    server: u.hostname.replace(/^\[|\]$/g, ''),
    port: num(u.port, 443),
    uuid: decodeURIComponent(u.username || ''),
    flow: q.get('flow') || '',
    tls: buildTls(q, u.hostname, false),
    transport: buildTransport(q.get('type') || 'tcp', q),
    link: url
  };
  if (!p.uuid || !p.server) throw new Error('vless: не хватает UUID или адреса');
  return p;
}

function parseVmess(url) {
  const body = url.slice('vmess://'.length);
  let j;
  try {
    j = JSON.parse(b64decode(body));
  } catch {
    throw new Error('vmess: не удалось разобрать ссылку');
  }
  const q = new URLSearchParams();
  q.set('type', j.net || 'tcp');
  if (j.path) q.set('path', j.path);
  if (j.host) q.set('host', j.host);
  if (j.sni) q.set('sni', j.sni);
  if (j.alpn) q.set('alpn', j.alpn);
  if (j.fp) q.set('fp', j.fp);
  if (j.tls) q.set('security', j.tls);
  const secured = j.tls === 'tls' || j.tls === 'reality';
  return {
    id: newId(),
    type: 'vmess',
    name: j.ps || j.add,
    server: String(j.add || ''),
    port: num(j.port, 443),
    uuid: String(j.id || ''),
    alter_id: num(j.aid, 0),
    security: j.scy || 'auto',
    tls: secured ? buildTls(q, j.sni || j.host || j.add, true) : null,
    transport: buildTransport(j.net || 'tcp', q),
    link: url
  };
}

function parseTrojan(url) {
  const u = new URL(url);
  const q = u.searchParams;
  return {
    id: newId(),
    type: 'trojan',
    name: decodeURIComponent(u.hash.slice(1)) || u.hostname,
    server: u.hostname.replace(/^\[|\]$/g, ''),
    port: num(u.port, 443),
    password: decodeURIComponent(u.username || ''),
    tls: buildTls(q, u.hostname, true),
    transport: buildTransport(q.get('type') || 'tcp', q),
    link: url
  };
}

function parseShadowsocks(url) {
  let rest = url.slice('ss://'.length);
  let name = '';
  const hashIdx = rest.indexOf('#');
  if (hashIdx >= 0) {
    name = decodeURIComponent(rest.slice(hashIdx + 1));
    rest = rest.slice(0, hashIdx);
  }
  const qIdx = rest.indexOf('?');
  if (qIdx >= 0) rest = rest.slice(0, qIdx);

  let method = '';
  let password = '';
  let server = '';
  let port = 0;
  if (rest.includes('@')) {
    const at = rest.lastIndexOf('@');
    const userPart = rest.slice(0, at);
    const hostPart = rest.slice(at + 1);
    const creds = userPart.includes(':') ? decodeURIComponent(userPart) : b64decode(userPart);
    const ci = creds.indexOf(':');
    method = creds.slice(0, ci);
    password = creds.slice(ci + 1);
    const hi = hostPart.lastIndexOf(':');
    server = hostPart.slice(0, hi).replace(/^\[|\]$/g, '');
    port = num(hostPart.slice(hi + 1), 443);
  } else {
    const dec = b64decode(rest);
    const at = dec.lastIndexOf('@');
    const creds = dec.slice(0, at);
    const hostPart = dec.slice(at + 1);
    const ci = creds.indexOf(':');
    method = creds.slice(0, ci);
    password = creds.slice(ci + 1);
    const hi = hostPart.lastIndexOf(':');
    server = hostPart.slice(0, hi).replace(/^\[|\]$/g, '');
    port = num(hostPart.slice(hi + 1), 443);
  }
  if (!server) throw new Error('ss: не удалось разобрать ссылку');
  return { id: newId(), type: 'shadowsocks', name: name || server, server, port, method, password, link: url };
}

function parseHysteria2(url) {
  const u = new URL(url.replace(/^hy2:\/\//, 'hysteria2://'));
  const q = u.searchParams;
  const p = {
    id: newId(),
    type: 'hysteria2',
    name: decodeURIComponent(u.hash.slice(1)) || u.hostname,
    server: u.hostname.replace(/^\[|\]$/g, ''),
    port: num(u.port, 443),
    password: decodeURIComponent(u.username || '') || q.get('password') || '',
    tls: {
      enabled: true,
      server_name: q.get('sni') || u.hostname,
      insecure: q.get('insecure') === '1',
      alpn: (q.get('alpn') || 'h3').split(',').map((s) => s.trim()).filter(Boolean)
    },
    link: url
  };
  if (q.get('obfs')) p.obfs = { type: q.get('obfs'), password: q.get('obfs-password') || '' };
  return p;
}

/** Одна ссылка -> профиль (или null) */
function parseLink(raw) {
  const line = String(raw || '').trim();
  if (!line) return null;
  try {
    if (line.startsWith('vless://')) return parseVless(line);
    if (line.startsWith('vmess://')) return parseVmess(line);
    if (line.startsWith('trojan://')) return parseTrojan(line);
    if (line.startsWith('ss://')) return parseShadowsocks(line);
    if (line.startsWith('hysteria2://') || line.startsWith('hy2://')) return parseHysteria2(line);
  } catch (e) {
    return { error: e.message, link: line };
  }
  return null;
}

/** Текст (список ссылок или base64) -> массив профилей */
function parseMany(text) {
  let body = String(text || '').trim();
  if (!/^(vless|vmess|trojan|ss|hysteria2|hy2):\/\//m.test(body) && looksBase64(body)) {
    const decoded = b64decode(body);
    if (decoded) body = decoded;
  }
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const p = parseLink(line);
    if (p && !p.error) out.push(p);
  }
  return out;
}

/** Заголовок subscription-userinfo: upload=..; download=..; total=..; expire=.. */
function parseUserInfo(header) {
  if (!header) return null;
  const info = {};
  for (const part of String(header).split(';')) {
    const [k, v] = part.split('=').map((s) => (s || '').trim());
    if (!k) continue;
    const n = Number(v);
    if (Number.isFinite(n)) info[k] = n;
  }
  if (!Object.keys(info).length) return null;
  return {
    used: (info.upload || 0) + (info.download || 0),
    total: info.total || 0,
    expire: info.expire || 0
  };
}

module.exports = { parseLink, parseMany, parseUserInfo, b64decode, newId };
