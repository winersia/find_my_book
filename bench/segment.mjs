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
const result = await page.evaluate(([url, opts]) => window.__segment(url, { debug: true, ...opts }), [dataUrl, options]);
console.log(`밴드 ${result.bands.length}개 · 기울기 ${result.tiltDeg.toFixed(1)}° · ${result.width}x${result.height}`);
if (result.profile) {
  const { shelf, typicalWidth, scale } = result.profile;
  console.log(`선반 행 ${Math.round(shelf.top * scale)}~${Math.round(shelf.bottom * scale)} · 대표 두께 ${(typicalWidth * scale).toFixed(0)}px`);
}
console.log(result.bands.map((b) => `${b.x0}-${b.x1}(잉크 ${b.ink?.toFixed(3)} ${b.color})`).join("  "));

if (result.profile && (process.env.FROM || process.env.TO)) {
  const { combined, run, color, shadow, scale } = result.profile;
  const from = Number(process.env.FROM ?? 0);
  const to = Number(process.env.TO ?? combined.length);
  const step = Number(process.env.STEP ?? 5);
  console.log("원본x  합계  세로선  색변화  그림자");
  for (let x = from; x < Math.min(to, combined.length); x++) {
    if (x % step !== 0) continue;
    console.log(
      `${String(Math.round(x * scale)).padStart(5)}  ${combined[x].toFixed(2)}  ${run[x].toFixed(2)}   ${color[x].toFixed(2)}   ${shadow[x].toFixed(2)}`,
    );
  }
}

const overlay = await page.evaluate(
  async ([url, bands, analysisWidth]) => {
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
    // 밴드 좌표는 축소된 작업 캔버스 기준이다. 원본 크기에 맞춰 늘려야 선이 제자리에 온다.
    const k = canvas.width / analysisWidth;
    for (const band of bands) {
      for (const x of [band.x0 * k, band.x1 * k]) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
    }
    return canvas.toDataURL("image/png").split(",")[1];
  },
  [dataUrl, result.bands, result.width],
);

const out = path.join(path.dirname(file), `${path.basename(file).replace(/\.[^.]+$/, "")}-bands.png`);
fs.writeFileSync(out, Buffer.from(overlay, "base64"));
console.log(`경계 표시 이미지: ${out}`);
await browser.close();
