/**
 * 책등 글자를 읽는 인식기 (PaddleOCR PP-OCRv5, onnxruntime-web).
 *
 * tesseract 로는 실제 사진에서 40권 중 12권만 쓸 만하게 읽혔다. 손으로 정확히 자른
 * 책등을 넣어도 한 글자도 못 읽는 책이 많아, 자르기가 아니라 인식기가 한계였다.
 * 같은 크롭으로 갈아 끼워 재면 20권이 된다 (docs/인식기-검토.md).
 *
 * 모델 두 개를 쓴다.
 *  - 인식(rec): 글자 띠 하나를 문자열로 바꾼다. 한국어 모델이지만 영문도 읽는다.
 *  - 검출(det): 책등 어디에 글자가 있는지 찾는다. 제목만 골라내는 데 쓴다.
 *    책등에는 출판사·시리즈 번호·분류가 잔글씨로 같이 찍혀 있고 그것도 한글이라,
 *    글자만 보고는 못 가른다. 크기로 갈라야 하는데 화소 밝기로는 무늬와 구별이 안 됐다.
 */
import type * as Ort from "onnxruntime-web";

/**
 * onnxruntime-web 은 실행할 때 가져온다.
 *
 * 정적으로 import 하면 vite 가 쓰지도 않는 wasm 변종(asyncify·jsep·jspi)까지 찾아내
 * 번들에 넣는다. 그것만 60MB가 넘는다. 경로를 실행 중에 만들면 vite 가 분석하지 못해
 * 우리가 배포한 것만 내려간다.
 */
let ort: typeof Ort | null = null;

export interface SpineText {
  text: string;
  /** 0~1 */
  confidence: number;
}

/** 인식 모델이 기대하는 글자 띠 높이 */
const LINE_HEIGHT = 48;
/** 글자 확률이 이보다 높으면 글자로 본다 */
const TEXT_PROBABILITY = 0.3;
/** 가장 큰 글자 덩어리 대비 이 비율은 돼야 제목으로 본다 */
const TITLE_HEIGHT_RATIO = 0.7;
/** 모델을 받는 데 이만큼 걸리면 실패로 본다 */
const MODEL_TIMEOUT_MS = 120_000;

let rec: Ort.InferenceSession | null = null;
let det: Ort.InferenceSession | null = null;
let dict: string[] | null = null;
let loading: Promise<void> | null = null;

function assetBase(): string {
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base : `${base}/`;
}

/** 이미 받아 뒀는지. 처음 실행인지 알려 줄 때 쓴다. */
export function hasModels(): boolean {
  return rec !== null && det !== null;
}

export async function releaseModels(): Promise<void> {
  await rec?.release();
  await det?.release();
  rec = null;
  det = null;
  dict = null;
  loading = null;
}

/** 내려받는 동안 진행률을 알려 준다. 17MB라 한참 걸린다. */
async function fetchWithProgress(
  url: string,
  onProgress?: (ratio: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} (${response.status})`);
  const total = Number(response.headers.get("content-length") ?? 0);
  if (!response.body || !total) return response.arrayBuffer();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received / total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

export async function loadModels(onProgress?: (ratio: number) => void): Promise<void> {
  if (hasModels()) return;
  if (loading) return loading;

  loading = (async () => {
    const base = assetBase();
    const runtime = `${base}ort/ort.wasm.bundle.min.mjs`;
    ort = (await import(/* @vite-ignore */ runtime)) as typeof Ort;
    // wasm 런타임은 앱과 같이 배포한다. CDN에 기대면 오프라인에서 못 쓴다.
    ort.env.wasm.wasmPaths = `${base}ort/`;
    ort.env.wasm.numThreads = 1;

    // 인식 모델이 12.8MB로 훨씬 크다. 진행률은 두 개를 합쳐 셈한다.
    const recBytes = await fetchWithProgress(`${base}ppocr/rec.onnx`, (r) => onProgress?.(r * 0.75));
    const detBytes = await fetchWithProgress(`${base}ppocr/det.onnx`, (r) => onProgress?.(0.75 + r * 0.2));
    const text = await (await fetch(`${base}ppocr/korean_dict.txt`)).text();
    onProgress?.(0.96);

    rec = await ort.InferenceSession.create(recBytes, { executionProviders: ["wasm"] });
    det = await ort.InferenceSession.create(detBytes, { executionProviders: ["wasm"] });
    // CTC: 0번은 빈 칸, 끝에 공백 하나를 덧붙이는 것이 PaddleOCR 관례다.
    dict = ["", ...text.split("\n"), " "];
    onProgress?.(1);
  })();

  try {
    await withTimeout(loading, MODEL_TIMEOUT_MS);
  } catch (error) {
    loading = null;
    rec = null;
    det = null;
    throw error;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "글자 인식 모델을 내려받지 못했습니다. 인터넷 연결을 확인해 주세요. " +
                  "(오프라인으로 쓰려면 npm run fetch:ppocr 로 받아 두세요)",
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 글자 띠를 모델이 기대하는 모양(높이 48, BGR, -1~1)으로 만든다. */
function toLineTensor(canvas: HTMLCanvasElement): Ort.Tensor {
  const height = LINE_HEIGHT;
  const width = Math.max(32, Math.min(3200, Math.round((canvas.width / canvas.height) * height)));
  const scaled = document.createElement("canvas");
  scaled.width = width;
  scaled.height = height;
  const ctx = scaled.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, width, height);

  const pixels = ctx.getImageData(0, 0, width, height).data;
  const data = new Float32Array(3 * height * width);
  const plane = height * width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const at = y * width + x;
      data[at] = (pixels[i + 2] / 255 - 0.5) / 0.5;
      data[plane + at] = (pixels[i + 1] / 255 - 0.5) / 0.5;
      data[2 * plane + at] = (pixels[i] / 255 - 0.5) / 0.5;
    }
  }
  return new ort!.Tensor("float32", data, [1, 3, height, width]);
}

/** CTC 출력에서 글자를 뽑는다. 같은 글자가 이어지면 하나로 친다. */
function decode(logits: Float32Array | Uint8Array, steps: number, classes: number): SpineText {
  const table = dict ?? [];
  let text = "";
  let previous = -1;
  let sum = 0;
  let count = 0;

  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestValue = -Infinity;
    for (let c = 0; c < classes; c++) {
      const value = logits[t * classes + c] as number;
      if (value > bestValue) {
        bestValue = value;
        best = c;
      }
    }
    if (best !== 0 && best !== previous) {
      text += table[best] ?? "";
      sum += bestValue;
      count++;
    }
    previous = best;
  }
  return {
    // 사전이 자모로 되어 있어 합쳐 줘야 "한글"이 된다.
    text: text.normalize("NFC").trim(),
    confidence: count ? Math.min(1, Math.max(0, sum / count)) : 0,
  };
}

/**
 * 띠에서 제목 글자가 있는 구간만 잘라낸다.
 *
 * 검출 모델에게 "여기가 글자다"를 묻고, 그 지도 위에서 글자가 띠의 위아래로 얼마나
 * 퍼져 있는지를 잰다. 제목은 늘 띠의 폭을 가장 많이 차지한다.
 */
async function titleSpan(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement | null> {
  if (!det) return null;
  const lineWidth = Math.max(32, Math.min(2048, Math.round((canvas.width / canvas.height) * LINE_HEIGHT)));
  const width = Math.ceil(lineWidth / 32) * 32;
  const height = Math.ceil(LINE_HEIGHT / 32) * 32;

  const small = document.createElement("canvas");
  small.width = width;
  small.height = height;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, lineWidth, LINE_HEIGHT);

  const pixels = ctx.getImageData(0, 0, width, height).data;
  const mean = [0.485, 0.456, 0.406];
  const deviation = [0.229, 0.224, 0.225];
  const data = new Float32Array(3 * height * width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        data[c * height * width + y * width + x] = (pixels[i + c] / 255 - mean[c]) / deviation[c];
      }
    }
  }

  const result = await det.run({
    [det.inputNames[0]]: new ort!.Tensor("float32", data, [1, 3, height, width]),
  });
  const map = result[det.outputNames[0]].data as Float32Array;

  const extent = new Int32Array(lineWidth);
  for (let x = 0; x < lineWidth; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < LINE_HEIGHT; y++) {
      if (map[y * width + x] > TEXT_PROBABILITY) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    extent[x] = top < 0 ? 0 : bottom - top + 1;
  }

  // 글자 사이 좁은 틈은 이어진 것으로 본다.
  const gapLimit = Math.max(6, Math.round(LINE_HEIGHT * 1.5));
  const spans: [number, number][] = [];
  let from = -1;
  let empty = 0;
  for (let x = 0; x <= lineWidth; x++) {
    if (x < lineWidth && extent[x] > 0) {
      if (from < 0) from = x;
      empty = 0;
    } else if (from >= 0 && ++empty > gapLimit) {
      spans.push([from, x - empty]);
      from = -1;
    }
  }
  if (from >= 0) spans.push([from, lineWidth - 1]);
  if (!spans.length) return null;

  const heightOf = ([a, b]: [number, number]) => {
    const list: number[] = [];
    for (let x = a; x <= b; x++) if (extent[x] > 0) list.push(extent[x]);
    list.sort((p, q) => p - q);
    return list[Math.floor(list.length * 0.7)] ?? 0;
  };
  const tallest = Math.max(...spans.map(heightOf));
  const kept = spans.filter((span) => heightOf(span) >= tallest * TITLE_HEIGHT_RATIO);
  if (!kept.length) return null;

  const scale = canvas.width / lineWidth;
  const left = Math.max(0, Math.round(kept[0][0] * scale) - 6);
  const right = Math.min(canvas.width - 1, Math.round(kept[kept.length - 1][1] * scale) + 6);
  if (right - left < canvas.height) return null;

  const out = document.createElement("canvas");
  out.width = right - left + 1;
  out.height = canvas.height;
  out.getContext("2d")?.drawImage(canvas, left, 0, out.width, canvas.height, 0, 0, out.width, canvas.height);
  return out;
}

/** 글자 띠 하나를 읽는다. 제목 구간을 먼저 추려 낸 뒤 인식한다. */
export async function readLine(canvas: HTMLCanvasElement): Promise<SpineText> {
  await loadModels();
  if (!rec) return { text: "", confidence: 0 };

  const trimmed = (await titleSpan(canvas)) ?? canvas;
  const output = await rec.run({ [rec.inputNames[0]]: toLineTensor(trimmed) });
  const tensor = output[rec.outputNames[0]];
  const [, steps, classes] = tensor.dims as number[];
  const read = decode(tensor.data as Float32Array, steps, classes);

  if (trimmed !== canvas) {
    trimmed.width = 0;
    trimmed.height = 0;
  }
  return read;
}
