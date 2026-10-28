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
  /** 한 칸의 안쪽 크기 (cm). 책장 템플릿이 채우고 사용자가 고친다. */
  slotSize?: SlotSize;
  /** 꽂힌 책이 대체로 얼마나 두꺼운지. 한 칸에 몇 권쯤 들어가는지, 몇 번에 나눠 찍을지가 여기서 정해진다. */
  bookKind?: BookKind;
  /** 고른 책장 템플릿 (BOOKCASE_TEMPLATES 의 id). 손으로 고치면 "custom" */
  template?: string;
  createdAt: string;
}

/** 칸 안쪽 크기 (cm) */
export interface SlotSize {
  width: number;
  height: number;
}

export type BookKind = "thin" | "normal" | "mixed";

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
  /** 결과 화면에서만 쓰는 책등 그림. 칸에 넣을 때 뺀다 (저장 공간을 먹는다). */
  preview?: string;
  /** 결과 화면에서만 쓰는 책등 모양 지문 (memory.ts). 칸에 넣을 때 뺀다. */
  look?: number[];
  /** 기억해 둔 제목으로 채웠는지. strong 이면 확인 없이 넘어간다 (memory.ts). */
  remembered?: "strong" | "weak";
}

export const DEFAULT_COLUMNS = 8;
export const DEFAULT_ROWS = 2;
export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 12;
export const MIN_ROWS = 1;
export const MAX_ROWS = 8;
/**
 * 책 두께 고르기. 정확도를 가르는 것은 사진 한 장에 담긴 권수라(책등 하나에 실리는 화소),
 * 한 칸에 몇 권쯤 들어가는지 알면 몇 번에 나눠 찍을지 미리 정할 수 있다.
 * 두께는 흔한 책으로 잡은 어림값이다. 양장 그림책 32~48쪽은 1cm 안팎, 소설·단행본은 2cm 안팎.
 */
export const BOOK_KINDS: Record<BookKind, { label: string; detail: string; thicknessCm: number }> = {
  thin: { label: "얇은 책 위주", detail: "그림책·동화책, 1cm 안팎", thicknessCm: 1 },
  normal: { label: "보통 두께 위주", detail: "소설·단행본, 2cm 안팎", thicknessCm: 2.2 },
  mixed: { label: "섞여 있어요", detail: "얇은 책과 두꺼운 책이 반반쯤", thicknessCm: 1.5 },
};
export const BOOK_KIND_ORDER: BookKind[] = ["thin", "normal", "mixed"];

export interface BookcaseTemplate {
  id: string;
  name: string;
  /** 고를 때 함께 보이는 크기 설명 */
  detail: string;
  columns: number;
  rows: number;
  slot: SlotSize;
}

/**
 * 가정에서 흔한 책장 크기. 칸 크기는 안쪽 어림값이다 (폭 80cm 책장의 안쪽은 76cm 남짓,
 * A4 가 들어가게 칸 높이는 30cm 안팎). 실제와 다르면 사용자가 숫자를 고친다.
 */
export const BOOKCASE_TEMPLATES: BookcaseTemplate[] = [
  { id: "shelf-3", name: "3단 책장", detail: "폭 80cm · 칸 76×30cm", columns: 1, rows: 3, slot: { width: 76, height: 30 } },
  { id: "shelf-5", name: "5단 책장", detail: "폭 80cm · 칸 76×30cm", columns: 1, rows: 5, slot: { width: 76, height: 30 } },
  { id: "shelf-5-wide", name: "5단 책장 2열", detail: "폭 120cm · 칸 57×30cm", columns: 2, rows: 5, slot: { width: 57, height: 30 } },
  { id: "low-wide", name: "낮은 와이드 책장", detail: "폭 120cm · 칸 116×30cm", columns: 1, rows: 2, slot: { width: 116, height: 30 } },
  { id: "cube-2x2", name: "큐브 수납장 2×2", detail: "칸 33×33cm", columns: 2, rows: 2, slot: { width: 33, height: 33 } },
  { id: "cube-4x2", name: "큐브 수납장 4×2", detail: "칸 33×33cm", columns: 4, rows: 2, slot: { width: 33, height: 33 } },
];
export const CUSTOM_TEMPLATE = "custom";
/** 직접 맞출 때 처음 값. 가로 8 × 세로 2 는 처음부터의 기본값이다. */
export const DEFAULT_SLOT_SIZE: SlotSize = { width: 40, height: 30 };
export const SLOT_WIDTH_RANGE = { min: 20, max: 240 };
export const SLOT_HEIGHT_RANGE = { min: 15, max: 60 };

/** 책이 칸 너비에서 차지하는 몫. 꽉 채워 꽂아도 끝에 조금 남는다. */
const SLOT_FILL = 0.9;

/**
 * 사진 한 장에 담을 권수. 실제 책장 사진에서 한 장에 29권은 19권(66%)을 맞게 읽었고,
 * 같은 칸을 두 배 넓게 이어 붙인 58권은 30권(52%)으로 떨어졌다. 재 본 것 가운데 좋았던 쪽이다.
 * 얇은 그림책으로 잰 값이다. 책이 두꺼워도 한 장의 권수가 같으면 책등 하나의 화소는 같다고 본다.
 * (docs/시나리오.md 의 M1 에서 다시 잰다.)
 */
export const BOOKS_PER_SHOT = 30;

/** 이 크기의 칸에 이런 책이 대략 몇 권 들어가는지 */
export function booksPerSlot(slot: SlotSize, kind: BookKind): number {
  return Math.max(1, Math.round((slot.width * SLOT_FILL) / BOOK_KINDS[kind].thicknessCm));
}

/**
 * 이 책장의 칸 하나를 몇 번에 나눠 찍을지. 왼쪽부터 같은 너비로 나눈다.
 * 칸 크기나 책 두께를 모르는 예전 책장은 예전처럼 한 번에 찍는다.
 */
export function shotsFor(bookcase: Pick<Bookcase, "slotSize" | "bookKind">): number {
  const { slotSize, bookKind } = bookcase;
  if (!slotSize || !bookKind || !BOOK_KINDS[bookKind]) return 1;
  return Math.max(1, Math.ceil(booksPerSlot(slotSize, bookKind) / BOOKS_PER_SHOT));
}

/** 나눠 찍을 때 이번 장이 칸의 어디인지. part 는 1부터 센다. */
export function partLabel(part: number, parts: number): string {
  if (parts <= 1) return "칸 전체";
  if (parts === 2) return part === 1 ? "왼쪽 절반" : "오른쪽 절반";
  if (parts === 3) return ["왼쪽", "가운데", "오른쪽"][part - 1] + " 3분의 1";
  if (part === 1) return `맨 왼쪽 ${parts}분의 1`;
  if (part === parts) return `맨 오른쪽 ${parts}분의 1`;
  return `왼쪽에서 ${part}번째 ${parts}분의 1`;
}
/** 신뢰도가 이 아래면 "확인 필요"로 표시한다 */
export const LOW_CONFIDENCE = 0.6;

/**
 * 결과 화면에서 사용자가 눈으로 확인해야 하는 확신도. 이보다 낮으면 확인 전에는 칸에 못 넣는다.
 * 처음에는 0.85 였다. 실제 책장 사진 왼쪽 10권에서 틀린 것은 0.69~0.80 이었다. 29권 전부를 재 보니
 * 한 글자만 틀린 제목이 0.86~0.91 에 셋 있었다 ("옴사탕이뭘까", "영리한 거미아난서").
 * 틀린 제목이 확인 없이 들어가는 쪽이 더 나빠 올렸다. 바르게 읽은 0.88·0.90 도 확인을 받는다.
 */
export const REVIEW_BELOW = 0.92;

/** 칸에 넣기 전에 사용자가 확인해야 하는 책인지. 제목을 못 읽은 책도 확인 대상이다. */
export function needsReview(book: Pick<ShelfBook, "title" | "confidence">): boolean {
  return !book.title.trim() || book.confidence < REVIEW_BELOW;
}

const STORAGE_KEY = "find-my-book:bookcases:v1";

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptySlot(): Slot {
  return { books: [] };
}

export function createBookcase(
  name: string,
  columns: number,
  rows: number,
  shape: Pick<Bookcase, "slotSize" | "bookKind" | "template"> = {},
): Bookcase {
  const safeColumns = clamp(columns, MIN_COLUMNS, MAX_COLUMNS);
  const safeRows = clamp(rows, MIN_ROWS, MAX_ROWS);
  return {
    id: createId(),
    name: name.trim() || "내 책장",
    columns: safeColumns,
    rows: safeRows,
    slots: Array.from({ length: safeColumns * safeRows }, emptySlot),
    ...shape,
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
    preview: reading.preview,
    look: reading.look,
  }));
}

/**
 * 나눠 찍은 결과를 앞 결과 뒤에 이어 붙인다.
 *
 * 한 칸을 두세 번에 나눠 찍으면 이음매가 조금씩 겹친다. 겹친 책은 같은 제목으로
 * 두 번 들어가므로, 이음매 근처에서 제목이 똑같은 것만 조용히 뺀다.
 * 제목을 못 읽은 책은 손대지 않는다. 빈 제목끼리는 같은 책인지 알 수 없다.
 */
export function appendBatch(existing: ShelfBook[], incoming: ShelfBook[]): ShelfBook[] {
  const key = (book: ShelfBook) => book.title.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
  const SEAM = 3;
  const tail = new Set(existing.slice(-SEAM).map(key).filter((value) => value.length >= 2));

  const added: ShelfBook[] = [];
  for (const [index, book] of incoming.entries()) {
    if (index < SEAM && tail.has(key(book))) continue;
    added.push(book);
  }
  return [...existing, ...added];
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
