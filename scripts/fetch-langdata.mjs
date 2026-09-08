/**
 * 언어 데이터(traineddata)를 public/tessdata 로 내려받는다.
 * 완전히 오프라인으로 쓰고 싶을 때만 필요하다.
 * 받은 뒤 VITE_TESSDATA_PATH=/tessdata 로 실행하거나 빌드하면 CDN을 쓰지 않는다.
 *
 * 경로와 파일명은 tesseract.js가 기본으로 쓰는 것과 같게 맞췄다.
 * (LSTM 전용 모델, gzip 그대로 저장)
 */
import fs from "node:fs";
import path from "node:path";

const base = (lang) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int`;
const langs = process.argv.slice(2).length ? process.argv.slice(2) : ["eng", "kor", "kor_vert"];
const target = path.resolve("public/tessdata");
fs.mkdirSync(target, { recursive: true });

for (const lang of langs) {
  const url = `${base(lang)}/${lang}.traineddata.gz`;
  process.stdout.write(`${lang} 내려받는 중… `);
  const response = await fetch(url);
  if (!response.ok) {
    console.log(`실패 (${response.status})`);
    process.exitCode = 1;
    continue;
  }
  const data = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(target, `${lang}.traineddata.gz`), data);
  console.log(`${(data.length / 1024 / 1024).toFixed(1)}MB`);
}

console.log("완료. VITE_TESSDATA_PATH=/tessdata 로 실행하거나 빌드하세요.");
