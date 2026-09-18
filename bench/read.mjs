/**
 * 사진 한 장을 앱과 똑같은 코드로 읽어 결과를 그대로 찍는다.
 * 정답이 없는 실제 사진을 눈으로 검토할 때 쓴다.
 *
 *   npm run dev            # 다른 터미널에서
 *   node bench/read.mjs ~/photo.jpg [--langs kor+eng] [--vertical always]
 */
import fs from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const file = args[0];
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
if (!file) {
  console.error("사용법: node bench/read.mjs <이미지> [--langs kor+eng] [--vertical auto]");
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--ssl-version-max=tls1.2"],
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined,
});
const page = await browser.newPage();
page.on("console", (message) => {
  if (message.type() === "error") console.error("브라우저:", message.text());
});
await page.goto(process.env.BENCH_URL || "http://localhost:5173/bench/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });

const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
const options = {
  langs: valueOf("--langs") ?? "kor+eng",
  ...(valueOf("--vertical") ? { verticalMode: valueOf("--vertical") } : {}),
  ...(valueOf("--segment") ? { segment: JSON.parse(valueOf("--segment")) } : {}),
};

const result = await page.evaluate(([url, opts]) => window.__bench(url, opts), [dataUrl, options]);

console.log(
  `${result.readings.length}권 · ${(result.elapsedMs / 1000).toFixed(1)}초 · 기울기 ${result.tiltDeg.toFixed(1)}°` +
    (result.usedFallback ? " · 분할 실패(전체 읽기)" : ""),
);
result.readings.forEach((reading, index) => {
  const confidence = Math.round(reading.confidence * 100);
  const alternatives = reading.alternatives.length ? `   [대안 ${reading.alternatives.join(" | ")}]` : "";
  const where = `x${reading.x0}-${reading.x1}`.padEnd(12);
  console.log(`${String(index + 1).padStart(3)}. ${where} ${confidence}%  ${reading.text || "(못 읽음)"}${alternatives}`);
});

await browser.close();
