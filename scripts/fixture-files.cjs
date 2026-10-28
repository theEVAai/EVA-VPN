'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function removeFixtureDirectory(dir, prefix, child = '') {
  if (!fs.existsSync(dir)) return;
  const root = fs.realpathSync(dir);
  const relative = path.relative(fs.realpathSync(os.tmpdir()), root);
  if (!relative.startsWith(prefix) || relative.includes(path.sep) || path.isAbsolute(relative) || relative.startsWith('..')) {
    throw new Error('Refusing to remove a directory outside the named temporary fixture');
  }
  const target = path.resolve(root, child);
  const inside = path.relative(root, target);
  if (path.isAbsolute(inside) || inside.startsWith('..')) throw new Error('Fixture cleanup escaped its directory');
  fs.rmSync(target, { recursive: true, force: true });
}

module.exports = { removeFixtureDirectory };
