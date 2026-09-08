import { normalize } from "./text";
import type { RecognizedBook, SavedBook } from "./types";

const STORAGE_KEY = "find-my-book:library:v1";

/** 같은 책인지 가리는 열쇠. 공백, 문장부호, 대소문자를 무시한다. */
export function dedupeKey(book: Pick<RecognizedBook, "title" | "author">): string {
  return `${normalize(book.title)}|${normalize(book.author).slice(0, 12)}`;
}

export function loadLibrary(): SavedBook[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedBook[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLibrary(books: SavedBook[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
  } catch {
    // 저장 공간이 없거나 프라이빗 모드일 수 있다. 화면 상태는 그대로 둔다.
  }
}

export interface MergeResult {
  library: SavedBook[];
  added: number;
  skipped: number;
}

/** 이미 있는 책은 건너뛰고 새 책만 서재에 더한다. */
export function mergeIntoLibrary(library: SavedBook[], incoming: RecognizedBook[]): MergeResult {
  const seen = new Set(library.map(dedupeKey));
  const next = [...library];
  let added = 0;
  let skipped = 0;

  for (const book of incoming) {
    const key = dedupeKey(book);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    next.push({ ...book, id: createId(), savedAt: new Date().toISOString() });
    added += 1;
  }

  return { library: next, added, skipped };
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toCsv(books: SavedBook[]): string {
  const header = ["제목", "저자", "책등 원문", "신뢰도", "ISBN", "저장일"];
  const rows = books.map((book) => [
    book.title,
    book.author || book.match?.author || "",
    book.spineText,
    book.confidence.toFixed(2),
    book.match?.isbn ?? "",
    book.savedAt.slice(0, 10),
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

/** 파일로 내려받는다. CSV는 엑셀 호환을 위해 BOM을 붙인다. */
export function download(filename: string, content: string, mime: string): void {
  const body = mime.startsWith("text/csv") ? `﻿${content}` : content;
  const blob = new Blob([body], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
