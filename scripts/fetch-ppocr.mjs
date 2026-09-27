/**
 * PaddleOCR 한국어 인식 모델(ONNX)과 문자 사전을 내려받는다.
 * 인식기를 바꿔 볼 때만 필요하다 (bench/ppocr.mjs).
 *
 * 모델은 저장소에 넣지 않는다. 13MB짜리 바이너리이고, 아직 앱이 쓰지 않는다.
 */
import fs from "node:fs";
import path from "node:path";

const REPO = "PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx";
const target = path.resolve("public/ppocr");
fs.mkdirSync(target, { recursive: true });

async function grab(name) {
  const url = `https://huggingface.co/${REPO}/resolve/main/${name}`;
  process.stdout.write(`${name} 내려받는 중… `);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`실패 (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  console.log(`${(data.length / 1024 / 1024).toFixed(1)}MB`);
  return data;
}

fs.writeFileSync(path.join(target, "rec.onnx"), await grab("inference.onnx"));

// 문자 사전은 inference.yml 안에 들어 있다. 한 글자씩 적힌 평문으로 뽑아 둔다.
const yml = (await grab("inference.yml")).toString("utf8").split("\n");
const start = yml.findIndex((line) => line.trim() === "character_dict:");
if (start < 0) throw new Error("character_dict 를 찾지 못했습니다.");
const chars = [];
for (const line of yml.slice(start + 1)) {
  if (!line.startsWith("  - ")) break;
  chars.push(line.slice(4));
}
fs.writeFileSync(path.join(target, "korean_dict.txt"), chars.join("\n"));
console.log(`문자 사전 ${chars.length}자 → public/ppocr/korean_dict.txt`);

// onnxruntime-web 런타임도 같은 자리에 복사해 둔다 (정적 서버로 띄워 시험한다).
const ortDir = path.dirname(new URL(import.meta.resolve("onnxruntime-web")).pathname);
const ort = path.resolve("public/ort");
fs.mkdirSync(ort, { recursive: true });
let copied = 0;
for (const file of fs.readdirSync(ortDir)) {
  if (/^ort(\.bundle\.min\.mjs|-wasm-simd-threaded.*\.(mjs|wasm))$/.test(file)) {
    fs.copyFileSync(path.join(ortDir, file), path.join(ort, file));
    copied++;
  }
}
console.log(`onnxruntime-web 자산 ${copied}개 → public/ort`);
console.log("완료. node bench/ppocr.mjs <책등 이미지…> 로 시험하세요.");
