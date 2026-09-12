import { useMemo, useState } from "react";
import {
  MAX_COLUMNS,
  MAX_ROWS,
  MIN_COLUMNS,
  MIN_ROWS,
  booksLostOnResize,
  type Bookcase,
} from "../lib/bookcase";

interface Props {
  /** 이미 있는 책장의 칸 수를 바꾸는 경우 */
  existing?: Bookcase;
  defaultName: string;
  defaultColumns: number;
  defaultRows: number;
  onConfirm: (name: string, columns: number, rows: number) => void;
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
  onConfirm,
  onCancel,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [columns, setColumns] = useState(defaultColumns);
  const [rows, setRows] = useState(defaultRows);

  const lost = useMemo(
    () => (existing ? booksLostOnResize(existing, columns, rows) : 0),
    [existing, columns, rows],
  );

  const submit = () => {
    if (lost > 0 && !askBeforeLosingBooks(lost)) return;
    onConfirm(name, columns, rows);
  };

  return (
    <section className="setup">
      <header className="setup-header">
        <h2>{existing ? "책장 칸 수 바꾸기" : "내 책장을 앱에 옮겨요"}</h2>
        <p className="hint">
          {existing ? "남는 칸의 책은 그대로 있습니다." : "실제 책장과 같은 칸 수로 맞춰 주세요."}
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
            {Array.from({ length: columns * rows }, (_, index) => (
              <div className="slot empty" key={index} />
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
  onChange: (value: number) => void;
}

function NumberField({ label, unit, value, min, max, onChange }: NumberFieldProps) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));

  return (
    <div className="field number-field">
      <span>{label}</span>
      <div className="stepper">
        <button
          type="button"
          onClick={() => set(value - 1)}
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
          onChange={(event) => set(Number(event.target.value))}
          aria-label={unit}
        />
        <button
          type="button"
          onClick={() => set(value + 1)}
          disabled={value >= max}
          aria-label={`${unit} 늘리기`}
        >
          +
        </button>
      </div>
    </div>
  );
}
