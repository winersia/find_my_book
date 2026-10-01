/**
 * 검출로 찾은 글자 줄을 잘라 파일로 떨군다. 줄 찾기가 제목을 온전히 잡았는지 눈으로 본다.
 *   node bench/linecrops.mjs <사진> <출력 폴더> [x0] [x1] ['{lines json}']
 * x0~x1 은 선반 가운데 높이의 x 범위(원본 px). 생략하면 전부.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [file, outDir = "bench/.cache/lines", x0 = "0", x1 = "1e9", json = "{}"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto(process.env.BENCH_URL || "http://localhost:5173/bench/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
const lines = await page.evaluate(([url, opts]) => window.__lineCrops(url, opts), [dataUrl, JSON.parse(json)]);
fs.mkdirSync(outDir, { recursive: true });
for (const line of lines) {
  if (line.shelfX < Number(x0) || line.shelfX > Number(x1)) continue;
  const name = `x${String(line.shelfX).padStart(4, "0")}-y${line.top}-${line.bottom}-t${line.thickness}.png`;
  fs.writeFileSync(path.join(outDir, name), Buffer.from(line.png, "base64"));
  if (line.stacked) fs.writeFileSync(path.join(outDir, name.replace(".png", "-s.png")), Buffer.from(line.stacked, "base64"));
  console.log(name, `기울기 ${line.slope} · 글자 ${line.cells}`);
}
console.log(`전체 ${lines.length}줄`);
await browser.close();
