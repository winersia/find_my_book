/**
 * 검출 모델의 글자 지도에서 책등 글자 줄을 직접 뽑는다.
 *
 * 색과 명암으로 책등 경계를 찾던 분할은 책마다 다른 기울기를 따라가지 못했다.
 * 실제 사진의 책은 제각각 1~8° 기울어 서로 기대 있는데, 경계를 곧게 그으면 제목이
 * 두 밴드로 쪼개진다. 한쪽에는 반 줄, 다른 쪽에는 이웃 책 글자가 섞여 둘 다 못 읽는다.
 * 40권 중 18권을 못 읽은 주된 까닭이 이것이었다.
 *
 * 검출 모델은 사진 전체에서 글자 줄을 그 줄의 실제 기울기대로 찾는다. 줄마다
 * 기울기를 재어 그 방향으로 잘라 읽으면 경계를 몰라도 된다.
 */
import type { TextMap } from "./ppocr";
import type { SpineVariant } from "./segment";

export interface TextLine {
  /** 원본 좌표 기준 줄의 중심 */
  cx: number;
  cy: number;
  /** 세로축에서 기운 정도 (dx/dy). 오른쪽으로 누우면 양수 */
  slope: number;
  /** 줄의 길이와 굵기 (원본 px) */
  length: number;
  thickness: number;
  /** 선반 가운데 높이에서의 x. 왼쪽부터 늘어놓는 순서다. */
  shelfX: number;
  /** 원본 좌표 기준 위아래 끝 */
  top: number;
  bottom: number;
  crop(deg: number, invert?: boolean): SpineVariant;
  /**
   * 세로로 쌓은 글자를 한 글자씩 떼어 똑바로 세운 채 가로로 늘어놓는다.
   *
   * 한국 그림책 책등은 음절을 세로로 쌓아 쓴 것이 많다. 줄째로 90° 돌리면 음절 하나하나가
   * 옆으로 누운 채 인식기에 들어가 "애애앵 모기다"가 "모기다"로, "심술쟁이 아기 양"이
   * "심술쟁이"로 읽혔다. 글자 사이 틈은 검출 지도에 그대로 보이므로 거기서 자른다.
   * 틈이 두 곳도 안 되면 쌓은 글자가 아니다. 그때는 null.
   */
  stacked(): SpineVariant | null;
}

export interface LineOptions {
  /** 이 확률 이상을 글자로 본다 */
  threshold?: number;
  /** 세로로 이만큼(지도 px) 떨어진 조각은 한 줄로 잇는다. 세로로 쌓은 글자용 */
  columnGap?: number;
  /** 세로에서 이보다 더 누운 줄은 책등 글자가 아니다 (도) */
  maxLeanDeg?: number;
  /** 이보다 짧은 줄은 버린다 (원본 px) */
  minLength?: number;
}

const DEFAULTS: Required<LineOptions> = {
  threshold: 0.3,
  columnGap: 24,
  maxLeanDeg: 20,
  minLength: 60,
};

/** 줄 둘레로 얼마나 넉넉히 자를지. 검출 영역은 글자보다 약간 좁게 나온다. */
const CROSS_MARGIN = 1.0;
const ALONG_MARGIN = 0.4;
/** 인식기로 넘기기 전 줄 굵기를 이 정도로 맞춘다 */
const TARGET_CROSS = 72;
const MAX_UPSCALE = 2;

export function findTextLines(
  source: HTMLCanvasElement,
  map: TextMap,
  options: LineOptions = {},
): TextLine[] {
  const spec = { ...DEFAULTS, ...options };
  const { width: W, height: H, data, scale } = map;
  const usedW = Math.min(W, Math.round(source.width * scale));
  const usedH = Math.min(H, Math.round(source.height * scale));

  // 1) 글자 여부. 세로로 쌓은 한글은 글자마다 끊겨 나오므로 세로 틈을 메운다.
  const on = new Uint8Array(W * H);
  for (let y = 0; y < usedH; y++) {
    for (let x = 0; x < usedW; x++) if (data[y * W + x] > spec.threshold) on[y * W + x] = 1;
  }
  for (let x = 0; x < usedW; x++) {
    let last = -1;
    for (let y = 0; y < usedH; y++) {
      if (!on[y * W + x]) continue;
      if (last >= 0 && y - last > 1 && y - last <= spec.columnGap) {
        for (let fill = last + 1; fill < y; fill++) on[fill * W + x] = 2;
      }
      last = y;
    }
  }

  // 2) 이어진 덩어리마다 번호를 붙이고 모양을 잰다.
  const label = new Int32Array(W * H).fill(-1);
  const stack = new Int32Array(W * H);
  const blobs: { n: number; sx: number; sy: number; sxx: number; syy: number; sxy: number }[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!on[start] || label[start] >= 0) continue;
    const id = blobs.length;
    const blob = { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const at = stack[--top];
      const x = at % W;
      const y = (at - x) / W;
      blob.n++;
      blob.sx += x;
      blob.sy += y;
      blob.sxx += x * x;
      blob.syy += y * y;
      blob.sxy += x * y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= usedH) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= usedW) continue;
          const next = ny * W + nx;
          if (on[next] && label[next] < 0) {
            label[next] = id;
            stack[top++] = next;
          }
        }
      }
    }
    blobs.push(blob);
  }

  // 3) 주축 방향과 그 방향의 길이·굵기. 길이는 투영의 양 끝으로 잰다.
  const axes = blobs.map((b) => {
    const mx = b.sx / b.n;
    const my = b.sy / b.n;
    const cxx = b.sxx / b.n - mx * mx;
    const cyy = b.syy / b.n - my * my;
    const cxy = b.sxy / b.n - mx * my;
    // 세로에 가까운 주축. 각도는 세로축 기준.
    const theta = 0.5 * Math.atan2(2 * cxy, cyy - cxx);
    return {
      mx,
      my,
      ux: Math.sin(theta),
      uy: Math.cos(theta),
      min: Infinity,
      max: -Infinity,
      cmin: Infinity,
      cmax: -Infinity,
      occupancy: null as Uint16Array | null,
    };
  });
  for (let at = 0; at < W * H; at++) {
    const id = label[at];
    if (id < 0 || on[at] !== 1) continue;
    const x = at % W;
    const y = (at - x) / W;
    const a = axes[id];
    const along = (x - a.mx) * a.ux + (y - a.my) * a.uy;
    const across = (x - a.mx) * a.uy - (y - a.my) * a.ux;
    if (along < a.min) a.min = along;
    if (along > a.max) a.max = along;
    if (across < a.cmin) a.cmin = across;
    if (across > a.cmax) a.cmax = across;
  }

  // 줄 방향으로 글자 화소가 있는 자리를 센다. 틈이 곧 글자 사이다.
  for (const a of axes) {
    if (Number.isFinite(a.min)) a.occupancy = new Uint16Array(Math.ceil(a.max - a.min) + 2);
  }
  for (let at = 0; at < W * H; at++) {
    const id = label[at];
    if (id < 0 || on[at] !== 1) continue;
    const a = axes[id];
    const x = at % W;
    const y = (at - x) / W;
    const along = (x - a.mx) * a.ux + (y - a.my) * a.uy;
    a.occupancy![Math.round(along - a.min)]++;
  }

  const maxLean = Math.tan((spec.maxLeanDeg * Math.PI) / 180);
  const found: LineShape[] = [];
  for (const a of axes) {
    if (!Number.isFinite(a.min)) continue;
    const length = (a.max - a.min + 1) / scale;
    const thickness = (a.cmax - a.cmin + 1) / scale;
    const slope = a.ux / a.uy;
    if (Math.abs(slope) > maxLean) continue;
    if (length < spec.minLength || length < thickness * 2.5) continue;
    const mid = (a.min + a.max) / 2;
    const cx = (a.mx + a.ux * mid) / scale;
    const cy = (a.my + a.uy * mid) / scale;
    found.push({
      cx,
      cy,
      slope,
      length,
      thickness,
      top: cy - (length / 2) * a.uy,
      bottom: cy + (length / 2) * a.uy,
      cells: glyphCells(a.occupancy!, (a.max - a.min) / 2, thickness * scale).map(
        ([from, to]) => [from / scale, to / scale] as [number, number],
      ),
    });
  }
  if (!found.length) return [];

  // 4) 선반 가운데 높이에서의 x 로 왼쪽부터 세운다. 기울어진 책끼리 순서가 뒤바뀌지 않는다.
  const centers = found.map((line) => line.cy).sort((p, q) => p - q);
  const shelfY = centers[Math.floor(centers.length / 2)];
  return found
    .map((line) => ({
      ...line,
      shelfX: line.cx + line.slope * (shelfY - line.cy),
      crop: (deg: number, invert = false) => cropLine(source, line, deg, invert),
      stacked: () => restack(source, line),
    }))
    .sort((p, q) => p.shelfX - q.shelfX);
}

type LineShape = Omit<TextLine, "shelfX" | "crop" | "stacked"> & {
  /** 글자 하나하나가 차지한 구간. 줄 중심 기준 줄 방향 거리 (원본 px) */
  cells: [number, number][];
};

/**
 * 줄 방향 점유 히스토그램에서 글자 구간을 찾는다 (지도 px, 줄 중심 기준).
 * 너무 좁은 조각은 옆 글자에 붙인다. 받침이나 획 하나가 따로 떨어져 나오기도 한다.
 */
function glyphCells(occupancy: Uint16Array, half: number, thickness: number): [number, number][] {
  const runs: [number, number][] = [];
  let from = -1;
  for (let i = 0; i <= occupancy.length; i++) {
    const filled = i < occupancy.length && occupancy[i] > 0;
    if (filled && from < 0) from = i;
    if (!filled && from >= 0) {
      runs.push([from, i - 1]);
      from = -1;
    }
  }
  // 한두 칸짜리 틈은 틈이 아니다.
  const joined: [number, number][] = [];
  for (const run of runs) {
    const last = joined[joined.length - 1];
    if (last && run[0] - last[1] <= 2) last[1] = run[1];
    else joined.push([...run]);
  }
  const minGlyph = thickness * 0.35;
  const merged: [number, number][] = [];
  for (const run of joined) {
    const last = merged[merged.length - 1];
    if (last && (run[1] - run[0] < minGlyph || last[1] - last[0] < minGlyph)) last[1] = run[1];
    else merged.push(run);
  }
  return merged.map(([a, b]) => [a - half, b - half]);
}

/**
 * 쌓인 글자를 한 글자씩 세워 가로로 늘어놓는다.
 *
 * 글자 사이는 검출 지도로는 이어져 보인다 (검출 모델은 줄 단위로 칠한다).
 * 그래서 세운 줄 이미지에서 행마다 밝기 대비를 잰다. 글자 사이 행에는 바탕만 있어
 * 대비가 뚝 떨어진다.
 */
function restack(source: HTMLCanvasElement, line: LineShape): SpineVariant | null {
  const glyph = line.thickness * 1.4;
  const scale = Math.min(MAX_UPSCALE, Math.max(1, TARGET_CROSS / (glyph * 1.6)));
  const along = line.length + line.thickness;
  const upright = drawUpright(source, line, glyph, along, scale);
  const ctx = upright.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width: w, height: h } = upright;
  const pixels = ctx.getImageData(0, 0, w, h).data;

  // 행마다 밝기의 퍼짐(표준편차)
  const spread = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let squares = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      sum += v;
      squares += v * v;
    }
    const mean = sum / w;
    spread[y] = Math.sqrt(Math.max(0, squares / w - mean * mean));
  }
  const sorted = Array.from(spread).sort((a, b) => a - b);
  const high = sorted[Math.floor(sorted.length * 0.8)];
  const low = sorted[Math.floor(sorted.length * 0.1)];
  const cut = low + (high - low) * 0.3;

  // 음절 크기. 쌓아 쓴 글자는 폭이 고르므로, 글자가 있는 열의 폭을 재면 된다.
  // 한글 음절은 거의 정사각형이라 높이도 이만하다.
  const columnInk = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let squares = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      const v = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      sum += v;
      squares += v * v;
    }
    const mean = sum / h;
    columnInk[x] = Math.sqrt(Math.max(0, squares / h - mean * mean));
  }
  const columnCut = Math.max(...columnInk) * 0.35;
  let left = 0;
  let right = w - 1;
  while (left < right && columnInk[left] < columnCut) left++;
  while (right > left && columnInk[right] < columnCut) right--;
  const size = Math.max(glyph * scale * 0.6, right - left + 1);

  const runs: [number, number][] = [];
  let from = -1;
  for (let y = 0; y <= h; y++) {
    const ink = y < h && spread[y] > cut;
    if (ink && from < 0) from = y;
    if (!ink && from >= 0) {
      runs.push([from, y - 1]);
      from = -1;
    }
  }
  const merged = groupSyllables(runs, size);
  // 붙어 있는 글자는 크기로 나눈다.
  const cells: [number, number][] = [];
  for (const [a, b] of merged) {
    const parts = Math.max(1, Math.round((b - a + 1) / size));
    for (let k = 0; k < parts; k++) {
      cells.push([a + ((b - a + 1) * k) / parts, a + ((b - a + 1) * (k + 1)) / parts]);
    }
  }
  if (cells.length < 3) {
    upright.width = 0;
    return null;
  }

  const tallest = Math.max(...cells.map(([a, b]) => b - a));
  const pad = Math.round(size * 0.15);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cells.length * (w + pad) + pad);
  canvas.height = Math.round(tallest + pad * 2);
  const out = canvas.getContext("2d");
  if (!out) return null;
  // 조각 사이는 책등 바탕색으로 채운다. 짙은 바탕 글자를 흰 캔버스에 붙이면
  // 조각마다 테두리가 생겨 "애애앵"이 "애해행"으로 읽혔다.
  out.fillStyle = medianColor(pixels);
  out.fillRect(0, 0, canvas.width, canvas.height);
  cells.forEach(([a, b], index) => {
    const top = Math.max(0, Math.floor(a - pad / 2));
    const height = Math.min(h - top, Math.ceil(b - a + pad));
    const dy = Math.round((canvas.height - height) / 2);
    out.drawImage(upright, 0, top, w, height, pad + index * (w + pad), dy, w, height);
  });
  upright.width = 0;
  return { deg: 0, invert: false, canvas };
}

/**
 * 조각을 음절로 묶는다.
 *
 * "콩"은 ㅋ·ㅗ 와 ㅇ 사이에도 틈이 있고, "앵"은 받침 때문에 폭보다 30% 넘게 길다.
 * 틈 하나하나를 보고 자를지 정하면 이런 음절이 반으로 갈린다. 그래서 전체를 한 번에
 * 본다: 음절 높이가 음절 크기에 가까울수록, 자르는 틈이 넓을수록 좋은 나눔이다.
 */
function groupSyllables(runs: [number, number][], size: number): [number, number][] {
  const n = runs.length;
  if (!n) return [];
  const groupCost = (from: number, to: number) => {
    const height = runs[to][1] - runs[from][0] + 1;
    const ratio = height / size;
    // 짧은 쪽보다 긴 쪽을 덜 벌한다. 받침 있는 음절은 길다.
    return ratio < 1 ? (1 - ratio) ** 2 * 1.5 : (ratio - 1.15) ** 2 * (ratio > 1.15 ? 1 : 0);
  };
  const cutCost = (at: number) => {
    const gap = runs[at + 1][0] - runs[at][1] - 1;
    return Math.max(0, 1 - gap / (0.3 * size));
  };
  const best = new Float64Array(n + 1).fill(Infinity);
  const back = new Int32Array(n + 1);
  best[0] = 0;
  for (let end = 1; end <= n; end++) {
    for (let start = 0; start < end; start++) {
      const cost = best[start] + groupCost(start, end - 1) + (start > 0 ? cutCost(start - 1) : 0);
      if (cost < best[end]) {
        best[end] = cost;
        back[end] = start;
      }
    }
  }
  const groups: [number, number][] = [];
  for (let end = n; end > 0; end = back[end]) groups.unshift([runs[back[end]][0], runs[end - 1][1]]);
  return groups;
}

/** 바탕색. 글자보다 바탕이 넓으므로 채널별 중앙값이면 된다. */
function medianColor(pixels: Uint8ClampedArray): string {
  const step = Math.max(1, Math.floor(pixels.length / 4 / 4000));
  const channels: number[][] = [[], [], []];
  for (let p = 0; p < pixels.length / 4; p += step) {
    for (let c = 0; c < 3; c++) channels[c].push(pixels[p * 4 + c]);
  }
  const mid = channels.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 255);
  return `rgb(${mid[0]}, ${mid[1]}, ${mid[2]})`;
}

/** 줄을 세워 자른다. 가로 cross, 세로 along (원본 px), 글자는 똑바로 선다. */
function drawUpright(
  source: HTMLCanvasElement,
  line: LineShape,
  cross: number,
  along: number,
  scale: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cross * scale));
  canvas.height = Math.max(1, Math.round(along * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.rotate(Math.atan(line.slope));
  ctx.translate(-line.cx, -line.cy);
  const reach = Math.hypot(cross, along) / 2 + 2;
  const sx = Math.max(0, Math.floor(line.cx - reach));
  const sy = Math.max(0, Math.floor(line.cy - reach));
  const sw = Math.min(source.width - sx, Math.ceil(reach * 2));
  const sh = Math.min(source.height - sy, Math.ceil(reach * 2));
  if (sw > 0 && sh > 0) ctx.drawImage(source, sx, sy, sw, sh, sx, sy, sw, sh);
  return canvas;
}

/** 줄 하나를 똑바로 세워 자른다. deg 는 SpineBand.crop 과 같은 뜻이다. */
function cropLine(
  source: HTMLCanvasElement,
  line: LineShape,
  deg: number,
  invert: boolean,
): SpineVariant {
  const cross = line.thickness * (1 + 2 * CROSS_MARGIN);
  const along = line.length + line.thickness * 2 * ALONG_MARGIN;
  const scale = Math.min(MAX_UPSCALE, Math.max(1, TARGET_CROSS / cross));
  const swap = deg % 180 !== 0;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((swap ? along : cross) * scale));
  canvas.height = Math.max(1, Math.round((swap ? cross : along) * scale));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const lean = Math.atan(line.slope);
    ctx.imageSmoothingQuality = "high";
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.scale(scale, scale);
    // 기운 줄을 세운다.
    ctx.rotate(lean);
    ctx.translate(-line.cx, -line.cy);
    const reach = Math.hypot(cross, along) / 2 + 2;
    const sx = Math.max(0, Math.floor(line.cx - reach));
    const sy = Math.max(0, Math.floor(line.cy - reach));
    const sw = Math.min(source.width - sx, Math.ceil(reach * 2));
    const sh = Math.min(source.height - sy, Math.ceil(reach * 2));
    if (sw > 0 && sh > 0) ctx.drawImage(source, sx, sy, sw, sh, sx, sy, sw, sh);
    if (invert) {
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < image.data.length; i += 4) {
        image.data[i] = 255 - image.data[i];
        image.data[i + 1] = 255 - image.data[i + 1];
        image.data[i + 2] = 255 - image.data[i + 2];
      }
      ctx.putImageData(image, 0, 0);
    }
  }
  return { deg, invert, canvas };
}
