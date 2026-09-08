import { PSM, createWorker, type Worker } from "tesseract.js";
import { segmentSpines, wholeImageVariants, type SpineVariant } from "./segment";

/** 책등 한 권을 읽은 결과 */
export interface SpineReading {
  x0: number;
  x1: number;
  /** 점수가 높은 쪽 읽기 */
  text: string;
  /** 반대 방향으로 읽은 결과. 책등 글자 방향을 잘못 골랐을 때 사용자가 뒤집을 수 있다. */
  alternative: string;
  /** 0~1 */
  confidence: number;
}

export interface ScanProgress {
  phase: string;
  done: number;
  total: number;
}

export interface ReadShelfOptions {
  /** "kor+eng" 또는 "eng" */
  langs: string;
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
}

export interface ShelfResult {
  readings: SpineReading[];
  tiltDeg: number;
  /** 책등 분할에 실패해 사진 전체를 읽었는지 */
  usedFallback: boolean;
}

let cached: { langs: string; worker: Worker } | null = null;

/** 하위 경로에 배포해도 자산을 찾을 수 있게 base를 붙인다. */
function assetBase(): string {
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base : `${base}/`;
}

/** 언어 데이터는 처음 한 번만 내려받는다. 워커는 다음 촬영에서 다시 쓴다. */
async function getWorker(langs: string, onProgress?: (p: ScanProgress) => void): Promise<Worker> {
  if (cached?.langs === langs) return cached.worker;
  await cached?.worker.terminate();
  cached = null;

  const worker = await createWorker(langs, 1, {
    // 워커와 wasm 코어는 앱과 함께 배포한다 (scripts/copy-tesseract-assets.mjs).
    // CDN에 의존하면 오프라인에서 못 쓰고, 경로가 어긋나면 통째로 실패한다.
    workerPath: `${assetBase()}tesseract/worker.min.js`,
    corePath: `${assetBase()}tesseract/`,
    // 언어 데이터는 기본적으로 공개 CDN에서 받는다.
    // npm run fetch:langdata 로 받아 두고 VITE_TESSDATA_PATH=/tessdata 를 주면 완전 오프라인이 된다.
    langPath: import.meta.env.VITE_TESSDATA_PATH || "https://tessdata.projectnaptha.com/4.0.0",
    logger: (message: { status?: string; progress?: number }) => {
      if (message.status?.includes("load") || message.status?.includes("initializ")) {
        onProgress?.({ phase: "글자 인식 모델 준비 중", done: message.progress ?? 0, total: 1 });
      }
    },
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  cached = { langs, worker };
  return worker;
}

export async function releaseOcr(): Promise<void> {
  await cached?.worker.terminate();
  cached = null;
}

/** 책장 사진 한 장에서 책등을 찾아 한 권씩 읽는다. */
export async function readShelf(
  image: HTMLCanvasElement,
  { langs, onProgress, signal }: ReadShelfOptions,
): Promise<ShelfResult> {
  const worker = await getWorker(langs, onProgress);
  onProgress?.({ phase: "책등 찾는 중", done: 0, total: 1 });

  const { bands, tiltDeg } = segmentSpines(image);
  const usedFallback = bands.length < 2;

  if (usedFallback) {
    // 책등을 못 나눴다. 사진 전체를 세 방향으로 읽어 줄 단위로 건진다.
    const readings = await readWholeImage(worker, image, onProgress, signal);
    return { readings, tiltDeg, usedFallback: true };
  }

  const readings: SpineReading[] = [];
  for (const [index, band] of bands.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ phase: "책등 읽는 중", done: index, total: bands.length });

    const candidates = await Promise.all(band.variants.map((variant) => readVariant(worker, variant)));
    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best || !best.text) continue;
    readings.push({
      x0: band.x0,
      x1: band.x1,
      text: best.text,
      alternative: candidates[1]?.text ?? "",
      confidence: Math.min(1, best.score / 100),
    });
  }

  onProgress?.({ phase: "책등 읽는 중", done: bands.length, total: bands.length });
  return { readings, tiltDeg, usedFallback: false };
}

interface Candidate {
  text: string;
  score: number;
}

async function readVariant(worker: Worker, variant: SpineVariant): Promise<Candidate> {
  const { data } = await worker.recognize(variant.canvas, {}, { blocks: true, text: true });
  const words = collectWords(data.blocks);
  return { text: cleanText(data.text ?? ""), score: scoreWords(words) };
}

/** 분할 실패 시: 사진 전체를 0/90/-90도로 읽고 줄마다 후보를 만든다. */
async function readWholeImage(
  worker: Worker,
  image: HTMLCanvasElement,
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<SpineReading[]> {
  const variants = wholeImageVariants(image);
  const readings: SpineReading[] = [];

  for (const [index, variant] of variants.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ phase: "사진 전체를 읽는 중", done: index, total: variants.length });

    const { data } = await worker.recognize(variant.canvas, {}, { blocks: true, text: true });
    for (const line of collectLines(data.blocks)) {
      const text = cleanText(line.text);
      if (!text) continue;
      const score = scoreWords(line.words ?? []);
      if (score < 40) continue;
      readings.push({ x0: 0, x1: 0, text, alternative: "", confidence: Math.min(1, score / 100) });
    }
  }

  onProgress?.({ phase: "사진 전체를 읽는 중", done: variants.length, total: variants.length });
  return dedupe(readings);
}

type LooseWord = { text?: string; confidence?: number };
type LooseLine = { text?: string; words?: LooseWord[] };
type LooseBlock = { paragraphs?: { lines?: LooseLine[] }[] };

function collectLines(blocks: unknown): { text: string; words: LooseWord[] }[] {
  const list = (blocks as LooseBlock[] | null | undefined) ?? [];
  return list.flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) =>
      (paragraph.lines ?? []).map((line) => ({ text: line.text ?? "", words: line.words ?? [] })),
    ),
  );
}

function collectWords(blocks: unknown): LooseWord[] {
  return collectLines(blocks).flatMap((line) => line.words);
}

/**
 * 어느 방향으로 읽은 것이 맞는지 고르는 점수.
 *
 * 페이지 전체 신뢰도는 거꾸로 읽은 글자에도 높게 나와 못 믿는다.
 * 글자 수로 가중한 단어 신뢰도에, 기호 범벅과 너무 짧은 결과를 깎아 쓴다.
 */
function scoreWords(words: LooseWord[]): number {
  let weight = 0;
  let sum = 0;
  let letters = 0;
  let junk = 0;

  for (const word of words) {
    const text = (word.text ?? "").trim();
    if (!text) continue;
    const letterCount = (text.match(/[A-Za-z가-힣]/g) ?? []).length;
    junk += (text.match(/[^A-Za-z가-힣0-9\s.,'":\-&!?]/g) ?? []).length;
    letters += letterCount;
    if (letterCount < 2) continue;
    weight += letterCount;
    sum += (word.confidence ?? 0) * letterCount;
  }

  if (!weight) return 0;
  const junkPenalty = 1 - Math.min(0.6, junk / Math.max(4, letters + junk));
  const lengthBonus = Math.min(1, letters / 6);
  return (sum / weight) * junkPenalty * lengthBonus;
}

/** OCR 결과에서 군더더기를 걷어낸다. */
export function cleanText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const tokens = collapsed
    .split(" ")
    .map((token) => token.replace(/^[^A-Za-z가-힣0-9(]+|[^A-Za-z가-힣0-9)]+$/g, ""))
    .filter((token) => {
      if (!token) return false;
      const letters = (token.match(/[A-Za-z가-힣0-9]/g) ?? []).length;
      return letters >= 2 || /^[A-Za-z가-힣0-9]$/.test(token);
    });

  const text = tokens.join(" ").trim();
  const letters = (text.match(/[A-Za-z가-힣]/g) ?? []).length;
  return letters >= 2 ? text : "";
}

function dedupe(readings: SpineReading[]): SpineReading[] {
  const seen = new Set<string>();
  return readings.filter((reading) => {
    const key = reading.text.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
