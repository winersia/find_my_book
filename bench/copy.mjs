/**
 * 화면에 적힌 설명 글자 수를 센다.
 *
 * 버튼 이름과 데이터(제목, 권수)는 빼고, "읽어야 알 수 있는 글"만 센다.
 * 화면이 이미 보여 주는 것을 글로 다시 말하면 이 숫자가 올라간다.
 *
 *   npm run build && npm run preview      # 다른 터미널에서
 *   node bench/copy.mjs [--verbose]
 */
import { chromium } from "playwright";

const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const APP_URL = process.env.FLOW_URL || "http://localhost:4173/";
const VIDEO = process.env.FLOW_VIDEO || "bench/.cache/slot.y4m";
const verbose = process.argv.includes("--verbose");

/** 설명 문구가 담기는 자리들 */
const SELECTOR = [
  ".hint",
  ".notes",
  ".notice",
  ".call-to-action",
  ".steps",
  ".preview-caption",
  ".frame-guide span",
].join(", ");

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {}),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${VIDEO}`,
    // 샌드박스 프록시는 크로미움의 TLS 1.3 을 못 넘긴다. 일반 환경에는 필요 없다.
    ...(process.env.HTTPS_PROXY ? ["--ssl-version-max=tls1.2"] : []),
  ],
});
const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
await context.grantPermissions(["camera"], { origin: new URL(APP_URL).origin });
const page = await context.newPage();
page.on("dialog", (dialog) => dialog.accept());

let total = 0;
async function measure(label) {
  const texts = await page.$$eval(SELECTOR, (els) =>
    els.filter((el) => el.offsetParent !== null).map((el) => el.textContent.replace(/\s+/g, " ").trim()),
  );
  const chars = texts.join("").length;
  total += chars;
  console.log(`  ${label.padEnd(10)} ${String(chars).padStart(4)}자${verbose && texts.length ? `  ${texts.join(" | ")}` : ""}`);
}

await page.goto(APP_URL, { waitUntil: "networkidle" });
await measure("설정");

await page.click("text=이 책장 만들기");
await page.waitForSelector('[data-testid="bookcase"]');
await measure("책장");

await page.click('[data-slot="0"]');
await page.waitForSelector('[data-testid="slot-panel"]');
await measure("빈 칸");

await page.click('[data-testid="scan-slot"]');
await page.waitForFunction(
  () => {
    const button = document.querySelector('[data-testid="scan-sheet"] button.shutter');
    return button && !button.disabled;
  },
  { timeout: 20000 },
);
await measure("카메라");

await page.locator('[data-testid="scan-sheet"] button.shutter').click();
await page.waitForTimeout(1500);
await measure("인식 중");

await page.waitForSelector('[data-testid="apply-scan"]', { timeout: 600000 });
await measure("결과");

await page.click('[data-testid="apply-scan"]');
await page.waitForSelector('[data-testid="scan-sheet"]', { state: "detached" });
await measure("채운 칸");

console.log(`  ${"합계".padEnd(10)} ${String(total).padStart(4)}자`);
await browser.close();
