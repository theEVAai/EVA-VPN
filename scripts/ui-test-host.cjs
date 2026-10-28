'use strict';

// Local UI acceptance host. Load the actual ASAR entry point/preload/renderer,
// isolating data and replacing only Windows-wide network/autostart changes.
// The clean Windows CI runner launches the installed EXE without this host.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const [source, dataDir, resourceDir] = process.argv.slice(2);
if (!source || !dataDir || !resourceDir) throw new Error('Missing isolated acceptance paths');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'browser'), { recursive: true });
app.setPath('userData', dataDir);
app.setPath('sessionData', path.join(dataDir, 'browser'));
app.setName('EVA VPN acceptance');
const metadata = require(path.join(source, 'package.json'));
app.getVersion = () => metadata.version;
Object.defineProperty(app, 'isPackaged', { value: true });
Object.defineProperty(process, 'resourcesPath', { value: resourceDir });

const netfix = require(path.join(source, 'src/main/netfix.js'));
for (const name of ['setSystemProxy', 'clearSystemProxy', 'flushRouteCaches', 'refreshTunPriority', 'restorePriority', 'disableKillSwitch']) {
  netfix[name] = async () => true;
}
netfix.guardCleanup = async () => [];
netfix.applyPriority = async () => { throw new Error('Host-wide routing is forbidden in local acceptance'); };
netfix.enableKillSwitch = async () => { throw new Error('Host-wide firewall is forbidden in local acceptance'); };
netfix.repairNetwork = async () => { throw new Error('Host-wide repair is forbidden in local acceptance'); };
const autostart = require(path.join(source, 'src/main/autostart.js'));
autostart.isEnabled = async () => false;
autostart.enable = autostart.disable = async () => true;
const { Core } = require(path.join(source, 'src/main/core.js'));
const start = Core.prototype.start;
Core.prototype.start = function (profile, mode, settings) {
  if (mode !== 'proxy') throw new Error('Local acceptance only uses loopback proxy mode');
  return start.call(this, profile, mode, settings);
};
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error('renderer:', message);
  });
});
// Exercise notifications produced by the real main process, including failed self tests.
const commandFile = path.join(dataDir, 'test-command');
fs.watchFile(commandFile, { interval: 100, persistent: false }, () => {
  if (fs.existsSync(commandFile) && fs.readFileSync(commandFile, 'utf8').trim() === 'failed-selftest') {
    fs.unlinkSync(commandFile);
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('selftest', { ok: false });
  }
});
require(path.join(source, 'src/main/main.js'));
