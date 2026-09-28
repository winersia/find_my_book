/**
 * PaddleOCR 한국어 인식 모델(ONNX)과 문자 사전을 내려받는다.
 * 인식기를 바꿔 볼 때만 필요하다 (bench/ppocr.mjs).
 *
 * 모델은 저장소에 넣지 않는다. 13MB짜리 바이너리이고, 아직 앱이 쓰지 않는다.
 */
import fs from "node:fs";
import path from "node:path";

const REC_REPO = "PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx";
const DET_REPO = "PaddlePaddle/PP-OCRv5_mobile_det_onnx";
const target = path.resolve("public/ppocr");
fs.mkdirSync(target, { recursive: true });

/**
 * src/lib/ppocr.ts 가 진행률 분모로 쓰는 크기. 서버가 gzip 으로 보내면
 * content-length 는 압축된 크기라 못 쓰기 때문에 상수로 박아 뒀다.
 * 모델을 바꾸면 여기서 먼저 걸려야 한다. 안 그러면 진행률이 100%를 넘거나 덜 찬다.
 */
const EXPECTED_BYTES = { "rec.onnx": 13_418_787, "det.onnx": 4_826_518 };

function verifySizes() {
  for (const [name, expected] of Object.entries(EXPECTED_BYTES)) {
    const actual = fs.statSync(path.join(target, name)).size;
    if (actual !== expected) {
      throw new Error(
        `${name} 크기가 ${actual}바이트입니다 (기대 ${expected}). ` +
          "src/lib/ppocr.ts 의 MODEL_BYTES 와 이 파일의 EXPECTED_BYTES 를 같이 고쳐 주세요. " +
          "그 값이 내려받기 진행률의 분모입니다.",
      );
    }
  }
}

// 이미 받아 뒀으면 건너뛴다. predev/prebuild 에서 매번 17MB를 다시 받을 일은 없다.
const done = ["rec.onnx", "det.onnx", "korean_dict.txt"].every((name) =>
  fs.existsSync(path.join(target, name)),
);
if (done && fs.existsSync(path.resolve("public/ort/ort.wasm.bundle.min.mjs"))) {
  verifySizes();
  console.log("PaddleOCR 자산이 이미 있습니다. 다시 받으려면 public/ppocr 를 지우세요.");
  process.exit(0);
}

async function grab(name, repo = REC_REPO) {
  const url = `https://huggingface.co/${repo}/resolve/main/${name}`;
  process.stdout.write(`${name} 내려받는 중… `);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`실패 (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  console.log(`${(data.length / 1024 / 1024).toFixed(1)}MB`);
  return data;
}

fs.writeFileSync(path.join(target, "rec.onnx"), await grab("inference.onnx"));
// 검출 모델. 책등 안에서 "제목처럼 큰 글자 덩어리"가 어디인지 찾는 데 쓴다.
// 출판사·분류도 한글이라 글자만 보고는 못 가르고, 잉크 분포로도 안 됐다.
fs.writeFileSync(path.join(target, "det.onnx"), await grab("inference.onnx", DET_REPO));
verifySizes();

// 문자 사전은 inference.yml 안에 들어 있다. 한 글자씩 적힌 평문으로 뽑아 둔다.
const yml = (await grab("inference.yml")).toString("utf8").split("\n");
const start = yml.findIndex((line) => line.trim() === "character_dict:");
if (start < 0) throw new Error("character_dict 를 찾지 못했습니다.");
const chars = [];
for (const line of yml.slice(start + 1)) {
  if (!line.startsWith("  - ")) break;
  chars.push(unquote(line.slice(4)));
}

/**
 * YAML 이 따옴표로 감싼 항목을 벗긴다.
 * 숫자와 기호는 '0' '-' 처럼 감싸져 나오는데, 그대로 두면 사전에 세 글자짜리 항목이
 * 들어가 인식 결과에 따옴표가 섞인다.
 */
function unquote(value) {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return value;
}
fs.writeFileSync(path.join(target, "korean_dict.txt"), chars.join("\n"));
console.log(`문자 사전 ${chars.length}자 → public/ppocr/korean_dict.txt`);

// onnxruntime-web 런타임도 같은 자리에 복사해 둔다 (정적 서버로 띄워 시험한다).
const ortDir = path.dirname(new URL(import.meta.resolve("onnxruntime-web")).pathname);
const ort = path.resolve("public/ort");
fs.mkdirSync(ort, { recursive: true });
let copied = 0;
for (const file of fs.readdirSync(ortDir)) {
  // 기본 wasm 코어 하나만 가져온다. asyncify·jsep·jspi 변종까지 넣으면 83MB가 된다.
  // wasm 전용 빌드를 쓴다. 기본 번들(ort.bundle.min.mjs)은 WebGPU용 jsep 코어를
  // 부르는데 그 wasm 만 27MB다. 우리는 wasm 백엔드만 쓴다.
  if (/^(ort\.wasm\.bundle\.min\.mjs|ort-wasm-simd-threaded\.(mjs|wasm))$/.test(file)) {
    fs.copyFileSync(path.join(ortDir, file), path.join(ort, file));
    copied++;
  }
}
console.log(`onnxruntime-web 자산 ${copied}개 → public/ort`);
console.log("완료. node bench/ppocr.mjs <책등 이미지…> 로 시험하세요.");
