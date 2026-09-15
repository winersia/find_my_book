import { useCallback, useRef, useState } from "react";
import { booksFromReadings, LOW_CONFIDENCE, type ShelfBook } from "../lib/bookcase";
import { enrichBooks } from "../lib/enrich";
import { toThumbnail } from "../lib/image";
import { hasOcrModel, readShelf, type ScanProgress } from "../lib/ocr";
import { CameraCapture } from "./CameraCapture";

interface Props {
  label: string;
  /** 이 칸에 이미 꽂혀 있는 권수. 교체 전에 알려 주기 위해 쓴다. */
  existingCount: number;
  langs: string;
  enrich: boolean;
  onApply: (books: ShelfBook[], photo: string) => void;
  onClose: () => void;
}

type Stage = "capture" | "scanning" | "review";

/** 책등 한 권을 읽는 데 걸리는 대략의 시간. 남은 시간을 어림잡아 보여 주는 데 쓴다. */
const SECONDS_PER_BOOK = 3;

/** 칸 하나를 찍어 읽는 화면. 결과를 확인하고 고친 뒤 그 칸에 넣는다. */
export function ScanSheet({ label, existingCount, langs, enrich, onApply, onClose }: Props) {
  const [stage, setStage] = useState<Stage>("capture");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const firstRun = !hasOcrModel(langs);

  const scan = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setStage("scanning");
      setError(null);
      setPhoto(toThumbnail(canvas));
      const controller = new AbortController();
      abort.current = controller;

      try {
        const result = await readShelf(canvas, {
          langs,
          onProgress: setProgress,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        const recognized = booksFromReadings(result.readings);
        setBooks(enrich ? await enrichBooks(recognized) : recognized);
        setDropped(new Set());
        setStage("review");
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "인식에 실패했습니다.");
        setStage("capture");
      } finally {
        abort.current = null;
        setProgress(null);
      }
    },
    [enrich, langs],
  );

  const cancel = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setProgress(null);
    setStage("capture");
  }, []);

  const kept = books.filter((book) => !dropped.has(book.id));

  return (
    <section className="scan-sheet" data-testid="scan-sheet">
      <header className="scan-header">
        <h2>{label} 채우기</h2>
        <button type="button" onClick={stage === "scanning" ? cancel : onClose} aria-label="닫기">
          ×
        </button>
      </header>

      {stage === "capture" && (
        <>
          {firstRun && (
            <p className="notice" data-testid="first-run-notice">
              처음 한 번만 인식 데이터 4MB를 받아요. 사진은 기기 밖으로 나가지 않습니다.
            </p>
          )}
          <CameraCapture onCapture={scan} disabled={false} remaining={1} autoStart />
          {error && <p className="error">{error}</p>}
        </>
      )}

      {stage === "scanning" && <Scanning progress={progress} onCancel={cancel} />}

      {stage === "review" &&
        (books.length === 0 ? (
          <>
            <p className="notes">책을 찾지 못했어요. 더 가까이에서 찍어 보세요.</p>
            <div className="scan-actions">
              <button type="button" className="primary" onClick={() => setStage("capture")}>
                다시 찍기
              </button>
              <button type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="notes" data-testid="scan-summary">
              왼쪽부터 {books.length}권
              {existingCount > 0 && ` · 이 칸의 ${existingCount}권과 바뀝니다`}
            </p>
            <ol className="scan-preview">
              {books.map((book, order) => {
                const isDropped = dropped.has(book.id);
                return (
                  <li key={book.id} className={isDropped ? "dropped" : book.confidence < LOW_CONFIDENCE ? "unsure" : ""}>
                    <span className="order">{order + 1}</span>
                    <span className="swatch" style={{ background: book.color }} aria-hidden="true" />
                    <input
                      className="scan-title"
                      value={book.title}
                      placeholder="제목 미상 — 직접 적어 주세요"
                      disabled={isDropped}
                      onChange={(event) =>
                        setBooks((previous) =>
                          previous.map((item) =>
                            item.id === book.id ? { ...item, title: event.target.value } : item,
                          ),
                        )
                      }
                      aria-label={`${order + 1}번째 책 제목`}
                    />
                    {book.confidence < LOW_CONFIDENCE && !isDropped && (
                      <span className="badge confidence low">확인 필요</span>
                    )}
                    <button
                      type="button"
                      className="drop"
                      onClick={() =>
                        setDropped((previous) => {
                          const next = new Set(previous);
                          if (next.has(book.id)) next.delete(book.id);
                          else next.add(book.id);
                          return next;
                        })
                      }
                      aria-label={isDropped ? `${order + 1}번째 책 되살리기` : `${order + 1}번째 책 빼기`}
                    >
                      {isDropped ? "되돌리기" : "빼기"}
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="scan-actions">
              <button
                type="button"
                className="primary"
                onClick={() => onApply(kept, photo)}
                disabled={kept.length === 0}
                data-testid="apply-scan"
              >
                {kept.length}권 이 칸에 넣기
              </button>
              <button type="button" onClick={() => setStage("capture")}>
                다시 찍기
              </button>
            </div>
          </>
        ))}
    </section>
  );
}

/** 오래 걸리는 구간. 어디까지 왔는지, 얼마나 남았는지, 멈출 수 있는지를 보여 준다. */
function Scanning({ progress, onCancel }: { progress: ScanProgress | null; onCancel: () => void }) {
  const preparing = !progress || progress.total <= 1;
  const ratio = progress && progress.total > 0 ? progress.done / progress.total : 0;
  const percent = Math.round(Math.min(1, ratio) * 100);
  const remaining =
    progress && progress.total > 1 ? Math.max(1, Math.round((progress.total - progress.done) * SECONDS_PER_BOOK)) : 0;

  return (
    <div className="progress" role="status" data-testid="scanning">
      <p className="progress-line">
        <strong>{preparing ? "읽을 준비를 하고 있어요" : `책등을 읽는 중 ${progress.done}/${progress.total}`}</strong>
        {remaining > 0 && <span className="remaining">약 {remaining}초 남음</span>}
      </p>
      <div className="bar">
        <span className={preparing ? "indeterminate" : ""} style={{ width: preparing ? "100%" : `${percent}%` }} />
      </div>
      <div className="scan-actions">
        <button type="button" onClick={onCancel} data-testid="cancel-scan">
          그만두기
        </button>
      </div>
    </div>
  );
}
