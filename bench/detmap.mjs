/**
 * 검출 모델이 사진 전체에서 글자를 어디서 찾는지 눈으로 본다.
 *   node bench/detmap.mjs <사진> [긴 변 px, 기본 1600]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [file, maxSide = "1600"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto(process.env.BENCH_URL || "http://localhost:5173/bench/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
const { elapsedMs, png } = await page.evaluate(([url, side]) => window.__detmap(url, side), [dataUrl, Number(maxSide)]);
const out = path.join(path.dirname(file), `${path.basename(file).replace(/\.[^.]+$/, "")}-det${maxSide}.png`);
fs.writeFileSync(out, Buffer.from(png, "base64"));
console.log(`검출 ${elapsedMs}ms → ${out}`);
await browser.close();
