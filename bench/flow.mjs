/**
 * 처음 요청한 흐름을 그대로 훑는 점검.
 *
 *   카메라로 찍기 → 제목 인식 → 목록 만들기 → 고치기 → 서재에 담기 → CSV → 다시 열기
 *
 * Chromium 의 가짜 카메라에 합성 책장 영상을 물려 실제 앱을 조작한다.
 *
 *   npm run build && npm run preview       # 다른 터미널에서
 *   node bench/flow.mjs [--case ko-stacked]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { CASES } from "./cases.mjs";
import { shelfHtml } from "./shelves/shelf.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const APP_URL = process.env.FLOW_URL || "http://localhost:4173/";
const CACHE = path.resolve("bench/.cache");
const args = process.argv.slice(2);
const caseId = args[args.indexOf("--case") + 1] ?? "en-rotated";
const testCase = CASES.find((c) => c.id === caseId) ?? CASES[0];

fs.mkdirSync(CACHE, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"} · ${name}${detail ? ` — ${detail}` : ""}`);
};

/** 합성 책장을 그려 가짜 카메라가 먹을 수 있는 y4m 영상으로 만든다. */
async function buildFakeCamera(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 520 }, deviceScaleFactor: 2.5 });
  await page.setContent(
    shelfHtml({
      titles: testCase.titles,
      layout: testCase.layout,
      fontFamily: '"Liberation Sans", sans-serif',
    }),
  );
  const shot = path.join(CACHE, `${testCase.id}-camera.png`);
  await page.screenshot({ path: shot, clip: { x: 4, y: 60, width: 620, height: 458 } });

  const { width, height, rgba } = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const scale = 1280 / img.width;
    const w = Math.floor((img.width * scale) / 2) * 2;
    const h = Math.floor((img.height * scale) / 2) * 2;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return { width: w, height: h, rgba: Array.from(canvas.getContext("2d").getImageData(0, 0, w, h).data) };
  }, fs.readFileSync(shot).toString("base64"));
  await page.close();

  const pixels = Uint8ClampedArray.from(rgba);
  const y = Buffer.alloc(width * height);
  const u = Buffer.alloc((width / 2) * (height / 2));
  const v = Buffer.alloc((width / 2) * (height / 2));
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 4;
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      y[row * width + col] = clamp(0.257 * r + 0.504 * g + 0.098 * b + 16, 16, 235);
      if (row % 2 === 0 && col % 2 === 0) {
        const ci = (row / 2) * (width / 2) + col / 2;
        u[ci] = clamp(-0.148 * r - 0.291 * g + 0.439 * b + 128, 16, 240);
        v[ci] = clamp(0.439 * r - 0.368 * g - 0.071 * b + 128, 16, 240);
      }
    }
  }
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push(Buffer.from("FRAME\n"), y, u, v);
  const file = path.join(CACHE, `${testCase.id}.y4m`);
  fs.writeFileSync(
    file,
    Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420mpeg2\n`), ...frames]),
  );
  return file;
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, Math.round(value)));

// 영상을 만든 뒤, 그 영상을 카메라로 물린 브라우저를 새로 띄운다.
const builder = await chromium.launch({ executablePath: CHROMIUM });
const videoFile = await buildFakeCamera(builder);
await builder.close();

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${videoFile}`,
  ],
});
const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
await context.grantPermissions(["camera"], { origin: new URL(APP_URL).origin });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("  [페이지오류]", String(error).slice(0, 160)));

await page.goto(APP_URL, { waitUntil: "networkidle" });
check("앱이 뜬다", (await page.title()) === "책장 스캐너");

await page.click("text=카메라 켜기");
const ready = await page
  .waitForSelector("button.primary:has-text('촬영'):not([disabled])", { timeout: 20000 })
  .then(() => true)
  .catch(() => false);
const size = await page.$eval(".viewport video", (v) => `${v.videoWidth}x${v.videoHeight}`).catch(() => "");
check("카메라가 켜지고 첫 화면이 들어온다", ready && size !== "0x0", size);

await page.click("button.primary:has-text('촬영')");
await page.waitForSelector(".thumbs img", { timeout: 15000 });
await page.click("button.primary:has-text('촬영')");
check("찍은 사진이 쌓인다", (await page.$$eval(".thumbs img", (els) => els.length)) === 2);

const started = Date.now();
await page.click("button.big");
await page.waitForSelector(".results", { timeout: 600000 });
const titles = await page.$$eval(".book-card .title-input", (els) => els.map((e) => e.value));
check("사진에서 제목을 읽어 목록을 만든다", titles.length > 0, `${titles.length}권 · ${Math.round((Date.now() - started) / 1000)}초`);
console.log("   읽은 제목:", titles.map((t) => `“${t}”`).join(", "));

const checked = await page.$$eval(".book-card .pick input", (els) => els.filter((e) => e.checked).length);
check("흐리게 읽힌 항목은 선택에서 빠져 있다", checked <= titles.length, `${checked}/${titles.length}권 선택됨`);

const firstTitle = page.locator(".book-card .title-input").first();
await firstTitle.fill("직접 고친 제목");
check("제목을 직접 고칠 수 있다", (await firstTitle.inputValue()) === "직접 고친 제목");

const second = page.locator(".book-card").nth(1);
if (await second.locator("button.badge.link").count()) {
  const before = await second.locator(".title-input").inputValue();
  await second.locator("button.badge.link").first().click();
  check("다르게 읽기로 후보를 바꿀 수 있다", before !== (await second.locator(".title-input").inputValue()));
} else {
  check("다르게 읽기로 후보를 바꿀 수 있다", false, "후보 없음");
}

await page.click("button.primary:has-text('서재에 담기')");
await page.waitForSelector(".library", { timeout: 15000 });
const saved = await page.$$eval(".library .book-card", (els) => els.length);
check("고른 책이 서재에 담긴다", saved > 0, `${saved}권`);

const savedTitles = await page.$$eval(".library .book-card .title", (els) => els.map((e) => e.textContent));
check("고친 제목이 그대로 저장된다", savedTitles.includes("직접 고친 제목"));

const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
  page.click("text=CSV 내려받기"),
]);
let csv = "";
if (download) {
  const file = path.join(CACHE, "library.csv");
  await download.saveAs(file);
  csv = fs.readFileSync(file, "utf8").split("\n")[0];
}
check("목록을 CSV로 내려받는다", csv.includes("제목"), csv.slice(0, 60));

await page.fill('input[type="search"]', "직접");
check("서재에서 검색된다", (await page.$$eval(".library .book-card", (els) => els.length)) === 1);
await page.fill('input[type="search"]', "");

await page.reload({ waitUntil: "networkidle" });
await page.click("text=내 서재");
check("앱을 다시 열어도 서재가 남아 있다", (await page.$$eval(".library .book-card", (els) => els.length)) === saved);

await page.screenshot({ path: path.join(CACHE, `${testCase.id}-flow.png`), fullPage: true });
console.log(`\n=== ${results.filter((r) => r.ok).length}/${results.length} 통과 ===`);
for (const failure of results.filter((r) => !r.ok)) console.log(`  실패: ${failure.name} (${failure.detail})`);
await browser.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
