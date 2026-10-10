import {
  releaseVariants,
  segmentSpines,
  singleSpine,
  type SegmentOptions,
  type SpineBand,
  type SpineVariant,
} from "./segment";
import { findTextLines, groupLines, withTextlessBooks, type GroupOptions, type LineOptions, type TextLine } from "./lines";
import { yieldToPaint } from "./yield";
import { detectText, hasModels, loadModels, readLine, releaseModels, watchModels } from "./ppocr";

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
  /**
   * 어느 구간인지. 화면이 진행률을 어떻게 그릴지 여기서 갈린다.
   *  - model: 인식 모델 내려받기. 바이트로 재므로 퍼센트를 보여 준다.
   *  - spine: 책등 찾기. 순간이라 셀 것이 없다.
   *  - read: 한 권씩 읽기. 남은 권수로 남은 시간을 어림잡는다.
   */
  kind: "model" | "spine" | "read";
  phase: string;
  done: number;
  total: number;
}

export interface ReadShelfOptions {
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
  /** 책등 분할 설정 (기본값으로 충분하다. 벤치에서 값을 바꿔 볼 때 쓴다.) */
  segment?: SegmentOptions;
  /**
   * 무엇으로 책을 가를지.
   *  - lines: 검출 모델이 찾은 글자 줄마다 그 기울기대로 잘라 읽는다 (기본)
   *  - bands: 색·명암으로 책등 경계를 찾아 밴드마다 읽는다 (예전 방식, 비교용)
   */
  engine?: "lines" | "bands";
  /** 글자 줄 찾기 설정 (벤치용) */
  lines?: LineOptions & GroupOptions & { detectSide?: number; trim?: boolean };
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
  { onProgress, signal, segment, engine = "lines", lines: lineOptions }: ReadShelfOptions,
): Promise<ShelfResult> {
  // 앱 진입 때 이미 받기 시작했으면 그 진행률이 그대로 흘러든다 (src/lib/warmup.ts).
  const unwatch = watchModels((progress) =>
    onProgress?.({
      kind: "model",
      phase: "글자 인식 준비 중",
      done: progress.opening ? progress.total : progress.loaded,
      total: progress.total,
    }),
  );
  try {
    await loadModels();
  } finally {
    unwatch();
  }
  onProgress?.({ kind: "spine", phase: "책등 찾는 중", done: 0, total: 1 });
  await yieldToPaint();
  if (signal?.aborted) return { readings: [], tiltDeg: 0, usedFallback: false };

  const { bands, tiltDeg } = segmentSpines(image, segment);

  if (engine === "lines") {
    onProgress?.({ kind: "spine", phase: "사진에서 글자 찾는 중", done: 0, total: 1 });
    await yieldToPaint();
    if (signal?.aborted) return { readings: [], tiltDeg, usedFallback: false };
    const map = await detectText(image, lineOptions?.detectSide ?? DETECT_SIDE);
    await yieldToPaint();
    if (signal?.aborted) return { readings: [], tiltDeg, usedFallback: false };
    const found = findTextLines(image, map, lineOptions);
    if (found.length >= 2) {
      const readings = await readLines(image, found, bands, onProgress, signal, lineOptions);
      return { readings, tiltDeg, usedFallback: false };
    }
  }

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
    onProgress?.({ kind: "read", phase: "책등 읽는 중", done: index, total: bands.length });
    await yieldToPaint();
    if (signal?.aborted) break;

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

  onProgress?.({ kind: "read", phase: "책등 읽는 중", done: bands.length, total: bands.length });
  return { readings, tiltDeg, usedFallback: false };
}

/**
 * 글자 줄 검출에 쓸 사진 크기(긴 변).
 * 1600 에서는 얇은 책등의 작은 글자가 지도에서 끊겼다. 원본 크기에 가깝게 둔다.
 */
const DETECT_SIDE = 2560;

/** 선반 높이 가운데 이 구간이 제목 구역이다 (위에서, 아래에서 뺄 비율) */
const TITLE_ZONE_TOP = 0.22;
const TITLE_ZONE_BOTTOM = 0.15;

/**
 * 저자 줄에 들어가는 말. 제목을 고를 때 이 줄은 뒤로 뺀다.
 * "씀"은 띄어 쓴 것만 본다. 붙여 두면 "알쏭달쏭"을 "알씀달"로 잘못 읽은 제목이 걸린다.
 */
const CREDIT = /(그림|옮김|지음|엮음|글\s*[·・.]|\s씀(\s|$))/;

/**
 * 저자 줄인지. 저자 줄은 이름이나 "글·그림"으로 시작하므로 저자 표시가 앞쪽에 온다.
 * 제목과 저자가 한 세로줄에 이어져 한 줄로 읽히면("100층짜리 집 글·그림 이와이 도시오")
 * 표시가 뒤쪽에 온다. 이것까지 저자 줄로 깎으면 세 글자 로고("북뱅크")가 제목이 됐다.
 */
function isCreditLine(text: string): boolean {
  const match = CREDIT.exec(text);
  if (!match) return false;
  const lettersBefore = (text.slice(0, match.index).match(/[A-Za-z0-9가-힣]/g) ?? []).length;
  return lettersBefore < 8;
}

/**
 * 글자 줄마다 읽고, 같은 책의 조각은 한 권으로 묶는다.
 *
 * 한 책등의 제목과 저자가 한 세로줄에 이어져 있으면 검출이 둘로 나눠 준다.
 * 선반 가운데 높이의 x 가 거의 같으면 같은 책이다. 그중 글자가 가장 굵은 줄이 제목이다.
 */
async function readLines(
  image: HTMLCanvasElement,
  lines: TextLine[],
  bands: SpineBand[],
  onProgress: ((progress: ScanProgress) => void) | undefined,
  signal: AbortSignal | undefined,
  groupOptions: GroupOptions & { trim?: boolean } = {},
): Promise<SpineReading[]> {
  const trim = groupOptions.trim ?? true;
  const read: { line: TextLine; best: Candidate; candidates: Candidate[] }[] = [];
  const votes: number[] = [];
  let settled: number | null = null;
  const wanted: Shot[] = [90, -90].map((deg) => ({ deg, invert: false }));

  for (const [index, line] of lines.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ kind: "read", phase: "책등 읽는 중", done: index, total: lines.length });
    await yieldToPaint();
    if (signal?.aborted) break;
    const first = settled !== null ? wanted.filter((shot) => shot.deg === settled) : wanted;
    let candidates = await readShots(line, first, trim);
    if ((candidates[0]?.score ?? 0) < WEAK_SCORE && first.length < wanted.length) {
      candidates = [...candidates, ...(await readShots(line, wanted.filter((shot) => shot.deg !== settled), trim))];
      candidates.sort((a, b) => b.score - a.score);
    }
    // 세로로 쌓은 글자일 수 있다. 음절을 세워 늘어놓은 것도 읽어 점수로 고른다.
    // 한 칸에 돌려 쓴 책과 쌓아 쓴 책이 섞여 있어 방향처럼 정해 둘 수 없다.
    const restacked = line.stacked();
    if (restacked) {
      let stackedRead: Candidate;
      try {
        stackedRead = { ...(await readVariant(restacked, trim)), deg: 0 };
      } finally {
        releaseVariants([restacked]);
      }
      // 돌려 쓴 글자에도 재배열은 돈다. 인식기가 누운 음절도 하나씩은 잘 읽어서
      // "어린왕자"를 "자왕린어"처럼 순서만 뒤집힌 채 100%로 읽는다.
      // 돌려 읽은 후보와 같은 글자들이면 돌려 쓴 글자다. 재배열 쪽을 버린다.
      if (!candidates.some((candidate) => sameLetters(candidate.text, stackedRead.text))) {
        candidates.push(stackedRead);
      }
    }
    candidates.sort((a, b) => rank(b) - rank(a));
    const best = candidates[0];
    if (!best) continue;
    if (best.score >= WEAK_SCORE && best.deg !== 0) votes.push(best.deg);
    if (settled === null && votes.length >= DIRECTION_PROBE) settled = majority(votes);
    read.push({ line, best, candidates });
  }
  onProgress?.({ kind: "read", phase: "책등 읽는 중", done: lines.length, total: lines.length });
  await yieldToPaint();

  // 한 권으로 묶기. 두 줄 사이에 책등 경계가 없으면 같은 책이다 (lines.ts).
  const byLine = new Map(read.map((item) => [item.line, item]));

  // 제목은 책등 가운데쯤에 있고, 시리즈·출판사 라벨은 위아래 끝에 있다. 선반 높이에서
  // 제목 구역을 정하고, 그 구역에 걸친 줄만 제목 후보로 본다. 위아래 끝 줄만 있는 묶음은
  // 이웃 책에서 떨어져 나온 라벨이라 책으로 세지 않는다.
  const tops = lines.map((line) => line.top).sort((p, q) => p - q);
  const bottoms = lines.map((line) => line.bottom).sort((p, q) => p - q);
  const shelfTop = tops[Math.floor(tops.length * 0.1)] ?? 0;
  const shelfBottom = bottoms[Math.floor(bottoms.length * 0.9)] ?? image.height;
  const zoneTop = shelfTop + (shelfBottom - shelfTop) * TITLE_ZONE_TOP;
  const zoneBottom = shelfBottom - (shelfBottom - shelfTop) * TITLE_ZONE_BOTTOM;
  const inTitleZone = (line: TextLine) => line.bottom > zoneTop && line.top < zoneBottom;

  const lineGroups = groupLines(image, lines, groupOptions).filter((group) => group.some(inTitleZone));
  // 글자가 안 보이는 책도 자리를 지킨다. 빠뜨리면 그 뒤 책이 한 칸씩 당겨진다.
  const slots = withTextlessBooks(image, lineGroups, groupOptions);
  const groups = slots.map((slot) =>
    slot.kind === "blank"
      ? slot
      : slot.lines.map((line) => byLine.get(line)).filter((item) => item !== undefined),
  );
  const textGroups = groups.filter((group): group is (typeof read)[number][] => Array.isArray(group));

  // 여러 책등에 되풀이되는 글자는 시리즈 이름이다 ("이야기 솜사탕", "안녕 마음아",
  // "드림차일드애플"). 굵고 또렷하게 찍혀 있어 굵기로 고르면 제목을 이긴다.
  const repeated = new Set<(typeof read)[number]>();
  textGroups.forEach((group, index) => {
    for (const item of group) {
      const others = textGroups.filter(
        (other, k) => k !== index && other.some((o) => similar(o.best.text, item.best.text)),
      );
      if (others.length > 0) repeated.add(item);
    }
  });

  const readings: SpineReading[] = [];
  const blankReading = (x: number, half: number): SpineReading => {
    const band = bands.find((b) => b.x0 <= x && x < b.x1) ?? nearestBand(bands, x);
    return {
      x0: Math.round(x - half),
      x1: Math.round(x + half),
      color: band?.color ?? "#8a7a60",
      widthRatio: (half * 2) / image.width,
      text: "",
      raw: "",
      alternatives: [],
      confidence: 0,
    };
  };
  for (const group of groups) {
    if (!Array.isArray(group)) {
      readings.push(blankReading(group.x, group.width / 2));
      continue;
    }
    // 제목 후보는 제목 구역에 걸친 줄뿐이다. 위아래 끝 라벨은 제목이 될 수 없다.
    const withText = group.filter((item) => item.best.text && inTitleZone(item.line));
    if (!withText.length) {
      // 제목 줄이 있는데 못 읽었다. 라벨로 채우지 말고 비워 둔다. 사용자가 적는다.
      const x = group.reduce((sum, item) => sum + item.line.shelfX, 0) / group.length;
      const blank = blankReading(x, Math.max(...group.map((item) => item.line.thickness)));
      blank.alternatives = group.map((item) => item.best.text).filter(Boolean);
      readings.push(blank);
      continue;
    }
    // 제목은 가장 굵은 글자다. 다만 책등 아래 출판사 로고("WON", "북뱅크")도 굵다.
    // 로고는 두세 자뿐이라 짧은 줄만 깎는다. 길이를 더 크게 치면 이번에는 길고 또렷한
    // 저자 줄("글·그림 … 옮김 …")이 제목을 이겼다.
    //
    // 저자 줄은 내용으로 가려진다. 한국 책등의 저자 줄에는 거의 늘 "그림·옮김·지음·씀"이
    // 들어간다. 쌓아 쓴 제목은 줄이 가늘게 잡혀, 굵기만 보면 옆의 저자 줄에 졌다
    // ("영리한 거미 아난시" 대신 "바바라 칸티니 그림 … 서보현 옮김").
    const titleness = (item: (typeof withText)[number]) => {
      const letters = (item.best.text.match(/[A-Za-z0-9가-힣]/g) ?? []).length;
      const credit = isCreditLine(item.best.text) ? 0.3 : 1;
      const series = repeated.has(item) ? 0.3 : 1;
      return item.line.thickness * (0.5 + item.best.score / 100) * (letters <= 3 ? 0.6 : 1) * credit * series;
    };
    const main = [...withText].sort((a, b) => titleness(b) - titleness(a))[0];
    const x = main.line.shelfX;
    const band = bands.find((b) => b.x0 <= x && x < b.x1) ?? nearestBand(bands, x);
    const half = Math.max(...group.map((item) => item.line.thickness));
    readings.push({
      x0: Math.round(x - half),
      x1: Math.round(x + half),
      color: band?.color ?? "#8a7a60",
      widthRatio: band?.widthRatio ?? 0.02,
      text: main.best.text,
      raw: main.best.raw,
      alternatives: [
        ...main.candidates.slice(1).map((c) => c.text),
        ...withText.filter((item) => item !== main).map((item) => item.best.text),
      ].filter((text, index, list) => text && text !== main.best.text && list.indexOf(text) === index),
      confidence: Math.min(1, main.best.score / 100),
    });
  }
  return readings;
}

function nearestBand(bands: SpineBand[], x: number): SpineBand | undefined {
  let best: SpineBand | undefined;
  let distance = Infinity;
  for (const band of bands) {
    const d = Math.abs((band.x0 + band.x1) / 2 - x);
    if (d < distance) {
      distance = d;
      best = band;
    }
  }
  return best;
}

/**
 * 같은 줄을 여러 방식으로 읽은 것 중 무엇을 믿을지.
 *
 * 평균 확신도만 보면 짧게 읽은 쪽이 이긴다. "애애앵 모기다"를 쌓은 글자 그대로 6자를
 * 90%로 읽어도, 돌려 읽어 뒤 3자만 95%로 건진 "모기다"가 뽑혔다. 그래서 읽은 글자 수를
 * 함께 본다. 확신도는 세제곱해 둬야 확신 낮은 긴 쓰레기가 이기지 못한다.
 */
function rank(candidate: Candidate): number {
  const letters = (candidate.text.match(/[A-Za-z0-9가-힣]/g) ?? []).length;
  return (candidate.score / 100) ** 3 * Math.log(1 + letters);
}

/** 글자가 얼마나 닮았는지로 같은 줄인지 본다. OCR 이 한두 글자 틀려도 같다고 친다. */
function similar(a: string, b: string): boolean {
  const x = a.match(/[A-Za-z0-9가-힣]/g) ?? [];
  const y = b.match(/[A-Za-z0-9가-힣]/g) ?? [];
  if (x.length < 3 || y.length < 3) return false;
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (x[i - 1] === y[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - row[y.length] / Math.max(x.length, y.length) >= 0.6;
}

/** 같은 글자들인데 순서만 다른지. 순서까지 같으면 둘 다 맞게 읽은 것이다. */
function sameLetters(a: string, b: string): boolean {
  const letters = (text: string) => text.match(/[A-Za-z0-9가-힣]/g) ?? [];
  const left = letters(a);
  const right = letters(b);
  if (left.length < 2 || left.join("") === right.join("")) return false;
  return [...left].sort().join("") === [...right].sort().join("");
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
async function readShots(band: Pick<SpineBand, "crop">, shots: Shot[], trim = true): Promise<Candidate[]> {
  const results: Candidate[] = [];
  for (const { deg, invert } of shots) {
    const variant = band.crop(deg, invert);
    try {
      results.push(await readVariant(variant, trim));
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

async function readVariant(variant: SpineVariant, trim = true): Promise<Candidate> {
  const read = await readLine(variant.canvas, { trim });
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
    onProgress?.({ kind: "read", phase: "사진 전체를 읽는 중", done: index, total: 3 });
    await yieldToPaint();
    if (signal?.aborted) break;
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

  onProgress?.({ kind: "read", phase: "사진 전체를 읽는 중", done: 3, total: 3 });
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
