import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

test('v4 pages and JavaScript imports resolve to packaged files', () => {
  assert.equal(fs.existsSync(path.join(root, 'game/v4/index.html')), true);
  assert.equal(fs.existsSync(path.join(root, 'game/v20')), false);
  for (const area of ['game', 'launcher']) {
    for (const file of filesUnder(path.join(root, area))) {
      if (!/\.(?:html|js|mjs)$/.test(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      const imports = file.endsWith('.html')
        ? [...content.matchAll(/(?:src|href)=["'](\.{1,2}\/[^"']+)["']/g)].map(match => match[1])
        : [...content.matchAll(/(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g)].map(match => match[1]);
      for (const relative of imports) {
        const target = path.resolve(path.dirname(file), relative.split(/[?#]/)[0]);
        assert.equal(fs.existsSync(target), true, `${path.relative(root, file)} references missing ${relative}`);
      }
    }
  }
});
