import type { SpineReading } from "./ocr";
import type { BookMatch } from "./types";

/**
 * 실제 책장을 그대로 옮긴 자료 구조.
 * 책장 하나가 가로 columns × 세로 rows 칸으로 이루어지고, 칸마다 책이 왼쪽부터 순서대로 들어간다.
 */
export interface Bookcase {
  id: string;
  name: string;
  /** 가로 칸 수 */
  columns: number;
  /** 세로 칸 수 */
  rows: number;
  /** 길이는 rows * columns. 왼쪽 위부터 행 우선으로 채운다. */
  slots: Slot[];
  createdAt: string;
}

export interface Slot {
  books: ShelfBook[];
  /** 이 칸을 마지막으로 찍은 사진 (작은 미리보기) */
  photo?: string;
  scannedAt?: string;
}

export interface ShelfBook {
  id: string;
  /** 비어 있으면 화면에서 "제목 미상"으로 보여 준다 */
  title: string;
  author: string;
  /** OCR 원문 */
  spineText: string;
  /** 다른 방향/모델로 읽은 후보들 */
  alternatives: string[];
  /** 0~1 */
  confidence: number;
  /** 책등 대표 색 */
  color: string;
  /** 칸 안에서 차지하는 두께 비율 */
  widthRatio: number;
  match?: BookMatch;
}

export const DEFAULT_COLUMNS = 8;
export const DEFAULT_ROWS = 2;
export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 12;
export const MIN_ROWS = 1;
export const MAX_ROWS = 8;
/** 신뢰도가 이 아래면 "확인 필요"로 표시한다 */
export const LOW_CONFIDENCE = 0.6;

const STORAGE_KEY = "find-my-book:bookcases:v1";

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptySlot(): Slot {
  return { books: [] };
}

export function createBookcase(name: string, columns: number, rows: number): Bookcase {
  const safeColumns = clamp(columns, MIN_COLUMNS, MAX_COLUMNS);
  const safeRows = clamp(rows, MIN_ROWS, MAX_ROWS);
  return {
    id: createId(),
    name: name.trim() || "내 책장",
    columns: safeColumns,
    rows: safeRows,
    slots: Array.from({ length: safeColumns * safeRows }, emptySlot),
    createdAt: new Date().toISOString(),
  };
}

export function slotIndex(bookcase: Pick<Bookcase, "columns">, row: number, column: number): number {
  return row * bookcase.columns + column;
}

/**
 * 칸 이름. 설정 화면에서 쓴 "줄"과 "칸"을 그대로 쓴다.
 * "1층"은 책장 맨 아래를 뜻할 수도 있어 헷갈린다. 화면에 보이는 대로 위에서부터 센다.
 */
export function slotLabel(bookcase: Pick<Bookcase, "columns">, index: number): string {
  const row = Math.floor(index / bookcase.columns) + 1;
  const column = (index % bookcase.columns) + 1;
  return `${row}번째 줄 ${column}번째 칸`;
}

/** 이름 뒤에 붙일 조사를 고른다. "내 책장을", "거실 책장을" 처럼 어색하지 않게. */
export function withParticle(name: string, withFinal: string, withoutFinal: string): string {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  if (!isHangul) return `${name}${withFinal}`;
  return `${name}${(code - 0xac00) % 28 > 0 ? withFinal : withoutFinal}`;
}

export function countBooks(bookcase: Bookcase): number {
  return bookcase.slots.reduce((sum, slot) => sum + slot.books.length, 0);
}

/**
 * 칸 수를 바꾼다. 남는 칸의 책은 유지하고, 잘려 나가는 칸의 책은 버린다.
 * 몇 권이 버려지는지는 booksLostOnResize 로 미리 알 수 있다.
 */
export function resizeBookcase(bookcase: Bookcase, columns: number, rows: number): Bookcase {
  const safeColumns = clamp(columns, MIN_COLUMNS, MAX_COLUMNS);
  const safeRows = clamp(rows, MIN_ROWS, MAX_ROWS);
  const slots: Slot[] = [];

  for (let row = 0; row < safeRows; row++) {
    for (let column = 0; column < safeColumns; column++) {
      const old =
        row < bookcase.rows && column < bookcase.columns
          ? bookcase.slots[slotIndex(bookcase, row, column)]
          : undefined;
      slots.push(old ?? emptySlot());
    }
  }

  return { ...bookcase, columns: safeColumns, rows: safeRows, slots };
}

/** 칸 수를 이렇게 바꾸면 몇 권이 사라지는지 */
export function booksLostOnResize(bookcase: Bookcase, columns: number, rows: number): number {
  let lost = 0;
  for (let row = 0; row < bookcase.rows; row++) {
    for (let column = 0; column < bookcase.columns; column++) {
      if (row < rows && column < columns) continue;
      lost += bookcase.slots[slotIndex(bookcase, row, column)]?.books.length ?? 0;
    }
  }
  return lost;
}

function updateSlot(bookcase: Bookcase, index: number, change: (slot: Slot) => Slot): Bookcase {
  const slots = bookcase.slots.map((slot, position) => (position === index ? change(slot) : slot));
  return { ...bookcase, slots };
}

/** 촬영 결과로 칸 내용을 통째로 바꾼다. */
export function setSlotBooks(
  bookcase: Bookcase,
  index: number,
  books: ShelfBook[],
  photo?: string,
): Bookcase {
  return updateSlot(bookcase, index, () => ({
    books,
    photo,
    scannedAt: new Date().toISOString(),
  }));
}

export function clearSlot(bookcase: Bookcase, index: number): Bookcase {
  return updateSlot(bookcase, index, () => emptySlot());
}

export function updateBook(
  bookcase: Bookcase,
  index: number,
  bookId: string,
  patch: Partial<ShelfBook>,
): Bookcase {
  return updateSlot(bookcase, index, (slot) => ({
    ...slot,
    books: slot.books.map((book) => (book.id === bookId ? { ...book, ...patch } : book)),
  }));
}

export function removeBook(bookcase: Bookcase, index: number, bookId: string): Bookcase {
  return updateSlot(bookcase, index, (slot) => ({
    ...slot,
    books: slot.books.filter((book) => book.id !== bookId),
  }));
}

export function addBook(bookcase: Bookcase, index: number, title = ""): Bookcase {
  return updateSlot(bookcase, index, (slot) => ({
    ...slot,
    books: [...slot.books, blankBook(title)],
  }));
}

/** 칸 안에서 책을 한 자리 옮긴다. */
export function moveBook(
  bookcase: Bookcase,
  index: number,
  bookId: string,
  direction: -1 | 1,
): Bookcase {
  return updateSlot(bookcase, index, (slot) => {
    const from = slot.books.findIndex((book) => book.id === bookId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= slot.books.length) return slot;
    const books = [...slot.books];
    [books[from], books[to]] = [books[to], books[from]];
    return { ...slot, books };
  });
}

/** 책을 다른 칸으로 옮긴다. 옮긴 칸의 맨 뒤에 붙는다. */
export function moveBookToSlot(
  bookcase: Bookcase,
  from: number,
  bookId: string,
  to: number,
): Bookcase {
  if (from === to) return bookcase;
  const book = bookcase.slots[from]?.books.find((item) => item.id === bookId);
  if (!book) return bookcase;

  const slots = bookcase.slots.map((slot, index) => {
    if (index === from) return { ...slot, books: slot.books.filter((item) => item.id !== bookId) };
    if (index === to) return { ...slot, books: [...slot.books, book] };
    return slot;
  });
  return { ...bookcase, slots };
}

/**
 * 인식 결과를 칸에 꽂을 책으로 바꾼다.
 *
 * 사진 왼쪽부터의 순서를 그대로 지키고, 같은 제목이 두 번 읽혀도 두 권으로 남긴다.
 * 제목을 못 읽은 책등도 자리를 지운다. 실제 권수와 순서가 맞아야 손으로 고칠 수 있다.
 */
export function booksFromReadings(readings: SpineReading[]): ShelfBook[] {
  return readings.map((reading) => ({
    id: createId(),
    title: reading.text,
    author: "",
    spineText: reading.raw,
    alternatives: reading.alternatives,
    confidence: reading.confidence,
    color: reading.color,
    widthRatio: reading.widthRatio,
  }));
}

export function blankBook(title = ""): ShelfBook {
  return {
    id: createId(),
    title,
    author: "",
    spineText: "",
    alternatives: [],
    confidence: 1,
    color: "#8a7f6d",
    widthRatio: 0.08,
  };
}

/* 저장 */

export function loadBookcases(): Bookcase[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Bookcase[];
    return Array.isArray(parsed) ? parsed.filter(isBookcase) : [];
  } catch {
    return [];
  }
}

export function saveBookcases(bookcases: Bookcase[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookcases));
  } catch {
    // 저장 공간이 없거나 프라이빗 모드일 수 있다. 화면 상태는 그대로 둔다.
  }
}

function isBookcase(value: unknown): value is Bookcase {
  const candidate = value as Bookcase;
  return (
    Boolean(candidate) &&
    typeof candidate.id === "string" &&
    Array.isArray(candidate.slots) &&
    typeof candidate.columns === "number" &&
    typeof candidate.rows === "number"
  );
}

/* 내보내기 */

export function toCsv(bookcases: Bookcase[]): string {
  const header = ["책장", "층", "칸", "순서", "제목", "저자", "책등 원문", "신뢰도"];
  const rows: string[][] = [];

  for (const bookcase of bookcases) {
    bookcase.slots.forEach((slot, index) => {
      const row = Math.floor(index / bookcase.columns) + 1;
      const column = (index % bookcase.columns) + 1;
      slot.books.forEach((book, order) => {
        rows.push([
          bookcase.name,
          String(row),
          String(column),
          String(order + 1),
          book.title || "제목 미상",
          book.author || book.match?.author || "",
          book.spineText,
          book.confidence.toFixed(2),
        ]);
      });
    });
  }

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

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, Math.round(value)));
}
