import { useCallback, useRef, useState } from "react";
import { appendBatch, booksFromReadings, needsReview, type ShelfBook } from "../lib/bookcase";
import { enrichBooks } from "../lib/enrich";
import { maxBooksPerShot, TARGET_SPINE_PX, toThumbnail } from "../lib/image";
import { readShelf, type ScanProgress } from "../lib/ocr";
import { CameraCapture } from "./CameraCapture";
import { modelLabel, WARMUP_REASON } from "./WarmupStrip";

interface Props {
  label: string;
  /** 이 칸에 이미 꽂혀 있는 권수. 교체 전에 알려 주기 위해 쓴다. */
  existingCount: number;
  enrich: boolean;
  onApply: (books: ShelfBook[], photo: string) => void;
  onClose: () => void;
}

type Stage = "capture" | "scanning" | "review";

/**
 * 남은 시간은 실제로 읽은 속도로 어림잡는다. 이만큼은 읽어 봐야 속도를 믿을 수 있다.
 *
 * 예전에는 한 줄에 3초로 박아 두었는데, 기기마다 열 배 가까이 차이가 나서 휴대폰에서는
 * "약 252초 남음"처럼 실제의 두 배를 넘게 말했다.
 */
const ESTIMATE_AFTER = 3;



/** 칸 하나를 찍어 읽는 화면. 결과를 확인하고 고친 뒤 그 칸에 넣는다. */
export function ScanSheet({ label, existingCount, enrich, onApply, onClose }: Props) {
  const [stage, setStage] = useState<Stage>("capture");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  /**
   * 사용자가 눈으로 확인한 책. 확신이 낮은 책은 [맞아요]를 누르거나 제목을 고쳐 써야
   * 확인된다. 확인 안 된 책이 남아 있으면 칸에 넣지 못한다.
   */
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLOListElement | null>(null);
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState(0);
  /** 이번 촬영을 앞 결과 뒤에 이어 붙일지 (나눠 찍기), 통째로 바꿀지 */
  const [appending, setAppending] = useState(false);
  /** 방금 사진에서 책등이 실제로 몇 px이었는지. 제목이 읽히는지를 거의 다 결정한다. */
  const [spinePx, setSpinePx] = useState(0);
  /** 이 사진 한 장에 담아도 됐을 권수 */
  const [shotCapacity, setShotCapacity] = useState(0);

  const abort = useRef<AbortController | null>(null);
  /** 사용자가 손으로 고친 책. 뒤늦게 온 책 정보가 고친 제목을 덮으면 안 된다. */
  const edited = useRef<Set<string>>(new Set());
  /** 책 정보 찾기 차례. 다시 찍거나 닫으면 늦게 온 답을 버린다. */
  const enrichRun = useRef(0);
  const [enriching, setEnriching] = useState(false);

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
          onProgress: setProgress,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        // 책등이 실제로 몇 px인지 본다. 이것이 제목을 읽을 수 있는지를 거의 다 결정한다.
        const widths = result.readings.map((reading) => reading.x1 - reading.x0).sort((a, b) => a - b);
        const measured = Math.round(widths[Math.floor(widths.length / 2)] ?? 0);

        const batch = booksFromReadings(result.readings);
        setBooks((previous) => (appending ? appendBatch(previous, batch) : batch));
        setSpinePx(measured);
        setShotCapacity(maxBooksPerShot(canvas.width));
        setShots((previous) => (appending ? previous + 1 : 1));
        if (!appending) {
          setDropped(new Set());
          setConfirmed(new Set());
        }
        setAppending(false);
        setStage("review");

        // 책 정보(표지·ISBN)는 결과를 보여 준 뒤에 찾는다. 기다리게 하지 않는다.
        // 예전에는 이걸 다 찾은 뒤에야 결과가 떴다. 한국 그림책은 대부분 없어서 헛걸음인데,
        // 40권이면 40초 가까이 "84/84" 화면에 멈춰 있었다.
        if (enrich && batch.length) {
          const run = ++enrichRun.current;
          setEnriching(true);
          void enrichBooks(batch, {
            onMatch: (found) => {
              if (run !== enrichRun.current || edited.current.has(found.id)) return;
              setBooks((previous) => previous.map((book) => (book.id === found.id ? found : book)));
            },
          }).finally(() => {
            if (run === enrichRun.current) setEnriching(false);
          });
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "인식에 실패했습니다.");
        setStage("capture");
      } finally {
        abort.current = null;
        setProgress(null);
      }
    },
    [appending, enrich],
  );

  const cancel = useCallback(() => {
    enrichRun.current++;
    setEnriching(false);
    abort.current?.abort();
    abort.current = null;
    setProgress(null);
    setStage("capture");
  }, []);

  const kept = books.filter((book) => !dropped.has(book.id));
  const isPending = (book: ShelfBook) => needsReview(book) && !confirmed.has(book.id);
  const pending = kept.filter(isPending);
  const confirm = (id: string) => setConfirmed((previous) => new Set(previous).add(id));
  /** 다음 확인할 책으로 옮겨 가 제목칸에 커서를 둔다. 수십 권이면 직접 찾기 어렵다. */
  const goToNextPending = () => {
    const next = pending[0];
    if (!next) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-book="${next.id}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  };
  // 책등이 목표 굵기에 못 미치면, 이번 사진을 몇 등분해 다시 찍어야 하는지 알려 준다.
  const thin = spinePx > 0 && spinePx < TARGET_SPINE_PX;

  return (
    <section className="scan-sheet" data-testid="scan-sheet" data-enriching={enriching ? "true" : undefined}>
      <header className="scan-header">
        <h2>{label} 채우기</h2>
        <button
          type="button"
          onClick={() => {
            enrichRun.current++;
            if (stage === "scanning") cancel();
            else onClose();
          }}
          aria-label="닫기"
        >
          ×
        </button>
      </header>

      {stage === "capture" && (
        <>
          {/* 첫 실행 안내는 앱을 열 때 띠가 이미 했다 (WarmupStrip). 여기서 또 말하지 않는다. */}
          {appending && (
            <p className="notice" data-testid="append-notice">
              {shots + 1}번째 사진 — 방금 찍은 곳 다음부터, 한두 권만 겹치게 찍어 주세요.
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
              {shots > 1 && ` · 사진 ${shots}장`}
              {existingCount > 0 && ` · 이 칸의 ${existingCount}권과 바뀝니다`}
              {enriching && " · 책 정보 찾는 중"}
            </p>
            {pending.length > 0 && (
              <p className="notice review-notice" data-testid="review-notice">
                표시된 {pending.length}권은 제목이 정확하지 않을 수 있어요. 사진과 맞는지 보고
                [맞아요]를 누르거나 고쳐 주세요.
              </p>
            )}
            {thin && (
              <p className="notice" data-testid="thin-spine-notice">
                책등이 {spinePx}px로 얇아 제목이 뭉개졌어요. <b>칸 하나만</b> 화면에 꽉 차게
                다시 찍어 주세요. 한 장에 다 안 들어오면 [이어서 찍기]로 나눠 담을 수 있어요
                (이 카메라는 한 장에 {shotCapacity}권까지).
              </p>
            )}
            <ol className="scan-preview" ref={listRef}>
              {books.map((book, order) => {
                const isDropped = dropped.has(book.id);
                const toReview = !isDropped && isPending(book);
                return (
                  <li
                    key={book.id}
                    data-book={book.id}
                    data-review={toReview ? "pending" : undefined}
                    className={isDropped ? "dropped" : toReview ? "review" : ""}
                  >
                    <span className="order">{order + 1}</span>
                    <span className="swatch" style={{ background: book.color }} aria-hidden="true" />
                    <input
                      className="scan-title"
                      value={book.title}
                      placeholder="제목 미상 — 직접 적어 주세요"
                      disabled={isDropped}
                      onChange={(event) => {
                        edited.current.add(book.id);
                        // 고쳐 썼다면 사진과 견줘 본 것이다.
                        confirm(book.id);
                        setBooks((previous) =>
                          previous.map((item) =>
                            item.id === book.id ? { ...item, title: event.target.value } : item,
                          ),
                        );
                      }}
                      aria-label={`${order + 1}번째 책 제목`}
                    />
                    {toReview && (
                      <button
                        type="button"
                        className="confirm"
                        data-testid="confirm-title"
                        onClick={() => confirm(book.id)}
                        aria-label={`${order + 1}번째 책 제목 확인`}
                      >
                        {book.title.trim() ? "맞아요" : "비워 두기"}
                      </button>
                    )}
                    {/* 인식기가 읽은 책등 그대로. 제목칸과 나란히 두고 견줘 보게 한다. */}
                    {book.preview && needsReview(book) && !isDropped && (
                      <img
                        className="spine-preview"
                        src={book.preview}
                        alt={`${order + 1}번째 책의 책등`}
                        data-testid="spine-preview"
                      />
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
              {pending.length > 0 ? (
                // 확인 안 된 책이 남았다. 넣기 대신 다음 확인할 책으로 데려간다.
                <button type="button" className="primary" onClick={goToNextPending} data-testid="next-review">
                  확인 {pending.length}권 남음 · 다음 책 보기
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  // 사용자가 확인한 책은 더는 "확인 필요"가 아니다.
                  onClick={() =>
                    onApply(
                      kept.map(({ preview: _preview, ...book }) =>
                        confirmed.has(book.id) ? { ...book, confidence: 1 } : book,
                      ),
                      photo,
                    )
                  }
                  disabled={kept.length === 0}
                  data-testid="apply-scan"
                >
                  {kept.length}권 이 칸에 넣기
                </button>
              )}
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

/**
 * 오래 걸리는 구간. 어디까지 왔는지, 얼마나 남았는지, 멈출 수 있는지를 보여 준다.
 *
 * 구간마다 잴 수 있는 것이 다르다. 모델 내려받기는 바이트로, 책등 읽기는 권수로 잰다.
 * 둘 다 숫자가 움직이는 막대를 보여 준다. 잴 것이 없는 구간만 흐르는 막대다.
 * 멈춘 것처럼 보이는 화면에서 사람이 나간다.
 */
function Scanning({ progress, onCancel }: { progress: ScanProgress | null; onCancel: () => void }) {
  // 읽기를 시작한 때. 진행률이 0 으로 돌아오면(다음 사진) 새로 잰다.
  const readStart = useRef<{ at: number; total: number } | null>(null);
  if (progress?.kind === "read" && (progress.done === 0 || readStart.current?.total !== progress.total)) {
    readStart.current = { at: performance.now(), total: progress.total };
  }
  const stop = (
    <div className="scan-actions">
      <button type="button" onClick={onCancel} data-testid="cancel-scan">
        그만두기
      </button>
    </div>
  );

  // 앱을 열 때 미리 받아 두므로 여기까지 오는 일은 드물다. 데이터 절약 모드이거나
  // 첫 화면을 금방 지나쳤을 때만 온다. 그때도 숫자는 보여야 한다.
  if (progress?.kind === "model") {
    const percent = Math.round(Math.min(1, progress.done / progress.total) * 100);
    return (
      <div className="progress" role="status" data-testid="scanning">
        <p className="progress-line">
          <strong data-testid="scan-model-label">
            <span className="spinner small" data-busy-indicator="scan" aria-hidden="true" />
            {modelLabel(progress.done, progress.total, percent >= 100)}
          </strong>
          <span className="remaining">{percent}%</span>
        </p>
        <div className="bar">
          <span style={{ width: `${percent}%` }} />
        </div>
        <p className="notice">{WARMUP_REASON}</p>
        {stop}
      </div>
    );
  }

  const counting = progress?.kind === "read" && progress.total > 1;
  const percent = counting ? Math.round(Math.min(1, progress.done / progress.total) * 100) : 0;
  const elapsed = readStart.current ? (performance.now() - readStart.current.at) / 1000 : 0;
  const remaining =
    counting && progress.done >= ESTIMATE_AFTER
      ? Math.max(1, Math.round((elapsed / progress.done) * (progress.total - progress.done)))
      : 0;

  return (
    <div className="progress" role="status" data-testid="scanning">
      <p className="progress-line">
        {/* 인식 중 계산이 몇 초씩 화면을 붙잡는다. 이 스피너는 그동안에도 돈다 (busy.ts). */}
        <strong>
          <span className="spinner small" data-busy-indicator="scan" aria-hidden="true" />
          {counting ? `책등을 읽는 중 ${progress.done}/${progress.total}` : (progress?.phase ?? "책등을 찾는 중")}
        </strong>
        {remaining > 0 && (
          <span className="remaining">
            약 {remaining >= 90 ? `${Math.round(remaining / 60)}분` : `${remaining}초`} 남음
          </span>
        )}
      </p>
      <div className="bar">
        <span className={counting ? "" : "indeterminate"} style={{ width: counting ? `${percent}%` : "100%" }} />
      </div>
      {stop}
    </div>
  );
}
