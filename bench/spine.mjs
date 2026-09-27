/**
 * 한 권만 잘라 둔 이미지를 분할 없이 읽는다.
 * 분할이 범인인지 OCR이 범인인지 가를 때 쓴다.
 *   node bench/spine.mjs 책등1.jpg 책등2.jpg ...
 */
import fs from "node:fs";
import { chromium } from "playwright";

const flagged = process.argv.slice(2);
const at0 = flagged.indexOf("--segment");
const files = flagged.filter((a, i) => !a.startsWith("--") && i !== at0 + 1);
const langs = process.argv.includes("--eng") ? "eng" : "kor+eng";
const at = process.argv.indexOf("--segment");
const segment = at >= 0 ? JSON.parse(process.argv[at + 1]) : {};
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--ssl-version-max=tls1.2"],
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined,
});
const page = await browser.newPage();
await page.goto(process.env.BENCH_URL || "http://localhost:5173/bench/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });

for (const file of files) {
  const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  const results = await page.evaluate(([url, l, sg]) => window.__spine(url, l, sg), [dataUrl, langs, segment]);
  console.log(`\n■ ${file.split("/").pop()}`);
  for (const r of results) {
    const label = r.deg === 0 ? "쌓인 글자" : `${r.deg > 0 ? "위→아래" : "아래→위"}`;
    console.log(`   ${label.padEnd(9)} ${String(Math.round(r.score)).padStart(3)}점  ${r.text || "(못 읽음)"}`);
  }
}
await browser.close();
