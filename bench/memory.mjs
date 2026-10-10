/**
 * 고친 제목 기억하기(src/lib/memory.ts)의 기준을 잰다.
 *
 *   node bench/memory.mjs <사진>
 *
 * 사진 한 장을 두 번 읽는다. 두 번째는 다시 찍은 것처럼 살짝 어둡게 하고 밀고 줄인다.
 *  - 같은 책끼리(원본 ↔ 다시 찍은 것) 글자·모양이 얼마나 닮는지
 *  - 서로 다른 책끼리 얼마나 닮는지 (이보다 높게 기준을 잡아야 엉뚱한 책을 채우지 않는다)
 * 마지막으로 원본에서 확인 대상이던 책을 정답 제목으로 기억시킨 뒤 다시 찍은 것을 읽어,
 * 어느 책이 기억으로 채워졌는지 본다.
 */
import fs from "node:fs";
import { chromium } from "playwright";

const [file] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto(process.env.BENCH_URL || "http://localhost:5173/bench/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
const url = `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
const out = await page.evaluate(async (url) => {
  const { readShelf } = await import("/src/lib/ocr.ts");
  const { toWorkingCanvas } = await import("/src/lib/image.ts");
  const { booksFromReadings, needsReview } = await import("/src/lib/bookcase.ts");
  const memory = await import("/src/lib/memory.ts");
  const original = await toWorkingCanvas(await (await fetch(url)).blob());
  // 다시 찍은 것처럼: 2% 밀고, 97% 로 줄이고, 10% 어둡게
  const shift = Math.round(original.width * 0.02);
  const scale = 0.97;
  const again = document.createElement("canvas");
  again.width = original.width;
  again.height = original.height;
  const ctx = again.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, again.width, again.height);
  ctx.filter = "brightness(0.9)";
  ctx.drawImage(original, shift, 0, original.width * scale, original.height * scale);
  const read = async (canvas) => {
    const readings = (await readShelf(canvas, {})).readings;
    return booksFromReadings(readings).map((book, i) => ({ ...book, x: (readings[i].x0 + readings[i].x1) / 2 }));
  };
  const a = await read(original);
  const b = await read(again);
  const reads = (book) => [book.spineText].filter(Boolean);
  const entryOf = (book) => ({ title: book.title, reads: reads(book), looks: [book.look ?? []], updatedAt: "" });
  // 서로 다른 책끼리 (원본 안에서)
  const negatives = [];
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a.length; j++) {
    if (i === j) continue;
    const s = memory.matchScore(a[i], entryOf(a[j]));
    negatives.push(s);
  }
  // 같은 책끼리: 다시 찍은 것의 위치를 원본으로 되돌려 가장 가까운 책과 짝짓는다
  const back = (x) => (x - shift) / scale;
  const pairOf = (book) => a.reduce((p, q) => (Math.abs(q.x - back(book.x)) < Math.abs(p.x - back(book.x)) ? q : p));
  const positives = b
    .map((book) => ({ book, twin: pairOf(book) }))
    .filter(({ book, twin }) => Math.abs(twin.x - back(book.x)) < 12)
    .map(({ book, twin }) => ({ ...memory.matchScore(book, entryOf(twin)), title: twin.title, review: needsReview(twin) }));
  // 기억시킨 뒤 다시 읽기: 원본의 확인 대상을 기억시킨다 (제목은 원본 읽기 그대로, 위치로 확인)
  memory.forgetAll();
  const taught = a.map((book, i) => ({ ...book, title: `책${i + 1}` })).filter((book, i) => needsReview(a[i]));
  memory.remember(taught);
  const recalled = memory.recall(b, needsReview);
  memory.forgetAll();
  const twinIndex = (book) => {
    const twin = pairOf(book);
    return Math.abs(twin.x - back(book.x)) < 12 ? a.indexOf(twin) + 1 : 0;
  };
  return {
    counts: [a.length, b.length],
    recallCheck: recalled
      .map((book, i) => ({ title: book.title, remembered: book.remembered, twin: twinIndex(b[i]) }))
      .filter((x) => x.remembered),
    negatives,
    positives,
    taught: taught.map((book) => book.title),
    recalled: recalled.map((book, i) => ({ i: i + 1, title: book.title, remembered: book.remembered ?? "" })).filter((x) => x.remembered),
  };
}, url);
const pct = (values, p) => [...values].sort((x, y) => x - y)[Math.floor((values.length - 1) * p)];
console.log(`권수 원본 ${out.counts[0]} · 다시 찍은 것 ${out.counts[1]}`);
const nt = out.negatives.map((s) => s.text);
const nl = out.negatives.map((s) => s.look);
const both = out.negatives.map((s) => Math.min(s.text, s.look * 0.75 / 0.8));
console.log(`다른 책끼리 글자 닮음: 99% ${pct(nt, 0.99).toFixed(2)} · 최대 ${Math.max(...nt).toFixed(2)}`);
console.log(`다른 책끼리 모양 닮음: 99% ${pct(nl, 0.99).toFixed(2)} · 최대 ${Math.max(...nl).toFixed(2)}`);
const nb = out.negatives.filter((s) => s.text >= 0.5 && s.look >= 0.5);
console.log(`다른 책끼리 글자·모양 둘 다 0.5 넘는 쌍: ${nb.length}개 ${nb.slice(0, 5).map((s) => `(${s.text.toFixed(2)},${s.look.toFixed(2)})`).join(" ")}`);
if (out.positives.length) {
  const pt = out.positives.map((s) => s.text);
  const pl = out.positives.map((s) => s.look);
  console.log(`같은 책끼리 글자 닮음: 최소 ${Math.min(...pt).toFixed(2)} · 중앙 ${pct(pt, 0.5).toFixed(2)}`);
  console.log(`같은 책끼리 모양 닮음: 최소 ${Math.min(...pl).toFixed(2)} · 중앙 ${pct(pl, 0.5).toFixed(2)}`);
  for (const p of out.positives.filter((p) => p.review)) console.log(`  확인 대상 ${p.title || "(빈칸)"}: 글자 ${p.text.toFixed(2)} 모양 ${p.look.toFixed(2)}`);
}
console.log(`기억시킨 책: ${out.taught.join(", ")}`);
console.log(`다시 읽었을 때 기억으로 채워진 책: ${out.recalled.map((r) => `${r.i}번→${r.title}(${r.remembered})`).join(", ") || "없음"}`);
const wrong = out.recallCheck.filter((r) => r.title !== `책${r.twin}`);
console.log(`그중 원본의 같은 책에 맞게 채워진 것: ${out.recallCheck.length - wrong.length}/${out.recallCheck.length}${wrong.length ? ` · 틀림 ${wrong.map((r) => `${r.title}→실제 책${r.twin}`).join(", ")}` : ""}`);
await browser.close();
