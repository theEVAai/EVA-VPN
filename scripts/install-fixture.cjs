'use strict';
// Exercise the production updater's NSIS launch, only in a disposable CI install.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const [installer, installDir, dataDir] = process.argv.slice(2);
if (process.env.CI !== 'true') throw new Error('This installation fixture is CI-only');
app.setPath('userData', dataDir);
const { Updater } = require('../src/main/updater');
app.whenReady().then(async () => {
  const updater = new Updater({ version: '0.3.1', userData: dataDir, installDir });
  const version = require('../package.json').version;
  updater.latest = { version, name: path.basename(installer), size: fs.statSync(installer).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex') };
  updater.file = installer;
  updater.state = 'ready';
  const result = await updater.install();
  assert.equal(result.ok, true, result.error);
  console.log('PASS production updater starts the checked installer in a path with spaces');
}).then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
