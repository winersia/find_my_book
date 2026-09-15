import { LOW_CONFIDENCE, slotLabel, type Bookcase } from "../lib/bookcase";

interface Props {
  bookcase: Bookcase;
  selected: number | null;
  onSelect: (index: number) => void;
}

/**
 * 늘 보이는 책장 그림.
 * 칸마다 꽂힌 책을 책등 모양으로 그린다. 색과 두께는 사진에서 뽑은 값이라 실제 책장과 닮는다.
 * 빈 칸은 글자 대신 + 로 비어 있음을 알린다. 칸이 작아 글자는 읽히지 않고 소음만 된다.
 */
export function BookcaseView({ bookcase, selected, onSelect }: Props) {
  return (
    <div className="bookcase-scroll">
      <div
        className="bookcase-frame"
        // 책장 전체가 한눈에 들어오는 것이 이 앱의 핵심이다. 칸을 줄여서라도 폭에 맞춘다.
        // 칸이 34px 아래로 내려갈 만큼 많으면 그때만 가로로 넘긴다.
        style={{ gridTemplateColumns: `repeat(${bookcase.columns}, minmax(34px, 1fr))` }}
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
              aria-label={slot.books.length === 0 ? `${label}, 비어 있음` : `${label}, ${slot.books.length}권`}
              aria-pressed={isSelected}
              title={label}
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
              {slot.books.length === 0 && (
                <span className="slot-plus" aria-hidden="true">
                  +
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
