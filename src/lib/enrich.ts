import { similarity } from "./text";
import type { BookMatch } from "./types";

const SEARCH_URL = "https://openlibrary.org/search.json";
const TIMEOUT_MS = 7000;
const CONCURRENCY = 3;
/** 이만큼은 닮아야 같은 책으로 본다. OCR 오탈자를 감안해 느슨하게 잡았다. */
const MIN_SIMILARITY = 0.55;

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  isbn?: string[];
  key?: string;
}

/** 제목 보정에 필요한 최소한의 모양. 책장에 꽂힌 책이든 인식 직후 결과든 이 모양이면 된다. */
interface Enrichable {
  title: string;
  author: string;
  spineText: string;
  /** 다른 방향으로 읽은 후보들. 다듬은 제목으로 못 찾으면 이것도 넣어 본다. */
  alternatives?: string[];
  match?: BookMatch;
}

/**
 * Open Library에서 찾아 정식 제목과 표지, ISBN을 붙인다.
 *
 * 이건 맞춤법 교정기가 아니다. Open Library 검색은 낱말 검색이라
 * "Refactorin" 처럼 한 글자가 틀리면 아무것도 찾지 못한다 (퍼지 검색도 없다).
 * 제목이 이미 충분히 맞을 때 정식 표기로 다듬고 표지를 붙여 주는 역할이다.
 * 네트워크가 막혀 있으면 조용히 원본을 그대로 둔다.
 */
export async function enrichBooks<T extends Enrichable>(books: T[]): Promise<T[]> {
  const result = [...books];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(CONCURRENCY, books.length) }, async () => {
    while (cursor < result.length) {
      const index = cursor++;
      const book = result[index];
      // 다듬은 제목이 가장 잘 찾힌다. 원문은 옆 책 글자가 섞여 있어 검색이 자주 빗나간다.
      const match = await lookupAny([book.title, book.spineText, ...(book.alternatives ?? [])]);
      if (!match) continue;
      result[index] = {
        ...book,
        // 충분히 닮았을 때만 제목을 갈아 끼운다. 어중간하면 원문을 남긴다.
        title: match.similarity >= 0.7 ? match.title : book.title,
        author: book.author || match.author,
        match,
      };
    }
  });

  await Promise.all(workers);
  return result;
}

/** 여러 후보로 차례로 찾아보고 처음 걸리는 것을 쓴다. */
async function lookupAny(queries: string[]): Promise<BookMatch | undefined> {
  const seen = new Set<string>();
  for (const query of queries) {
    const key = query.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const match = await lookup(query);
    if (match) return match;
  }
  return undefined;
}

async function lookup(query: string): Promise<BookMatch | undefined> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return undefined;

  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("limit", "3");
  url.searchParams.set("fields", "title,author_name,first_publish_year,cover_i,isbn,key");

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return undefined;

    const payload = (await response.json()) as { docs?: OpenLibraryDoc[] };
    const scored = (payload.docs ?? [])
      .filter((doc): doc is OpenLibraryDoc & { title: string } => Boolean(doc.title))
      .map((doc) => ({ doc, score: similarity(trimmed, doc.title) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < MIN_SIMILARITY) return undefined;

    return {
      title: best.doc.title,
      author: best.doc.author_name?.join(", ") ?? "",
      firstPublishYear: best.doc.first_publish_year,
      isbn: best.doc.isbn?.[0],
      coverUrl: best.doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${best.doc.cover_i}-M.jpg`
        : undefined,
      infoUrl: best.doc.key ? `https://openlibrary.org${best.doc.key}` : undefined,
      similarity: best.score,
    };
  } catch {
    // 오프라인이거나 조회가 막혔다. 인식 결과만으로도 목록은 만들 수 있다.
    return undefined;
  }
}
