/**
 * PaddleOCR 한국어 인식 모델을 브라우저에서 돌려 본다 (tesseract 대안 비교용).
 *
 *   npm run fetch:ppocr                          # 모델 한 번 받기
 *   node bench/crops.mjs 사진.jpg /tmp/bands 0 60  # 책등별로 잘라 두고
 *   node bench/ppocr.mjs /tmp/bands/*-up.png --list > 결과.txt
 *   node bench/score.mjs 정답.txt 결과.txt
 *
 * --list 를 주면 bench/score.mjs 가 읽는 형식으로 찍는다.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

/**
 * 시험용 정적 서버. public/ppocr(모델·사전)와 public/ort(런타임), 그리고 이 폴더의
 * ppocr.html 을 한 자리에서 내준다. vite 는 public 안의 JS import 를 막아서 못 쓴다.
 */
function serve(port) {
  const roots = [path.resolve("public/ppocr"), path.resolve("public/ort"), path.resolve("bench")];
  const types = {
    ".html": "text/html; charset=utf-8",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
    ".onnx": "application/octet-stream",
    ".txt": "text/plain; charset=utf-8",
  };
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split("?")[0]);
    const file = name === "/" ? "ppocr.html" : name.replace(/^\//, "");
    for (const root of roots) {
      const full = path.join(root, file);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        res.writeHead(200, { "Content-Type": types[path.extname(full)] ?? "application/octet-stream" });
        res.end(fs.readFileSync(full));
        return;
      }
    }
    res.writeHead(404);
    res.end("no");
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!fs.existsSync(path.resolve("public/ppocr/rec.onnx"))) {
  console.error("모델이 없습니다. npm run fetch:ppocr 를 먼저 실행하세요.");
  process.exit(1);
}
const server = await serve(8099);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--ssl-version-max=tls1.2"],
});
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.error("브라우저:", m.text().slice(0, 200)); });
page.on("pageerror", (e) => console.error("페이지오류:", String(e).slice(0, 300)));
page.on("response", (r) => { if (r.status() >= 400) console.error(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
await page.goto("http://localhost:8099/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ppocrReady === true, { timeout: 30000 });
if (process.argv.includes("--title")) await page.evaluate(() => { window.__titleOnly = true; });

let index = 0;
if (process.argv.includes("--list")) console.log(`${files.length}권 · PaddleOCR 한국어`);
for (const file of files) {
  const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  const started = Date.now();
  const results = await page.evaluate(([u]) => window.__ppocr(u), [dataUrl]);
  if (process.argv.includes("--list")) {
    // bench/score.mjs 가 읽는 형식으로 찍는다.
    const best = results[0];
    const alt = results.slice(1).map((r) => r.text).filter(Boolean);
    index += 1;
    console.log(
      `${String(index).padStart(3)}. x0-0        ${Math.round(Math.min(1, best.confidence) * 100)}%  ` +
        `${best.text || "(못 읽음)"}${alt.length ? `   [대안 ${alt.join(" | ")}]` : ""}`,
    );
  } else {
    console.log(`\n■ ${file.split("/").pop()}  (${Date.now() - started}ms)`);
    for (const r of results) {
      console.log(`   ${r.deg === 0 ? "그대로 " : r.deg > 0 ? "위→아래" : "아래→위"}  ${r.confidence.toFixed(1)}  ${r.text || "(못 읽음)"}`);
    }
  }
}
await browser.close();
server.close();
