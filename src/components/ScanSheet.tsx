import { useCallback, useState } from "react";
import { booksFromReadings, LOW_CONFIDENCE, type ShelfBook } from "../lib/bookcase";
import { enrichBooks } from "../lib/enrich";
import { toThumbnail } from "../lib/image";
import { readShelf, type ScanProgress } from "../lib/ocr";
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

/** 칸 하나를 찍어 읽는 화면. 결과를 확인한 뒤 그 칸에 넣는다. */
export function ScanSheet({ label, existingCount, langs, enrich, onApply, onClose }: Props) {
  const [stage, setStage] = useState<Stage>("capture");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setStage("scanning");
      setError(null);
      setPhoto(toThumbnail(canvas));

      try {
        const result = await readShelf(canvas, { langs, onProgress: setProgress });
        const recognized = booksFromReadings(result.readings);
        setBooks(enrich ? await enrichBooks(recognized) : recognized);
        setStage("review");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "인식에 실패했습니다.");
        setStage("capture");
      } finally {
        setProgress(null);
      }
    },
    [enrich, langs],
  );

  return (
    <section className="scan-sheet" data-testid="scan-sheet">
      <header className="scan-header">
        <h2>{label} 채우기</h2>
        <button type="button" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </header>

      {stage === "capture" && (
        <>
          <p className="hint">이 칸만 화면에 꽉 차게, 정면에서 찍어 주세요.</p>
          <CameraCapture onCapture={scan} disabled={false} remaining={1} />
          {error && <p className="error">{error}</p>}
        </>
      )}

      {stage === "scanning" && (
        <div className="progress" role="status">
          <p>
            {progress?.phase ?? "읽는 중"}
            {progress && progress.total > 1 && ` ${progress.done}/${progress.total}`}
          </p>
          <div className="bar">
            <span
              style={{ width: `${Math.round(((progress?.done ?? 0) / Math.max(1, progress?.total ?? 1)) * 100)}%` }}
            />
          </div>
          <p className="hint">기기 안에서 처리합니다. 사진은 어디로도 전송되지 않아요.</p>
        </div>
      )}

      {stage === "review" && (
        <>
          {books.length === 0 ? (
            <>
              <p className="notes">책을 찾지 못했습니다. 더 가까이에서 다시 찍어 주세요.</p>
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
                왼쪽부터 {books.length}권을 읽었습니다.
                {existingCount > 0 && ` 이 칸의 ${existingCount}권을 이 결과로 바꿉니다.`}
              </p>
              <ol className="scan-preview">
                {books.map((book, order) => (
                  <li key={book.id} className={book.confidence < LOW_CONFIDENCE ? "unsure" : ""}>
                    <span className="order">{order + 1}</span>
                    <span className="swatch" style={{ background: book.color }} aria-hidden="true" />
                    <span className="scan-title">{book.title || "제목 미상"}</span>
                    {book.confidence < LOW_CONFIDENCE && <span className="badge confidence low">확인 필요</span>}
                  </li>
                ))}
              </ol>
              <div className="scan-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => onApply(books, photo)}
                  data-testid="apply-scan"
                >
                  이 칸에 넣기
                </button>
                <button type="button" onClick={() => setStage("capture")}>
                  다시 찍기
                </button>
                <button type="button" onClick={onClose}>
                  취소
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
