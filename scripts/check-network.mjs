import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createNetworkFixture, freePort, delay } from './network-fixture.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const netfix = require(path.join(root, 'src/main/netfix.js'));
// This suite exercises the real core process lifecycle and traffic. Windows-wide
// proxy/firewall/route mutations are exercised by the clean installed-app CI suite.
netfix.setSystemProxy = netfix.clearSystemProxy = async () => true;
const { Core } = require(path.join(root, 'src/main/core.js'));
const { parseLink } = require(path.join(root, 'src/main/parse.js'));
const { DEFAULTS } = require(path.join(root, 'src/main/store.js'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eva-core-'));
const coreExe = path.join(root, 'core/sing-box.exe');
const fixture = await createNetworkFixture(coreExe);
const core = new Core({ coreExe, userData: dir, srss: path.join(root, 'core/srss') });
const profiles = fixture.links.map((link) => parseLink(link));
const settings = { ...DEFAULTS.settings, mode: 'proxy', mixedPort: await freePort(), clashPort: await freePort(),
  bypassPrivate: false, vpnPriority: false, profiles, splitMode: 'off', domainRules: [] };
try {
  for (let i = 0; i < 9; i++) {
    const index = i % profiles.length;
    const before = fixture.counts();
    const started = Date.now();
    assert.equal((await core.start(profiles[index], 'proxy', settings)).ok, true, core.logs.slice(-10).join('\n'));
    const response = await fixture.request(settings.mixedPort);
    assert.equal(response.status, 200);
    assert.ok(response.body.length > 65536);
    assert.ok(fixture.counts()[index] > before[index], 'Traffic must reach the selected VLESS endpoint');
    console.log(`PASS connect/switch ${i + 1}: ${profiles[index].name}, real traffic, ${Date.now() - started}ms`);
  }
  // Configuration failure must preserve the working core.
  const activePid = core.proc.pid;
  await assert.rejects(() => core.start({ type: 'unsupported', server: '127.0.0.1', port: 1 }, 'proxy', settings));
  assert.equal(core.proc.pid, activePid);
  assert.equal((await fixture.request(settings.mixedPort)).status, 200);
  console.log('PASS invalid key preserves the working connection');
  // Domain rules use separate endpoints in one running core; direct and block
  // are verified by actual requests and by the receiving endpoint counters.
  const routed = { ...settings, domainRules: [
    { id: 'japan', domains: ['japan.example.test'], target: { type: 'profile', profileId: profiles[0].id }, enabled: true },
    { id: 'poland', domains: ['poland.example.test'], target: { type: 'profile', profileId: profiles[2].id }, enabled: true },
    { id: 'direct', domains: ['direct.example.test'], target: { type: 'direct' }, enabled: true },
    { id: 'block', domains: ['block.example.test'], target: { type: 'block' }, enabled: true }
  ] };
  assert.equal((await core.start(profiles[1], 'proxy', routed)).ok, true);
  for (const [domain, expected] of [['japan', 0], ['poland', 2], ['active', 1], ['direct', -1]]) {
    const before = fixture.counts();
    const response = await fixture.request(settings.mixedPort, domain + '.example.test');
    assert.equal(response.status, 200);
    const after = fixture.counts();
    if (expected < 0) assert.deepEqual(after, before);
    else assert.ok(after[expected] > before[expected], domain + ' must reach the bound endpoint');
    console.log('PASS domain route ' + domain + ': real traffic reaches the right destination');
  }
  const blockedCounts = fixture.counts();
  const blocked = await fixture.request(settings.mixedPort, 'block.example.test').catch(() => null);
  assert.ok(!blocked || blocked.status !== 200);
  assert.deepEqual(fixture.counts(), blockedCounts);
  console.log('PASS Block prevents a real request');
  await delay(5500);
  assert.ok(core.stats.downTotal > 0 && core.stats.upTotal > 0, 'Traffic counters must increase');
  console.log('PASS actual upload/download counters are nonzero');
  await core.stop();
  const attempt = core.start(profiles[0], 'proxy', settings);
  core.cancelStart();
  assert.equal((await attempt).cancelled, true);
  assert.equal(core.proc, null);
  assert.equal((await core.start(profiles[2], 'proxy', settings)).ok, true);
  assert.equal((await fixture.request(settings.mixedPort)).status, 200);
  console.log('PASS cancel pending start, then reconnect successfully');
} finally {
  await core.stop();
  await fixture.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
