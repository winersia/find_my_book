import { useCallback, useEffect, useState } from "react";
import { CameraCapture } from "./components/CameraCapture";
import { Library } from "./components/Library";
import { ScanResults } from "./components/ScanResults";
import { scanShelf } from "./lib/api";
import { loadLibrary, mergeIntoLibrary, saveLibrary } from "./lib/storage";
import type { RecognizedBook, SavedBook, ScanResponse } from "./lib/types";

const MAX_SHOTS = 4;

type Tab = "scan" | "library";

export default function App() {
  const [tab, setTab] = useState<Tab>("scan");
  const [shots, setShots] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [library, setLibrary] = useState<SavedBook[]>([]);

  useEffect(() => setLibrary(loadLibrary()), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const addShot = useCallback((dataUrl: string) => {
    setError(null);
    setShots((previous) =>
      previous.length >= MAX_SHOTS ? previous : [...previous, dataUrl],
    );
  }, []);

  const runScan = useCallback(async () => {
    if (shots.length === 0) return;
    setScanning(true);
    setError(null);
    try {
      setResult(await scanShelf(shots));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "인식에 실패했습니다.");
    } finally {
      setScanning(false);
    }
  }, [shots]);

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
          <button
            type="button"
            className={tab === "scan" ? "active" : ""}
            onClick={() => setTab("scan")}
          >
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
            notes={result.notes}
            meta={result.meta}
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
                      <img src={shot} alt={`촬영 ${index + 1}`} />
                      <button
                        type="button"
                        className="remove"
                        onClick={() => setShots((previous) => previous.filter((_, i) => i !== index))}
                        aria-label={`${index + 1}번째 사진 삭제`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <p className="hint">
                  책장이 넓으면 나눠서 최대 {MAX_SHOTS}장까지 찍은 뒤 한 번에 인식할 수 있어요.
                </p>
                <button type="button" className="primary big" onClick={runScan} disabled={scanning}>
                  {scanning ? "책등을 읽는 중…" : `사진 ${shots.length}장에서 목록 만들기`}
                </button>
              </section>
            )}

            {scanning && (
              <p className="progress" role="status">
                책등 글자를 읽고 있어요. 사진 한 장에 10~30초쯤 걸립니다.
              </p>
            )}
            {error && <p className="error">{error}</p>}
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
