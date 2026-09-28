import { useEffect, useState } from "react";
import { useWarmup, warmUp, type WarmupState } from "../lib/warmup";

/**
 * 준비가 왜 걸리는지 한 번만 알려 주는 줄.
 * "매번 이러나?"와 "내 사진은 어디로 가나?" 두 가지를 먼저 답해 둔다.
 */
export const WARMUP_REASON = "처음 한 번만 받아요. 사진은 기기 밖으로 나가지 않아요.";

/** 다 받은 뒤 "준비 끝"을 이만큼만 보여 주고 사라진다 */
const DONE_LINGER_MS = 2400;

/**
 * 이만큼 안에 끝나면 아무 말도 하지 않는다.
 *
 * 다시 들어온 사람은 브라우저 캐시에서 모델을 꺼내 쓰므로 금방 끝난다. 그때
 * 띠가 번쩍하고 지나가면 알려 주는 것이 아니라 어수선한 것이다.
 */
const SHOW_AFTER_MS = 600;

/**
 * 화면을 옮겨 다녀도 유지돼야 하는 두 가지. 컴포넌트가 다시 붙을 때마다
 * "준비 끝"을 새로 알리거나 600ms 를 다시 세면 안 된다.
 */
let everShown = false;
let announced = false;

export function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * 내려받는 중임을 한 줄로 적는다. 진행 화면과 이 띠가 같은 말을 쓴다.
 * 다 받고 세션을 여는 동안은 잴 것이 없어 바이트 대신 "거의 다 됐어요"로 바꾼다.
 */
export function modelLabel(loaded: number, total: number, opening: boolean): string {
  if (opening) return "글자 인식 준비 중 · 거의 다 됐어요";
  return `글자 인식 준비 중 · ${megabytes(loaded)} / ${megabytes(total)}MB`;
}

export function warmupLabel(state: WarmupState): string {
  if (state.kind !== "loading") return "글자 인식 준비 중";
  return modelLabel(state.progress.loaded, state.progress.total, state.progress.opening);
}

/**
 * 화면 위쪽에 얹는 얇은 준비 표시.
 *
 * 아무것도 막지 않는다. 받는 동안 책장을 만들고 칸을 고를 수 있다. 셔터를 누를 때
 * 아직 안 끝났으면 그때 기다리게 되지만, 그 전에 대개 끝난다.
 */
export function WarmupStrip() {
  const state = useWarmup();
  const [shown, setShown] = useState(everShown);
  const [lingering, setLingering] = useState(false);

  // 잠깐이면 띄우지 않는다. 600ms 를 넘겨서야 "받고 있다"고 말한다.
  useEffect(() => {
    if (state.kind !== "loading" || shown) return;
    const timer = setTimeout(() => {
      everShown = true;
      setShown(true);
    }, SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state.kind, shown]);

  // 띄운 적이 있을 때만 끝났다고 알린다. 그리고 이 방문에 한 번만.
  useEffect(() => {
    if (state.kind !== "ready" || !shown || announced) return;
    announced = true;
    setLingering(true);
    const timer = setTimeout(() => setLingering(false), DONE_LINGER_MS);
    return () => clearTimeout(timer);
  }, [state.kind, shown]);

  if (state.kind === "idle") return null;

  if (state.kind === "ready") {
    if (!lingering) return null;
    return (
      <div className="warmup done" role="status" data-testid="warmup">
        <p className="warmup-line">
          <strong>글자 인식 준비 끝</strong>
        </p>
      </div>
    );
  }

  if (state.kind === "failed") {
    return (
      <div className="warmup failed" data-testid="warmup">
        <p className="warmup-line">
          <strong>글자 인식을 준비하지 못했어요</strong>
          <button type="button" onClick={warmUp} data-testid="warmup-retry">
            다시 시도
          </button>
        </p>
      </div>
    );
  }

  if (!shown) return null;

  const percent = Math.round(state.progress.ratio * 100);
  return (
    <div className="warmup" role="status" data-testid="warmup" aria-live="polite">
      <p className="warmup-line">
        <strong data-testid="warmup-label">{warmupLabel(state)}</strong>
        <span className="warmup-percent" data-testid="warmup-percent">
          {percent}%
        </span>
      </p>
      <div className="bar">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="notice warmup-reason">{WARMUP_REASON}</p>
    </div>
  );
}
