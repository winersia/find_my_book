/**
 * 글자 줄을 책으로 어떻게 묶었는지 사진 위에 색으로 칠해 본다. 같은 색 번호가 한 권이다.
 *   node bench/groups.mjs <사진> ['{옵션 json}']
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [file, json = "{}"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto(process.env.BENCH_URL || "http://localhost:5173/bench/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
const result = await page.evaluate(([url, opts]) => window.__groups(url, opts), [dataUrl, JSON.parse(json)]);
const out = path.join(path.dirname(file), `${path.basename(file).replace(/\.[^.]+$/, "")}-groups.png`);
fs.writeFileSync(out, Buffer.from(result.png, "base64"));
console.log(`줄 ${result.lines}개 → 책 ${result.groups}권 · ${out}`);
await browser.close();
