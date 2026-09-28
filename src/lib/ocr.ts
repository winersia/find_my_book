import {
  releaseVariants,
  segmentSpines,
  singleSpine,
  type SegmentOptions,
  type SpineBand,
  type SpineVariant,
} from "./segment";
import { hasModels, loadModels, readLine, releaseModels } from "./ppocr";

/** 책등 한 권을 읽은 결과 */
export interface SpineReading {
  x0: number;
  x1: number;
  /** 점수가 높은 쪽 읽기 */
  text: string;
  /** 점수가 낮았던 다른 읽기들. 방향을 잘못 골랐을 때 사용자가 바꿔 끼울 수 있다. */
  alternatives: string[];
  /** 다듬기 전 인식 원문 */
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

/**
 * 방향을 정하기 전에 세 방향을 다 읽어 볼 책 수.
 *
 * 한 칸에 꽂힌 책은 거의 다 같은 방향으로 제목이 쓰여 있다. 앞의 몇 권으로 방향을
 * 정하면 나머지는 한 번씩만 읽으면 된다.
 */
const DIRECTION_PROBE = 4;
/** 이 점수에 못 미치면 방향을 잘못 골랐다고 보고 나머지 방향도 읽어 본다 */
const WEAK_SCORE = 60;

/** 모델을 이미 받아 뒀는지. 처음 실행인지 알려 줄 때 쓴다. */
export function hasOcrModel(): boolean {
  return hasModels();
}

export async function releaseOcr(): Promise<void> {
  await releaseModels();
}

/** 책장 사진 한 장에서 책등을 찾아 한 권씩 읽는다. */
export async function readShelf(
  image: HTMLCanvasElement,
  { onProgress, signal, segment }: ReadShelfOptions,
): Promise<ShelfResult> {
  await loadModels((ratio) =>
    onProgress?.({ phase: "글자 인식 모델 준비 중", done: ratio, total: 1 }),
  );
  onProgress?.({ phase: "책등 찾는 중", done: 0, total: 1 });

  const { bands, tiltDeg } = segmentSpines(image, segment);
  const usedFallback = bands.length < 2;

  if (usedFallback) {
    // 책등을 못 나눴다. 사진 전체를 한 권으로 보고 읽어 건진다.
    const readings = await readWholeImage(image, onProgress, signal);
    return { readings, tiltDeg, usedFallback: true };
  }

  // 책장 양 끝의 배경 조각이나 책 사이 그림자는 밴드로 잡히지만 책이 아니다.
  // 글자를 하나도 못 읽은 밴드는 두께로 가른다. 책이라면 다른 책과 두께가 비슷하다.
  const widths = bands.map((band) => band.x1 - band.x0).sort((a, b) => a - b);
  const medianWidth = widths[Math.floor(widths.length / 2)] ?? 0;
  const minBookWidth = medianWidth * 0.5;

  const readings: SpineReading[] = [];
  const votes: number[] = [];
  let settled: number | null = null;

  for (const [index, band] of bands.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ phase: "책등 읽는 중", done: index, total: bands.length });

    // 흑백 반전도 같이 읽어 보면 짙은 바탕에 흰 글자인 책등이 살아나지만, 전체로 재 보면
    // 합계가 그대로고 시간만 두 배가 됐다. 그래서 기본으로는 켜지 않는다 (crop API 에는 남아 있다).
    const wanted: Shot[] = [90, -90].map((deg) => ({ deg, invert: false }));
    const first = settled !== null ? wanted.filter((shot) => shot.deg === settled) : wanted;
    let candidates = await readShots(band, first);

    // 정한 방향으로 잘 안 읽히면 거꾸로 꽂힌 책이다. 나머지도 본다.
    if ((candidates[0]?.score ?? 0) < WEAK_SCORE && first.length < wanted.length) {
      const rest = wanted.filter((shot) => shot.deg !== settled);
      candidates = [...candidates, ...(await readShots(band, rest))];
      candidates.sort((a, b) => b.score - a.score);
    }

    const best = candidates[0];
    if (!best) continue;
    if (best.score >= WEAK_SCORE) votes.push(best.deg);
    if (settled === null && votes.length >= DIRECTION_PROBE) settled = majority(votes);

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

/** 읽어 볼 한 가지 방법: 방향 + 흑백 반전 여부 */
interface Shot {
  deg: number;
  invert: boolean;
}

interface Candidate {
  /** 어느 방향으로 읽었는지 (90 은 위→아래, -90 은 아래→위) */
  deg: number;
  text: string;
  /** 다듬기 전 인식 원문 */
  raw: string;
  /** 0~100 */
  score: number;
}

/** 한 책등을 주어진 방법들로 읽는다. 크롭은 읽자마자 버린다. */
async function readShots(band: SpineBand, shots: Shot[]): Promise<Candidate[]> {
  const results: Candidate[] = [];
  for (const { deg, invert } of shots) {
    const variant = band.crop(deg, invert);
    try {
      results.push(await readVariant(variant));
    } finally {
      releaseVariants([variant]);
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

/** 가장 많이 나온 값. 방향 투표에 쓴다. */
function majority(values: number[]): number {
  const tally = new Map<number, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function readVariant(variant: SpineVariant): Promise<Candidate> {
  const read = await readLine(variant.canvas);
  return {
    deg: variant.deg,
    text: cleanText(read.text),
    raw: read.text,
    score: read.confidence * 100,
  };
}

/** 분할 실패 시: 사진 전체를 한 권으로 보고 세 방향으로 읽는다. */
async function readWholeImage(
  image: HTMLCanvasElement,
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<SpineReading[]> {
  const band = singleSpine(image);
  const readings: SpineReading[] = [];

  for (const [index, deg] of [0, 90, -90].entries()) {
    if (signal?.aborted) break;
    onProgress?.({ phase: "사진 전체를 읽는 중", done: index, total: 3 });
    const variant = band.crop(deg);
    try {
      const candidate = await readVariant(variant);
      if (!candidate.text) continue;
      readings.push({
        x0: 0,
        x1: 0,
        color: "#6b6257",
        widthRatio: 0,
        text: candidate.text,
        raw: candidate.raw,
        alternatives: [],
        confidence: Math.min(1, candidate.score / 100),
      });
    } finally {
      releaseVariants([variant]);
    }
  }

  onProgress?.({ phase: "사진 전체를 읽는 중", done: 3, total: 3 });
  return dedupe(readings);
}

/** 인식 결과에서 군더더기를 걷어낸다. */
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

/**
 * 이미 한 권만 잘려 있는 이미지를 읽는다 (bench/spine.mjs 진단용).
 * 세 방향을 모두 읽어 점수 순으로 돌려준다.
 */
export async function readSpineImage(
  image: HTMLCanvasElement,
  segment: SegmentOptions = {},
): Promise<{ deg: number; invert: boolean; text: string; raw: string; score: number }[]> {
  await loadModels();
  const band = singleSpine(image, segment);

  const results: (Candidate & { invert: boolean })[] = [];
  for (const deg of [90, -90, 0]) {
    for (const invert of [false, true]) {
      const variant = band.crop(deg, invert);
      try {
        results.push({ ...(await readVariant(variant)), invert });
      } finally {
        releaseVariants([variant]);
      }
    }
  }
  return results.sort((a, b) => b.score - a.score);
}
