'use strict';

function quoteArgument(value) {
  const text = String(value);
  if (!/[\s"]/.test(text)) return text;
  return '"' + text.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, '$&$&') + '"';
}

function command(exe, args, { nsis = false } = {}) {
  const quote = (text) => "'" + text.replace(/'/g, "''") + "'";
  return "$ErrorActionPreference='Stop'; Start-Process -FilePath " + quote(exe) + ' -Verb RunAs' +
    (nsis ? ' -WindowStyle Hidden' : '') + (args.length ? ' -ArgumentList ' + quote(args.map((arg, index) =>
      nsis && index === args.length - 1 && arg.startsWith('/D=') ? arg : quoteArgument(arg)).join(' ')) : '') + ' -PassThru | Out-Null';
}

async function waitForParent(argv, timeout = 120000) {
  const arg = argv.find((value) => /^--wait-for-parent=\d+$/.test(value));
  if (!arg) return;
  const pid = Number(arg.slice(arg.indexOf('=') + 1));
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Invalid relaunch parent');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Previous application did not exit before relaunch');
}

module.exports = { command, quoteArgument, waitForParent };
