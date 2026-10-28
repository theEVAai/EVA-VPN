import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let count = 0;
for (const dir of ['src/main', 'src/renderer']) {
  for (const entry of fs.readdirSync(path.join(root, dir))) {
    if (!entry.endsWith('.js')) continue;
    const name = dir + '/' + entry;
    new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name });
    count++;
  }
}
console.log(`Syntax OK: ${count} application scripts`);
