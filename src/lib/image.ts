/**
 * OCR에 넣을 최대 크기.
 *
 * 한 칸에 얇은 책이 40권 넘게 꽂히면 책등 하나가 사진 가로의 2%도 안 된다.
 * 책등 두께를 절반으로 줄여 재 보면 제목이 제대로 읽힌 권수가 11권에서 4권으로,
 * 3분의 1로 줄이면 0권으로 떨어진다. 이 구간에서는 해상도가 곧 정확도다.
 * 그래서 휴대폰이 준 화소를 함부로 버리지 않는다.
 *
 * 경계 찾기는 어차피 1500px로 줄여서 하고, 잘라낸 책등도 목표 너비에 맞춰 다시
 * 키우므로, 이 값을 올려도 인식 시간은 거의 그대로다. 늘어나는 것은 메모리뿐이다.
 * 3600×2700이면 970만 화소로, 아이폰 사파리의 캔버스 한도(1670만) 안쪽이다.
 */
const MAX_EDGE = 3600;
const THUMB_EDGE = 240;

/**
 * 책등이 이 굵기(px) 아래로 내려가면 제목이 눈에 띄게 무너진다.
 *
 * 목표가 아니라 **바닥**이다. 실제 책장 사진 두 벌로 잰 값은 이렇다.
 *  - 같은 사진을 줄여 가며: 16px에서 0/37, 24px에서 4/37, 48px에서 11/37.
 *    25px 아래로는 가망이 없고, 40px 언저리까지는 굵어질수록 확실히 나아진다.
 *  - 같은 책장을 멀리서 가로로(책등 42px), 가까이서 세로로(책등 70px) 찍어
 *    같은 책들끼리 대 보면 7/23 대 6/23, 5/17 대 2/17. 화소가 1.7배여도
 *    나아지지 않았다. 이 위로는 굵기가 더 이상 제약이 아니다.
 *
 * 그래서 "굵을수록 좋다"가 아니라 "이 아래로만 가지 마라"로 쓴다.
 * 더 굵게 찍으려고 가까이 가면 원근이 심해져 오히려 손해를 봤다.
 */
export const TARGET_SPINE_PX = 40;

/** 사진 가로에서 책장이 실제로 차지하는 몫. 잘 찍어도 양옆에 벽이 조금 남는다. */
const SHELF_FILL = 0.85;

/**
 * 이 가로 크기의 사진 한 장에 몇 권까지 담을 수 있는지 (권장이 아니라 한도).
 * 기종마다 카메라가 주는 화소가 달라, 한도도 기종마다 달라야 한다.
 */
export function maxBooksPerShot(photoWidth: number): number {
  if (!photoWidth) return 0;
  return Math.max(1, Math.floor((photoWidth * SHELF_FILL) / TARGET_SPINE_PX));
}

/** 파일이나 캔버스를 OCR용 캔버스로 만든다. */
export async function toWorkingCanvas(source: Blob | HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const bitmap = source instanceof HTMLCanvasElement ? source : await createImageBitmap(source);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);

  if (!(source instanceof HTMLCanvasElement)) (bitmap as ImageBitmap).close?.();
  return canvas;
}

/** 미리보기용 작은 JPEG */
export function toThumbnail(canvas: HTMLCanvasElement): string {
  const scale = Math.min(1, THUMB_EDGE / Math.max(canvas.width, canvas.height));
  const thumb = document.createElement("canvas");
  thumb.width = Math.round(canvas.width * scale);
  thumb.height = Math.round(canvas.height * scale);
  thumb.getContext("2d")?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/jpeg", 0.7);
}
