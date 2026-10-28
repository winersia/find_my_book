import { useMemo, useState } from "react";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  MAX_SLOT_ASPECT,
  MIN_COLUMNS,
  MIN_ROWS,
  MIN_SLOT_ASPECT,
  SLOT_ASPECT_STEP,
  booksLostOnResize,
  partLabel,
  shotsForSlot,
  type Bookcase,
} from "../lib/bookcase";

interface Props {
  /** 이미 있는 책장의 칸 수를 바꾸는 경우 */
  existing?: Bookcase;
  defaultName: string;
  defaultColumns: number;
  defaultRows: number;
  /** 한 칸의 가로 ÷ 높이 */
  defaultSlotAspect: number;
  onConfirm: (name: string, columns: number, rows: number, slotAspect: number) => void;
  onCancel?: () => void;
}

/**
 * 첫 화면. 왼쪽에서 칸 수를 조절하면 오른쪽 미리보기가 바로 따라 바뀐다.
 * 실제 책장과 같은 모양을 만들어 두는 것이 이 앱의 출발점이다.
 */
export function BookcaseSetup({
  existing,
  defaultName,
  defaultColumns,
  defaultRows,
  defaultSlotAspect,
  onConfirm,
  onCancel,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [columns, setColumns] = useState(defaultColumns);
  const [rows, setRows] = useState(defaultRows);
  const [slotAspect, setSlotAspect] = useState(defaultSlotAspect);
  const shots = shotsForSlot(slotAspect);

  const lost = useMemo(
    () => (existing ? booksLostOnResize(existing, columns, rows) : 0),
    [existing, columns, rows],
  );

  const submit = () => {
    if (lost > 0 && !askBeforeLosingBooks(lost)) return;
    onConfirm(name, columns, rows, slotAspect);
  };

  return (
    <section className="setup">
      <header className="setup-header">
        <h2>{existing ? "책장 칸 수 바꾸기" : "내 책장을 앱에 옮겨요"}</h2>
        <p className="hint">
          {existing ? "남는 칸의 책은 그대로 있습니다." : "실제 책장과 같은 칸 수와 칸 모양으로 맞춰 주세요."}
        </p>
      </header>

      <div className="setup-body">
        <div className="setup-controls">
          <label className="field">
            <span>책장 이름</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="거실 책장"
              aria-label="책장 이름"
            />
          </label>

          <NumberField
            label="가로 칸"
            unit="칸 수"
            value={columns}
            min={MIN_COLUMNS}
            max={MAX_COLUMNS}
            onChange={setColumns}
          />
          <NumberField
            label="세로 줄"
            unit="줄 수"
            value={rows}
            min={MIN_ROWS}
            max={MAX_ROWS}
            onChange={setRows}
          />

          {/* 긴 칸은 한 장에 담으면 책등이 작아져 제목이 무너진다. 몇 번에 나눠 찍을지 미리 알린다. */}
          <NumberField
            label="한 칸의 가로 길이"
            unit="가로가 높이의 몇 배"
            suffix="배"
            value={slotAspect}
            min={MIN_SLOT_ASPECT}
            max={MAX_SLOT_ASPECT}
            step={SLOT_ASPECT_STEP}
            onChange={setSlotAspect}
            hint="칸 높이의 몇 배인지"
          />
          <SlotShape aspect={slotAspect} shots={shots} />

          {lost > 0 && (
            <p className="error">칸을 줄이면 {lost}권이 사라집니다. 확인 후 진행합니다.</p>
          )}

        </div>

        <div className="setup-preview">
          <div
            className="bookcase-frame preview"
            style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
            data-testid="setup-preview"
          >
            {/* 칸도 실제 모양(가로 ÷ 높이)대로 그린다. 긴 칸은 길게 보인다. */}
            {Array.from({ length: columns * rows }, (_, index) => (
              <div className="slot empty" key={index} style={{ aspectRatio: `${slotAspect} / 1` }} />
            ))}
          </div>
        </div>
      </div>

      <div className="setup-actions">
        <button type="button" className="primary big" onClick={submit}>
          {existing ? "칸 수 바꾸기" : "이 책장 만들기"}
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

/** 칸 모양 그림의 최대 높이 (px) */
const SHAPE_HEIGHT = 96;

/**
 * 한 칸의 모양을 그려 보이고, 몇 번에 나눠 찍을지 그 위에 나눠 보인다.
 * 숫자보다 그림이 실제 책장과 견주기 쉽다.
 */
function SlotShape({ aspect, shots }: { aspect: number; shots: number }) {
  return (
    <div className="slot-shape" data-testid="setup-shots" data-shots={shots}>
      {/* 높이를 120px 로 묶으면 비율이 깨진다. 너비를 비율에 맞춰 줄인다. */}
      <div
        className="slot-shape-box"
        style={{ aspectRatio: `${aspect} / 1`, width: `min(100%, ${SHAPE_HEIGHT * aspect}px)` }}
        aria-hidden="true"
      >
        {Array.from({ length: shots }, (_, index) => (
          <span key={index}>{shots > 1 ? index + 1 : ""}</span>
        ))}
      </div>
      <p className="hint">
        {shots > 1 ? (
          <>
            한 칸을 <b>{shots}번에 나눠</b> 찍어요. {partLabel(1, shots)}부터 차례로 안내해 드려요.
          </>
        ) : (
          "한 칸을 한 번에 찍어요."
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
  /** 숫자 뒤에 붙는 단위 ("배") */
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

  return (
    <div className="field number-field">
      <span>
        {label}
        {hint && <em> · {hint}</em>}
      </span>
      <div className="stepper">
        <button
          type="button"
          onClick={() => set(value - step)}
          disabled={value <= min}
          aria-label={`${unit} 줄이기`}
        >
          −
        </button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          inputMode={step < 1 ? "decimal" : "numeric"}
          onChange={(event) => set(Number(event.target.value))}
          aria-label={unit}
        />
        {suffix && <span className="suffix">{suffix}</span>}
        <button
          type="button"
          onClick={() => set(value + step)}
          disabled={value >= max}
          aria-label={`${unit} 늘리기`}
        >
          +
        </button>
      </div>
    </div>
  );
}
