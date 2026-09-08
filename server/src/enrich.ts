import type { BookMatch, RecognizedBook } from "./types.js";

const SEARCH_URL = "https://openlibrary.org/search.json";
const TIMEOUT_MS = 6000;
const CONCURRENCY = 4;

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  isbn?: string[];
  key?: string;
}

/**
 * Open Library에서 표지/ISBN/출간연도를 찾아 붙인다.
 * 네트워크가 막혀 있으면 조용히 원본을 그대로 돌려준다.
 */
export async function enrichBooks(books: RecognizedBook[]): Promise<RecognizedBook[]> {
  const result = [...books];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(CONCURRENCY, books.length) }, async () => {
    while (cursor < result.length) {
      const index = cursor++;
      const book = result[index];
      const match = await lookup(book);
      if (match) {
        result[index] = { ...book, match };
      }
    }
  });

  await Promise.all(workers);
  return result;
}

async function lookup(book: RecognizedBook): Promise<BookMatch | undefined> {
  const query = [book.title, book.author].filter(Boolean).join(" ").trim();
  if (!query) return undefined;

  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("fields", "title,author_name,first_publish_year,cover_i,isbn,key");

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "find-my-book/0.1 (bookshelf scanner)" },
    });
    if (!response.ok) return undefined;

    const payload = (await response.json()) as { docs?: OpenLibraryDoc[] };
    const doc = payload.docs?.[0];
    if (!doc?.title) return undefined;

    return {
      title: doc.title,
      author: doc.author_name?.join(", ") ?? "",
      firstPublishYear: doc.first_publish_year,
      isbn: doc.isbn?.[0],
      coverUrl: doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
        : undefined,
      infoUrl: doc.key ? `https://openlibrary.org${doc.key}` : undefined,
    };
  } catch {
    // 조회 실패는 치명적이지 않다. 인식 결과는 그대로 쓴다.
    return undefined;
  }
}
