'use strict';

// Chromium honours the Windows proxy. Node's global fetch does not use the
// system proxy, which can make GitHub unreachable in EVA's proxy mode.
const { net } = require('electron');

function fail(message, retryable = false) {
  return Object.assign(new Error(message), { retryable });
}

function openResponse(url, { signal, trusted, headers = {}, headerTimeout = 20000, idleTimeout = 30000 }) {
  return new Promise((resolve, reject) => {
    if (!trusted(url)) return reject(fail('Недопустимый адрес обновления'));
    let request;
    let response;
    let timer;
    let closed = false;
    let redirects = 0;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const stop = (error) => {
      if (closed) return;
      closed = true;
      cleanup();
      reject(error);
      if (response) response.destroy(error);
      if (request) request.abort();
    };
    const abort = () => stop(signal.reason || Object.assign(new Error('отменено'), { name: 'AbortError' }));
    const touch = (ms = idleTimeout) => {
      clearTimeout(timer);
      timer = setTimeout(() => stop(fail('GitHub не отвечает. Повторите загрузку.', true)), ms);
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      request = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit', useSessionCookies: false });
      for (const [name, value] of Object.entries({ 'User-Agent': 'EVA VPN', ...headers })) request.setHeader(name, value);
      request.on('redirect', (_status, _method, next) => {
        if (++redirects > 5 || !trusted(next)) return stop(fail('GitHub перенаправил загрузку на недопустимый адрес'));
        request.followRedirect();
      });
      request.on('error', (error) => stop(Object.assign(error, { retryable: true })));
      request.on('abort', () => {
        if (!closed) stop(fail('Загрузка прервана', true));
      });
      request.once('response', (incoming) => {
        response = incoming;
        // A timeout may occur between receiving headers and attaching pipeline.
        incoming.on('error', () => {});
        incoming.once('aborted', () => stop(fail('Соединение с GitHub оборвалось', true)));
        incoming.once('end', cleanup);
        incoming.once('close', cleanup);
        if (incoming.statusCode !== 200) {
          return stop(fail('GitHub ответил ' + incoming.statusCode,
            incoming.statusCode === 408 || incoming.statusCode === 429 || incoming.statusCode >= 500));
        }
        touch();
        resolve({ response: incoming, touch, close: () => {
          closed = true;
          cleanup();
          incoming.destroy();
          request.abort();
        } });
      });
      touch(headerTimeout);
      request.end();
    } catch (error) { stop(error); }
  });
}

async function readJSON(url, options) {
  const stream = await openResponse(url, options);
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of stream.response) {
      stream.touch();
      length += chunk.length;
      if (length > 2 * 1024 * 1024) throw fail('Ответ GitHub слишком большой');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { stream.close(); }
}

module.exports = { openResponse, readJSON, fail };
