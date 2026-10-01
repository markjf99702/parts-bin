// Link preview card:  node tools/screenshots.mjs   (README phone shots come from npm test)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const b64 = async (f, t) => `data:${t};base64,` + (await readFile(join(root, f))).toString('base64');
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(`<style>
@font-face{font-family:BC;font-weight:600;src:url(${await b64('fonts/barlow-condensed-600.woff2', 'font/woff2')})}
@font-face{font-family:B;src:url(${await b64('fonts/barlow-400.woff2', 'font/woff2')})}
body{margin:0;width:1200px;height:630px;background:#1B6F70;color:#F2F1EC;display:grid;grid-template-columns:1fr 470px;overflow:hidden;font-family:B}
.l{padding:0 0 0 80px;align-self:center}
h1{font:600 120px/.9 BC;margin:0}
p{font-size:32px;color:#D9ECEB;margin:24px 0 0;max-width:14em;line-height:1.3}
.r{position:relative}
.r img{position:absolute;top:70px;left:30px;width:390px;border-radius:28px;box-shadow:0 30px 60px -20px rgba(0,0,0,.6);border:8px solid #1E201D}
</style><div class="l"><h1>Parts Bin</h1><p>Every part, which bag it’s in, and what you can build with it.</p></div>
<div class="r"><img src="${await b64('docs/phone-bom.png', 'image/png')}"></div>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, 'og.png') });
await browser.close();
console.log('og.png written');
