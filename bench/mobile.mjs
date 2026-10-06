/**
 * 휴대폰과 비슷한 조건에서 셔터를 누른 뒤 화면이 얼마나 멈추는지 잰다.
 *
 * 사진을 가짜 카메라 영상으로 넣고, CPU 를 느리게 걸어 앱을 실제로 눌러 본다.
 * 화면이 멈춘 구간은 requestAnimationFrame 사이 간격으로 잰다. 메인 스레드가 막히면
 * 그 사이에 프레임이 하나도 그려지지 않는다.
 *
 *   node bench/mobile.mjs <사진.jpg> [앱 주소] [CPU 배율, 기본 4] [--gallery]
 *
 * --gallery 면 셔터 대신 "사진 고르기"로 같은 사진을 넣는다.
 * 멈춘 구간마다 그 직전에 로딩 표시([data-busy-indicator])가 떠 있었는지도 본다.
 * 로딩 표시는 CSS 애니메이션이라 멈춘 동안에도 돈다. 표시 없이 멈추면 사용자는 앱이 죽은 줄 안다.
 * 사진은 저장소 밖에 두고, 만든 영상은 bench/.cache 에 남는다.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const gallery = process.argv.includes("--gallery");
const [photo, url = "http://localhost:4173/", rate = "4"] = positional;
const CACHE = path.resolve("bench/.cache");
fs.mkdirSync(CACHE, { recursive: true });
const proxy = process.env.HTTPS_PROXY
  ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
  : {};

// 사진을 y4m 영상으로 (두 프레임이면 된다)
const video = path.join(CACHE, `${path.basename(photo).replace(/\.[^.]+$/, "")}.y4m`);
if (!fs.existsSync(video)) {
  const maker = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await maker.newPage();
  const { width, height, y, u, v } = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${data}`;
    await img.decode();
    const w = img.width & ~1;
    const h = img.height & ~1;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const Y = new Uint8Array(w * h);
    const U = new Uint8Array((w / 2) * (h / 2));
    const V = new Uint8Array((w / 2) * (h / 2));
    const c = (x) => Math.max(16, Math.min(240, Math.round(x)));
    for (let r = 0; r < h; r++) {
      for (let col = 0; col < w; col++) {
        const i = (r * w + col) * 4;
        Y[r * w + col] = c(0.257 * px[i] + 0.504 * px[i + 1] + 0.098 * px[i + 2] + 16);
        if (r % 2 === 0 && col % 2 === 0) {
          const k = (r / 2) * (w / 2) + col / 2;
          U[k] = c(-0.148 * px[i] - 0.291 * px[i + 1] + 0.439 * px[i + 2] + 128);
          V[k] = c(0.439 * px[i] - 0.368 * px[i + 1] - 0.071 * px[i + 2] + 128);
        }
      }
    }
    const b64 = (a) => btoa(Array.from(a, (x) => String.fromCharCode(x)).join(""));
    return { width: w, height: h, y: b64(Y), u: b64(U), v: b64(V) };
  }, fs.readFileSync(photo).toString("base64"));
  await maker.close();
  const frame = [Buffer.from("FRAME\n"), Buffer.from(y, "base64"), Buffer.from(u, "base64"), Buffer.from(v, "base64")];
  fs.writeFileSync(
    video,
    Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F5:1 Ip A1:1 C420mpeg2\n`), ...frame, ...frame]),
  );
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  ...proxy,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${video}`,
    ...(process.env.HTTPS_PROXY ? ["--ssl-version-max=tls1.2"] : []),
  ],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await context.grantPermissions(["camera"], { origin: new URL(url).origin });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[페이지 오류]", String(error).slice(0, 200)));
page.on("crash", () => console.log("[탭이 죽음]"));

// 프레임 간격 기록기. 메인 스레드가 막히면 간격이 벌어진다.
await page.addInitScript(() => {
  window.__gaps = [];
  let last = performance.now();
  let shown = false;
  const tick = (now) => {
    if (now - last > 500) window.__gaps.push({ at: Math.round(last), ms: Math.round(now - last), shown });
    last = now;
    // 이 프레임에 로딩 표시가 화면에 있었는지. 다음 프레임까지 멈추면 이 값이 남는다.
    shown = [...document.querySelectorAll("[data-busy-indicator]")].some((el) => el.getClientRects().length > 0);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__marks = [];
  new MutationObserver(() => {
    const text = document.querySelector('[data-testid="scanning"] .progress-line')?.textContent ?? "";
    const tail = window.__marks[window.__marks.length - 1];
    const state = document.querySelector('[data-testid="apply-scan"]') ? "결과" : text.replace(/\s+/g, " ").trim();
    const key = state.replace(/[0-9]+\/[0-9]+.*/, "");
    if (state && (!tail || tail.key !== key)) window.__marks.push({ at: Math.round(performance.now()), state, key });
  }).observe(document, { subtree: true, childList: true, characterData: true });
});

await page.goto(url, { waitUntil: "networkidle" });
await page.click("text=이 책장 만들기");
await page.click('[data-slot="0"]');
await page.click('[data-testid="scan-slot"]');
await page.waitForFunction(() => {
  const b = document.querySelector('[data-testid="scan-sheet"] button.shutter');
  return b && !b.disabled;
}, { timeout: 60000 });
const camera = await page.$eval("video", (v) => `${v.videoWidth}x${v.videoHeight}`);

const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(rate) });
const shotAt = await page.evaluate(() => Math.round(performance.now()));
if (gallery) {
  // 갤러리에서 고른 것처럼 파일을 넣는다. 사진 원본(JPEG)이 그대로 들어간다.
  await page.setInputFiles('[data-testid="scan-sheet"] input[type="file"]', photo);
} else {
  // 클릭이 끝나기를 기다리지 않는다. 셔터 뒤 메인 스레드가 막히면 클릭 확인부터 늦어진다.
  await page.evaluate(() => {
    setTimeout(() => document.querySelector('[data-testid="scan-sheet"] button.shutter').click(), 0);
  });
}
await page.waitForSelector('[data-testid="apply-scan"], [data-testid="scan-sheet"] .error, .notes', { timeout: 900000 });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

const { gaps, marks } = await page.evaluate(() => ({ gaps: window.__gaps, marks: window.__marks }));
const count = await page.$$eval(".scan-preview li", (els) => els.length);
console.log(`${gallery ? "갤러리 사진" : `카메라 ${camera}`} · CPU ${rate}배 느리게`);
console.log("화면에 나타난 상태 (셔터 기준 초):");
for (const m of marks.filter((m) => m.at >= shotAt)) console.log(`  +${((m.at - shotAt) / 1000).toFixed(1)}s  ${m.state}`);
const after = gaps.filter((g) => g.at >= shotAt - 100);
const longest = after.reduce((m, g) => Math.max(m, g.ms), 0);
console.log(`화면이 멈춘 구간: 1초 넘는 것 ${after.filter((g) => g.ms > 1000).length}번 · 가장 긴 것 ${(longest / 1000).toFixed(1)}초`);
for (const g of after.filter((g) => g.ms > 3000)) {
  console.log(`  +${((g.at - shotAt) / 1000).toFixed(1)}s 부터 ${(g.ms / 1000).toFixed(1)}초`);
}
const bare = after.filter((g) => g.ms > 500 && !g.shown);
console.log(`로딩 표시 없이 0.5초 넘게 멈춘 구간: ${bare.length}번`);
for (const g of bare) console.log(`  +${((g.at - shotAt) / 1000).toFixed(1)}s 부터 ${(g.ms / 1000).toFixed(1)}초`);
console.log(`결과 ${count}권`);
await browser.close();
