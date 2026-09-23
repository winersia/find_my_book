/**
 * 책장 사진에서 책등을 한 권씩 잘라낸다.
 *
 * 사진 한 장을 통째로 OCR에 넣으면 옆 책 글자가 한 줄로 섞여 읽힌다.
 * 그래서 먼저 세로 경계를 찾아 책등 단위로 자른 뒤 한 권씩 인식한다.
 *
 * 실제 책장 사진은 합성 이미지와 다르다. 얇은 책이 수십 권 빽빽하고,
 * 원근 때문에 왼쪽 책과 오른쪽 책의 기울기가 다르고, 한쪽만 그늘지고,
 * 위아래로 다른 칸이 같이 찍힌다. 그래서 다음 순서로 찾는다.
 *
 *  1. 책이 실제로 꽂힌 행 구간을 먼저 잘라낸다 (천장·아래 칸 제외).
 *  2. 열마다 기울기를 따로 찾아 "가장 긴 연속 세로 에지"를 잰다.
 *  3. 책 사이 그림자와 바탕색 변화를 같이 본다.
 *  4. 국소 대비로 봉우리를 고르고, 대표 두께로 너무 잘거나 넓은 구간을 정리한다.
 */

export interface SpineBand {
  /** 원본 이미지 기준 좌우 경계 */
  x0: number;
  x1: number;
  /** 책등 대표 색 (#rrggbb). 앱 책장에 실제와 닮은 색으로 그리기 위해 뽑는다. */
  color: string;
  /** 사진 가로 대비 이 책등의 두께 비율 */
  widthRatio: number;
  /** 이 구간에 글자·무늬가 얼마나 있는지 (0~1). 배경 조각을 가려낼 때 쓴다. */
  ink: number;
  /**
   * 이 책등을 잘라 세운 캔버스를 만든다.
   * 90/-90 은 돌려 세운 글자(위→아래, 아래→위), 0 은 세로로 쌓은 글자용이다.
   *
   * 부를 때 만든다. 책이 수십 권이면 미리 다 만들어 두는 것만으로 메모리가 바닥난다.
   */
  crop(deg: number): SpineVariant;
}

export interface SpineVariant {
  /** 90, -90 은 돌려 세운 글자, 0 은 세로로 쌓인 글자용 */
  deg: number;
  canvas: HTMLCanvasElement;
}

/** 다 읽은 크롭은 바로 버린다. 캔버스 하나가 수 MB다. */
export function releaseVariants(variants: SpineVariant[]): void {
  for (const variant of variants) {
    variant.canvas.width = 0;
    variant.canvas.height = 0;
  }
}

export interface SegmentOptions {
  /** 경계 분석에 쓸 최대 가로 크기. 얇은 책이 많으면 이 값이 곧 분해능이다. */
  analysisWidth?: number;
  /** 열마다 찾아볼 기울기 범위(도) */
  maxTiltDeg?: number;
  /** 책등 최소 너비 (가로 대비 비율). 대표 두께를 재기 전의 절대 하한이다. */
  minWidthRatio?: number;
  /** 책등 최대 너비 (가로 대비 비율) */
  maxWidthRatio?: number;
  /** 경계로 인정할 국소 대비 (주변 기준선 대비 봉우리 높이, 0~1) */
  relScore?: number;
  /** 밴드 좌우를 이만큼 안쪽으로 깎는다. 옆 책이 비쳐 들어오는 것을 막는다. */
  sideInset?: number;
  /** 크롭한 책등의 목표 너비(px). 글자 크기를 OCR이 좋아하는 범위로 맞춘다. */
  targetSpineWidth?: number;
  /**
   * 책이 차지하는 세로 구간을 찾은 뒤 더 깎을 비율. 음수면 바깥으로 넓힌다.
   * 이 방향이 글자가 흐르는 방향이라 안쪽으로 깎으면 첫 글자와 끝 글자가 잘린다.
   */
  extentMargin?: number;
  /** 최대 밴드 수 */
  maxBands?: number;
  /**
   * 잘라낸 책등을 원본보다 몇 배까지 키울지.
   * 키운다고 글자가 또렷해지지 않는다. 오히려 그림이 커져 OCR의 줄 찾기가 흔들린다.
   */
  maxUpscale?: number;
  /** 잘라낸 책등의 최대 길이(px). 가까이서 찍으면 책등이 사진 세로를 꽉 채운다. */
  maxCropLength?: number;
  /** 경계 점수 프로파일을 함께 돌려준다 (bench/segment.mjs 진단용) */
  debug?: boolean;
}

const DEFAULTS = {
  analysisWidth: 1500,
  maxTiltDeg: 8,
  minWidthRatio: 0.005,
  maxWidthRatio: 0.3,
  relScore: 0.1,
  sideInset: 0.1,
  targetSpineWidth: 150,
  extentMargin: -0.02,
  maxBands: 80,
  maxUpscale: 1.5,
  maxCropLength: 2000,
  debug: false,
} satisfies Required<SegmentOptions>;

export interface SegmentResult {
  bands: SpineBand[];
  /** 진단용 경계 점수 프로파일. opts.debug 를 켰을 때만 채운다. */
  profile?: {
    combined: number[];
    run: number[];
    color: number[];
    shadow: number[];
    scale: number;
    shelf: { top: number; bottom: number };
    typicalWidth: number;
  };
  /** 추정한 사진 기울기(도). 화면에 보여 주면 사용자가 다시 찍을지 판단할 수 있다. */
  tiltDeg: number;
}

export function segmentSpines(source: HTMLCanvasElement, options: SegmentOptions = {}): SegmentResult {
  const opts = { ...DEFAULTS, ...options };

  const analysis = toAnalysisCanvas(source, opts.analysisWidth);
  const { width: aw, height: ah } = analysis;
  const ctx = analysis.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { bands: [], tiltDeg: 0 };

  const pixels = ctx.getImageData(0, 0, aw, ah).data;
  const gray = toGray(pixels, aw * ah);
  const edge = toEdgeMap(pixels, aw, ah);

  // 1. 책이 꽂힌 행 구간. 여기 밖은 전부 경계 찾기를 방해한다.
  const shelf = shelfRows(pixels, edge, aw, ah);

  // 2. 열별 점수 세 가지.
  const slopes = slopeList(opts.maxTiltDeg);
  const { run, slopeAt, slope } = columnRuns(edge, aw, shelf, slopes);
  const ink = columnInk(edge, aw, shelf);
  const columns = bookColumns(ink, aw);
  const medians = columnMedians(pixels, aw, shelf);
  // 그림자는 밝은 쪽 백분위로 잰다. 아래 columnBright 주석 참고.
  const bright = columnBright(pixels, aw, shelf);
  const shadowWindows = [0.006, 0.013, 0.027, 0.055, 0.09].map((r) => Math.max(3, Math.round(aw * r)));

  const radius = Math.max(1, Math.round(aw * 0.0015));
  const runScore = normalize(smooth(run, radius));
  // 색이 바뀌는 자리도 경계다. 밝기가 비슷한 두 책(파랑 옆 초록)은 이쪽으로 잡힌다.
  const colorScore = normalize(smooth(columnColorChange(medians, aw), radius));
  // 빽빽한 책장에서는 책 사이 그림자가 가장 또렷한 단서다.
  const shadowScore = normalize(smooth(columnShadow(bright, aw, shadowWindows), radius));

  const combined = new Float32Array(aw);
  for (let x = 0; x < aw; x++) {
    // 두 책이 맞닿은 자리에는 위에서 아래까지 이어진 세로선이 있다.
    // 책등 음영이 꺾이는 자리나 쌓인 제목의 좌우도 색이 바뀌고 어둡지만, 세로선이 없다.
    // 그래서 세로선이 약한 봉우리는 깎고, 세 신호 중 둘 이상이 맞장구치기를 요구한다.
    const edgeGate = 0.35 + 0.65 * Math.min(1, runScore[x] / EDGE_SUPPORT);
    const support = Math.min(1, Math.max(colorScore[x], shadowScore[x]) / 0.3);
    const raw = 0.45 * runScore[x] + 0.25 * colorScore[x] + 0.3 * shadowScore[x];
    combined[x] = raw * edgeGate * (0.5 + 0.5 * support);
  }

  // 3. 국소 대비. 한쪽만 그늘진 사진에서도 같은 잣대를 쓸 수 있다.
  const baseWindow = Math.max(8, Math.round(aw * 0.04));
  const prominence = localContrast(combined, baseWindow);

  const floor = Math.max(4, Math.round(aw * opts.minWidthRatio));
  // 4. 먼저 또렷한 경계만 세어 대표 두께를 잡고, 그 두께로 다시 고른다.
  const strong = selectPeaks(combined, prominence, aw, floor, opts.relScore * 2.2);
  const typical = typicalWidth(strong, aw, floor);
  const minGap = Math.max(floor, Math.round(typical * 0.42));
  const peaks = selectPeaks(combined, prominence, aw, minGap, opts.relScore).filter(
    (x) => x > columns.from + minGap * 0.5 && x < columns.to - minGap * 0.5,
  );

  const cuts = splitWideSegments(
    [columns.from, ...peaks, columns.to],
    combined,
    prominence,
    minGap,
    opts.relScore * 0.35,
  );
  const scale = source.width / aw;
  const bands: SpineBand[] = [];
  const raw: { x0: number; x1: number; ink: number }[] = [];

  for (let i = 0; i < cuts.length - 1; i++) {
    const x0 = cuts[i];
    const x1 = cuts[i + 1];
    const width = x1 - x0;
    // 대표 두께의 3분의 1도 안 되는 조각은 책이 아니라 그림자나 벽 무늬다.
    if (width < Math.max(floor, typical * 0.35)) continue;
    if (width > aw * opts.maxWidthRatio) continue;
    let total = 0;
    for (let x = x0; x < x1; x++) total += ink[x];
    raw.push({ x0, x1, ink: total / width });
  }

  const merged = mergeTwins(raw, medians, colorScore, aw);

  const kept = dropEdgeBackground(merged);

  for (const band of kept) {
    if (bands.length >= opts.maxBands) break;

    const width = band.x1 - band.x0;
    const inset = Math.min(Math.round(width * opts.sideInset), Math.floor((width - 2) / 2));
    const left = band.x0 + Math.max(0, inset);
    const right = band.x1 - Math.max(0, inset);
    const extent = rowExtent(gray, aw, left, right, shelf, opts.extentMargin);
    const color = bandColor(pixels, aw, left, right, extent.top, extent.bottom);
    // 이 책이 기운 만큼 크롭도 같이 기울인다. 얇은 책은 세로로 자르면 옆 책이 통째로 딸려 온다.
    const bandSlope = (slopeAt[band.x0] + slopeAt[Math.min(aw - 1, band.x1)]) / 2;

    bands.push({
      ...cropBand(source, {
        x0: left * scale,
        x1: right * scale,
        top: extent.top * scale,
        bottom: extent.bottom * scale,
        originalX0: band.x0 * scale,
        originalX1: band.x1 * scale,
        targetWidth: opts.targetSpineWidth,
        maxUpscale: opts.maxUpscale,
        maxLength: opts.maxCropLength,
        slope: bandSlope,
      }),
      color,
      widthRatio: width / aw,
      ink: band.ink,
    });
  }

  return {
    bands,
    tiltDeg: (Math.atan(slope) * 180) / Math.PI,
    profile: opts.debug
      ? {
          combined: Array.from(combined),
          run: Array.from(runScore),
          color: Array.from(colorScore),
          shadow: Array.from(shadowScore),
          scale,
          shelf,
          typicalWidth: typical,
        }
      : undefined,
  };
}

/** 이만큼 긴 세로선이 있어야 경계로 온전히 쳐 준다 (가장 긴 세로선 대비). */
const EDGE_SUPPORT = 0.55;

/**
 * 책장 벽이나 빈 자리를 양 끝에서만 떼어낸다.
 *
 * 벽은 글자도 무늬도 없어 무늬 양(ink)이 눈에 띄게 적다. 하지만 이 기준을 가운데
 * 밴드에까지 들이대면 안 된다. 사진 한쪽이 그늘지면 그쪽 책들도 무늬 양이 똑같이
 * 줄어서, 그늘에 든 책이 통째로 "배경"으로 버려진다. 실제로 가까이서 찍은 사진에서
 * 어두운 책 네 권이 한꺼번에 사라졌다. 배경은 어차피 사진 양 끝에만 있다.
 */
function dropEdgeBackground(
  bands: { x0: number; x1: number; ink: number }[],
): { x0: number; x1: number; ink: number }[] {
  if (bands.length < 3) return bands;
  const inks = bands.map((band) => band.ink).sort((a, b) => a - b);
  const median = inks[Math.floor(inks.length / 2)] ?? 0;
  const floor = Math.max(0.015, median * 0.3);

  let from = 0;
  let to = bands.length - 1;
  while (from < to && bands[from].ink < floor) from++;
  while (to > from && bands[to].ink < floor) to--;
  return bands.slice(from, to + 1);
}

/** 같은 책의 바탕색으로 볼 색 차이 (0~255). */
const TWIN_COLOR_DISTANCE = 12;
/** 이 정도로 색이 안 바뀌는 자리는 두 책 사이가 아니다 (0~1). */
const TWIN_SEAM_COLOR = 0.18;

/**
 * 한 권이 둘로 쪼개진 자리를 도로 붙인다.
 *
 * 세로로 쌓은 제목은 글자 덩어리의 좌우가 긴 세로선처럼 보여 가짜 경계를 만든다.
 * 그렇게 갈라진 두 조각은 바탕색이 같다. 진짜 옆 책이면 색이 다르다.
 * 다만 붙여서 다른 책들보다 뚜렷이 두꺼워지면 원래 두 권이었다고 보고 그냥 둔다.
 */
function mergeTwins(
  bands: { x0: number; x1: number; ink: number }[],
  medians: Float32Array,
  colorScore: Float32Array,
  w: number,
): { x0: number; x1: number; ink: number }[] {
  if (bands.length < 2) return bands;

  const widths = bands.map((band) => band.x1 - band.x0).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] ?? 0;
  const limit = median * 2.5;

  const color = (x0: number, x1: number) => {
    // 가장자리는 옆 책이 비친다. 안쪽 60%만 본다.
    const inset = Math.round((x1 - x0) * 0.2);
    const from = Math.max(0, x0 + inset);
    const to = Math.min(w - 1, x1 - inset);
    const rgb = [0, 0, 0];
    let n = 0;
    for (let x = from; x <= to; x++) {
      for (let c = 0; c < 3; c++) rgb[c] += medians[x * 3 + c];
      n++;
    }
    return n ? rgb.map((value) => value / n) : rgb;
  };

  const result = [...bands];
  for (let i = 0; i + 1 < result.length; ) {
    const left = result[i];
    const right = result[i + 1];
    if (right.x0 !== left.x1 || right.x1 - left.x0 > limit) {
      i++;
      continue;
    }
    // 두 책 사이라면 그 자리에서 바탕색이 뚝 바뀐다. 한 책 안의 음영은 스르르 바뀐다.
    if (colorScore[right.x0] >= TWIN_SEAM_COLOR) {
      i++;
      continue;
    }
    const a = color(left.x0, left.x1);
    const b = color(right.x0, right.x1);
    const distance = Math.max(...a.map((value, c) => Math.abs(value - b[c])));
    if (distance >= TWIN_COLOR_DISTANCE) {
      i++;
      continue;
    }
    const width = right.x1 - left.x0;
    result.splice(i, 2, {
      x0: left.x0,
      x1: right.x1,
      ink: (left.ink * (left.x1 - left.x0) + right.ink * (right.x1 - right.x0)) / width,
    });
  }
  return result;
}

interface RowRange {
  top: number;
  bottom: number;
}

/**
 * 책이 실제로 꽂힌 행 구간을 찾는다.
 *
 * 나뭇결 벽이나 빈 선반은 세로 에지가 거의 없고, 책이 꽂힌 구간은 빽빽하다.
 * 한 칸만 찍어 달라고 안내해도 위 칸 천장과 아래 칸이 같이 찍히는 일이 많은데,
 * 그대로 두면 아래 칸 책들의 경계가 위 칸 경계와 뒤섞여 둘 다 놓친다.
 */
function shelfRows(
  pixels: Uint8ClampedArray,
  edge: Uint8Array,
  w: number,
  h: number,
): RowRange {
  const density = new Float32Array(h);
  const spread = new Float32Array(h);
  const step = Math.max(1, Math.round(w / 200));
  const sample: number[] = [];

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x < w; x++) count += edge[row + x];
    density[y] = count / w;

    // 한 줄에 여러 책이 걸쳐 있으면 색이 제각각이다. 나뭇결 벽이나 빈 선반은 한 색이다.
    // 에지만 보면 무늬 없는 책등은 배경처럼 보여, 제목 글자가 있는 줄만 책으로 잡힌다.
    sample.length = 0;
    for (let x = 0; x < w; x += step) {
      const i = (row + x) * 4;
      sample.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    }
    sample.sort((a, b) => a - b);
    spread[y] = (sample[Math.floor(sample.length * 0.9)] ?? 0) - (sample[Math.floor(sample.length * 0.1)] ?? 0);
  }

  const radius = Math.max(2, Math.round(h * 0.012));
  const byEdge = normalize(smooth(density, radius));
  const bySpread = normalize(smooth(spread, radius));
  const score = new Float32Array(h);
  for (let y = 0; y < h; y++) score[y] = Math.max(byEdge[y], bySpread[y]);
  const cutoff = percentile(score, 0.95) * 0.35;

  const runs: RowRange[] = [];
  let start = -1;
  for (let y = 0; y < h; y++) {
    if (score[y] >= cutoff) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      runs.push({ top: start, bottom: y - 1 });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ top: start, bottom: h - 1 });
  if (!runs.length) return { top: 0, bottom: h - 1 };

  const span = (r: RowRange) => r.bottom - r.top;
  const longest = runs.reduce((a, b) => (span(b) > span(a) ? b : a));
  // 사용자는 찍고 싶은 칸을 화면 가운데 둔다. 가운데 걸친 구간이면 그쪽을 믿는다.
  const middle = runs.find((r) => r.top <= h / 2 && h / 2 <= r.bottom);
  const chosen = middle && span(middle) >= span(longest) * 0.5 ? middle : longest;
  // 사진의 절반도 안 되는 구간만 잡혔다면 잘못 짚은 것이다. 통째로 쓰는 편이 낫다.
  if (span(chosen) < h * 0.45) return { top: 0, bottom: h - 1 };

  // 책 위아래가 조금이라도 잘리면 제목의 첫 글자와 끝 글자를 잃는다. 넉넉히 둔다.
  const pad = Math.round(span(chosen) * 0.04);
  return { top: Math.max(0, chosen.top - pad), bottom: Math.min(h - 1, chosen.bottom + pad) };
}

/** 열마다 따로 찾아볼 기울기 목록. 원근 때문에 왼쪽 책과 오른쪽 책이 서로 다르게 기운다. */
function slopeList(maxDeg: number): number[] {
  const list: number[] = [];
  for (let deg = -maxDeg; deg <= maxDeg + 1e-6; deg += 1) {
    list.push(Math.tan((deg * Math.PI) / 180));
  }
  return list;
}

/**
 * 열마다 "가장 긴 연속 세로 에지"를 잰다. 기울기는 열마다 따로 고른다.
 * 책 경계는 위아래로 길게 이어지고, 글자 획은 짧게 끊긴다.
 */
function columnRuns(edge: Uint8Array, w: number, shelf: RowRange, slopes: number[]) {
  const run = new Float32Array(w);
  const slopeAt = new Float32Array(w);
  const center = (shelf.top + shelf.bottom) / 2;
  const span = Math.max(1, shelf.bottom - shelf.top + 1);
  const slack = Math.max(2, Math.round(span * 0.006));

  let slopeVotes = 0;
  let slopeSum = 0;

  for (let x = 0; x < w; x++) {
    let best = 0;
    let bestSlope = 0;
    for (const slope of slopes) {
      let current = 0;
      let peak = 0;
      for (let y = shelf.top; y <= shelf.bottom; y++) {
        const xi = x + Math.round(slope * (y - center));
        if (xi >= 0 && xi < w && edge[y * w + xi]) {
          current++;
          if (current > peak) peak = current;
        } else {
          current = Math.max(0, current - slack); // 몇 픽셀 끊김은 눈감아 준다
        }
      }
      if (peak > best) {
        best = peak;
        bestSlope = slope;
      }
    }
    run[x] = best / span;
    slopeAt[x] = bestSlope;
    // 사용자에게 보여 줄 대표 기울기는 또렷한 경계들의 평균으로 낸다.
    if (best > span * 0.5) {
      slopeVotes++;
      slopeSum += bestSlope;
    }
  }

  return { run, slopeAt, slope: slopeVotes ? slopeSum / slopeVotes : 0 };
}

/**
 * 책이 실제로 꽂힌 열 구간.
 * 책장 벽과 빈 자리를 미리 떼어내지 않으면, 나뭇결의 옅은 무늬가 잘게 쪼개져
 * 제목 없는 밴드로 줄줄이 들어온다.
 */
function bookColumns(ink: Float32Array, w: number): { from: number; to: number } {
  const smoothed = smooth(ink, Math.max(3, Math.round(w * 0.008)));
  // 책이 있는 열과 벽은 무늬 양이 몇 배씩 차이 난다. 가운데 값의 절반을 기준으로 삼는다.
  const cutoff = percentile(smoothed, 0.5) * 0.45;
  // 안쪽까지 잘라 먹지 않도록 양쪽에서 잘라낼 수 있는 한도를 둔다.
  const limit = Math.round(w * 0.25);

  let from = 0;
  let to = w - 1;
  while (from < limit && smoothed[from] < cutoff) from++;
  while (to > w - 1 - limit && smoothed[to] < cutoff) to--;

  // 양 끝 책의 바깥쪽 모서리가 잘리지 않게 조금 넓힌다.
  const pad = Math.round(w * 0.006);
  return { from: Math.max(0, from - pad), to: Math.min(w - 1, to + pad) };
}

/** 열마다 에지 비율. 글자도 무늬도 없는 배경을 가려낼 때 쓴다. */
function columnInk(edge: Uint8Array, w: number, shelf: RowRange): Float32Array {
  const ink = new Float32Array(w);
  const span = Math.max(1, shelf.bottom - shelf.top + 1);
  for (let y = shelf.top; y <= shelf.bottom; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) ink[x] += edge[row + x];
  }
  for (let x = 0; x < w; x++) ink[x] /= span;
  return ink;
}

/**
 * 열마다 대표 색(중앙값)을 낸다.
 *
 * 평균을 쓰면 큰 글자가 지나가는 열이 통째로 어두워져 책 경계만큼 큰 변화가 생긴다.
 * 중앙값은 글자가 열의 절반을 넘지 않는 한 책등 바탕색을 그대로 짚는다.
 */
function columnMedians(pixels: Uint8ClampedArray, w: number, shelf: RowRange): Float32Array {
  const span = shelf.bottom - shelf.top + 1;
  const step = Math.max(1, Math.round(span / 300));
  const buffer = new Float32Array(Math.ceil(span / step) + 1);
  const medians = new Float32Array(w * 3);

  for (let x = 0; x < w; x++) {
    for (let channel = 0; channel < 3; channel++) {
      let n = 0;
      for (let y = shelf.top; y <= shelf.bottom; y += step) {
        buffer[n++] = pixels[(y * w + x) * 4 + channel];
      }
      const slice = buffer.subarray(0, n).slice().sort();
      medians[x * 3 + channel] = slice[Math.floor(n / 2)] ?? 0;
    }
  }
  return medians;
}

/** 옆 열과의 대표색 차이. */
function columnColorChange(medians: Float32Array, w: number): Float32Array {
  const change = new Float32Array(w);
  for (let x = 1; x < w; x++) {
    change[x] = Math.max(
      Math.abs(medians[x * 3] - medians[(x - 1) * 3]),
      Math.abs(medians[x * 3 + 1] - medians[(x - 1) * 3 + 1]),
      Math.abs(medians[x * 3 + 2] - medians[(x - 1) * 3 + 2]),
    );
  }
  return change;
}

/**
 * 열마다 "밝은 쪽" 밝기(70번째 백분위).
 *
 * 책 사이 그림자는 위에서 아래까지 내내 어둡다. 반면 제목 글자가 지나가는 열은
 * 글자와 바탕이 번갈아 나와 밝은 쪽이 그대로 남는다. 중앙값을 쓰면 글자가 굵은 열이
 * 그림자만큼 어둡게 나와 책 한 권이 둘로 쪼개진다.
 */
function columnBright(pixels: Uint8ClampedArray, w: number, shelf: RowRange): Float32Array {
  const span = shelf.bottom - shelf.top + 1;
  const step = Math.max(1, Math.round(span / 300));
  const buffer = new Float32Array(Math.ceil(span / step) + 1);
  const out = new Float32Array(w);

  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = shelf.top; y <= shelf.bottom; y += step) {
      const i = (y * w + x) * 4;
      buffer[n++] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    }
    const slice = buffer.subarray(0, n).slice().sort();
    out[x] = slice[Math.floor(n * 0.7)] ?? 0;
  }
  return out;
}

/**
 * 책과 책 사이에는 가는 그림자가 있다. 그 열이 주변보다 얼마나 어두운지 잰다.
 * 두께가 제각각이라 창 크기를 여러 개 대 보고 가장 깊게 잡히는 값을 쓴다.
 */
function columnShadow(lum: Float32Array, w: number, windows: number[]): Float32Array {
  const out = new Float32Array(w);
  for (const win of windows) {
    for (let x = 0; x < w; x++) {
      let high = 0;
      const from = Math.max(0, x - win);
      const to = Math.min(w - 1, x + win);
      for (let i = from; i <= to; i++) if (lum[i] > high) high = lum[i];
      const depth = high - lum[x];
      if (depth > out[x]) out[x] = depth;
    }
  }
  return out;
}

/**
 * 주변 기준선보다 얼마나 솟았는지.
 * 사진 한쪽이 그늘지면 절대 점수는 통째로 낮아지지만 국소 대비는 남는다.
 */
function localContrast(score: Float32Array, window: number): Float32Array {
  const out = new Float32Array(score.length);
  const step = Math.max(1, Math.round(window / 8));
  for (let x = 0; x < score.length; x += step) {
    const from = Math.max(0, x - window);
    const to = Math.min(score.length - 1, x + window);
    const sample: number[] = [];
    for (let i = from; i <= to; i += Math.max(1, Math.round((to - from) / 60))) sample.push(score[i]);
    sample.sort((a, b) => a - b);
    const base = sample[Math.floor(sample.length * 0.4)] ?? 0;
    for (let i = x; i < Math.min(score.length, x + step); i++) out[i] = score[i] - base;
  }
  return out;
}

/** 국소 대비가 큰 순서대로 고르되, 이미 고른 경계와 minGap 안에는 겹쳐 놓지 않는다. */
function selectPeaks(
  score: Float32Array,
  prominence: Float32Array,
  w: number,
  minGap: number,
  threshold: number,
): number[] {
  const candidates: number[] = [];
  for (let x = 1; x < w - 1; x++) {
    if (score[x] < score[x - 1] || score[x] < score[x + 1]) continue;
    if (prominence[x] < threshold) continue;
    candidates.push(x);
  }
  candidates.sort((a, b) => prominence[b] - prominence[a]);

  const taken: number[] = [];
  for (const x of candidates) {
    let clash = false;
    for (const t of taken) {
      if (Math.abs(t - x) < minGap) {
        clash = true;
        break;
      }
    }
    if (!clash) taken.push(x);
  }
  return taken.sort((a, b) => a - b);
}

/**
 * 또렷한 경계들의 간격에서 대표 두께를 잡는다.
 * 경계를 몇 개 놓쳐도 간격의 중앙값은 대개 한 권이나 두 권 폭이라,
 * 최소 간격을 그 절반 아래로 잡으면 놓친 경계를 다시 주울 수 있다.
 */
function typicalWidth(peaks: number[], w: number, floor: number): number {
  if (peaks.length < 3) return Math.max(floor, w * 0.06);
  const gaps: number[] = [];
  for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.max(floor, median);
}

/**
 * 한 책장에 꽂힌 책들은 두께가 비슷하다.
 * 유난히 넓은 구간은 경계를 놓쳐 여러 권이 붙은 것으로 보고, 안쪽에서 가장
 * 그럴듯한 자리를 찾아 쪼갠다. 전역 문턱을 낮추면 다른 곳이 잘게 부서지므로
 * 여기서만 완화한다.
 */
function splitWideSegments(
  cuts: number[],
  score: Float32Array,
  prominence: Float32Array,
  minGap: number,
  floor: number,
): number[] {
  const widths = cuts.slice(1).map((x, i) => x - cuts[i]).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] ?? 0;
  if (median < minGap) return cuts;

  const limit = median * 1.7;
  const result = [...cuts];

  // 넓은 구간이 없어질 때까지, 다만 무한히 쪼개지 않도록 몇 번만 돈다.
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (let index = 0; index + 1 < result.length; index++) {
      const x0 = result[index];
      const x1 = result[index + 1];
      if (x1 - x0 <= limit) continue;

      let bestX = -1;
      let bestScore = 0;
      for (let x = x0 + minGap; x < x1 - minGap; x++) {
        if (score[x] < score[x - 1] || score[x] < score[x + 1]) continue;
        // 전역 문턱보다는 낮춰 주되, 아무 봉우리나 경계로 삼지는 않는다.
        if (prominence[x] < floor) continue;
        if (score[x] > bestScore) {
          bestScore = score[x];
          bestX = x;
        }
      }
      if (bestX < 0) continue;
      result.splice(index + 1, 0, bestX);
      changed = true;
      index++;
    }
    if (!changed) break;
  }
  return result;
}

/** 분석용 축소 캔버스. 원본 그대로 분석하면 느리기만 하다. */
function toAnalysisCanvas(source: HTMLCanvasElement, maxWidth: number): HTMLCanvasElement {
  if (source.width <= maxWidth) return source;
  const scale = maxWidth / source.width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

function toGray(data: Uint8ClampedArray, pixels: number): Float32Array {
  const gray = new Float32Array(pixels);
  for (let i = 0, p = 0; p < pixels; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

/**
 * 이웃한 두 픽셀의 색 차이. 채널별 변화 중 가장 큰 값을 쓴다.
 * 밝기만 보면 파랑 옆 초록처럼 밝기가 비슷한 경계를 놓친다.
 */
function colorDistance(pixels: Uint8ClampedArray, a: number, b: number): number {
  const dr = Math.abs(pixels[a] - pixels[b]);
  const dg = Math.abs(pixels[a + 1] - pixels[b + 1]);
  const db = Math.abs(pixels[a + 2] - pixels[b + 2]);
  return Math.max(dr, dg, db);
}

/** 에지 임계값은 사진마다 다르다. 색 변화량의 백분위로 정한다. */
function edgeThreshold(pixels: Uint8ClampedArray, w: number, h: number): number {
  const sample: number[] = [];
  const step = Math.max(1, Math.round(Math.sqrt(w * h) / 220));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x + 1 < w; x += step) {
      sample.push(colorDistance(pixels, (y * w + x) * 4, (y * w + x + 1) * 4));
    }
  }
  sample.sort((a, b) => a - b);
  const p = sample[Math.floor(sample.length * 0.88)] ?? 0;
  return Math.min(48, Math.max(8, p));
}

function toEdgeMap(pixels: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const threshold = edgeThreshold(pixels, w, h);
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x + 1 < w; x++) {
      edge[row + x] = colorDistance(pixels, (row + x) * 4, (row + x + 1) * 4) > threshold ? 1 : 0;
    }
  }
  return edge;
}

/** 상위 몇 퍼센트 값. 최댓값으로 정규화하면 튄 값 하나에 전체가 눌린다. */
function percentile(values: Float32Array, ratio: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

/** 0~1 범위로 맞춘다. 기준은 최댓값이 아니라 상위 2% 값이다. */
function normalize(values: Float32Array): Float32Array {
  const top = percentile(values, 0.98) || Math.max(...values) || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.min(1, values[i] / top);
  return out;
}

function smooth(values: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(values.length);
  let sum = 0;
  for (let x = 0; x < values.length + radius; x++) {
    if (x < values.length) sum += values[x];
    if (x - 2 * radius - 1 >= 0) sum -= values[x - 2 * radius - 1];
    const center = x - radius;
    if (center >= 0 && center < values.length) {
      const from = Math.max(0, center - radius);
      const to = Math.min(values.length - 1, center + radius);
      out[center] = sum / (to - from + 1);
    }
  }
  return out;
}

/** 밴드 안에서 책이 실제로 차지하는 위/아래 경계를 찾는다. */
function rowExtent(
  gray: Float32Array,
  w: number,
  x0: number,
  x1: number,
  shelf: RowRange,
  margin: number,
) {
  const height = shelf.bottom - shelf.top + 1;
  const rows = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = x0; x < x1; x++) sum += gray[(shelf.top + y) * w + x];
    rows[y] = sum / Math.max(1, x1 - x0);
  }

  const sampleSize = Math.max(3, Math.round(height * 0.03));
  const median = (from: number, to: number) => {
    const slice = Array.from(rows.slice(from, to)).sort((a, b) => a - b);
    return slice[Math.floor(slice.length / 2)] ?? 0;
  };
  const bgTop = median(0, sampleSize);
  const bgBottom = median(height - sampleSize, height);
  const tolerance = 14;

  let top = 0;
  let bottom = height - 1;
  while (top < height - 1 && Math.abs(rows[top] - bgTop) < tolerance) top++;
  while (bottom > top && Math.abs(rows[bottom] - bgBottom) < tolerance) bottom--;

  // 책을 못 찾았으면 칸 전체를 쓴다.
  if (bottom - top < height * 0.3) return { top: shelf.top, bottom: shelf.bottom };

  // margin 이 음수면 바깥쪽으로 넓힌다. 글자 끝이 잘리는 것을 막는다.
  const pixels = Math.round((bottom - top) * margin);
  return {
    top: shelf.top + Math.min(height - 1, Math.max(0, top + pixels)),
    bottom: shelf.top + Math.max(0, Math.min(height - 1, bottom - pixels)),
  };
}

interface CropSpec {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  originalX0: number;
  originalX1: number;
  targetWidth: number;
  /** 원본보다 몇 배까지 키울지 */
  maxUpscale: number;
  /** 잘라낸 책등의 최대 길이(px) */
  maxLength: number;
  /** 이 책등이 기운 정도 (아래로 1px 갈 때 오른쪽으로 몇 px). */
  slope: number;
}

/** 책등을 잘라 세운 캔버스를 만든다. 실제로 읽을 때 한 장씩 만든다. */
function cropBand(
  source: HTMLCanvasElement,
  spec: CropSpec,
): Pick<SpineBand, "x0" | "x1" | "crop"> {
  const width = Math.max(1, Math.round(spec.x1 - spec.x0));
  const height = Math.max(1, Math.round(spec.bottom - spec.top));
  // 얇은 책은 원본에서도 20~30px밖에 안 된다. 목표 너비까지 키울 수 있게 배율을 넉넉히 둔다.
  // 다만 길이에는 한도를 둔다. 가까이서 찍으면 책등이 사진 세로를 꽉 채워,
  // 그대로 키우면 만 픽셀이 넘는 띠가 되어 OCR이 한 줄로 보지 못한다.
  // 키우는 데는 두 가지 한도를 둔다.
  //  - 배율: 원본에 없는 획이 생기지는 않는다. 크게만 만들면 OCR의 줄 찾기가 흔들린다.
  //  - 길이: 가까이서 찍으면 책등이 사진 세로를 꽉 채워, 그대로 키우면 만 픽셀이 넘는
  //    띠가 된다. 그 정도면 OCR이 한 줄로 보지 못하고 제목이 토막 난다.
  const scale = Math.min(
    spec.maxUpscale,
    Math.max(1, spec.targetWidth / width),
    Math.max(1, spec.maxLength / height),
  );
  const centerX = (spec.x0 + spec.x1) / 2;
  const centerY = (spec.top + spec.bottom) / 2;
  // 기울인 만큼 원본에서 더 넓게 읽어야 한다.
  const pad = Math.abs(spec.slope) * height * 0.5 + 2;
  const sx = Math.max(0, Math.floor(spec.x0 - pad));
  const sy = Math.max(0, Math.floor(spec.top));
  const sw = Math.min(source.width - sx, Math.ceil(width + 2 * pad));
  const sh = Math.min(source.height - sy, Math.ceil(height));

  const draw = (deg: number): SpineVariant => {
    const swap = deg % 180 !== 0;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((swap ? height : width) * scale);
    canvas.height = Math.round((swap ? width : height) * scale);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingQuality = "high";
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.scale(scale, scale);
      // 기울기를 펴서 책등이 똑바로 서게 만든다.
      ctx.transform(1, 0, -spec.slope, 1, 0, 0);
      ctx.translate(-centerX, -centerY);
      if (sw > 0 && sh > 0) ctx.drawImage(source, sx, sy, sw, sh, sx, sy, sw, sh);
    }
    return { deg, canvas };
  };

  return {
    x0: Math.round(spec.originalX0),
    x1: Math.round(spec.originalX1),
    crop: draw,
  };
}

/**
 * 책등의 대표 색. 글자에 흔들리지 않게 중앙값을 쓴다.
 * 평균을 쓰면 흰 글자가 많은 책등이 실제보다 밝게 나온다.
 */
function bandColor(
  pixels: Uint8ClampedArray,
  w: number,
  x0: number,
  x1: number,
  top: number,
  bottom: number,
): string {
  const samples: number[][] = [[], [], []];
  const stepX = Math.max(1, Math.round((x1 - x0) / 12));
  const stepY = Math.max(1, Math.round((bottom - top) / 60));

  for (let y = top; y < bottom; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * w + x) * 4;
      samples[0].push(pixels[i]);
      samples[1].push(pixels[i + 1]);
      samples[2].push(pixels[i + 2]);
    }
  }

  const channel = (values: number[]) => {
    if (!values.length) return 128;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${hex(channel(samples[0]))}${hex(channel(samples[1]))}${hex(channel(samples[2]))}`;
}

/** 분할이 실패했을 때 쓸 전체 이미지 회전본 (정면 표지, 눕힌 책 대비) */
export function wholeImageVariants(source: HTMLCanvasElement): SpineVariant[] {
  return [0, 90, -90].map((deg) => {
    const swap = deg % 180 !== 0;
    const canvas = document.createElement("canvas");
    canvas.width = swap ? source.height : source.width;
    canvas.height = swap ? source.width : source.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(source, -source.width / 2, -source.height / 2);
    }
    return { deg, canvas };
  });
}
