/**
 * tesseract.js 워커와 wasm 코어를 public/tesseract 로 복사한다.
 *
 * 기본값으로 두면 tesseract.js가 이 파일들을 CDN에서 받아 오는데,
 * 오프라인에서 못 쓰고 CDN 경로가 어긋나면 통째로 실패한다.
 * 앱과 같이 배포하는 편이 안전하고 빠르다.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const target = path.resolve("public/tesseract");

const workerSource = path.join(path.dirname(require.resolve("tesseract.js")), "..", "dist", "worker.min.js");
const coreDir = path.dirname(require.resolve("tesseract.js-core/package.json"));

// oem 1(LSTM)만 쓰므로 LSTM 코어 세 종류면 충분하다.
// 브라우저는 이 중 지원하는 것 하나만 내려받는다.
const coreFiles = [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
];

fs.mkdirSync(target, { recursive: true });

const copied = [];
const worker = fs.existsSync(workerSource)
  ? workerSource
  : path.join(coreDir, "..", "tesseract.js", "dist", "worker.min.js");
fs.copyFileSync(worker, path.join(target, "worker.min.js"));
copied.push("worker.min.js");

for (const file of coreFiles) {
  const source = path.join(coreDir, file);
  if (!fs.existsSync(source)) {
    console.warn(`건너뜀: ${file} 없음`);
    continue;
  }
  fs.copyFileSync(source, path.join(target, file));
  copied.push(file);
}

const bytes = copied.reduce((sum, file) => sum + fs.statSync(path.join(target, file)).size, 0);
console.log(`tesseract 자산 ${copied.length}개 복사 (${(bytes / 1024 / 1024).toFixed(1)}MB) → public/tesseract`);
