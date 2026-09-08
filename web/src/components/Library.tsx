import { useMemo, useState } from "react";
import { download, toCsv } from "../lib/storage";
import type { SavedBook } from "../lib/types";

interface Props {
  books: SavedBook[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function Library({ books, onRemove, onClear }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return books;
    return books.filter((book) =>
      [book.title, book.author, book.publisher, book.match?.author ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [books, query]);

  if (books.length === 0) {
    return (
      <section className="library empty">
        <h2>서재가 비어 있어요</h2>
        <p>책장을 찍어 첫 책을 담아 보세요.</p>
      </section>
    );
  }

  return (
    <section className="library">
      <header className="library-header">
        <h2>내 서재 {books.length}권</h2>
        <div className="library-tools">
          <input
            type="search"
            value={query}
            placeholder="제목이나 저자 검색"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="서재 검색"
          />
          <button
            type="button"
            onClick={() => download("내서재.csv", toCsv(books), "text/csv")}
          >
            CSV 내려받기
          </button>
          <button
            type="button"
            onClick={() =>
              download("내서재.json", JSON.stringify(books, null, 2), "application/json")
            }
          >
            JSON
          </button>
          <button type="button" className="danger" onClick={onClear}>
            전체 비우기
          </button>
        </div>
      </header>

      <ul className="book-list">
        {filtered.map((book) => (
          <li key={book.id} className="book-card">
            {book.match?.coverUrl ? (
              <img className="cover" src={book.match.coverUrl} alt="" loading="lazy" />
            ) : (
              <div className="cover placeholder" aria-hidden="true">
                {book.title.slice(0, 1)}
              </div>
            )}
            <div className="fields static">
              <p className="title">{book.title}</p>
              <p className="author">{book.author || book.match?.author || "저자 미상"}</p>
              <div className="badges">
                {book.publisher && <span className="badge">{book.publisher}</span>}
                {book.match?.isbn && <span className="badge subtle">ISBN {book.match.isbn}</span>}
                {book.match?.infoUrl && (
                  <a className="badge link" href={book.match.infoUrl} target="_blank" rel="noreferrer">
                    정보 보기
                  </a>
                )}
              </div>
            </div>
            <button
              type="button"
              className="remove"
              onClick={() => onRemove(book.id)}
              aria-label={`${book.title} 삭제`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {filtered.length === 0 && <p className="notes">검색 결과가 없습니다.</p>}
    </section>
  );
}
