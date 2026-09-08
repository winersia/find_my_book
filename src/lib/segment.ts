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
  /** 회전한 두 방향의 크롭. 책등 글자는 위→아래거나 아래→위다. */
  variants: SpineVariant[];
}

export interface SpineVariant {
  /** 90 또는 -90 */
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
} satisfies Required<SegmentOptions>;

export interface SegmentResult {
  bands: SpineBand[];
  /** 추정한 사진 기울기(도). 화면에 보여 주면 사용자가 다시 찍을지 판단할 수 있다. */
  tiltDeg: number;
}

export function segmentSpines(source: HTMLCanvasElement, options: SegmentOptions = {}): SegmentResult {
  const opts = { ...DEFAULTS, ...options };

  const analysis = toAnalysisCanvas(source, opts.analysisWidth);
  const { width: aw, height: ah } = analysis;
  const ctx = analysis.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { bands: [], tiltDeg: 0 };

  const gray = toGray(ctx.getImageData(0, 0, aw, ah).data, aw * ah);
  const edge = toEdgeMap(gray, aw, ah);
  const slope = estimateSlope(edge, aw, ah, opts.maxTiltDeg);
  const { run, coverage } = columnRuns(edge, aw, ah, slope);

  const smoothed = smooth(run, Math.max(1, Math.round(aw * 0.002)));
  const maxRun = Math.max(...smoothed) || 1;
  const minGap = Math.max(12, Math.round(aw * opts.minWidthRatio));

  const peaks: number[] = [];
  for (let x = 1; x < aw - 1; x++) {
    const score = smoothed[x] / maxRun;
    if (score < opts.relScore) continue;
    if (smoothed[x] < smoothed[x - 1] || smoothed[x] < smoothed[x + 1]) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && x - last < minGap) {
      if (smoothed[x] > smoothed[last]) peaks[peaks.length - 1] = x;
    } else {
      peaks.push(x);
    }
  }

  const cuts = [0, ...peaks, aw - 1];
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

  return { bands, tiltDeg: (Math.atan(slope) * 180) / Math.PI };
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

/** 에지 임계값은 사진마다 다르다. 밝기 변화량의 백분위로 정한다. */
function edgeThreshold(gray: Float32Array, w: number, h: number): number {
  const sample: number[] = [];
  const step = Math.max(1, Math.round(Math.sqrt(w * h) / 220));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x + 1 < w; x += step) {
      sample.push(Math.abs(gray[y * w + x + 1] - gray[y * w + x]));
    }
  }
  sample.sort((a, b) => a - b);
  const p = sample[Math.floor(sample.length * 0.88)] ?? 0;
  return Math.min(40, Math.max(6, p));
}

function toEdgeMap(gray: Float32Array, w: number, h: number): Uint8Array {
  const threshold = edgeThreshold(gray, w, h);
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x + 1 < w; x++) {
      edge[row + x] = Math.abs(gray[row + x + 1] - gray[row + x]) > threshold ? 1 : 0;
    }
  }
  return edge;
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

  const variants = [90, -90].map((deg) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(height * scale);
    canvas.height = Math.round(width * scale);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingQuality = "high";
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.drawImage(source, spec.x0, spec.top, width, height, -width / 2, -height / 2, width, height);
    }
    return { deg, canvas };
  });

  return { x0: Math.round(spec.originalX0), x1: Math.round(spec.originalX1), variants };
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
