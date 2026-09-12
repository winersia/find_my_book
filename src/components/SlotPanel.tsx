import { LOW_CONFIDENCE, slotLabel, type Bookcase, type ShelfBook } from "../lib/bookcase";

interface Props {
  bookcase: Bookcase;
  index: number;
  onScan: () => void;
  onUpdateBook: (bookId: string, patch: Partial<ShelfBook>) => void;
  onRemoveBook: (bookId: string) => void;
  onMoveBook: (bookId: string, direction: -1 | 1) => void;
  onMoveToSlot: (bookId: string, target: number) => void;
  onAddBook: () => void;
  onClearSlot: () => void;
}

/** 고른 칸의 책을 손보는 곳. 순서 바꾸기, 빼기, 넣기, 제목 고치기가 모두 여기서 된다. */
export function SlotPanel({
  bookcase,
  index,
  onScan,
  onUpdateBook,
  onRemoveBook,
  onMoveBook,
  onMoveToSlot,
  onAddBook,
  onClearSlot,
}: Props) {
  const slot = bookcase.slots[index];
  const label = slotLabel(bookcase, index);

  return (
    <section className="slot-panel" data-testid="slot-panel">
      <header className="slot-panel-header">
        <h2>{label}</h2>
        <span className="meta">{slot.books.length}권</span>
      </header>

      <div className="slot-panel-actions">
        <button type="button" className="primary" onClick={onScan} data-testid="scan-slot">
          {slot.books.length === 0 ? "이 칸 촬영하기" : "이 칸 다시 찍기"}
        </button>
        <button type="button" onClick={onAddBook}>
          책 직접 넣기
        </button>
        {slot.books.length > 0 && (
          <button type="button" className="danger" onClick={onClearSlot}>
            칸 비우기
          </button>
        )}
      </div>

      {slot.books.length === 0 ? (
        <p className="notes">
          아직 비어 있어요. 이 칸만 화면에 꽉 차게 찍으면 꽂힌 순서 그대로 채워집니다.
        </p>
      ) : (
        <ol className="slot-books-list">
          {slot.books.map((book, order) => (
            <li key={book.id} className="slot-book" data-order={order}>
              <span className="order">{order + 1}</span>
              <span className="swatch" style={{ background: book.color }} aria-hidden="true" />

              <div className="fields">
                <input
                  className="title-input"
                  value={book.title}
                  placeholder="제목 미상 — 직접 적어 주세요"
                  onChange={(event) => onUpdateBook(book.id, { title: event.target.value })}
                  aria-label={`${order + 1}번째 책 제목`}
                />
                <input
                  className="author-input"
                  value={book.author}
                  placeholder="저자 (선택)"
                  onChange={(event) => onUpdateBook(book.id, { author: event.target.value })}
                  aria-label={`${order + 1}번째 책 저자`}
                />
                <div className="badges">
                  {book.confidence < LOW_CONFIDENCE && <span className="badge confidence low">확인 필요</span>}
                  {book.match && (
                    <span className="badge" data-testid="match-badge" title={book.match.title}>
                      확인됨
                      {book.match.firstPublishYear ? ` · ${book.match.firstPublishYear}` : ""}
                      {book.match.isbn ? ` · ISBN ${book.match.isbn}` : ""}
                    </span>
                  )}
                  {book.spineText && book.spineText !== book.title && (
                    <span className="badge subtle">원문 “{book.spineText}”</span>
                  )}
                  {book.alternatives.length > 0 && (
                    <button
                      type="button"
                      className="badge link"
                      onClick={() => cycle(book, onUpdateBook)}
                    >
                      “{shorten(book.alternatives[0])}”로 바꾸기
                    </button>
                  )}
                </div>
              </div>

              <div className="book-tools">
                <button
                  type="button"
                  onClick={() => onMoveBook(book.id, -1)}
                  disabled={order === 0}
                  aria-label={`${order + 1}번째 책 왼쪽으로`}
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => onMoveBook(book.id, 1)}
                  disabled={order === slot.books.length - 1}
                  aria-label={`${order + 1}번째 책 오른쪽으로`}
                >
                  →
                </button>
                <select
                  value=""
                  onChange={(event) => {
                    if (event.target.value) onMoveToSlot(book.id, Number(event.target.value));
                  }}
                  aria-label={`${order + 1}번째 책 옮기기`}
                >
                  <option value="">옮기기…</option>
                  {bookcase.slots.map((_, target) =>
                    target === index ? null : (
                      <option value={target} key={target}>
                        {slotLabel(bookcase, target)}
                      </option>
                    ),
                  )}
                </select>
                <button
                  type="button"
                  className="remove"
                  onClick={() => onRemoveBook(book.id)}
                  aria-label={`${order + 1}번째 책 빼기`}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** 인식이 남긴 다음 후보로 바꾼다. 한 바퀴 돌면 원래 제목으로 돌아온다. */
function cycle(book: ShelfBook, onUpdateBook: Props["onUpdateBook"]): void {
  const [next, ...rest] = book.alternatives;
  if (!next) return;
  onUpdateBook(book.id, { title: next, alternatives: [...rest, book.title], match: undefined });
}

function shorten(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}…` : value;
}
