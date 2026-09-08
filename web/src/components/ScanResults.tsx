import { useMemo, useState } from "react";
import type { RecognizedBook, ScanMeta } from "../lib/types";

interface Props {
  books: RecognizedBook[];
  notes: string;
  meta: ScanMeta;
  onSave: (books: RecognizedBook[]) => void;
  onDiscard: () => void;
}

export function ScanResults({ books, notes, meta, onSave, onDiscard }: Props) {
  const [edited, setEdited] = useState<RecognizedBook[]>(books);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  const selected = useMemo(
    () => edited.filter((_, index) => !excluded.has(index)),
    [edited, excluded],
  );

  const toggle = (index: number) => {
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const update = (index: number, patch: Partial<RecognizedBook>) => {
    setEdited((previous) =>
      previous.map((book, position) => (position === index ? { ...book, ...patch } : book)),
    );
  };

  if (books.length === 0) {
    return (
      <section className="results empty">
        <h2>책을 찾지 못했습니다</h2>
        <p>{notes || "책등 글자가 보이도록 조금 더 가까이에서 다시 찍어 주세요."}</p>
        <button type="button" onClick={onDiscard}>
          다시 찍기
        </button>
      </section>
    );
  }

  return (
    <section className="results">
      <header className="results-header">
        <h2>{edited.length}권을 찾았어요</h2>
        <p className="meta">
          사진 {meta.imageCount}장 · {(meta.elapsedMs / 1000).toFixed(1)}초 · {meta.model}
        </p>
      </header>

      {notes && <p className="notes">메모: {notes}</p>}

      <ul className="book-list">
        {edited.map((book, index) => {
          const isExcluded = excluded.has(index);
          return (
            <li key={index} className={`book-card ${isExcluded ? "excluded" : ""}`}>
              <label className="pick">
                <input type="checkbox" checked={!isExcluded} onChange={() => toggle(index)} />
              </label>

              {book.match?.coverUrl ? (
                <img className="cover" src={book.match.coverUrl} alt="" loading="lazy" />
              ) : (
                <div className="cover placeholder" aria-hidden="true">
                  {book.title.slice(0, 1)}
                </div>
              )}

              <div className="fields">
                <input
                  className="title-input"
                  value={book.title}
                  onChange={(event) => update(index, { title: event.target.value })}
                  aria-label="제목"
                />
                <input
                  className="author-input"
                  value={book.author}
                  placeholder="저자 (선택)"
                  onChange={(event) => update(index, { author: event.target.value })}
                  aria-label="저자"
                />
                <div className="badges">
                  <ConfidenceBadge value={book.confidence} />
                  {book.publisher && <span className="badge">{book.publisher}</span>}
                  {book.match?.firstPublishYear && (
                    <span className="badge">{book.match.firstPublishYear}</span>
                  )}
                  {book.spineText && book.spineText !== book.title && (
                    <span className="badge subtle" title="책등에서 읽은 원문">
                      “{book.spineText}”
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="results-actions">
        <button
          type="button"
          className="primary"
          onClick={() => onSave(selected)}
          disabled={selected.length === 0}
        >
          선택한 {selected.length}권 서재에 담기
        </button>
        <button type="button" onClick={onDiscard}>
          버리고 다시 찍기
        </button>
      </div>
    </section>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const level = value >= 0.8 ? "high" : value >= 0.5 ? "mid" : "low";
  const label = level === "high" ? "확실" : level === "mid" ? "보통" : "불확실";
  return (
    <span className={`badge confidence ${level}`}>
      {label} {Math.round(value * 100)}%
    </span>
  );
}
