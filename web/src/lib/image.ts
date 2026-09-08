const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/**
 * 사진을 긴 변 1600px 이하 JPEG data URL로 줄인다.
 * 업로드 용량을 줄이고 인식 속도를 높이기 위한 전처리다.
 */
export async function downscaleToDataUrl(source: Blob | HTMLCanvasElement): Promise<string> {
  const bitmap =
    source instanceof HTMLCanvasElement ? source : await createImageBitmap(source);

  const width = bitmap.width;
  const height = bitmap.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("캔버스를 만들 수 없습니다.");
  context.drawImage(bitmap as CanvasImageSource, 0, 0, targetWidth, targetHeight);

  if (!(source instanceof HTMLCanvasElement)) {
    (bitmap as ImageBitmap).close?.();
  }
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
