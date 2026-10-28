'use strict';
// Integration against the public GitHub release and Electron's real HTTP stack.
// Never installs or runs the downloaded release.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eva-updater-'));
app.setPath('userData', dir);
const { Updater } = require('../src/main/updater');
app.whenReady().then(async () => {
  const updater = new Updater({ version: '0.3.1', userData: dir });
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
}).then(() => {
  // Chromium still owns cache files until exit; delete only our download cache.
  fs.rmSync(path.join(dir, 'updates'), { recursive: true, force: true });
  app.exit(0);
}, (error) => { console.error(error); app.exit(1); });
