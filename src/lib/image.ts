/**
 * OCR에 넣을 최대 크기.
 *
 * 한 칸에 얇은 책이 40권 넘게 꽂히면 책등 하나가 사진 가로의 2%도 안 된다.
 * 2000px로 줄이면 책등이 20px 남짓이라 한글 획이 뭉개져 무엇을 해도 못 읽는다.
 * 요즘 휴대폰 사진은 대개 3000px 이상이라 이만큼은 남겨 둬야 한다.
 */
const MAX_EDGE = 2600;
const THUMB_EDGE = 240;

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
