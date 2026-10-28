/**
 * 긴 칸 나눠 찍기를 점검한다. 책장 설정에서 칸 모양을 고르면 몇 번에 나눠 찍을지 미리 알리고,
 * 찍을 때 장마다 칸의 어디를 찍을지 안내해야 한다.
 *
 *   npm run build && npm run preview      # 다른 터미널에서
 *   node bench/longshelf.mjs [사진] [앱 주소]
 *
 * 사진을 주지 않으면 합성 책장(bench/.cache/ko-rotated.png, bench/run.mjs 가 만든다)을 쓴다.
 * 같은 사진을 "왼쪽 절반", "오른쪽 절반"으로 두 번 넣는다. 무엇이 읽혔는지가 아니라 안내를 본다.
 */
import { chromium } from "playwright";

const [photo = "bench/.cache/ko-rotated.png", url = "http://localhost:4173/"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "통과" : "실패"} · ${name}${detail ? ` — ${detail}` : ""}`);
};
const text = (selector) => page.$eval(selector, (el) => el.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
const dialogs = [];
let acceptDialogs = true;
page.on("dialog", (dialog) => {
  dialogs.push(dialog.message());
  void (acceptDialogs ? dialog.accept() : dialog.dismiss());
});

await page.goto(url, { waitUntil: "networkidle" });

// 1. 책장 설정: 보통 칸은 한 번에, 긴 칸은 나눠 찍는다고 미리 알린다.
const shotsNow = () => page.$eval('[data-testid="setup-shots"]', (el) => Number(el.dataset.shots));
check("기본 칸 모양은 한 번에 찍는다", (await shotsNow()) === 1, await text('[data-testid="setup-shots"] .hint'));
for (let i = 0; i < 4; i++) await page.click('button[aria-label="가로가 높이의 몇 배 늘리기"]');
const aspect = await page.inputValue('input[aria-label="가로가 높이의 몇 배"]');
const plan = await text('[data-testid="setup-shots"] .hint');
const boxes = await page.$$eval('[data-testid="setup-shots"] .slot-shape-box span', (els) => els.length);
check(
  "가로가 높이의 4배인 칸은 2번에 나눠 찍는다고 미리 알린다",
  (await shotsNow()) === 2 && /2번에 나눠/.test(plan) && boxes === 2,
  `${aspect}배 · ${plan} · 그림 ${boxes}칸`,
);
for (let i = 0; i < 4; i++) await page.click('button[aria-label="가로가 높이의 몇 배 늘리기"]');
check("6배는 3번에 나눠 찍는다", (await shotsNow()) === 3, await text('[data-testid="setup-shots"] .hint'));
for (let i = 0; i < 4; i++) await page.click('button[aria-label="가로가 높이의 몇 배 줄이기"]');
await page.click("text=이 책장 만들기");

// 2. 칸을 고르면 촬영 버튼에 나눠 찍기가 보인다.
await page.click('[data-slot="0"]');
const scanLabel = await text('[data-testid="scan-slot"]');
check("칸 촬영 버튼에 몇 번에 나눠 찍을지 나온다", /2번에 나눠/.test(scanLabel), scanLabel);

// 3. 첫 장: 왼쪽 절반.
await page.click('[data-testid="scan-slot"]');
await page.waitForSelector('[data-testid="part-notice"]');
const first = await text('[data-testid="part-notice"]');
const guide = await text('[data-testid="scan-sheet"] .viewport .hint, [data-testid="frame-guide"]');
check("첫 장은 칸의 왼쪽 절반을 찍으라고 안내한다", /1\/2/.test(first) && /왼쪽 절반/.test(first) && /왼쪽 절반/.test(guide), `${first} | 틀: ${guide}`);
await page.setInputFiles('[data-testid="scan-sheet"] input[type="file"]', photo);
await page.waitForSelector('[data-testid="scan-summary"]', { timeout: 600000 });

// 4. 첫 장 뒤: 남은 장을 먼저 찍게 한다.
const nextNotice = await text('[data-testid="next-part-notice"]');
const nextButton = await page.$eval('[data-testid="next-part"]', (el) => ({ text: el.textContent.trim(), primary: el.classList.contains("primary") })).catch(() => null);
const plainAppend = await page.$('[data-testid="append-scan"]');
check(
  "첫 장 뒤에는 오른쪽 절반 이어서 찍기가 맨 앞 버튼이다",
  /오른쪽 절반/.test(nextNotice) && nextButton?.primary && /오른쪽 절반 이어서 찍기 \(2\/2\)/.test(nextButton.text) && !plainAppend,
  `${nextNotice} | ${nextButton?.text}`,
);

// 다 찍기 전에 넣으려 하면 묻는다. 취소하면 그대로다.
while (await page.$('[data-testid="confirm-title"]')) await page.locator('[data-testid="confirm-title"]').first().click();
acceptDialogs = false;
await page.click('[data-testid="apply-scan"]');
acceptDialogs = true;
const asked = dialogs.at(-1) ?? "";
check("다 찍기 전에 넣으려 하면 남은 부분을 알리고 묻는다", /오른쪽 절반을 아직/.test(asked) && Boolean(await page.$('[data-testid="scan-sheet"]')), asked);

// 5. 둘째 장: 오른쪽 절반.
await page.click('[data-testid="next-part"]');
await page.waitForSelector('[data-testid="part-notice"]');
const second = await text('[data-testid="part-notice"]');
check("둘째 장은 오른쪽 절반을, 앞 사진과 겹치게 찍으라고 안내한다", /2\/2/.test(second) && /오른쪽 절반/.test(second) && /겹치게/.test(second), second);
await page.setInputFiles('[data-testid="scan-sheet"] input[type="file"]', photo);
await page.waitForFunction(() => /사진 2장/.test(document.querySelector('[data-testid="scan-summary"]')?.textContent ?? ""), null, { timeout: 600000 });
const done = !(await page.$('[data-testid="next-part"]')) && !(await page.$('[data-testid="next-part-notice"]')) && Boolean(await page.$('[data-testid="append-scan"]'));
check("다 찍으면 나눠 찍기 안내가 사라지고 평소처럼 이어서 찍기가 남는다", done, await text('[data-testid="scan-summary"]'));

// 6. 넣기. 이제는 묻지 않는다.
while (await page.$('[data-testid="confirm-title"]')) await page.locator('[data-testid="confirm-title"]').first().click();
const before = dialogs.length;
const total = await page.$$eval(".scan-preview li:not(.dropped)", (els) => els.length);
await page.click('[data-testid="apply-scan"]');
await page.waitForSelector('[data-testid="scan-sheet"]', { state: "detached" });
const placed = await page.$eval('[data-slot="0"]', (el) => Number(el.dataset.count));
check("다 찍은 뒤 넣으면 묻지 않고 두 장의 책이 다 들어간다", dialogs.length === before && placed === total, `${placed}권`);

// 7. 칸 모양은 저장되고, 칸 수 바꾸기 화면에 그대로 나온다.
await page.reload({ waitUntil: "networkidle" });
await page.click(".more-tools summary");
await page.click("text=칸 수 바꾸기");
const kept = await page.inputValue('input[aria-label="가로가 높이의 몇 배"]');
check("칸 모양은 저장되고 다시 열어도 그대로다", kept === "4", `${kept}배`);
await page.click("text=취소");

// 8. 칸 모양이 없던 예전 책장은 한 번에 찍는다 (예전처럼).
await page.evaluate(() => {
  const key = "find-my-book:bookcases:v1";
  const list = JSON.parse(localStorage.getItem(key));
  delete list[0].slotAspect;
  localStorage.setItem(key, JSON.stringify(list));
});
await page.reload({ waitUntil: "networkidle" });
await page.click('[data-slot="1"]');
const legacy = await text('[data-testid="scan-slot"]');
check("칸 모양이 없던 예전 책장은 예전처럼 한 번에 찍는다", !/나눠/.test(legacy), legacy);

console.log(`=== ${results.filter(Boolean).length}/${results.length} 통과 ===`);
await browser.close();
process.exitCode = results.every(Boolean) ? 0 : 1;
