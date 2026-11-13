// 發佈前執行：在所有 JS／CSS 引用加上版本號（?v=…），避免手機瀏覽器混用新舊檔案。
// 用法：node scripts/stamp.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const files = ['index.html'];
const walk = (d) => readdirSync(join(root, d), { withFileTypes: true }).forEach((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') && files.push(join(d, e.name)));
walk('src');
for (const f of files) {
  const p = join(root, f);
  const s = readFileSync(p, 'utf8');
  const out = s
    .replace(/(from\s+'\.{1,2}\/[^'?]+\.js)(\?v=\w*)?'/g, `$1?v=${v}'`)
    .replace(/((?:src|href)="src\/[^"?]+\.(?:js|css))(\?v=\w*)?"/g, `$1?v=${v}"`);
  if (out !== s) writeFileSync(p, out);
}
console.log('version', v);
