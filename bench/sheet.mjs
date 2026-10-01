/**
 * 여러 크롭을 한 장에 세로로 이어 붙인다. 이름표를 왼쪽에 단다.
 *   node bench/sheet.mjs <출력.png> <그림…>
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [out, ...files] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
const items = files.map((file) => ({
  name: path.basename(file).replace(/\.png$/, ""),
  url: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`,
}));
const png = await page.evaluate(async (list) => {
  const images = await Promise.all(
    list.map(async (item) => {
      const img = new Image();
      img.src = item.url;
      await img.decode();
      return { name: item.name, img };
    }),
  );
  const label = 190;
  const canvas = document.createElement("canvas");
  canvas.width = label + Math.max(...images.map((i) => i.img.width));
  canvas.height = images.reduce((sum, i) => sum + i.img.height + 6, 0);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = "13px sans-serif";
  let y = 0;
  for (const { name, img } of images) {
    ctx.drawImage(img, label, y);
    ctx.fillText(name, 4, y + img.height / 2 + 4);
    y += img.height + 6;
  }
  return canvas.toDataURL("image/png").split(",")[1];
}, items);
fs.writeFileSync(out, Buffer.from(png, "base64"));
console.log(out);
await browser.close();
