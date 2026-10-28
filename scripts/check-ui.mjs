import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createNetworkFixture } from './network-fixture.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const source = path.resolve(option('--source') || root);
const packagedExe = option('--exe');
const launcherWaitMs = /-portable\.exe$/i.test(packagedExe || '') ? 60000 : 15000;
const expectedFailure = args.includes('--expect-broken');
if (packagedExe && !process.env.CI) throw new Error('Installed EXE acceptance requires a clean CI machine');
const dataDir = option('--data') || fs.mkdtempSync(path.join(os.tmpdir(), 'eva-ui-'));
const evidence = path.resolve(option('--evidence') || path.join(root, 'dist', 'acceptance'));
fs.mkdirSync(evidence, { recursive: true });
const metadata = source.endsWith('.asar')
  ? JSON.parse(require('@electron/asar').extractFile(source, 'package.json'))
  : JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
const { DEFAULTS } = require(path.join(root, 'src/main/store.js'));
const initial = structuredClone(DEFAULTS);
initial.settings.mode = 'proxy';
initial.settings.vpnPriority = false;
initial.settings.bypassPrivate = false;
initial.settings.language = 'ru';
fs.mkdirSync(dataDir, { recursive: true });
if (!packagedExe && !fs.existsSync(path.join(dataDir, 'settings.json'))) {
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(initial));
}
const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref(); });
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject).listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const port = await freePort();
const executable = packagedExe || require('electron');
const launchArgs = packagedExe ? [] : [path.join(root, 'scripts/ui-test-host.cjs'), source, dataDir,
  path.resolve(option('--resources') || (source.endsWith('.asar') ? path.dirname(source) : root))];
launchArgs.push('--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port);
if (packagedExe) launchArgs.push('--enable-logging=file', '--log-file=' + path.join(evidence, 'chromium.log'));
function launch(options = {}) {
  if (!packagedExe) return spawn(executable, launchArgs, { windowsHide: true, ...options });
  // The installed EXE requests administrator rights. ShellExecute honours its
  // manifest; CreateProcess used by Node.spawn cannot perform Windows elevation.
  const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
  const command = "$ErrorActionPreference='Stop'; $evaProcess=Start-Process -FilePath " + quote(executable) +
    ' -ArgumentList ' + quote(launchArgs.join(' ')) +
    ' -WindowStyle Hidden -Wait -PassThru; exit $evaProcess.ExitCode';
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, ...options });
}
const child = launch({ stdio: ['pipe', 'pipe', 'pipe'] });
let output = '';
let launchError;
child.on('error', (error) => { launchError = error; });
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });
let ws;
let fixture;
let seq = 0;
const pending = new Map();
const exceptions = [];
const checks = [];
const expectedExceptions = [];
function record(name) { checks.push(name); console.log('PASS ' + name); }
async function waitFor(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error('Application exited (' + child.exitCode + '): ' + output.slice(-4000));
    try { const result = await check(); if (result) return result; } catch (error) {
      if (String(error).includes('Application exited')) throw error;
    }
    // Keep the polling promise alive even if Windows exits the launched process
    // before the first renderer appears, so its real exit is reported.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out: ' + label + '\n' + output.slice(-4000));
}
function call(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const snapshot = () => evaluate('window.eva.getState()');
async function reload() {
  const next = new Promise((resolve) => {
    const listener = ({ data }) => {
      if (JSON.parse(data).method !== 'Page.loadEventFired') return;
      ws.removeEventListener('message', listener);
      resolve();
    };
    ws.addEventListener('message', listener);
  });
  await call('Page.reload', { ignoreCache: true });
  await Promise.race([next, delay(20000).then(() => { throw new Error('Reload did not finish'); })]);
}
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const fill = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
async function screenshot(name) {
  await delay(400); // Wait for panel transitions before judging the captured UI.
  const { data } = await call('Page.captureScreenshot');
  fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from(data, 'base64'));
}
try {
  const target = await waitFor(async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    return targets.find((item) => item.type === 'page' && item.url.includes('index.html'));
  }, 'renderer target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  await call('Runtime.enable');
  await call('Page.enable');
  await reload();
  if (expectedFailure) {
    await waitFor(async () => (await evaluate('document.readyState')) === 'complete', 'broken renderer load');
    await delay(1000);
    const result = await evaluate('({version: document.getElementById("version").textContent, domains:typeof window.DomainRoutes, menu:document.getElementById("panelMenu").classList.contains("open")})');
    assert.equal(result.version, 'v0.1.0');
    assert.equal(result.domains, 'undefined');
    await click('#btnMenu');
    assert.equal(await evaluate('document.getElementById("panelMenu").classList.contains("open")'), false);
    assert.ok(exceptions.some((e) => JSON.stringify(e).includes('SyntaxError')));
    await screenshot('reproduced-0.7.1');
    record('Published 0.7.1 reproduces stale 0.1.0 label and unresponsive menu');
  } else {
    await waitFor(async () => (await evaluate('document.getElementById("version").textContent')) === 'v' + metadata.version, 'correct version');
    await waitFor(async () => await evaluate('typeof firstPaint !== "undefined" && firstPaint === false'), 'renderer initialized');
    assert.equal(await evaluate('document.getElementById("startupError").hidden'), true);
    record('Renderer, preload and main IPC start; version matches package');
    if (args.includes('--migration')) {
      const migrated = await snapshot();
      assert.equal(migrated.settings.mtu, 1420);
      assert.equal(migrated.profiles.length, 1);
      assert.equal(migrated.profile.id, 'legacy-saved');
      assert.equal(migrated.profile.color, '#e8503a');
      await evaluate('window.eva.removeKey("legacy-saved").then(render)');
      record('Upgrade retains the legacy key, active selection, color and settings');
    }
    if (args.includes('--continue-fixture')) {
      const previous = await snapshot();
      assert.equal(previous.profiles.length, 3);
      assert.ok(previous.profiles.every((profile) => profile.server === '127.0.0.1' && profile.uuid === '11111111-2222-4333-8444-555555555555'));
      for (const rule of previous.settings.domainRules) await evaluate(`window.eva.domainRemove(${JSON.stringify(rule.id)})`);
      for (const profile of previous.profiles) await evaluate(`window.eva.removeKey(${JSON.stringify(profile.id)}).then(render)`);
      record('Portable opens the existing installed profile and saved keys');
    }
    await screenshot('home');
    await click('#btnMenu');
    assert.equal(await evaluate('document.getElementById("panelMenu").classList.contains("open")'), true);
    await click('[data-open="panelAdd"]');
    await fill('#addInput', 'invalid-key');
    await click('#btnAdd');
    await waitFor(async () => !(await evaluate('document.getElementById("btnAdd").disabled')), 'invalid key handled');
    assert.equal((await snapshot()).profiles.length, 0);
    const resourceDir = option('--resources') || (source.endsWith('.asar') ? path.dirname(source) : root);
    fixture = await createNetworkFixture(path.join(resourceDir, 'core', 'sing-box.exe'));
    const keys = fixture.links;
    await fill('#addInput', keys.join('\n'));
    await click('#btnAdd');
    await waitFor(async () => (await snapshot()).profiles.length === 3, 'three keys added');
    const profiles = (await snapshot()).profiles;
    await waitFor(async () => (await evaluate('document.querySelectorAll(".keycard").length')) === 3, 'keys rendered');
    await click(`.keycard[data-id="${profiles[1].id}"]`);
    await waitFor(async () => (await snapshot()).activeId === profiles[1].id, 'key selected');
    await screenshot('keys');
    record('Add multiple keys, reject invalid input, render and select saved key');
    await evaluate('closeAllPanels()');
    await click('#btnMenu');
    await click('[data-open="panelSplit"]');
    for (const [i, target] of ['direct', 'block', 'active', 'profile:' + profiles[0].id].entries()) {
      await click('#domainNew');
      await fill('#domainInput', `https://route${i}.example.test/path`);
      await fill('#domainTarget', target);
      await click('#domainSave');
      await waitFor(async () => (await snapshot()).settings.domainRules.length === i + 1, 'rule saved ' + target);
      await waitFor(async () => await evaluate('document.getElementById("domainForm").hidden'), 'editor closed');
    }
    assert.equal(await evaluate('document.querySelectorAll(".domain-rule").length'), 4);
    await screenshot('domain-rules');
    await click('[data-domain-edit]');
    await fill('#domainInput', 'changed.example.test');
    await click('#domainSave');
    await waitFor(async () => (await snapshot()).settings.domainRules[0].domains[0] === 'changed.example.test', 'rule edited');
    await click('[data-domain-toggle]');
    await waitFor(async () => (await snapshot()).settings.domainRules[0].enabled === false, 'rule disabled');
    await click('[data-domain-remove]');
    await waitFor(async () => (await snapshot()).settings.domainRules.length === 3, 'rule removed');
    await click('#splitTabApps');
    await fill('#splitName', 'Example.exe');
    await click('#btnSplitName');
    await waitFor(async () => (await snapshot()).settings.splitApps.includes('Example.exe'), 'application exclusion');
    await click('#splitTabPresets');
    assert.equal(await evaluate('document.getElementById("splitPresets").hidden'), false);
    record('Domain Direct/Block/active/chosen key, edit/toggle/delete and application exclusions');
    await evaluate('closeAllPanels()');
    await click('#btnMenu');
    await click('[data-open="panelSettings"]');
    await fill('[data-set="language"]', 'en');
    await waitFor(async () => (await evaluate('document.documentElement.lang')) === 'en', 'English UI');
    await fill('[data-set="language"]', 'ru');
    await waitFor(async () => (await evaluate('document.documentElement.lang')) === 'ru', 'Russian UI');
    await evaluate('closeAllPanels()');
    for (const panel of ['panelLogs', 'panelAccount', 'panelAbout']) {
      await click('#btnMenu');
      await click(`[data-open="${panel}"]`);
      assert.equal(await evaluate(`document.getElementById(${JSON.stringify(panel)}).classList.contains('open')`), true);
      await evaluate('closeAllPanels()');
    }
    record('Settings, both languages, logs, account screen and About');
    const saved = await snapshot();
    await reload();
    await waitFor(async () => await evaluate('typeof firstPaint !== "undefined" && firstPaint === false'), 'reload');
    assert.equal((await snapshot()).activeId, saved.activeId);
    assert.deepEqual((await snapshot()).settings.domainRules, saved.settings.domainRules);
    record('Window reload retains keys, selection and routing settings');
    if (!packagedExe) {
      fs.writeFileSync(path.join(dataDir, 'test-command'), 'failed-selftest');
      await waitFor(async () => (await evaluate('document.getElementById("toast").textContent')).includes('трафик не проходит'), 'self-test notification');
      record('Failed connectivity notification does not crash renderer');
    }
    const proxyPort = await freePort();
    const clashPort = await freePort();
    for (const [key, value] of Object.entries({mode:'proxy', mixedPort:proxyPort, clashPort, bypassPrivate:false, vpnPriority:false})) {
      await evaluate(`window.eva.setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    }
    await evaluate('closeAllPanels()');
    await click('#btnPower');
    await waitFor(async () => (await snapshot()).state === 'running', 'real core connects', 45000);
    assert.equal((await fixture.request(proxyPort)).status, 200);
    for (const index of [0, 2, 1]) {
      await click('#btnMenu');
      await click('[data-open="panelKeys"]');
      const before = fixture.counts();
      await click(`.keycard[data-id="${profiles[index].id}"]`);
      await waitFor(async () => { const state = await snapshot(); return state.state === 'running' && state.activeId === profiles[index].id; }, 'real UI key switch');
      assert.equal((await fixture.request(proxyPort)).status, 200);
      assert.ok(fixture.counts()[index] > before[index]);
      await evaluate('closeAllPanels()');
    }
    // Rapid selections exercise the real main-process queue, rather than only Core.start.
    await evaluate(`Promise.all(${JSON.stringify([profiles[0].id, profiles[1].id, profiles[2].id])}.map(id => window.eva.selectKey(id)))`);
    assert.equal((await snapshot()).activeId, profiles[2].id);
    assert.equal((await snapshot()).state, 'running');
    assert.equal((await fixture.request(proxyPort)).status, 200);
    record('Real core connects, UI key switches and rapid selections preserve traffic');
    await click('#btnPower');
    await waitFor(async () => (await snapshot()).state === 'stopped', 'disconnect');
    record('UI disconnect stops the core');
    if (!packagedExe) {
      await evaluate('window.eva.setSetting("mode", "tun")');
      await click('#btnPower');
      await waitFor(async () => await evaluate('document.getElementById("modalAdmin").classList.contains("show")'), 'admin request shown');
      await click('#admRestart');
      await waitFor(async () => !(await evaluate('document.getElementById("admRestart").disabled')), 'UAC cancellation handled');
      assert.equal(await evaluate('document.getElementById("modalAdmin").classList.contains("show")'), true);
      assert.equal((await snapshot()).state, 'stopped');
      await click('#admProxy');
      await waitFor(async () => (await snapshot()).state === 'running', 'proxy fallback after UAC cancellation');
      assert.equal((await fixture.request(proxyPort)).status, 200);
      await evaluate('window.eva.disconnect()');
      record('UAC cancellation preserves the window and allows a working proxy connection');
    }
    if (packagedExe) {
      // Clean CI machine only: exercise the installed app's actual Windows TUN,
      // routes and priority restore without touching a developer's active VPN.
      await evaluate('window.eva.setSetting("mode", "tun")');
      await evaluate('window.eva.setSetting("vpnPriority", true)');
      const connected = await evaluate('window.eva.connect()');
      assert.equal(connected.ok, true, JSON.stringify(connected));
      const before = fixture.counts();
      const traffic = await fixture.requestThroughSystem();
      assert.equal(traffic.status, 200);
      assert.ok(traffic.body.includes('/system-tun-probe'));
      assert.ok(fixture.counts()[2] > before[2], 'System traffic must pass through the TUN and selected key');
      if (fixture.internet) {
        const publicPage = await fixture.requestInternet();
        assert.equal(publicPage.status, 200);
        assert.ok(publicPage.body.includes('Example Domain'));
        record('Real DNS and public HTTPS work through the installed Windows TUN');
      }
      await screenshot('connected-tun');
      await evaluate('window.eva.disconnect()');
      assert.equal((await snapshot()).state, 'stopped');
      assert.deepEqual((await snapshot()).guard, {killSwitch:false, priority:false});
      record('Installed Windows TUN creates, transfers data, disconnects and restores priority');
    }
    // Minimize/close-to-tray followed by second-instance launch must restore this window.
    await click('#btnClose');
    const second = launch({ stdio: 'ignore' });
    await new Promise((resolve, reject) => { second.once('exit', resolve); second.once('error', reject); setTimeout(() => reject(new Error('Second instance did not exit')), launcherWaitMs).unref(); });
    assert.equal((await snapshot()).version, metadata.version);
    record('Close to tray and reopen through a second launch retain one working instance');
    assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
    await call('Network.enable');
    await call('Network.setBlockedURLs', { urls: ['*domain-routes.js'] });
    await reload();
    await waitFor(async () => await evaluate('!document.getElementById("startupError").hidden'), 'startup error shown');
    assert.equal(await evaluate('document.getElementById("version").textContent'), 'v' + metadata.version);
    await screenshot('startup-error');
    expectedExceptions.push(...exceptions.splice(0));
    await call('Network.setBlockedURLs', { urls: [] });
    await click('#startupReload');
    await waitFor(async () => await evaluate('typeof firstPaint !== "undefined" && firstPaint === false && document.getElementById("startupError").hidden'), 'startup recovery');
    record('An injected renderer load failure shows the correct version and recovers with Reload');
    await evaluate('window.eva.quit()');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(launcherWaitMs)]);
    assert.equal(child.exitCode, 0, 'Application must quit cleanly');
    record('Explicit exit shuts the application down cleanly');
  }
} catch (error) {
  let details = '';
  const chromiumLog = path.join(evidence, 'chromium.log');
  if (fs.existsSync(chromiumLog)) details += '\nChromium: ' + fs.readFileSync(chromiumLog, 'utf8').slice(-5000);
  if (ws?.readyState === WebSocket.OPEN && !expectedFailure) {
    try {
      const state = await snapshot();
      const logs = await evaluate('window.eva.logs()');
      details += '\nState: ' + state.state + ', error: ' + state.error + '\n' + logs.slice(-12).join('\n');
      fs.writeFileSync(path.join(evidence, 'failure-state.json'), JSON.stringify(state, null, 2));
      fs.writeFileSync(path.join(evidence, 'failure-core.log'), logs.join('\n'));
      await screenshot('failure');
    } catch { /* Preserve the original test failure. */ }
  }
  if (process.env.CI) console.log('::error title=Windows acceptance::' + (error.message + details).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
  throw error;
} finally {
  if (!expectedFailure && child.exitCode === null && ws?.readyState === WebSocket.OPEN) {
    try { await evaluate('window.eva.disconnect()'); await evaluate('window.eva.quit()'); }
    catch { /* The scoped process cleanup below handles a failed renderer. */ }
  }
  ws?.close();
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Test finished')); }
  if (child.exitCode === null) child.kill();
  if (!packagedExe && !expectedFailure) {
    const resourceDir = path.resolve(option('--resources') || (source.endsWith('.asar') ? path.dirname(source) : root));
    await require(path.join(root, 'src/main/netfix.js')).killOrphanCores(path.join(resourceDir, 'core/sing-box.exe'), path.join(dataDir, 'current-config.json'));
  }
  await fixture?.close();
  fs.writeFileSync(path.join(evidence, 'ui-report.json'), JSON.stringify({ version: metadata.version, isolated: !packagedExe, checks, exceptions, expectedExceptions }, null, 2));
  fs.writeFileSync(path.join(evidence, 'ui-process.log'), output);
}
