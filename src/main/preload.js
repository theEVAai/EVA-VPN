'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eva', {
  getState: () => ipcRenderer.invoke('app:state'),
  toggle: () => ipcRenderer.invoke('vpn:toggle'),
  connect: () => ipcRenderer.invoke('vpn:connect'),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  reapply: () => ipcRenderer.invoke('vpn:reapply'),
  relaunchAdmin: () => ipcRenderer.invoke('app:relaunchAdmin'),

  addKey: (text) => ipcRenderer.invoke('keys:add', text),
  selectKey: (id) => ipcRenderer.invoke('keys:select', id),
  removeKey: (id) => ipcRenderer.invoke('keys:remove', id),
  copyKey: (id) => ipcRenderer.invoke('keys:copy', id),
  setKeyColor: (id, hex) => ipcRenderer.invoke('keys:color', id, hex),

  updateSubs: (id) => ipcRenderer.invoke('subs:update', id),
  removeSub: (id) => ipcRenderer.invoke('subs:remove', id),

  siteLogin: (email, password, code) => ipcRenderer.invoke('site:login', email, password, code),
  siteLogout: () => ipcRenderer.invoke('site:logout'),
  siteRefresh: () => ipcRenderer.invoke('site:refresh'),
  siteImport: () => ipcRenderer.invoke('site:import'),
  siteSwitch: (choice) => ipcRenderer.invoke('site:switch', choice),

  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  repairNetwork: (deep) => ipcRenderer.invoke('net:repair', deep),
  releaseGuards: () => ipcRenderer.invoke('net:release'),
  ping: () => ipcRenderer.invoke('net:ping'),
  logs: () => ipcRenderer.invoke('core:logs'),
  openLogs: () => ipcRenderer.invoke('logs:open'),
  selfTest: () => ipcRenderer.invoke('net:selftest'),

  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  paste: () => ipcRenderer.invoke('clipboard:read'),

  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),

  on: (channel, cb) => {
    const allowed = ['state', 'stats', 'log', 'toast', 'ping', 'selftest'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
