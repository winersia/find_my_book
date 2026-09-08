import { useCallback, useEffect, useState } from "react";
import { CameraCapture } from "./components/CameraCapture";
import { Library } from "./components/Library";
import { ScanResults } from "./components/ScanResults";
import { enrichBooks } from "./lib/enrich";
import { toThumbnail } from "./lib/image";
import { readShelf, type ScanProgress } from "./lib/ocr";
import { loadLibrary, mergeIntoLibrary, saveLibrary } from "./lib/storage";
import { normalize } from "./lib/text";
import type { RecognizedBook, SavedBook } from "./lib/types";

const MAX_SHOTS = 4;
const SETTINGS_KEY = "find-my-book:settings:v1";

type Tab = "scan" | "library";

interface Shot {
  canvas: HTMLCanvasElement;
  thumb: string;
}

interface Settings {
  /** tesseract 언어 데이터 */
  langs: "kor+eng" | "eng";
  /** Open Library로 제목을 보정할지 */
  enrich: boolean;
}

interface ScanOutcome {
  books: RecognizedBook[];
  imageCount: number;
  elapsedMs: number;
  usedFallback: boolean;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("scan");
  const [shots, setShots] = useState<Shot[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<(ScanProgress & { image: number; images: number }) | null>(null);
  const [result, setResult] = useState<ScanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [library, setLibrary] = useState<SavedBook[]>([]);
  const [settings, setSettings] = useState<Settings>({ langs: "kor+eng", enrich: true });

  useEffect(() => {
    setLibrary(loadLibrary());
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings((previous) => ({ ...previous, ...(JSON.parse(raw) as Partial<Settings>) }));
    } catch {
      // 설정을 못 읽어도 기본값으로 동작한다.
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

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

  const addShot = useCallback((canvas: HTMLCanvasElement) => {
    setError(null);
    setShots((previous) =>
      previous.length >= MAX_SHOTS ? previous : [...previous, { canvas, thumb: toThumbnail(canvas) }],
    );
  }, []);

  const runScan = useCallback(async () => {
    if (shots.length === 0) return;
    setScanning(true);
    setError(null);
    const startedAt = Date.now();

    try {
      const collected: RecognizedBook[] = [];
      let usedFallback = false;

      for (const [index, shot] of shots.entries()) {
        const outcome = await readShelf(shot.canvas, {
          langs: settings.langs,
          onProgress: (p) => setProgress({ ...p, image: index + 1, images: shots.length }),
        });
        usedFallback = usedFallback || outcome.usedFallback;

        for (const reading of outcome.readings) {
          collected.push({
            title: reading.text,
            author: "",
            spineText: reading.raw,
            alternatives: reading.alternatives,
            confidence: reading.confidence,
          });
        }
      }

      const merged = mergeDuplicates(collected);
      setProgress({ phase: "제목 확인하는 중", done: 0, total: 1, image: shots.length, images: shots.length });
      const books = settings.enrich ? await enrichBooks(merged) : merged;

      setResult({
        books,
        imageCount: shots.length,
        elapsedMs: Date.now() - startedAt,
        usedFallback,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `인식에 실패했습니다: ${caught.message}`
          : "인식에 실패했습니다.",
      );
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [settings.enrich, settings.langs, shots]);

  const reset = useCallback(() => {
    setShots([]);
    setResult(null);
    setError(null);
  }, []);

  const saveToLibrary = useCallback(
    (books: RecognizedBook[]) => {
      setLibrary((previous) => {
        const merged = mergeIntoLibrary(previous, books);
        saveLibrary(merged.library);
        setToast(
          merged.skipped > 0
            ? `${merged.added}권 담았어요. 이미 있는 ${merged.skipped}권은 건너뛰었습니다.`
            : `${merged.added}권을 서재에 담았어요.`,
        );
        return merged.library;
      });
      reset();
      setTab("library");
    },
    [reset],
  );

  const removeBook = useCallback((id: string) => {
    setLibrary((previous) => {
      const next = previous.filter((book) => book.id !== id);
      saveLibrary(next);
      return next;
    });
  }, []);

  const clearLibrary = useCallback(() => {
    if (!confirm("서재의 모든 책을 지울까요? 되돌릴 수 없습니다.")) return;
    setLibrary([]);
    saveLibrary([]);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>책장 스캐너</h1>
        <nav className="tabs">
          <button type="button" className={tab === "scan" ? "active" : ""} onClick={() => setTab("scan")}>
            촬영
          </button>
          <button
            type="button"
            className={tab === "library" ? "active" : ""}
            onClick={() => setTab("library")}
          >
            내 서재 {library.length > 0 && <span className="count">{library.length}</span>}
          </button>
        </nav>
      </header>

      <main>
        {tab === "library" ? (
          <Library books={library} onRemove={removeBook} onClear={clearLibrary} />
        ) : result ? (
          <ScanResults
            books={result.books}
            imageCount={result.imageCount}
            elapsedMs={result.elapsedMs}
            usedFallback={result.usedFallback}
            onSave={saveToLibrary}
            onDiscard={reset}
          />
        ) : (
          <>
            <CameraCapture
              onCapture={addShot}
              disabled={scanning || shots.length >= MAX_SHOTS}
              remaining={MAX_SHOTS - shots.length}
            />

            {shots.length > 0 && (
              <section className="shots">
                <div className="thumbs">
                  {shots.map((shot, index) => (
                    <div className="thumb" key={index}>
                      <img src={shot.thumb} alt={`촬영 ${index + 1}`} />
                      <button
                        type="button"
                        className="remove"
                        disabled={scanning}
                        onClick={() => setShots((previous) => previous.filter((_, i) => i !== index))}
                        aria-label={`${index + 1}번째 사진 삭제`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <p className="hint">
                  넓은 책장은 칸별로 나눠 최대 {MAX_SHOTS}장까지 찍은 뒤 한 번에 읽을 수 있어요.
                </p>
                <button type="button" className="primary big" onClick={runScan} disabled={scanning}>
                  {scanning ? "읽는 중…" : `사진 ${shots.length}장에서 목록 만들기`}
                </button>
              </section>
            )}

            {progress && (
              <div className="progress" role="status">
                <p>
                  {progress.images > 1 && `사진 ${progress.image}/${progress.images} · `}
                  {progress.phase}
                  {progress.total > 1 && ` ${progress.done}/${progress.total}`}
                </p>
                <div className="bar">
                  <span style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
                </div>
                <p className="hint">글자 인식은 기기 안에서 처리합니다. 사진은 어디로도 전송되지 않아요.</p>
              </div>
            )}

            {error && <p className="error">{error}</p>}

            <section className="settings">
              <label>
                <span>인식 언어</span>
                <select
                  value={settings.langs}
                  disabled={scanning}
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
                  disabled={scanning}
                  onChange={(event) => updateSettings({ enrich: event.target.checked })}
                />
                <span>Open Library로 제목 보정하기</span>
              </label>
            </section>
          </>
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/** 사진 여러 장에 걸쳐 같은 책이 잡히면 신뢰도가 높은 쪽만 남긴다. */
function mergeDuplicates(books: RecognizedBook[]): RecognizedBook[] {
  const byKey = new Map<string, RecognizedBook>();
  for (const book of books) {
    const key = normalize(book.title);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || book.confidence > existing.confidence) byKey.set(key, book);
  }
  return [...byKey.values()];
}
