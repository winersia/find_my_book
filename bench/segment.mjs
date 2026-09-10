/**
 * 책등 분할만 눈으로 확인한다. 경계선을 그린 이미지를 bench/.cache 에 남긴다.
 *   node bench/segment.mjs bench/.cache/ko-stacked.png
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const file = process.argv[2];
const options = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined,
});
const page = await browser.newPage();
await page.goto(process.env.BENCH_URL || "http://localhost:5173/bench/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });

const dataUrl = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
const result = await page.evaluate(([url, opts]) => window.__segment(url, opts), [dataUrl, options]);
console.log(`밴드 ${result.bands.length}개 · 기울기 ${result.tiltDeg.toFixed(1)}° · ${result.width}x${result.height}`);
console.log(result.bands.map((b) => `${b.x0}-${b.x1}(잉크 ${b.ink?.toFixed(3)} ${b.color})`).join("  "));

if (result.profile) {
  const { combined, run, color, scale } = result.profile;
  const from = Number(process.env.FROM ?? 0);
  const to = Number(process.env.TO ?? combined.length);
  console.log("원본x  합계  세로선  색변화");
  for (let x = from; x < Math.min(to, combined.length); x++) {
    if (x % (Number(process.env.STEP ?? 5)) !== 0) continue;
    console.log(
      `${String(Math.round(x * scale)).padStart(5)}  ${combined[x].toFixed(2)}  ${run[x].toFixed(2)}   ${color[x].toFixed(2)}`,
    );
  }
}

const overlay = await page.evaluate(
  async ([url, bands]) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#00ff88";
    for (const band of bands) {
      for (const x of [band.x0, band.x1]) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
    }
    return canvas.toDataURL("image/png").split(",")[1];
  },
  [dataUrl, result.bands],
);

const out = path.join(path.dirname(file), `${path.basename(file, ".png")}-bands.png`);
fs.writeFileSync(out, Buffer.from(overlay, "base64"));
console.log(`경계 표시 이미지: ${out}`);
await browser.close();
