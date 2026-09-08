/**
 * 책장 사진에서 책등을 한 권씩 잘라낸다.
 *
 * 사진 한 장을 통째로 OCR에 넣으면 옆 책 글자가 한 줄로 섞여 읽힌다.
 * 그래서 먼저 세로 경계를 찾아 책등 단위로 자른 뒤 한 권씩 인식한다.
 *
 * 경계 찾기는 세 단계다.
 *  1. 사진이 기울어진 각도를 추정한다 (에지를 기울여 투영했을 때 가장 날카로운 각도).
 *  2. 그 기울기를 따라 내려가며 열마다 "가장 긴 연속 세로 에지"를 잰다.
 *     책 경계는 위아래로 길게 이어지고, 글자 획은 짧게 끊긴다.
 *  3. 봉우리를 경계로 삼아 밴드를 만들고, 밴드마다 책이 실제 차지하는
 *     세로 구간까지 잘라낸다. 위쪽 배경이 섞이면 OCR이 통째로 실패한다.
 */

export interface SpineBand {
  /** 원본 이미지 기준 좌우 경계 */
  x0: number;
  x1: number;
  /** 돌려 세운 두 방향의 크롭. 책등 글자는 위→아래거나 아래→위다. */
  variants: SpineVariant[];
  /** 돌리지 않은 크롭. 한글 책등에 흔한 세로로 쌓은 글자를 읽을 때 쓴다. */
  upright: SpineVariant;
}

export interface SpineVariant {
  /** 90, -90 은 돌려 세운 글자, 0 은 세로로 쌓인 글자용 */
  deg: number;
  canvas: HTMLCanvasElement;
}

export interface SegmentOptions {
  /** 경계 분석에 쓸 최대 가로 크기. 크게 잡아도 정확도는 거의 안 오르고 느려진다. */
  analysisWidth?: number;
  /** 최대 기울기 탐색 범위(도) */
  maxTiltDeg?: number;
  /** 책등 최소 너비 (가로 대비 비율) */
  minWidthRatio?: number;
  /** 책등 최대 너비 (가로 대비 비율) */
  maxWidthRatio?: number;
  /** 경계로 인정할 점수 (가장 긴 에지 대비 비율) */
  relScore?: number;
  /** 밴드 좌우를 이만큼 안쪽으로 깎는다. 옆 책이 비쳐 들어오는 것을 막는다. */
  sideInset?: number;
  /** 크롭한 책등의 목표 너비(px). 글자 크기를 OCR이 좋아하는 범위로 맞춘다. */
  targetSpineWidth?: number;
  /** 최대 밴드 수 */
  maxBands?: number;
  /** 경계 점수 프로파일을 함께 돌려준다 (bench/segment.mjs 진단용) */
  debug?: boolean;
}

const DEFAULTS = {
  analysisWidth: 900,
  maxTiltDeg: 6,
  minWidthRatio: 0.025,
  maxWidthRatio: 0.45,
  relScore: 0.35,
  sideInset: 0.08,
  targetSpineWidth: 150,
  maxBands: 24,
  debug: false,
} satisfies Required<SegmentOptions>;

export interface SegmentResult {
  bands: SpineBand[];
  /** 진단용 경계 점수 프로파일. opts.debug 를 켰을 때만 채운다. */
  profile?: { combined: number[]; run: number[]; color: number[]; scale: number };
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
  const slope = estimateSlope(edge, aw, ah, opts.maxTiltDeg);
  const { run, coverage } = columnRuns(edge, aw, ah, slope);

  const radius = Math.max(1, Math.round(aw * 0.002));
  const runScore = normalize(smooth(run, radius));
  // 색이 바뀌는 자리도 경계다. 밝기가 비슷한 두 책(파랑 옆 초록)은 이쪽으로 잡힌다.
  const colorScore = normalize(smooth(columnColorChange(pixels, aw, ah), radius));

  const combined = new Float32Array(aw);
  for (let x = 0; x < aw; x++) combined[x] = 0.7 * runScore[x] + 0.3 * colorScore[x];

  const minGap = Math.max(12, Math.round(aw * opts.minWidthRatio));

  const peaks: number[] = [];
  for (let x = 1; x < aw - 1; x++) {
    const score = combined[x];
    if (score < opts.relScore) continue;
    if (combined[x] < combined[x - 1] || combined[x] < combined[x + 1]) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && x - last < minGap) {
      if (combined[x] > combined[last]) peaks[peaks.length - 1] = x;
    } else {
      peaks.push(x);
    }
  }

  const cuts = splitWideSegments([0, ...peaks, aw - 1], combined, minGap, opts.relScore);
  const scale = source.width / aw;
  const bands: SpineBand[] = [];

  for (let i = 0; i < cuts.length - 1 && bands.length < opts.maxBands; i++) {
    const x0 = cuts[i];
    const x1 = cuts[i + 1];
    const width = x1 - x0;
    if (width < minGap || width > aw * opts.maxWidthRatio) continue;

    // 글자가 거의 없는 밴드(벽, 선반 여백)는 책이 아니다.
    let ink = 0;
    for (let x = x0; x < x1; x++) ink += coverage[x];
    if (ink / width < 0.02) continue;

    const inset = Math.round(width * opts.sideInset);
    const extent = rowExtent(gray, aw, ah, x0 + inset, x1 - inset);

    bands.push(
      cropBand(source, {
        x0: (x0 + inset) * scale,
        x1: (x1 - inset) * scale,
        top: extent.top * scale,
        bottom: extent.bottom * scale,
        originalX0: x0 * scale,
        originalX1: x1 * scale,
        targetWidth: opts.targetSpineWidth,
      }),
    );
  }

  return {
    bands,
    tiltDeg: (Math.atan(slope) * 180) / Math.PI,
    profile: opts.debug
      ? {
          combined: Array.from(combined),
          run: Array.from(runScore),
          color: Array.from(colorScore),
          scale,
        }
      : undefined,
  };
}

/**
 * 한 책장에 꽂힌 책들은 두께가 비슷하다.
 * 유난히 넓은 구간은 경계를 놓쳐 두 권이 붙은 것으로 보고, 안쪽에서 가장 그럴듯한
 * 자리를 찾아 쪼갠다. 전역 임계값을 낮추면 다른 곳이 잘게 부서지므로 여기서만 완화한다.
 */
function splitWideSegments(
  cuts: number[],
  score: Float32Array,
  minGap: number,
  relScore: number,
): number[] {
  const widthOf = (index: number) => cuts[index + 1] - cuts[index];
  const widths = cuts.slice(0, -1).map((_, index) => widthOf(index)).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] ?? 0;
  if (median < minGap) return cuts;

  const limit = median * 1.8;
  const floor = relScore * 0.4;
  const result = [...cuts];

  // 넓은 구간이 없어질 때까지, 다만 무한히 쪼개지 않도록 몇 번만 돈다.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let index = 0; index + 1 < result.length; index++) {
      const x0 = result[index];
      const x1 = result[index + 1];
      if (x1 - x0 <= limit) continue;

      let bestX = -1;
      let bestScore = floor;
      for (let x = x0 + minGap; x < x1 - minGap; x++) {
        if (score[x] > bestScore && score[x] >= score[x - 1] && score[x] >= score[x + 1]) {
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

/**
 * 열마다 대표 색(중앙값)을 내고, 옆 열과의 색 차이를 돌려준다.
 *
 * 평균을 쓰면 큰 글자가 지나가는 열이 통째로 밝아져 책 경계만큼 큰 변화가 생긴다.
 * 중앙값은 글자가 열의 절반을 넘지 않는 한 책등 바탕색을 그대로 짚는다.
 */
function columnColorChange(pixels: Uint8ClampedArray, w: number, h: number): Float32Array {
  const step = Math.max(1, Math.round(h / 300));
  const sampleCount = Math.ceil(h / step);
  const buffer = new Float32Array(sampleCount);
  const medians = new Float32Array(w * 3);

  for (let x = 0; x < w; x++) {
    for (let channel = 0; channel < 3; channel++) {
      let n = 0;
      for (let y = 0; y < h; y += step) buffer[n++] = pixels[(y * w + x) * 4 + channel];
      const slice = buffer.subarray(0, n).slice().sort();
      medians[x * 3 + channel] = slice[Math.floor(n / 2)];
    }
  }

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

/** 0~1 범위로 맞춘다. */
function normalize(values: Float32Array): Float32Array {
  const max = Math.max(...values) || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / max;
  return out;
}

/** 에지를 여러 각도로 기울여 투영했을 때 가장 뾰족한 각도가 책장의 기울기다. */
function estimateSlope(edge: Uint8Array, w: number, h: number, maxDeg: number): number {
  let bestSlope = 0;
  let bestScore = -1;
  for (let deg = -maxDeg; deg <= maxDeg; deg += 0.5) {
    const slope = Math.tan((deg * Math.PI) / 180);
    const acc = new Float32Array(w);
    for (let y = 0; y < h; y++) {
      const shift = Math.round(slope * (y - h / 2));
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (!edge[row + x]) continue;
        const xi = x + shift;
        if (xi >= 0 && xi < w) acc[xi]++;
      }
    }
    let sum = 0;
    let squares = 0;
    for (let i = 0; i < w; i++) {
      sum += acc[i];
      squares += acc[i] * acc[i];
    }
    const score = sum > 0 ? squares / sum : 0;
    if (score > bestScore) {
      bestScore = score;
      bestSlope = slope;
    }
  }
  return bestSlope;
}

/** 열마다 가장 긴 연속 에지 길이와 에지 비율. 기울기를 따라 내려간다. */
function columnRuns(edge: Uint8Array, w: number, h: number, slope: number) {
  const run = new Float32Array(w);
  const coverage = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let best = 0;
    let current = 0;
    let total = 0;
    for (let y = 0; y < h; y++) {
      const xi = x - Math.round(slope * (y - h / 2));
      const on = xi >= 0 && xi < w && edge[y * w + xi];
      if (on) {
        current++;
        total++;
        if (current > best) best = current;
      } else {
        current = Math.max(0, current - 4); // 몇 픽셀 끊김은 눈감아 준다
      }
    }
    run[x] = best;
    coverage[x] = total / h;
  }
  return { run, coverage };
}

function smooth(values: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let x = 0; x < values.length; x++) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      const xi = x + k;
      if (xi >= 0 && xi < values.length) {
        sum += values[xi];
        count++;
      }
    }
    out[x] = sum / count;
  }
  return out;
}

/** 밴드 안에서 책이 실제로 차지하는 위/아래 경계를 찾는다. */
function rowExtent(gray: Float32Array, w: number, h: number, x0: number, x1: number) {
  const rows = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = x0; x < x1; x++) sum += gray[y * w + x];
    rows[y] = sum / Math.max(1, x1 - x0);
  }

  const sampleSize = Math.max(3, Math.round(h * 0.03));
  const median = (from: number, to: number) => {
    const slice = Array.from(rows.slice(from, to)).sort((a, b) => a - b);
    return slice[Math.floor(slice.length / 2)] ?? 0;
  };
  const bgTop = median(0, sampleSize);
  const bgBottom = median(h - sampleSize, h);
  const tolerance = 14;

  let top = 0;
  let bottom = h - 1;
  while (top < h - 1 && Math.abs(rows[top] - bgTop) < tolerance) top++;
  while (bottom > top && Math.abs(rows[bottom] - bgBottom) < tolerance) bottom--;

  // 책을 못 찾았으면 통째로 쓴다.
  if (bottom - top < h * 0.3) return { top: 0, bottom: h - 1 };

  const margin = Math.round((bottom - top) * 0.015);
  return { top: Math.min(h - 1, top + margin), bottom: Math.max(0, bottom - margin) };
}

interface CropSpec {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  originalX0: number;
  originalX1: number;
  targetWidth: number;
}

/** 책등을 잘라 ±90도로 세운 캔버스 두 장을 만든다. */
function cropBand(source: HTMLCanvasElement, spec: CropSpec): SpineBand {
  const width = Math.max(1, Math.round(spec.x1 - spec.x0));
  const height = Math.max(1, Math.round(spec.bottom - spec.top));
  const scale = Math.min(4, Math.max(1, spec.targetWidth / width));

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
      ctx.drawImage(source, spec.x0, spec.top, width, height, -width / 2, -height / 2, width, height);
    }
    return { deg, canvas };
  };

  return {
    x0: Math.round(spec.originalX0),
    x1: Math.round(spec.originalX1),
    variants: [draw(90), draw(-90)],
    upright: draw(0),
  };
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
