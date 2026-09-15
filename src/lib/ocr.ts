import { PSM, createWorker, type Worker } from "tesseract.js";
import { segmentSpines, wholeImageVariants, type SegmentOptions, type SpineVariant } from "./segment";

/** 책등 한 권을 읽은 결과 */
export interface SpineReading {
  x0: number;
  x1: number;
  /** 점수가 높은 쪽 읽기 */
  text: string;
  /** 점수가 낮았던 다른 읽기들. 방향을 잘못 골랐을 때 사용자가 바꿔 끼울 수 있다. */
  alternatives: string[];
  /** 다듬기 전 OCR 원문 */
  raw: string;
  /** 0~1 */
  confidence: number;
  /** 책등 대표 색 (#rrggbb) */
  color: string;
  /** 사진 가로 대비 책등 두께 비율 */
  widthRatio: number;
}

export interface ScanProgress {
  phase: string;
  done: number;
  total: number;
}

export interface ReadShelfOptions {
  /** "kor+eng" 또는 "eng" */
  langs: string;
  /**
   * 세로로 쌓인 한글을 언제 읽을지.
   * auto: 돌려 읽은 결과가 시원찮을 때만 (기본), always: 항상, off: 읽지 않음
   */
  verticalMode?: "auto" | "always" | "off";
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
  /** 책등 분할 설정 (기본값으로 충분하다. 벤치에서 값을 바꿔 볼 때 쓴다.) */
  segment?: SegmentOptions;
}

export interface ShelfResult {
  readings: SpineReading[];
  tiltDeg: number;
  /** 책등 분할에 실패해 사진 전체를 읽었는지 */
  usedFallback: boolean;
}

/** 세로로 쌓인 한글을 읽는 모델. 가로용 kor 모델로는 거의 못 읽는다. */
const VERTICAL_LANG = "kor_vert";
/**
 * 돌려 세운 두 방향이 이 점수에 못 미치면 세로로 쌓인 글자를 의심하고 한 번 더 읽는다.
 * 항상 읽으면 영문 책장에서 시간만 50% 더 든다.
 */
const VERTICAL_RETRY_SCORE = 70;
/** 제목 앞뒤의 짧은 조각을 군더더기로 볼 신뢰도 기준 */
const EDGE_NOISE_CONFIDENCE = 55;
/** 점수를 낼 때 한글 음절 하나를 라틴 글자 몇 개로 칠지 */
const HANGUL_WEIGHT = 1.6;
/**
 * 언어 데이터를 받는 데 이만큼 걸리면 실패로 본다.
 * tesseract.js 는 내려받기가 막혀도 예외를 던지지 않고 그대로 멈춰 있어서,
 * 이 시간을 두지 않으면 화면이 "읽는 중"에서 영원히 돌아간다.
 */
const MODEL_TIMEOUT_MS = 90_000;

let cached: { langs: string; worker: Worker } | null = null;
let cachedVertical: Worker | null = null;

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

  const worker = await spawn(langs, PSM.SINGLE_BLOCK, onProgress);
  cached = { langs, worker };
  return worker;
}

/** 세로로 쌓인 한글 전용 워커. 한국어를 켰을 때만 만든다. */
async function getVerticalWorker(onProgress?: (p: ScanProgress) => void): Promise<Worker | null> {
  if (cachedVertical) return cachedVertical;
  try {
    cachedVertical = await spawn(VERTICAL_LANG, PSM.SINGLE_BLOCK_VERT_TEXT, onProgress);
    return cachedVertical;
  } catch {
    // 세로 모델을 못 받아도 가로 인식만으로 동작해야 한다.
    return null;
  }
}

/** 정해진 시간 안에 끝나지 않으면 실패로 처리한다. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function spawn(
  langs: string,
  psm: PSM,
  onProgress?: (p: ScanProgress) => void,
): Promise<Worker> {
  const creating = createWorker(langs, 1, {
    // 워커와 wasm 코어는 앱과 함께 배포한다 (scripts/copy-tesseract-assets.mjs).
    // CDN에 의존하면 오프라인에서 못 쓰고, 경로가 어긋나면 통째로 실패한다.
    workerPath: `${assetBase()}tesseract/worker.min.js`,
    corePath: `${assetBase()}tesseract/`,
    // 언어 데이터 경로를 넘기지 않으면 tesseract.js 가 언어별 CDN 경로를 알아서 쓴다.
    // (LSTM 전용 모델이라 영어 기준 3MB 남짓. 직접 지정하면 8비트가 아닌 큰 모델을 받게 된다.)
    // npm run fetch:langdata 로 받아 두고 VITE_TESSDATA_PATH=/tessdata 를 주면 완전 오프라인이 된다.
    ...(import.meta.env.VITE_TESSDATA_PATH ? { langPath: import.meta.env.VITE_TESSDATA_PATH } : {}),
    logger: (message: { status?: string; progress?: number }) => {
      if (message.status?.includes("load") || message.status?.includes("initializ")) {
        onProgress?.({ phase: "글자 인식 모델 준비 중", done: message.progress ?? 0, total: 1 });
      }
    },
  });

  const worker = await withTimeout(
    creating,
    MODEL_TIMEOUT_MS,
    "글자 인식 모델을 내려받지 못했습니다. 인터넷 연결을 확인해 주세요. " +
      "(오프라인으로 쓰려면 npm run fetch:langdata 로 받아 두세요)",
  ).catch((error: unknown) => {
    // 늦게라도 워커가 만들어지면 메모리에 남지 않도록 정리한다.
    void creating.then((late) => late.terminate()).catch(() => {});
    throw error;
  });

  await worker.setParameters({ tessedit_pageseg_mode: psm });
  return worker;
}

/** 이 언어의 모델을 이미 받아 뒀는지. 처음 실행인지 알려 줄 때 쓴다. */
export function hasOcrModel(langs: string): boolean {
  return cached?.langs === langs;
}

export async function releaseOcr(): Promise<void> {
  await cached?.worker.terminate();
  await cachedVertical?.terminate();
  cached = null;
  cachedVertical = null;
}

/** 책장 사진 한 장에서 책등을 찾아 한 권씩 읽는다. */
export async function readShelf(
  image: HTMLCanvasElement,
  { langs, onProgress, signal, verticalMode = "auto", segment }: ReadShelfOptions,
): Promise<ShelfResult> {
  const worker = await getWorker(langs, onProgress);
  onProgress?.({ phase: "책등 찾는 중", done: 0, total: 1 });

  const { bands, tiltDeg } = segmentSpines(image, segment);
  const usedFallback = bands.length < 2;

  if (usedFallback) {
    // 책등을 못 나눴다. 사진 전체를 세 방향으로 읽어 줄 단위로 건진다.
    const readings = await readWholeImage(worker, image, onProgress, signal);
    return { readings, tiltDeg, usedFallback: true };
  }

  // 한국어를 켰으면 세로로 쌓인 글자도 읽을 준비를 한다.
  const wantsVertical = langs.includes("kor") && verticalMode !== "off";
  if (!wantsVertical && cachedVertical) {
    // 영어로 바꿨으면 세로 모델은 메모리에서 내린다.
    await cachedVertical.terminate();
    cachedVertical = null;
  }
  const verticalWorker = wantsVertical ? await getVerticalWorker(onProgress) : null;

  // 책장 양 끝의 배경 조각이나 책 사이 그림자는 밴드로 잡히지만 책이 아니다.
  // 글자를 하나도 못 읽은 밴드는 두께로 가른다. 책이라면 다른 책과 두께가 비슷하다.
  const widths = bands.map((band) => band.x1 - band.x0).sort((a, b) => a - b);
  const medianWidth = widths[Math.floor(widths.length / 2)] ?? 0;
  const minBookWidth = medianWidth * 0.5;

  const readings: SpineReading[] = [];
  for (const [index, band] of bands.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ phase: "책등 읽는 중", done: index, total: bands.length });

    const candidates = await Promise.all(band.variants.map((variant) => readVariant(worker, variant)));
    candidates.sort((a, b) => b.score - a.score);

    // 돌려 읽은 결과가 시원찮으면 세로로 쌓인 한글일 수 있다. 그런 책등만 한 번 더 읽는다.
    const weak = (candidates[0]?.score ?? 0) < VERTICAL_RETRY_SCORE;
    if (verticalWorker && (verticalMode === "always" || weak)) {
      candidates.push(await readVariant(verticalWorker, band.upright, true));
      candidates.sort((a, b) => b.score - a.score);
    }

    const best = candidates[0];
    if (!best) continue;
    // 제목을 못 읽었어도 두께가 책만 하면 자리를 남긴다.
    // 실제 권수와 순서가 맞아야 나중에 손으로 고칠 수 있다.
    if (!best.text && band.x1 - band.x0 < minBookWidth) continue;
    readings.push({
      x0: band.x0,
      x1: band.x1,
      color: band.color,
      widthRatio: band.widthRatio,
      text: best.text,
      raw: best.raw,
      alternatives: candidates
        .slice(1)
        .map((candidate) => candidate.text)
        .filter((text, index, list) => text && text !== best.text && list.indexOf(text) === index),
      confidence: Math.min(1, best.score / 100),
    });
  }

  onProgress?.({ phase: "책등 읽는 중", done: bands.length, total: bands.length });
  return { readings, tiltDeg, usedFallback: false };
}

interface Candidate {
  text: string;
  /** 다듬기 전 OCR 원문 */
  raw: string;
  score: number;
}

/**
 * @param stacked 세로로 쌓인 글자를 읽은 것인지.
 *   쌓인 글자에는 띄어쓰기가 없다. 모델이 음절 사이에 넣은 공백은 전부 군더더기다.
 */
async function readVariant(
  worker: Worker,
  variant: SpineVariant,
  stacked = false,
): Promise<Candidate> {
  const { data } = await worker.recognize(variant.canvas, {}, { blocks: true, text: true });
  const words = collectWords(data.blocks);
  const raw = (data.text ?? "").replace(/\s+/g, " ").trim();
  const trimmed = trimEdgeNoise(words) || raw;
  const text = cleanText(stacked ? trimmed.replace(/\s+/g, "") : trimmed);
  return { text, raw, score: scoreWords(words) };
}

/**
 * 제목 앞뒤에 붙은 짧은 오독을 떼어낸다.
 * 옆 책 그림자나 책등 끝의 무늬가 "UN", "55덱" 같은 조각으로 읽히는 일이 잦다.
 * 가운데 글자는 건드리지 않는다. 확신이 낮아도 제목의 일부일 수 있다.
 */
function trimEdgeNoise(words: LooseWord[]): string {
  const isNoise = (word: LooseWord | undefined) => {
    if (!word) return false;
    const text = (word.text ?? "").trim();
    const letters = (text.match(/[A-Za-z가-힣0-9]/g) ?? []).length;
    return letters > 0 && letters <= 3 && (word.confidence ?? 0) < EDGE_NOISE_CONFIDENCE;
  };

  let start = 0;
  let end = words.length;
  while (start < end && isNoise(words[start])) start++;
  while (end > start && isNoise(words[end - 1])) end--;

  const kept = words.slice(start, end).map((word) => (word.text ?? "").trim());
  return kept.join(" ").replace(/\s+/g, " ").trim();
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
      readings.push({
        x0: 0,
        x1: 0,
        color: "#6b6257",
        widthRatio: 0,
        text,
        raw: line.text.replace(/\s+/g, " ").trim(),
        alternatives: [],
        confidence: Math.min(1, score / 100),
      });
    }
  }

  onProgress?.({ phase: "사진 전체를 읽는 중", done: variants.length, total: variants.length });
  return dedupe(readings);
}

/**
 * 글자 수를 센다. 한글 음절은 자모 두세 개가 모인 글자라 라틴 한 글자보다 정보가 많다.
 * 같은 무게로 세면 "코스모스"(4)가 길기만 한 영문 오독보다 늘 낮게 나온다.
 */
function countLetters(text: string): number {
  const hangul = (text.match(/[가-힣]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return latin + hangul * HANGUL_WEIGHT;
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
    const letterCount = countLetters(text);
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

  const text = joinHangulSyllables(dropForeignTokens(tokens)).trim();
  const letters = (text.match(/[A-Za-z가-힣]/g) ?? []).length;
  return letters >= 2 ? text : "";
}

/**
 * 한글 제목에는 옆 책 글자가 라틴 문자 쪼가리로 섞여 들어온다
 * ("죄와 벌 xix S klclo"). 한글이 대부분인 읽기에서는 한글 없는 토막을 버린다.
 */
function dropForeignTokens(tokens: string[]): string[] {
  const hangul = tokens.join("").match(/[가-힣]/g)?.length ?? 0;
  const latin = tokens.join("").match(/[A-Za-z]/g)?.length ?? 0;
  if (hangul < 2 || hangul < latin) return tokens;

  const kept = tokens.filter((token) => /[가-힣]/.test(token));
  return kept.length > 0 ? kept : tokens;
}

/**
 * 세로로 쌓인 글자를 읽으면 음절마다 떨어져 나올 때가 있다 ("코 스 모 스").
 * 전부 한 글자짜리 한글이면 붙여 준다. 진짜 띄어쓰기가 있는 제목은 건드리지 않는다.
 */
function joinHangulSyllables(tokens: string[]): string {
  const allSingleHangul = tokens.length >= 3 && tokens.every((token) => /^[가-힣]$/.test(token));
  return allSingleHangul ? tokens.join("") : tokens.join(" ");
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
