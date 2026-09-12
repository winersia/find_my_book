import { useCallback, useEffect, useMemo, useState } from "react";
import { BookcaseSetup } from "./components/BookcaseSetup";
import { BookcaseView } from "./components/BookcaseView";
import { ScanSheet } from "./components/ScanSheet";
import { SlotPanel } from "./components/SlotPanel";
import {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  addBook,
  clearSlot,
  countBooks,
  createBookcase,
  download,
  loadBookcases,
  moveBook,
  moveBookToSlot,
  removeBook,
  resizeBookcase,
  saveBookcases,
  setSlotBooks,
  slotLabel,
  toCsv,
  updateBook,
  withParticle,
  type Bookcase,
  type ShelfBook,
} from "./lib/bookcase";

const SETTINGS_KEY = "find-my-book:settings:v1";

interface Settings {
  langs: "kor+eng" | "eng";
  enrich: boolean;
}

type Screen = "setup" | "bookcase";

export default function App() {
  const [bookcases, setBookcases] = useState<Bookcase[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("setup");
  /** 칸 수를 바꾸는 중인지 (새로 만드는 것과 구분) */
  const [resizing, setResizing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [settings, setSettings] = useState<Settings>({ langs: "kor+eng", enrich: true });

  useEffect(() => {
    const stored = loadBookcases();
    setBookcases(stored);
    if (stored.length > 0) {
      setCurrentId(stored[0].id);
      setScreen("bookcase");
    }
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings((previous) => ({ ...previous, ...(JSON.parse(raw) as Partial<Settings>) }));
    } catch {
      // 설정을 못 읽어도 기본값으로 동작한다.
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    // 되돌릴 수 있는 알림은 조금 더 오래 둔다.
    const timer = setTimeout(() => setToast(null), toast.undo ? 6000 : 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const current = useMemo(
    () => bookcases.find((bookcase) => bookcase.id === currentId) ?? null,
    [bookcases, currentId],
  );

  /** 책장 하나를 바꾸고 곧바로 저장한다. 편집 결과가 새로고침에도 남아야 한다. */
  const commit = useCallback((id: string, change: (bookcase: Bookcase) => Bookcase) => {
    setBookcases((previous) => {
      const next = previous.map((bookcase) => (bookcase.id === id ? change(bookcase) : bookcase));
      saveBookcases(next);
      return next;
    });
  }, []);

  /**
   * 책을 빼거나 칸을 비우는 것처럼 되돌리고 싶어질 만한 변경.
   * 확인 창으로 막는 대신 일단 해 주고 되돌릴 길을 남긴다. 흐름이 끊기지 않는다.
   */
  const commitUndoable = useCallback(
    (id: string, change: (bookcase: Bookcase) => Bookcase, message: string) => {
      setBookcases((previous) => {
        const before = previous.find((bookcase) => bookcase.id === id);
        const next = previous.map((bookcase) => (bookcase.id === id ? change(bookcase) : bookcase));
        saveBookcases(next);
        if (before) {
          setToast({
            message,
            undo: () =>
              setBookcases((current) => {
                const restored = current.map((bookcase) => (bookcase.id === id ? before : bookcase));
                saveBookcases(restored);
                setToast(null);
                return restored;
              }),
          });
        }
        return next;
      });
    },
    [],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // 저장에 실패해도 이번 세션에는 적용된다.
      }
      return next;
    });
  }, []);

  const confirmSetup = useCallback(
    (name: string, columns: number, rows: number) => {
      if (resizing && current) {
        commit(current.id, (bookcase) => ({ ...resizeBookcase(bookcase, columns, rows), name }));
        setResizing(false);
        setSelected(null);
        setToast({ message: "책장 칸 수를 바꿨어요." });
      } else {
        const bookcase = createBookcase(name, columns, rows);
        setBookcases((previous) => {
          const next = [...previous, bookcase];
          saveBookcases(next);
          return next;
        });
        setCurrentId(bookcase.id);
        setToast({ message: `${withParticle(bookcase.name, "을", "를")} 만들었어요. 칸을 눌러 채워 보세요.` });
      }
      setScreen("bookcase");
    },
    [commit, current, resizing],
  );

  const applyScan = useCallback(
    (books: ShelfBook[], photo: string) => {
      if (!current || selected === null) return;
      const had = current.slots[selected].books.length;
      const message = `${slotLabel(current, selected)}에 ${books.length}권을 넣었어요.`;
      if (had > 0) {
        commitUndoable(current.id, (bookcase) => setSlotBooks(bookcase, selected, books, photo), message);
      } else {
        commit(current.id, (bookcase) => setSlotBooks(bookcase, selected, books, photo));
        setToast({ message });
      }
      setScanning(false);
    },
    [commit, current, selected],
  );

  const removeBookcase = useCallback(() => {
    if (!current) return;
    if (!window.confirm(`${withParticle(current.name, "을", "를")} 지울까요? 담긴 책도 함께 사라집니다.`)) return;
    setBookcases((previous) => {
      const next = previous.filter((bookcase) => bookcase.id !== current.id);
      saveBookcases(next);
      setCurrentId(next[0]?.id ?? null);
      setScreen(next.length > 0 ? "bookcase" : "setup");
      return next;
    });
    setSelected(null);
  }, [current]);

  if (screen === "setup" || !current) {
    const editing = resizing && current ? current : undefined;
    return (
      <div className="app">
        <Header title="책장 스캐너" />
        <main>
          <BookcaseSetup
            existing={editing}
            defaultName={editing?.name ?? (bookcases.length > 0 ? `책장 ${bookcases.length + 1}` : "내 책장")}
            defaultColumns={editing?.columns ?? DEFAULT_COLUMNS}
            defaultRows={editing?.rows ?? DEFAULT_ROWS}
            onConfirm={confirmSetup}
            onCancel={
              bookcases.length > 0
                ? () => {
                    setResizing(false);
                    setScreen("bookcase");
                  }
                : undefined
            }
          />
        </main>
        {toast && <Toast message={toast.message} onUndo={toast.undo} />}
      </div>
    );
  }

  const total = countBooks(current);

  return (
    <div className="app">
      <Header title={current.name} subtitle={`${current.columns}×${current.rows}칸 · ${total}권`}>
        {bookcases.length > 1 && (
          <select
            className="bookcase-switch"
            value={current.id}
            onChange={(event) => {
              setCurrentId(event.target.value);
              setSelected(null);
            }}
            aria-label="책장 고르기"
          >
            {bookcases.map((bookcase) => (
              <option value={bookcase.id} key={bookcase.id}>
                {bookcase.name}
              </option>
            ))}
          </select>
        )}
      </Header>

      <main>
        <BookcaseView
          bookcase={current}
          selected={selected}
          onSelect={(index) => setSelected(index === selected ? null : index)}
        />

        {selected === null ? (
          <p className="call-to-action" data-testid="pick-slot">
            {total === 0
              ? "채우고 싶은 칸을 눌러 주세요. 그 칸만 사진으로 찍으면 꽂힌 순서 그대로 들어갑니다."
              : "칸을 누르면 그 칸의 책을 보고 고칠 수 있어요."}
          </p>
        ) : (
          <SlotPanel
            bookcase={current}
            index={selected}
            onScan={() => setScanning(true)}
            onUpdateBook={(bookId, patch) =>
              commit(current.id, (bookcase) => updateBook(bookcase, selected, bookId, patch))
            }
            onRemoveBook={(bookId) =>
              commitUndoable(
                current.id,
                (bookcase) => removeBook(bookcase, selected, bookId),
                "책을 뺐어요.",
              )
            }
            onMoveBook={(bookId, direction) =>
              commit(current.id, (bookcase) => moveBook(bookcase, selected, bookId, direction))
            }
            onMoveToSlot={(bookId, target) =>
              commit(current.id, (bookcase) => moveBookToSlot(bookcase, selected, bookId, target))
            }
            onAddBook={() => commit(current.id, (bookcase) => addBook(bookcase, selected))}
            onClearSlot={() =>
              commitUndoable(
                current.id,
                (bookcase) => clearSlot(bookcase, selected),
                `${slotLabel(current, selected)}을 비웠어요.`,
              )
            }
          />
        )}

        {/* 자주 쓰지 않는 것은 접어 둔다. 처음 쓰는 사람에게는 소음이다. */}
        <details className="more-tools">
          <summary>책장 설정과 내보내기</summary>

          <div className="bookcase-tools">
            <button
              type="button"
              onClick={() => {
                setResizing(true);
                setScreen("setup");
              }}
            >
              칸 수 바꾸기
            </button>
            <button
              type="button"
              onClick={() => {
                setResizing(false);
                setScreen("setup");
              }}
            >
              책장 추가
            </button>
            <button type="button" onClick={() => download("내책장.csv", toCsv(bookcases), "text/csv")}>
              CSV 내려받기
            </button>
            <button
              type="button"
              onClick={() =>
                download("내책장.json", JSON.stringify(bookcases, null, 2), "application/json")
              }
            >
              JSON 내려받기
            </button>
          </div>

          <div className="settings">
            <label>
              <span>인식 언어</span>
              <select
                value={settings.langs}
                onChange={(event) => updateSettings({ langs: event.target.value as Settings["langs"] })}
              >
                <option value="kor+eng">한국어 + 영어</option>
                <option value="eng">영어만 (빠름)</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.enrich}
                onChange={(event) => updateSettings({ enrich: event.target.checked })}
              />
              <span>Open Library에서 표지·ISBN 붙이기</span>
            </label>
          </div>

          <div className="danger-zone">
            <button type="button" className="danger" onClick={removeBookcase}>
              이 책장 지우기
            </button>
          </div>
        </details>
      </main>

      {scanning && selected !== null && (
        <div className="sheet-backdrop">
          <ScanSheet
            label={slotLabel(current, selected)}
            existingCount={current.slots[selected].books.length}
            langs={settings.langs}
            enrich={settings.enrich}
            onApply={applyScan}
            onClose={() => setScanning(false)}
          />
        </div>
      )}

      {toast && <Toast message={toast.message} onUndo={toast.undo} />}
    </div>
  );
}

function Header({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="app-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="meta">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}

function Toast({ message, onUndo }: { message: string; onUndo?: () => void }) {
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      {onUndo && (
        <button type="button" onClick={onUndo} data-testid="undo">
          되돌리기
        </button>
      )}
    </div>
  );
}
