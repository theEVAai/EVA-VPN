import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';

export const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref(); });
export const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject).listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});

// Real VLESS endpoints and HTTP traffic, all on loopback, without customer keys.
export async function createNetworkFixture(coreExe) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eva-network-'));
  const origin = http.createServer((request, response) => {
    response.setHeader('Connection', 'close');
    response.end('EVA acceptance ' + request.url + '\n' + 'x'.repeat(65536));
  });
  await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
  const originPort = origin.address().port;
  const ports = await Promise.all([freePort(), freePort(), freePort()]);
  const names = ['Japan', 'Netherlands', 'Poland'];
  const uuid = '11111111-2222-4333-8444-555555555555';
  const config = {
    log: { level: 'info' },
    inbounds: ports.map((port, i) => ({ type: 'vless', tag: names[i], listen: '127.0.0.1', listen_port: port, users: [{ uuid }] })),
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { rules: [{ action: 'route', outbound: 'direct', override_address: '127.0.0.1', override_port: originPort }], final: 'direct' }
  };
  const file = path.join(dir, 'server.json');
  fs.writeFileSync(file, JSON.stringify(config));
  execFileSync(coreExe, ['check', '-c', file], { windowsHide: true, stdio: 'pipe' });
  const server = spawn(coreExe, ['run', '-c', file, '--disable-color'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (data) => { output += data; });
  server.stderr.on('data', (data) => { output += data; });
  const end = Date.now() + 10000;
  while (!output.includes('sing-box started')) {
    if (server.exitCode !== null || Date.now() > end) {
      server.kill(); origin.close();
      throw new Error('Fixture server did not start: ' + output);
    }
    await delay(50);
  }
  return {
    links: names.map((name, i) => `vless://${uuid}@127.0.0.1:${ports[i]}?security=none&type=tcp#${name}`),
    originPort,
    counts() { return names.map((name) => output.split(`inbound/vless[${name}]`).length - 1); },
    output: () => output,
    request(proxyPort, domain = 'active.example.test') {
      return new Promise((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET',
          path: `http://127.0.0.1:${originPort}/probe`, headers: { Host: domain, Connection: 'close' } }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => { body += chunk; });
          response.on('end', () => resolve({ status: response.statusCode, body }));
          response.on('error', reject);
        });
        request.setTimeout(8000, () => request.destroy(new Error('Proxy request timed out')));
        request.on('error', reject); request.end();
      });
    },
    requestThroughSystem() {
      return new Promise((resolve, reject) => {
        const request = http.get({ host: '198.18.0.17', port: originPort, path: '/system-tun-probe', headers: { Connection: 'close' } }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => { body += chunk; });
          response.on('end', () => resolve({ status: response.statusCode, body }));
          response.on('error', reject);
        });
        request.setTimeout(10000, () => request.destroy(new Error('System TUN request timed out')));
        request.on('error', reject);
      });
    },
    async close() {
      if (server.exitCode === null) {
        server.kill();
        await new Promise((resolve) => server.once('exit', resolve));
      }
      origin.closeAllConnections();
      await new Promise((resolve) => origin.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}
