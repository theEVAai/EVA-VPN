'use strict';
// Integration against the public GitHub release and Electron's real HTTP stack.
// Never installs or runs the downloaded release.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;
let emulateElevation = false;
childProcess.spawn = (...args) => {
  if (!emulateElevation) return originalSpawn(...args);
  const child = new EventEmitter();
  process.nextTick(() => child.emit('error', Object.assign(new Error('Elevation required (fixture)'), { code: 'EACCES' })));
  return child;
};
const netfix = require('../src/main/netfix');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eva-updater-'));
app.setPath('userData', dir);
const { Updater } = require('../src/main/updater');
app.whenReady().then(async () => {
  const updater = new Updater({ version: '0.3.1', userData: dir, installDir: 'C:\\Program Files\\EVA Update Test' });
  assert.equal((await updater.install()).ok, false);
  const check = updater.check();
  assert.equal(updater.check(), check);
  const release = await check;
  assert.equal(release.state, 'available', release.error);
  assert.ok(release.latest.name.endsWith('-x64.exe'));
  console.log('PASS real GitHub API selects the exact Windows installer and SHA-256');
  const interrupted = updater.download();
  setTimeout(() => updater.cancel(), 100);
  assert.equal((await interrupted).cancelled, true);
  assert.equal(updater.state, 'available');
  assert.equal(fs.readdirSync(updater.dir).some((file) => file.endsWith('.part')), false);
  console.log('PASS download cancellation clears partial files and permits retry');
  const download = await updater.download();
  assert.equal(download.ok, true, download.error);
  assert.equal(updater.state, 'ready');
  assert.equal(updater.progress.percent, 100);
  assert.equal(fs.statSync(updater.file).size, release.latest.size);
  console.log('PASS real installer downloads completely and passes size/SHA-256 checks');
  fs.appendFileSync(updater.file, 'corrupted-fixture');
  const corrupt = await updater.install();
  assert.equal(corrupt.ok, false);
  assert.equal(updater.state, 'error');
  assert.equal(fs.existsSync(updater.markerFile), false);
  console.log('PASS a changed installer is rejected before starting installation');
  fs.truncateSync(updater.file, release.latest.size);
  emulateElevation = true;
  let allowElevation = false;
  netfix.runPs = async (command) => {
    assert.ok(command.includes('-Verb RunAs'));
    assert.ok(command.includes('/D=C:\\Program Files\\EVA Update Test'));
    return { code: allowElevation ? 0 : 1, stdout: '', stderr: '' };
  };
  updater.setState('ready');
  assert.equal((await updater.install()).ok, false);
  assert.equal(fs.existsSync(updater.markerFile), false);
  allowElevation = true;
  updater.setState('ready');
  assert.equal((await updater.install()).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(updater.markerFile, 'utf8')).to, release.latest.version);
  childProcess.spawn = originalSpawn;
  console.log('PASS UAC cancellation preserves the client, and approved elevation starts installation');
}).then(() => {
  // Chromium still owns cache files until exit; delete only our download cache.
  require('./fixture-files.cjs').removeFixtureDirectory(dir, 'eva-updater-', 'updates');
  app.exit(0);
}, (error) => { console.error(error); app.exit(1); });
