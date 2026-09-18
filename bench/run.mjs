/**
 * 책등 인식 정확도 벤치.
 *
 * 합성 책장 사진을 만들어 앱과 똑같은 코드(src/lib/ocr.ts)로 읽고,
 * 정답 제목과 비교해 몇 권을 맞혔는지 센다.
 *
 *   npm run dev            # 다른 터미널에서
 *   node bench/run.mjs [--case ko-rotated] [--langs kor+eng]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { CASES } from "./cases.mjs";
import { shelfHtml } from "./shelves/shelf.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const APP_URL = process.env.BENCH_URL || "http://localhost:5173/bench/";
const CACHE = path.resolve("bench/.cache");
const FONT_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@5.0.0/files/noto-sans-kr-korean-700-normal.woff2";

const args = process.argv.slice(2);
const only = valueOf("--case");
const langsOverride = valueOf("--langs");
const verticalMode = valueOf("--vertical");
const spineWidth = valueOf("--spine-width");
const segmentOverride = valueOf("--segment");
const keepImages = args.includes("--keep-images");

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

/** 한글 폰트를 받아 둔다. 시스템 폰트만으로는 한글 책등을 제대로 그릴 수 없다. */
async function koreanFontFace() {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, "noto-sans-kr.woff2");
  if (!fs.existsSync(file)) {
    const response = await fetch(FONT_URL).catch(() => null);
    if (!response?.ok) {
      console.warn("경고: 한글 폰트를 받지 못했습니다. 시스템 폰트로 그립니다 (측정값 왜곡).");
      return { face: "", family: "sans-serif" };
    }
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const base64 = fs.readFileSync(file).toString("base64");
  return {
    face: `@font-face { font-family: "BenchKR"; font-weight: 700; src: url(data:font/woff2;base64,${base64}) format("woff2"); }`,
    family: '"BenchKR", sans-serif',
  };
}

const norm = (value) => value.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
const normalize = norm;

function levenshtein(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

function similarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** 후보 안에 정답이 통째로 들어 있으면 맞춘 것으로 본다 (밴드가 합쳐진 경우). */
function contains(candidate, truth) {
  const c = normalize(candidate);
  const t = normalize(truth);
  return Boolean(c && t && c.includes(t));
}

/**
 * 두 가지를 따로 센다.
 *  - primary: 화면에 처음 뜨는 제목. 사용자가 아무것도 안 해도 맞은 것.
 *  - any: "다르게 읽기"에 들어 있는 후보까지 포함. 한 번 눌러서 도달할 수 있는 것.
 */
function grade(truth, readings) {
  const best = (texts, title) => {
    let score = 0;
    let text = "";
    for (const candidate of texts) {
      const value = contains(candidate, title) ? 1 : similarity(candidate, title);
      if (value > score) {
        score = value;
        text = candidate;
      }
    }
    return { score, text };
  };

  const primaryTexts = readings.map((r) => r.text).filter(Boolean);
  const allTexts = readings.flatMap((r) => [r.text, ...(r.alternatives ?? [])].filter(Boolean));

  return truth.map((title) => {
    const primary = best(primaryTexts, title);
    const any = best(allTexts, title);
    // 글자 오류율: 정답 제목을 그대로 맞추려면 몇 글자를 고쳐야 하는가 (0이면 완벽)
    const cer = primary.text
      ? levenshtein(norm(primary.text), norm(title)) / Math.max(1, norm(title).length)
      : 1;
    return {
      title,
      score: primary.score,
      text: primary.text,
      anyScore: any.score,
      anyText: any.text,
      exact: Boolean(primary.text) && norm(primary.text) === norm(title),
      cer,
    };
  });
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  // 가로채는 프록시 뒤에서는 크로미움의 TLS 1.3 핸드셰이크가 끊긴다.
  args: ["--ssl-version-max=tls1.2"],
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined,
});

const font = await koreanFontFace();
const renderer = await browser.newPage({ viewport: { width: 1280, height: 520 }, deviceScaleFactor: 2.5 });
const app = await browser.newPage();
app.on("pageerror", (error) => console.log("  [페이지오류]", String(error).slice(0, 200)));
await app.goto(APP_URL, { waitUntil: "networkidle" });
await app.waitForFunction(() => window.__ready === true, { timeout: 30000 });

const summary = [];
for (const testCase of CASES) {
  if (only && testCase.id !== only) continue;

  const html = shelfHtml({
    titles: testCase.titles,
    layout: testCase.layout,
    fontFace: testCase.korean ? font.face : "",
    fontFamily: testCase.korean ? font.family : '"Liberation Sans", sans-serif',
  });
  const file = path.join(CACHE, `${testCase.id}.html`);
  fs.writeFileSync(file, html);
  await renderer.goto(`file://${file}`);
  const shot = path.join(CACHE, `${testCase.id}.png`);
  await renderer.screenshot({ path: shot, clip: { x: 4, y: 60, width: 620, height: 458 } });

  const dataUrl = `data:image/png;base64,${fs.readFileSync(shot).toString("base64")}`;
  const langs = langsOverride ?? (testCase.korean ? "kor+eng" : "eng");
  const result = await app.evaluate(
    ([url, options]) => window.__bench(url, options),
    [dataUrl, { langs, ...(verticalMode ? { verticalMode } : {}), segment: {
        ...(spineWidth ? { targetSpineWidth: Number(spineWidth) } : {}),
        ...(segmentOverride ? JSON.parse(segmentOverride) : {}),
      } }],
  );

  const graded = grade(testCase.titles, result.readings);
  const hits = graded.filter((g) => g.score >= 0.7).length;
  const reachable = graded.filter((g) => g.anyScore >= 0.7).length;
  const exact = graded.filter((g) => g.exact).length;
  // 찾긴 찾은 제목들만 놓고 글자가 얼마나 틀렸는지 본다
  const found = graded.filter((g) => g.score >= 0.7);
  const meanCer = found.length
    ? found.reduce((sum, g) => sum + g.cer, 0) / found.length
    : 1;

  console.log(`\n■ ${testCase.label} (${testCase.id}, ${langs}${verticalMode ? `, 세로=${verticalMode}` : ""})`);
  console.log(
    `  바로 맞은 것 ${hits}/${testCase.titles.length}, "다르게 읽기"까지 포함 ${reachable}/${testCase.titles.length} · ` +
      `${(result.elapsedMs / 1000).toFixed(0)}초 · 기울기 ${result.tiltDeg.toFixed(1)}° · 인식 ${result.readings.length}건` +
      (result.usedFallback ? " · 폴백" : ""),
  );
  console.log(
    `  제목 글자: 정확히 일치 ${exact}/${testCase.titles.length} · 찾은 것들의 평균 글자 오류율 ${(meanCer * 100).toFixed(0)}%`,
  );
  for (const g of graded) {
    const mark = g.exact ? "=" : g.score >= 0.7 ? "O" : g.anyScore >= 0.7 ? "^" : "X";
    const shown = g.score >= 0.7 ? g.text : g.anyScore >= 0.7 ? `${g.anyText} (후보)` : g.text || "(못 읽음)";
    const detail = g.score >= 0.7 && !g.exact ? ` (${(g.cer * 100).toFixed(0)}%)` : "";
    console.log(`   ${mark} ${g.title.padEnd(18)} ← ${shown}${detail}`);
  }
  summary.push({
    id: testCase.id,
    hits,
    reachable,
    exact,
    meanCer,
    total: testCase.titles.length,
    seconds: result.elapsedMs / 1000,
  });

  if (!keepImages) fs.rmSync(file, { force: true });
}

console.log("\n=== 요약 ===");
for (const row of summary) {
  console.log(
    `  ${row.id.padEnd(12)} 바로 ${row.hits}/${row.total} · 후보 포함 ${row.reachable}/${row.total} · ` +
      `글자 일치 ${row.exact}/${row.total} · 오류율 ${(row.meanCer * 100).toFixed(0)}% · ${row.seconds.toFixed(0)}초`,
  );
}

await browser.close();
