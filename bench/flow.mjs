/**
 * docs/시나리오.md 의 "완료 기준" 12가지를 그대로 확인한다.
 *
 * Chromium 의 가짜 카메라에 합성 책장 영상을 물려, 실제 앱을 눌러 가며 점검한다.
 *
 *   npm run build && npm run preview      # 다른 터미널에서
 *   node bench/flow.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { shelfHtml } from "./shelves/shelf.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const APP_URL = process.env.FLOW_URL || "http://localhost:4173/";
const CACHE = path.resolve("bench/.cache");
/** 칸 하나에 꽂힌 책들. 한 칸만 찍는 시나리오라 짧은 책장을 쓴다. */
const SLOT_TITLES = ["Design Patterns", "Clean Code", "Deep Work", "Sapiens", "Refactoring"];

fs.mkdirSync(CACHE, { recursive: true });

const norm = (value) => value.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
/** 인식한 제목이 실제 책 목록 중 어느 것인지 (못 찾으면 -1) */
function matchIndex(text) {
  const target = norm(text);
  if (!target) return -1;
  return SLOT_TITLES.findIndex((title) => {
    const source = norm(title);
    return target.includes(source) || source.includes(target) && target.length >= 5;
  });
}

/**
 * 수고 재기: 앱을 열고 첫 칸이 채워질 때까지 몇 번 누르고 몇 초가 걸리는지 센다.
 * UX 를 고칠 때 "좋아졌다"는 느낌 대신 이 숫자를 본다.
 */
const effort = { taps: 0, startedAt: 0, firstSlotFilledMs: 0, counting: true };
function countTap() {
  if (effort.counting) effort.taps += 1;
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"} · ${name}${detail ? ` — ${detail}` : ""}`);
};

const clamp = (value, low, high) => Math.max(low, Math.min(high, Math.round(value)));

/** 합성 책장을 그려 가짜 카메라가 먹을 수 있는 y4m 영상으로 만든다. */
async function buildFakeCamera(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 520 }, deviceScaleFactor: 2.5 });
  await page.setContent(
    shelfHtml({ titles: SLOT_TITLES, layout: "rotated", fontFamily: '"Liberation Sans", sans-serif' }),
  );
  const shot = path.join(CACHE, "slot-camera.png");
  await page.screenshot({ path: shot, clip: { x: 4, y: 60, width: 330, height: 458 } });

  const { width, height, rgba } = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const scale = 1100 / img.width;
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
  const file = path.join(CACHE, "slot.y4m");
  fs.writeFileSync(
    file,
    Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420mpeg2\n`), ...frames]),
  );
  return file;
}

const builder = await chromium.launch({ executablePath: CHROMIUM });
const videoFile = await buildFakeCamera(builder);
await builder.close();

/**
 * 샌드박스에서 바깥 망을 쓰려면 프록시를 태워야 한다.
 * 그 프록시는 TLS 를 다시 맺는데 크로미움의 TLS 1.3 핸드셰이크를 못 넘겨서 연결이 끊긴다.
 * 1.2 로 낮추면 지나간다. 일반 사용 환경에는 필요 없는 설정이다.
 */
const sandboxNetwork = process.env.HTTPS_PROXY
  ? {
      proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" },
      args: ["--ssl-version-max=tls1.2"],
    }
  : { args: [] };

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  ...(sandboxNetwork.proxy ? { proxy: sandboxNetwork.proxy } : {}),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${videoFile}`,
    ...sandboxNetwork.args,
  ],
});
// 책장 앞에서 휴대폰으로 쓰는 앱이다. 점검도 휴대폰 폭에서 한다.
const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
await context.grantPermissions(["camera"], { origin: new URL(APP_URL).origin });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("  [페이지오류]", String(error).slice(0, 160)));
page.on("dialog", (dialog) => dialog.accept());

/** 고른 칸을 찍어 인식한 뒤 칸에 넣는다. 인식 결과 제목을 돌려준다. */
async function scanIntoSelectedSlot() {
  await page.click('[data-testid="scan-slot"]');
  await page.waitForSelector('[data-testid="scan-sheet"]');
  // 카메라는 시트가 열리면서 저절로 켜진다. 셔터가 눌릴 수 있을 때까지 기다렸다 찍는다.
  const sheet = page.locator('[data-testid="scan-sheet"]');
  const shutter = sheet.locator("button.shutter");
  await shutter.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(
    () => {
      const button = document.querySelector('[data-testid="scan-sheet"] button.shutter');
      return button && !button.disabled;
    },
    { timeout: 20000 },
  );
  countTap();
  await shutter.click();
  await page.waitForSelector('[data-testid="apply-scan"]', { timeout: 600000 });
  // 결과 제목은 그 자리에서 고칠 수 있는 입력칸이다.
  const recognized = await page.$$eval(".scan-preview .scan-title", (els) =>
    els.map((e) => e.value.trim()),
  );
  console.log(`   인식: ${recognized.join(" / ")}`);
  await page.click('[data-testid="apply-scan"]');
  await page.waitForSelector('[data-testid="scan-sheet"]', { state: "detached" });
  return recognized;
}

/** 부가 기능은 접혀 있다. 필요한 때만 펼친다. */
async function openTools() {
  const details = page.locator("details.more-tools");
  if (!(await details.evaluate((el) => el.open))) await details.locator("summary").click();
}

const slotTitles = () =>
  page.$$eval('[data-testid="slot-panel"] .title-input', (els) => els.map((e) => e.value));
const slotCount = (index) =>
  page.$eval(`[data-slot="${index}"]`, (el) => Number(el.dataset.count));

// page.click / locator.click 을 세기 위해 얇게 감싼다.
const rawClick = page.click.bind(page);
page.click = async (...args) => {
  countTap();
  return rawClick(...args);
};

await page.goto(APP_URL, { waitUntil: "networkidle" });
effort.startedAt = Date.now();

// 1. 첫 화면은 책장 설정, 기본 8×2
const defaults = await page.$$eval(".number-field input", (els) => els.map((e) => e.value));
const previewSlots = await page.$$eval('[data-testid="setup-preview"] .slot', (els) => els.length);
check("첫 화면이 책장 설정이고 기본이 8×2다", defaults.join("×") === "8×2" && previewSlots === 16,
  `${defaults.join("×")} · 미리보기 ${previewSlots}칸`);

// 2. 숫자를 바꾸면 미리보기가 따라 바뀐다
await page.click('button[aria-label="칸 수 줄이기"]');
await page.click('button[aria-label="칸 수 줄이기"]');
const afterChange = await page.$$eval('[data-testid="setup-preview"] .slot', (els) => els.length);
check("칸 수를 바꾸면 미리보기가 따라 바뀐다", afterChange === 12, `${afterChange}칸`);

// 3. 확정하면 책장 화면이 뜨고 책장이 늘 보인다
await page.fill('input[aria-label="책장 이름"]', "거실 책장");
await page.click("text=이 책장 만들기");
await page.waitForSelector('[data-testid="bookcase"]');
const shelfSlots = await page.$$eval('[data-testid="bookcase"] .slot', (els) => els.length);
check("확정하면 책장 화면에 책장이 그려진다", shelfSlots === 12, `${shelfSlots}칸`);

// 4. 칸을 누르면 선택된다
await page.click('[data-slot="0"]');
await page.waitForSelector('[data-testid="slot-panel"]');
const panelTitle = await page.textContent('[data-testid="slot-panel"] h2');
check("칸을 누르면 그 칸이 선택된다", panelTitle.includes("1번째 줄 1번째 칸"), panelTitle.trim());

// 5·6. 촬영 결과가 순서대로 그 칸에 들어간다
const recognized = await scanIntoSelectedSlot();
effort.firstSlotFilledMs = Date.now() - effort.startedAt;
effort.counting = false;
console.log(
  `   [수고] 앱을 연 뒤 첫 칸이 채워질 때까지 ${effort.taps}번 누름 · ${Math.round(effort.firstSlotFilledMs / 1000)}초`,
);
const placed = await slotTitles();
check(
  "실제 권수와 같은 수를 읽는다",
  recognized.length === SLOT_TITLES.length,
  `사진 ${SLOT_TITLES.length}권 → 인식 ${recognized.length}권: ${recognized.join(" / ")}`,
);

const matched = recognized.map(matchIndex).filter((index) => index >= 0);
const inOrder = matched.every((value, index) => index === 0 || value >= matched[index - 1]);
check("꽂힌 순서 그대로 읽는다", inOrder && matched.length >= 3, `자리 ${matched.join(",")}`);

const exactTitles = recognized.filter((text, index) => norm(text) === norm(SLOT_TITLES[index] ?? ""));
check(
  "제목 글자까지 맞는 것이 대부분이다",
  exactTitles.length >= SLOT_TITLES.length - 1,
  `${exactTitles.length}/${SLOT_TITLES.length}권이 글자까지 일치`,
);
check(
  "칸에 넣으면 권수와 순서가 인식 결과와 같다",
  placed.length === recognized.length &&
    placed.every((title, index) => (title || "제목 미상") === recognized[index]),
  `칸 ${placed.length}권: ${placed.join(" / ")}`,
);
check("다른 칸은 비어 있다", (await slotCount(1)) === 0 && (await slotCount(5)) === 0);

// Open Library 보정이 실제로 걸렸는지 (네트워크가 있을 때만 확인)
const matchBadges = await page.$$eval('[data-testid="match-badge"]', (els) =>
  els.map((e) => e.textContent.trim()),
);
if (process.env.HTTPS_PROXY || process.env.FLOW_EXPECT_NETWORK) {
  check("Open Library 보정이 붙는다", matchBadges.length > 0, matchBadges.join(" / ") || "붙은 것 없음");
} else {
  console.log("  (건너뜀) Open Library 보정 — 이 실행에는 바깥 망이 없음");
}

// 7. 순서를 바꾸면 책장 그림에도 반영된다
const spinesBefore = await page.$$eval('[data-slot="0"] .spine', (els) => els.map((e) => e.title));
await page.click('button[aria-label="1번째 책 오른쪽으로"]');
const spinesAfter = await page.$$eval('[data-slot="0"] .spine', (els) => els.map((e) => e.title));
check(
  "순서를 바꾸면 책장 그림에 반영된다",
  spinesBefore[0] === spinesAfter[1] && spinesBefore[1] === spinesAfter[0],
  `${spinesBefore.slice(0, 2).join(",")} → ${spinesAfter.slice(0, 2).join(",")}`,
);

// 8. 책을 빼고 넣을 수 있다
const beforeRemove = (await slotTitles()).length;
await page.click('button[aria-label="1번째 책 빼기"]');
const afterRemove = (await slotTitles()).length;
await page.click("text=책 직접 넣기");
const afterAdd = await slotTitles();
await page.locator('[data-testid="slot-panel"] .title-input').last().fill("손으로 넣은 책");
check(
  "책을 빼고 넣을 수 있다",
  afterRemove === beforeRemove - 1 && afterAdd.length === afterRemove + 1,
  `${beforeRemove} → ${afterRemove} → ${afterAdd.length}권`,
);

// 9. 같은 칸을 다시 찍으면 교체된다
const beforeRescan = (await slotTitles()).length;
const rescanned = await scanIntoSelectedSlot();
const afterRescan = await slotTitles();
check(
  "같은 칸을 다시 찍으면 내용이 교체된다",
  afterRescan.length === rescanned.length && afterRescan.length !== beforeRescan + rescanned.length,
  `${beforeRescan}권 → ${afterRescan.length}권`,
);

// 10. 다른 칸을 찍어도 앞 칸은 그대로다
const slot0Before = await slotCount(0);
await page.click('[data-slot="7"]');
await page.waitForSelector('[data-testid="slot-panel"]');
await scanIntoSelectedSlot();
check(
  "다른 칸을 찍어도 앞 칸은 그대로다",
  (await slotCount(0)) === slot0Before && (await slotCount(7)) > 0,
  `1번 칸 ${await slotCount(0)}권, 8번 칸 ${await slotCount(7)}권`,
);

// 칸 수를 늘려도 책은 그대로 남는다 (문서의 엣지 케이스)
await openTools();
await page.click("text=칸 수 바꾸기");
await page.waitForSelector('[data-testid="setup-preview"]');
await page.click('button[aria-label="칸 수 늘리기"]');
await page.click('button[aria-label="칸 수 늘리기"]');
await page.click(".setup-actions button.primary");
await page.waitForSelector('[data-testid="bookcase"]');
const grownSlots = await page.$$eval('[data-testid="bookcase"] .slot', (els) => els.length);
const keptTotal = await page.textContent(".app-header .meta");
check(
  "칸 수를 늘려도 책은 그대로 남는다",
  grownSlots === 16 && keptTotal.includes("10권") && (await slotCount(0)) === 5,
  `${grownSlots}칸 · ${keptTotal.trim()}`,
);

// 11. 책장을 하나 더 만들 수 있다
await openTools();
await page.click("text=책장 추가");
await page.waitForSelector('[data-testid="setup-preview"]');
await page.fill('input[aria-label="책장 이름"]', "서재 책장");
await page.click("text=이 책장 만들기");
await page.waitForSelector('[data-testid="bookcase"]');
const secondEmpty = await page.$$eval('[data-testid="bookcase"] .slot', (els) =>
  els.every((el) => Number(el.dataset.count) === 0),
);
const options = await page.$$eval(".bookcase-switch option", (els) => els.map((e) => e.textContent));
check("책장을 하나 더 만들 수 있고 각자 내용을 가진다", secondEmpty && options.length === 2, options.join(", "));

// 12. 다시 열어도 그대로다
await page.selectOption(".bookcase-switch", { label: "거실 책장" });
const before = await page.$$eval('[data-testid="bookcase"] .slot', (els) =>
  els.map((el) => Number(el.dataset.count)),
);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="bookcase"]');
const after = await page.$$eval('[data-testid="bookcase"] .slot', (els) =>
  els.map((el) => Number(el.dataset.count)),
);
check("앱을 다시 열어도 책장과 칸이 그대로다", JSON.stringify(before) === JSON.stringify(after),
  `${before.join(",")} → ${after.join(",")}`);

await page.click('[data-slot="0"]');
await page.screenshot({ path: path.join(CACHE, "flow-bookcase.png"), fullPage: true });

console.log(`\n=== ${results.filter((r) => r.ok).length}/${results.length} 통과 ===`);
for (const failure of results.filter((r) => !r.ok)) console.log(`  실패: ${failure.name} (${failure.detail})`);
await browser.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
