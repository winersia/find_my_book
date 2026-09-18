import { useCallback, useRef, useState } from "react";
import { appendBatch, booksFromReadings, LOW_CONFIDENCE, type ShelfBook } from "../lib/bookcase";
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

/**
 * 책등이 이 굵기(px)에 못 미치면 나눠 찍기를 권한다.
 *
 * 책등 두께를 절반(24px)으로 줄여 재 보면 제목이 제대로 읽힌 권수가 11권에서 4권으로
 * 떨어진다. 얇은 책이 빽빽한 칸은 한 번에 담을수록 한 권이 차지하는 화소가 줄어
 * 어떤 후처리로도 살릴 수 없다. 절반씩 나눠 찍으면 그만큼 굵어진다.
 */
const THIN_SPINE_PX = 60;

/** 칸 하나를 찍어 읽는 화면. 결과를 확인하고 고친 뒤 그 칸에 넣는다. */
export function ScanSheet({ label, existingCount, langs, enrich, onApply, onClose }: Props) {
  const [stage, setStage] = useState<Stage>("capture");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState(0);
  /** 이번 촬영을 앞 결과 뒤에 이어 붙일지 (나눠 찍기), 통째로 바꿀지 */
  const [appending, setAppending] = useState(false);
  /** 책등이 얇아 나눠 찍기를 권할 상황인지 */
  const [thin, setThin] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const firstRun = !hasOcrModel(langs);

  const scan = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setStage("scanning");
      setError(null);
      // 칸 미리보기는 첫 사진을 쓴다. 나눠 찍으면 대개 첫 장이 왼쪽 끝이다.
      setPhoto((previous) => (appending && previous ? previous : toThumbnail(canvas)));
      const controller = new AbortController();
      abort.current = controller;

      try {
        const result = await readShelf(canvas, {
          langs,
          onProgress: setProgress,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        // 책등이 실제로 몇 px인지 본다. 이것이 제목을 읽을 수 있는지를 거의 다 결정한다.
        const widths = result.readings.map((reading) => reading.x1 - reading.x0).sort((a, b) => a - b);
        const spinePx = widths[Math.floor(widths.length / 2)] ?? 0;

        const recognized = booksFromReadings(result.readings);
        const batch = enrich ? await enrichBooks(recognized) : recognized;
        setBooks((previous) => (appending ? appendBatch(previous, batch) : batch));
        setThin(spinePx > 0 && spinePx < THIN_SPINE_PX);
        setShots((previous) => (appending ? previous + 1 : 1));
        if (!appending) setDropped(new Set());
        setAppending(false);
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
    [appending, enrich, langs],
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
          {appending ? (
            <p className="notice" data-testid="append-notice">
              {shots + 1}번째 사진 — 방금 찍은 곳 다음부터, 한두 권만 겹치게 찍어 주세요.
            </p>
          ) : (
            firstRun && (
              <p className="notice" data-testid="first-run-notice">
                처음 한 번만 인식 데이터 4MB를 받아요. 사진은 기기 밖으로 나가지 않습니다.
              </p>
            )
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
              {shots > 1 && ` · 사진 ${shots}장`}
              {existingCount > 0 && ` · 이 칸의 ${existingCount}권과 바뀝니다`}
            </p>
            {thin && (
              <p className="notice" data-testid="thin-spine-notice">
                책등이 얇아 제목이 잘 안 읽혀요. 여기까지 두고 <b>이어서 찍기</b>로 나머지를
                가까이에서 찍으면 또렷해집니다.
              </p>
            )}
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
              <button
                type="button"
                onClick={() => {
                  setAppending(true);
                  setStage("capture");
                }}
                data-testid="append-scan"
              >
                이어서 찍기
              </button>
              <button
                type="button"
                onClick={() => {
                  setAppending(false);
                  setStage("capture");
                }}
              >
                처음부터 다시
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
