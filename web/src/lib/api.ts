import type { ScanResponse } from "./types";

/** 책장 사진을 서버로 보내 책 목록을 받아온다. */
export async function scanShelf(images: string[], enrich = true): Promise<ScanResponse> {
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images, enrich }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `서버 오류 (${response.status})`);
  }
  return (await response.json()) as ScanResponse;
}
