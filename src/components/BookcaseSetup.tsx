import { useMemo, useState } from "react";
import {
  BOOKCASE_TEMPLATES,
  BOOK_KINDS,
  BOOK_KIND_ORDER,
  BOOKS_PER_SHOT,
  CUSTOM_TEMPLATE,
  MAX_COLUMNS,
  MAX_ROWS,
  MIN_COLUMNS,
  MIN_ROWS,
  SLOT_HEIGHT_RANGE,
  SLOT_WIDTH_RANGE,
  booksLostOnResize,
  booksPerSlot,
  partLabel,
  shotsFor,
  type Bookcase,
  type BookKind,
  type SlotSize,
} from "../lib/bookcase";

/** 설정 화면이 정하는 책장의 모양 */
export interface BookcaseShape {
  name: string;
  columns: number;
  rows: number;
  slotSize: SlotSize;
  bookKind: BookKind;
  template: string;
}

interface Props {
  /** 이미 있는 책장의 칸 수를 바꾸는 경우 */
  existing?: Bookcase;
  defaultName: string;
  defaultColumns: number;
  defaultRows: number;
  defaultSlotSize: SlotSize;
  /** 예전 책장에는 없다. 그때는 사용자가 새로 고른다. */
  defaultBookKind?: BookKind;
  defaultTemplate: string;
  onConfirm: (shape: BookcaseShape) => void;
  onCancel?: () => void;
}

/**
 * 첫 화면. 흔한 책장 크기에서 고르거나 칸 수와 칸 크기를 직접 맞추고, 책 두께를 고른다.
 * 미리보기가 바로 따라 바뀌고, 한 칸을 몇 번에 나눠 찍을지 미리 알려 준다.
 * 실제 책장과 같은 모양을 만들어 두는 것이 이 앱의 출발점이다.
 */
export function BookcaseSetup({
  existing,
  defaultName,
  defaultColumns,
  defaultRows,
  defaultSlotSize,
  defaultBookKind,
  defaultTemplate,
  onConfirm,
  onCancel,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [columns, setColumns] = useState(defaultColumns);
  const [rows, setRows] = useState(defaultRows);
  const [slotSize, setSlotSize] = useState<SlotSize>(defaultSlotSize);
  const [bookKind, setBookKind] = useState<BookKind | undefined>(defaultBookKind);
  const [template, setTemplate] = useState(defaultTemplate);
  /** 템플릿을 고르면 숫자는 접어 둔다. 대부분은 고칠 일이 없다. */
  const [editingNumbers, setEditingNumbers] = useState(false);
  const picked = BOOKCASE_TEMPLATES.find((item) => item.id === template);
  const showNumbers = !picked || editingNumbers;
  // 미리보기 전체가 이 높이를 넘지 않게 너비를 줄인다. 1칸 × 5줄 책장이 화면을 다 덮었다.
  const gridAspect = (columns * slotSize.width) / (rows * slotSize.height);

  const lost = useMemo(
    () => (existing ? booksLostOnResize(existing, columns, rows) : 0),
    [existing, columns, rows],
  );
  const shots = shotsFor({ slotSize, bookKind });
  const perSlot = bookKind ? booksPerSlot(slotSize, bookKind) : 0;

  /** 숫자를 손으로 바꾸면 더는 그 템플릿이 아니다. */
  const custom = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setTemplate(CUSTOM_TEMPLATE);
  };

  const pickTemplate = (id: string) => {
    setTemplate(id);
    const picked = BOOKCASE_TEMPLATES.find((item) => item.id === id);
    if (!picked) return;
    setColumns(picked.columns);
    setRows(picked.rows);
    setSlotSize(picked.slot);
  };

  const submit = () => {
    if (!bookKind) return;
    if (lost > 0 && !askBeforeLosingBooks(lost)) return;
    onConfirm({ name, columns, rows, slotSize, bookKind, template });
  };

  return (
    <section className="setup">
      <header className="setup-header">
        <h2>{existing ? "책장 칸 수 바꾸기" : "내 책장을 앱에 옮겨요"}</h2>
        <p className="hint">
          {existing ? "남는 칸의 책은 그대로 있습니다." : "비슷한 책장을 고르고, 다르면 숫자를 고쳐 주세요."}
        </p>
      </header>

      <div className="setup-body">
        <div className="setup-controls">
          {/* 흔한 책장 크기. 고르면 칸 수와 칸 크기가 채워진다. */}
          <fieldset className="choice-group" data-testid="templates">
            <legend>책장 종류</legend>
            <div className="choices">
              {BOOKCASE_TEMPLATES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`choice ${template === item.id ? "chosen" : ""}`}
                  aria-pressed={template === item.id}
                  onClick={() => pickTemplate(item.id)}
                  data-testid={`template-${item.id}`}
                >
                  <strong>{item.name}</strong>
                  <span>{item.detail}</span>
                </button>
              ))}
              <button
                type="button"
                className={`choice ${template === CUSTOM_TEMPLATE ? "chosen" : ""}`}
                aria-pressed={template === CUSTOM_TEMPLATE}
                onClick={() => setTemplate(CUSTOM_TEMPLATE)}
                data-testid={`template-${CUSTOM_TEMPLATE}`}
              >
                <strong>직접 맞추기</strong>
                <span>아래 숫자로</span>
              </button>
            </div>
          </fieldset>

          {/* 책 두께는 꼭 고른다. 한 칸에 몇 권쯤인지, 몇 번에 나눠 찍을지가 여기서 정해진다. */}
          <fieldset className="choice-group" data-testid="book-kinds">
            <legend>꽂힌 책은 대체로</legend>
            <div className="choices">
              {BOOK_KIND_ORDER.map((kind) => (
                <button
                  type="button"
                  key={kind}
                  className={`choice ${bookKind === kind ? "chosen" : ""}`}
                  aria-pressed={bookKind === kind}
                  onClick={() => setBookKind(kind)}
                  data-testid={`book-kind-${kind}`}
                >
                  <strong>{BOOK_KINDS[kind].label}</strong>
                  <span>{BOOK_KINDS[kind].detail}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>책장 이름</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="거실 책장"
              aria-label="책장 이름"
            />
          </label>

          {!showNumbers && picked && (
            <p className="template-summary" data-testid="template-summary">
              {columns}칸 × {rows}줄 · 칸 {slotSize.width}×{slotSize.height}cm{" "}
              <button type="button" className="link" onClick={() => setEditingNumbers(true)} data-testid="edit-numbers">
                숫자 고치기
              </button>
            </p>
          )}

          {showNumbers && (
            <>
          <NumberField
            label="가로 칸"
            unit="칸 수"
            value={columns}
            min={MIN_COLUMNS}
            max={MAX_COLUMNS}
            onChange={custom(setColumns)}
          />
          <NumberField
            label="세로 줄"
            unit="줄 수"
            value={rows}
            min={MIN_ROWS}
            max={MAX_ROWS}
            onChange={custom(setRows)}
          />
          <NumberField
            label="한 칸 너비"
            unit="칸 너비 cm"
            suffix="cm"
            hint="안쪽"
            value={slotSize.width}
            min={SLOT_WIDTH_RANGE.min}
            max={SLOT_WIDTH_RANGE.max}
            onChange={custom((width: number) => setSlotSize((previous) => ({ ...previous, width })))}
          />
          <NumberField
            label="한 칸 높이"
            unit="칸 높이 cm"
            suffix="cm"
            hint="안쪽"
            value={slotSize.height}
            min={SLOT_HEIGHT_RANGE.min}
            max={SLOT_HEIGHT_RANGE.max}
            onChange={custom((height: number) => setSlotSize((previous) => ({ ...previous, height })))}
          />
            </>
          )}

          <SlotPlan slotSize={slotSize} bookKind={bookKind} perSlot={perSlot} shots={shots} />

          {lost > 0 && (
            <p className="error">칸을 줄이면 {lost}권이 사라집니다. 확인 후 진행합니다.</p>
          )}
        </div>

        <div className="setup-preview">
          <div
            className="bookcase-frame preview"
            style={{
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              width: `min(100%, ${PREVIEW_HEIGHT * gridAspect}px)`,
            }}
            data-testid="setup-preview"
          >
            {/* 칸도 실제 모양(너비 ÷ 높이)대로 그린다. 긴 칸은 길게 보인다. */}
            {Array.from({ length: columns * rows }, (_, index) => (
              <div
                className="slot empty"
                key={index}
                style={{ aspectRatio: `${slotSize.width} / ${slotSize.height}` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="setup-actions">
        <button type="button" className="primary big" onClick={submit} disabled={!bookKind} data-testid="confirm-setup">
          {!bookKind ? "책 두께를 골라 주세요" : existing ? "칸 수 바꾸기" : "이 책장 만들기"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            취소
          </button>
        )}
      </div>
    </section>
  );
}

/** 책장 미리보기의 대략 최대 높이 (px). 칸 사이 틈과 테두리만큼 조금 넘는다. */
const PREVIEW_HEIGHT = 200;

/** 칸 모양 그림의 최대 높이 (px) */
const SHAPE_HEIGHT = 96;

/**
 * 한 칸의 모양을 그려 보이고, 몇 권쯤 들어가는지와 몇 번에 나눠 찍을지를 그 위에 보인다.
 * 숫자보다 그림이 실제 책장과 견주기 쉽다.
 */
function SlotPlan({
  slotSize,
  bookKind,
  perSlot,
  shots,
}: {
  slotSize: SlotSize;
  bookKind?: BookKind;
  perSlot: number;
  shots: number;
}) {
  const aspect = slotSize.width / slotSize.height;
  return (
    <div className="slot-shape" data-testid="setup-shots" data-shots={bookKind ? shots : 0}>
      {/* 높이를 묶으면 비율이 깨진다. 너비를 비율에 맞춰 줄인다. */}
      <div
        className="slot-shape-box"
        style={{ aspectRatio: `${slotSize.width} / ${slotSize.height}`, width: `min(100%, ${SHAPE_HEIGHT * aspect}px)` }}
        aria-hidden="true"
      >
        {Array.from({ length: bookKind ? shots : 1 }, (_, index) => (
          <span key={index}>{shots > 1 && bookKind ? index + 1 : ""}</span>
        ))}
      </div>
      <p className="hint">
        {!bookKind ? (
          "책 두께를 고르면 한 칸을 몇 번에 나눠 찍을지 알려 드려요."
        ) : shots > 1 ? (
          <>
            한 칸에 약 {perSlot}권 · <b>{shots}번에 나눠</b> 찍어요 (한 장에 {BOOKS_PER_SHOT}권 안팎).{" "}
            {partLabel(1, shots)}부터 차례로 안내해 드려요.
          </>
        ) : (
          `한 칸에 약 ${perSlot}권 · 한 번에 찍어요.`
        )}
      </p>
    </div>
  );
}

/** 칸을 줄여 책이 사라지는 경우에만 되묻는다. */
function askBeforeLosingBooks(lost: number): boolean {
  return window.confirm(`칸을 줄이면 ${lost}권이 사라집니다. 계속할까요?`);
}

interface NumberFieldProps {
  label: string;
  /** 읽어 주는 이름 */
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 숫자 뒤에 붙는 단위 ("cm") */
  suffix?: string;
  /** 이름 옆에 흐리게 붙는 설명 */
  hint?: string;
  onChange: (value: number) => void;
}

function NumberField({ label, unit, value, min, max, step = 1, suffix, hint, onChange }: NumberFieldProps) {
  const set = (next: number) => {
    if (!Number.isFinite(next)) return;
    onChange(Math.min(max, Math.max(min, Math.round(next / step) * step)));
  };
  // 치는 동안에는 범위를 강요하지 않는다. "116"을 치다 "1"에서 최솟값 20 으로 튀면 칠 수가 없다.
  // 범위 안의 숫자가 되면 바로 반영하고, 칸을 떠날 때 범위로 맞춘다.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="field number-field">
      <span>
        {label}
        {hint && <em> · {hint}</em>}
      </span>
      <div className="stepper">
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            set(value - step);
          }}
          disabled={value <= min}
          aria-label={`${unit} 줄이기`}
        >
          −
        </button>
        <input
          type="number"
          value={draft ?? value}
          min={min}
          max={max}
          step={step}
          inputMode="numeric"
          onChange={(event) => {
            setDraft(event.target.value);
            const typed = Number(event.target.value);
            if (event.target.value !== "" && typed >= min && typed <= max) set(typed);
          }}
          onBlur={() => {
            if (draft !== null && draft !== "") set(Number(draft));
            setDraft(null);
          }}
          aria-label={unit}
        />
        {suffix && <span className="suffix">{suffix}</span>}
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            set(value + step);
          }}
          disabled={value >= max}
          aria-label={`${unit} 늘리기`}
        >
          +
        </button>
      </div>
    </div>
  );
}
