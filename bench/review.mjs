/**
 * 결과 확인 단계를 점검한다. 확신이 낮은 책이 남아 있으면 칸에 넣을 수 없어야 한다.
 *
 *   node bench/review.mjs <사진> [앱 주소]
 *
 * 사진을 "사진 고르기"로 넣고 다음을 확인한다.
 *  1. 확인할 책이 있으면 [넣기] 대신 "확인 n권 남음"이 나온다
 *  2. 그 버튼은 다음 확인할 책으로 데려가 제목칸에 커서를 둔다
 *  3. 하나를 고쳐 쓰면 그 책은 확인된 것으로 친다
 *  4. 전부 확인하면 [넣기]가 나오고, 넣은 권수가 결과와 같다
 */
import { chromium } from "playwright";

const [photo, url = "http://localhost:4173/"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "통과" : "실패"} · ${name}${detail ? ` — ${detail}` : ""}`);
};

await page.goto(url, { waitUntil: "networkidle" });
await page.click("text=이 책장 만들기");
await page.click('[data-slot="0"]');
await page.click('[data-testid="scan-slot"]');
await page.setInputFiles('[data-testid="scan-sheet"] input[type="file"]', photo);
await page.waitForSelector('[data-testid="scan-summary"]', { timeout: 600000 });

const total = await page.$$eval(".scan-preview li", (els) => els.length);
const pendingAt = () => page.$$eval('[data-review="pending"]', (els) => els.length);
const firstPending = await pendingAt();
const gate = await page.$('[data-testid="next-review"]');
const apply = await page.$('[data-testid="apply-scan"]');
check("확인할 책이 있으면 넣을 수 없다", firstPending > 0 && Boolean(gate) && !apply, `${total}권 중 확인 ${firstPending}권`);

await page.click('[data-testid="next-review"]');
const focused = await page.evaluate(() => {
  const row = document.activeElement?.closest("li");
  return row?.getAttribute("data-review") === "pending";
});
check("다음 책 보기는 확인할 책의 제목칸으로 데려간다", focused);

await page.keyboard.type(" ");
check("고쳐 쓰면 확인된 것으로 친다", (await pendingAt()) === firstPending - 1, `${firstPending} → ${await pendingAt()}`);

while (await page.$('[data-testid="confirm-title"]')) {
  await page.locator('[data-testid="confirm-title"]').first().click();
}
const ready = await page.$('[data-testid="apply-scan"]');
check("전부 확인하면 넣을 수 있다", Boolean(ready) && (await pendingAt()) === 0);
await page.click('[data-testid="apply-scan"]');
await page.waitForSelector('[data-testid="scan-sheet"]', { state: "detached" });
const placed = await page.$eval('[data-slot="0"]', (el) => Number(el.dataset.count));
check("넣은 권수가 결과와 같다", placed === total, `${placed}권`);
const flagged = await page.$$eval('[data-testid="slot-panel"] .badge.confidence.low', (els) => els.length);
check("확인한 책은 칸에서 다시 확인 필요로 뜨지 않는다", flagged === 0, `${flagged}권`);

console.log(`=== ${results.filter(Boolean).length}/${results.length} 통과 ===`);
await browser.close();
process.exitCode = results.every(Boolean) ? 0 : 1;
