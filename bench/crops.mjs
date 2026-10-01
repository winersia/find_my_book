/**
 * 잘라낸 책등을 파일로 떨군다. 분할이 맞았는지 눈으로 보는 용도.
 *   node bench/crops.mjs ~/photo.jpg bench/.cache/crops [시작] [개수]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [file, outDir = "bench/.cache/crops", from = "0", count = "12"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto(process.env.BENCH_URL || "http://localhost:5173/bench/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });

const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
const crops = await page.evaluate(([url]) => window.__crops(url), [dataUrl]);

fs.mkdirSync(outDir, { recursive: true });
const slice = crops.slice(Number(from), Number(from) + Number(count));
slice.forEach((crop, index) => {
  const n = Number(from) + index + 1;
  fs.writeFileSync(path.join(outDir, `${String(n).padStart(2, "0")}-rot.png`), Buffer.from(crop.rotated, "base64"));
  fs.writeFileSync(path.join(outDir, `${String(n).padStart(2, "0")}-up.png`), Buffer.from(crop.upright, "base64"));
});
console.log(`${slice.length}권 저장: ${outDir} (전체 ${crops.length}권)`);
await browser.close();
