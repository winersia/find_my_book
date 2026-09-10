import { LOW_CONFIDENCE, slotLabel, type Bookcase } from "../lib/bookcase";

interface Props {
  bookcase: Bookcase;
  selected: number | null;
  onSelect: (index: number) => void;
}

/**
 * 늘 보이는 책장 그림.
 * 칸마다 꽂힌 책을 책등 모양으로 그린다. 색과 두께는 사진에서 뽑은 값을 쓰기 때문에
 * 실제 책장과 비슷하게 보인다.
 */
export function BookcaseView({ bookcase, selected, onSelect }: Props) {
  return (
    <div
      className="bookcase-frame"
      style={{ gridTemplateColumns: `repeat(${bookcase.columns}, 1fr)` }}
      data-testid="bookcase"
    >
      {bookcase.slots.map((slot, index) => {
        const isSelected = selected === index;
        const label = slotLabel(bookcase, index);
        return (
          <button
            type="button"
            key={index}
            className={`slot ${isSelected ? "selected" : ""} ${slot.books.length === 0 ? "empty" : ""}`}
            onClick={() => onSelect(index)}
            aria-label={`${label}, ${slot.books.length}권`}
            aria-pressed={isSelected}
            data-slot={index}
            data-count={slot.books.length}
          >
            <span className="slot-books">
              {slot.books.map((book) => (
                <span
                  key={book.id}
                  className={`spine ${book.confidence < LOW_CONFIDENCE ? "unsure" : ""}`}
                  style={{
                    background: book.color,
                    flexGrow: Math.max(1, Math.round(book.widthRatio * 100)),
                  }}
                  title={book.title || "제목 미상"}
                >
                  <span className="spine-title">{book.title || "?"}</span>
                </span>
              ))}
            </span>
            {slot.books.length === 0 && <span className="slot-hint">비어 있음</span>}
          </button>
        );
      })}
    </div>
  );
}
