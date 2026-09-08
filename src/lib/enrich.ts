import { similarity } from "./text";
import type { BookMatch, RecognizedBook } from "./types";

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

/**
 * OCR로 읽은 제목을 Open Library에서 찾아 정식 제목으로 고치고 표지를 붙인다.
 * 오탈자 교정 역할도 한다. 네트워크가 막혀 있으면 조용히 원본을 그대로 둔다.
 */
export async function enrichBooks(books: RecognizedBook[]): Promise<RecognizedBook[]> {
  const result = [...books];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(CONCURRENCY, books.length) }, async () => {
    while (cursor < result.length) {
      const index = cursor++;
      const book = result[index];
      const match = await lookup(book.spineText || book.title);
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
