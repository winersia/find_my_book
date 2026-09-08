import { useMemo, useState } from "react";
import type { RecognizedBook } from "../lib/types";

interface Props {
  books: RecognizedBook[];
  imageCount: number;
  elapsedMs: number;
  usedFallback: boolean;
  onSave: (books: RecognizedBook[]) => void;
  onDiscard: () => void;
}

/** 이 아래로 떨어지면 대개 옆 책 글자가 섞인 오독이다. 기본 선택에서 빼 둔다. */
const TRUST_THRESHOLD = 0.6;

export function ScanResults({ books, imageCount, elapsedMs, usedFallback, onSave, onDiscard }: Props) {
  const [edited, setEdited] = useState<RecognizedBook[]>(books);
  const [excluded, setExcluded] = useState<Set<number>>(
    () => new Set(books.flatMap((book, index) => (book.confidence < TRUST_THRESHOLD ? [index] : []))),
  );

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

  /** 글자 방향을 잘못 골랐을 때 다음 후보로 바꿔 끼운다. */
  const cycle = (index: number) => {
    const book = edited[index];
    const [next, ...rest] = book.alternatives;
    if (!next) return;
    update(index, { title: next, alternatives: [...rest, book.title], match: undefined });
  };

  if (books.length === 0) {
    return (
      <section className="results empty">
        <h2>글자를 읽지 못했어요</h2>
        <p>책등이 화면에 꽉 차도록 더 가까이에서, 정면으로 다시 찍어 주세요.</p>
        <button type="button" onClick={onDiscard}>
          다시 찍기
        </button>
      </section>
    );
  }

  return (
    <section className="results">
      <header className="results-header">
        <h2>{edited.length}권을 읽었어요</h2>
        <p className="meta">
          사진 {imageCount}장 · {(elapsedMs / 1000).toFixed(0)}초
        </p>
      </header>

      {usedFallback && (
        <p className="notes">
          책등 경계를 나누지 못해 사진 전체에서 글자만 골라냈습니다. 결과가 거칠 수 있어요.
        </p>
      )}
      <p className="notes">
        잘못 읽은 제목은 눌러서 고칠 수 있습니다.
        {excluded.size > 0 && ` 흐리게 읽힌 ${excluded.size}권은 선택에서 빼 두었어요.`}
      </p>

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
                  {book.match && (
                    <span className="badge" title="Open Library에서 찾은 책">
                      제목 보정됨
                    </span>
                  )}
                  {book.match?.firstPublishYear && (
                    <span className="badge">{book.match.firstPublishYear}</span>
                  )}
                  {book.spineText && book.spineText !== book.title && (
                    <span className="badge subtle" title="책등에서 읽은 원문">
                      원문 “{book.spineText}”
                    </span>
                  )}
                  {book.alternatives.length > 0 && (
                    <button type="button" className="badge link" onClick={() => cycle(index)}>
                      다르게 읽기 “{shorten(book.alternatives[0])}”
                    </button>
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

function shorten(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
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
