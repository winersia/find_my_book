/**
 * 사용자가 고친 제목을 기억해 두었다가, 같은 책을 다시 찍으면 알아보고 채운다.
 *
 * 인식기가 끝내 못 읽는 책이 있다 (장식 글꼴, 아주 작은 글씨). 그런 책은 사용자가 한 번
 * 고쳐 주면, 다음부터는 그 책을 알아보는 것으로 충분하다. 알아보는 단서는 두 가지다.
 *  - 읽은 글자: 같은 책등은 다시 찍어도 비슷하게 틀린다 ("케첩 기차" → "지그기치").
 *  - 모양 지문: 책등을 아주 작게 줄인 무늬 (lines.ts 의 lookOf).
 * 같은 시리즈 책은 무늬가 닮아서 모양만으로는 믿지 않는다. 둘 다 맞아야 확인 없이 넘긴다.
 *
 * 기억은 이 기기의 localStorage 에만 둔다. 사진은 남기지 않는다.
 */
import { similarity } from "./text";

export interface MemoryEntry {
  title: string;
  /** 인식기가 이 책을 읽은 글자들. 원문과 다른 후보까지 */
  reads: string[];
  /** 모양 지문들. 찍을 때마다 하나씩, 최근 것 몇 개만 둔다 */
  looks: number[][];
  updatedAt: string;
}

export interface Rememberable {
  title: string;
  spineText: string;
  alternatives: string[];
  confidence: number;
  look?: number[];
  remembered?: "strong" | "weak";
}

const KEY = "find-my-book:memory:v1";
/** 이만큼만 기억한다. 넘치면 오래된 것부터 잊는다 */
const MAX_ENTRIES = 500;
const MAX_READS = 8;
const MAX_LOOKS = 3;

/**
 * 알아보는 기준 (bench/memory.mjs). 실제 책장 사진 31권과 그것을 다시 찍은 것처럼 바꾼 사진으로 쟀다.
 *  - 서로 다른 책끼리: 글자 닮음 최대 0.29, 모양 닮음 최대 0.79, 둘 다 0.5 넘는 쌍은 없었다.
 *  - 같은 책끼리(확인 대상): 글자 0~1.00, 모양 0.58~1.00.
 * 그래서 글자와 모양이 둘 다 맞으면 넘기고, 모양만 맞으면 다른 책끼리 최대보다 넉넉히 높아야
 * 미리 채우되 확인은 받는다.
 */
export const RECALL = {
  /** 글자와 모양이 둘 다 이만큼이면 확인 없이 넘긴다 */
  strongText: 0.45,
  strongLook: 0.7,
  /** 글자가 이만큼 같으면 그것만으로도 넘긴다 (똑같이 틀리게 읽힌 경우) */
  sameText: 0.95,
  /** 하나만 이만큼이면 미리 채우되 확인은 받는다 */
  weakText: 0.45,
  weakLook: 0.85,
};

export function loadMemory(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MemoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveMemory(entries: MemoryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // 저장 공간이 모자라면 이번 기억은 버린다. 앱은 그대로 쓴다.
  }
}

export function forgetAll(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 지울 수 없으면 그대로 둔다.
  }
}

export function memorySize(): number {
  return loadMemory().length;
}

/** 사용자가 확인하거나 고친 책을 기억한다. 제목이 같으면 한 항목에 모은다. */
export function remember(books: Rememberable[]): void {
  const usable = books.filter((book) => book.title.trim() && book.look?.length);
  if (!usable.length) return;
  const entries = loadMemory();
  const now = new Date().toISOString();
  for (const book of usable) {
    const reads = readsOf(book);
    const key = book.title.trim();
    const index = entries.findIndex((entry) => entry.title === key);
    const entry: MemoryEntry =
      index >= 0 ? entries.splice(index, 1)[0] : { title: key, reads: [], looks: [], updatedAt: now };
    entry.reads = [...reads, ...entry.reads].filter((text, i, list) => list.indexOf(text) === i).slice(0, MAX_READS);
    entry.looks = [book.look!, ...entry.looks].slice(0, MAX_LOOKS);
    entry.updatedAt = now;
    // 최근에 쓴 것을 앞에 둔다. 넘치면 뒤에서부터 잊는다.
    entries.unshift(entry);
  }
  saveMemory(entries);
}

/**
 * 이 책의 제목 줄을 인식기가 읽은 글자. "다르게 읽기" 후보에는 같은 책등의 다른 줄(시리즈명,
 * 저자)도 섞여 있어 빼야 한다. 같은 시리즈 책끼리 그 줄이 겹쳐 다른 책을 알아본다고 착각했다.
 * 기억할 때는 사용자가 고치기 전 제목을 쓴다 (원문 spineText 가 그것을 담는다).
 */
function readsOf(book: Rememberable): string[] {
  return [book.spineText].filter((text) => text.trim());
}

/** 두 지문이 얼마나 닮았는지 (-1~1). 둘 다 평균 0, 퍼짐 1 로 맞춰 두었으므로 상관계수다. */
export function lookSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum / a.length;
}

/** 이 책이 기억 속 항목과 얼마나 닮았는지 */
export function matchScore(book: Rememberable, entry: MemoryEntry): { text: number; look: number } {
  const reads = readsOf(book);
  let text = 0;
  for (const read of reads) for (const known of entry.reads) text = Math.max(text, similarity(read, known));
  let look = 0;
  if (book.look?.length) for (const known of entry.looks) look = Math.max(look, lookSimilarity(book.look, known));
  return { text, look };
}

/**
 * 확인이 필요한 책 가운데 기억 속 책과 닮은 것을 찾아 제목을 채운다.
 * 기억 하나는 한 번 찍을 때 한 권에만 쓴다. 닮은 쌍부터 차례로 짝짓는다.
 */
export function recall<T extends Rememberable>(books: T[], needsHelp: (book: T) => boolean): T[] {
  const entries = loadMemory();
  if (!entries.length) return books;
  const pairs: { book: number; entry: number; level: "strong" | "weak"; score: number }[] = [];
  books.forEach((book, b) => {
    if (!needsHelp(book)) return;
    entries.forEach((entry, e) => {
      const { text, look } = matchScore(book, entry);
      const strong = (text >= RECALL.strongText && look >= RECALL.strongLook) || text >= RECALL.sameText;
      const weak = text >= RECALL.weakText || look >= RECALL.weakLook;
      if (strong || weak) pairs.push({ book: b, entry: e, level: strong ? "strong" : "weak", score: text + look });
    });
  });
  pairs.sort((p, q) => (p.level === q.level ? q.score - p.score : p.level === "strong" ? -1 : 1));
  const usedBooks = new Set<number>();
  const usedEntries = new Set<number>();
  const out = [...books];
  for (const pair of pairs) {
    if (usedBooks.has(pair.book) || usedEntries.has(pair.entry)) continue;
    usedBooks.add(pair.book);
    usedEntries.add(pair.entry);
    const book = out[pair.book];
    const title = entries[pair.entry].title;
    out[pair.book] = {
      ...book,
      title,
      alternatives: [book.title, ...book.alternatives].filter((text, i, list) => text && text !== title && list.indexOf(text) === i),
      // 둘 다 맞으면 사용자가 예전에 확인한 제목이니 다시 묻지 않는다.
      confidence: pair.level === "strong" ? Math.max(book.confidence, 0.95) : book.confidence,
      remembered: pair.level,
    };
  }
  return out;
}
