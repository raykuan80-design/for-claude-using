// 用 Playwright 把 icon.svg 轉成 PNG：node scripts/make-icons.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('..', import.meta.url));
const svg = await readFile(dir + 'icon.svg', 'utf8');
const browser = await chromium.launch();
for (const size of [180, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // iOS 主畫面圖示會自己加圓角，所以 PNG 用方形底色
  await page.setContent(`<body style="margin:0;background:#2a78d6">${svg.replace('rx="112"', 'rx="0"').replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: `${dir}icon-${size}.png` });
  await page.close();
}
await browser.close();
