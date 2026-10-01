/**
 * 글자 인식 모델을 미리 받아 둔다.
 *
 * 이 앱은 사진을 기기 밖으로 내보내지 않는 대신 인식기를 브라우저 안에서 돌린다.
 * 그 값으로 첫 실행에 17MB를 받아야 한다. 셔터를 누른 뒤에 받기 시작하면,
 * 사용자는 "찍었는데 아무 일도 안 일어나는" 화면을 수십 초 본다. 거기서 나간다.
 *
 * 그래서 앱을 열자마자 뒤에서 받는다. 첫 화면은 책장 칸 수를 맞추는 곳이고
 * 사람은 거기서 10~30초를 쓴다. 그 시간을 쓰면 셔터를 누를 때는 대개 준비가 끝나 있다.
 * 받는 동안에도 화면은 아무것도 막지 않는다. 진행률만 조용히 한 줄 보여 준다.
 */
import { useEffect, useState } from "react";
import { hasModels, loadModels, watchModels, type ModelProgress } from "./ppocr";

export type WarmupState =
  | { kind: "idle" }
  | { kind: "loading"; progress: ModelProgress }
  | { kind: "ready" }
  | { kind: "failed"; message: string };

let state: WarmupState = { kind: "idle" };
const listeners = new Set<(next: WarmupState) => void>();

function set(next: WarmupState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

export function getWarmup(): WarmupState {
  return state;
}

/**
 * 데이터를 아끼려는 사람에게 17MB를 말없이 물리지 않는다.
 * 이 경우에는 셔터를 누를 때 받는다. 그때는 받는 이유가 분명하다.
 */
export function shouldWarmUpNow(): boolean {
  const link = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (link?.saveData) return false;
  if (link?.effectiveType && /(^|-)2g$/.test(link.effectiveType)) return false;
  return true;
}

/** 내려받기를 시작한다. 여러 번 불러도 한 번만 받는다. */
export function warmUp(): void {
  if (state.kind === "loading" || state.kind === "ready") return;
  if (hasModels()) {
    set({ kind: "ready" });
    return;
  }

  const stop = watchModels((progress) => set({ kind: "loading", progress }));
  loadModels()
    .then(() => set({ kind: "ready" }))
    .catch((error: unknown) => {
      set({ kind: "failed", message: error instanceof Error ? error.message : "준비에 실패했어요." });
    })
    .finally(stop);
}

/** 첫 그림이 그려진 다음에 시작한다. 내려받기가 첫 화면을 늦추면 안 된다. */
export function warmUpWhenIdle(): void {
  if (!shouldWarmUpNow()) return;
  const idle = (window as unknown as { requestIdleCallback?: (fn: () => void, options?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(() => warmUp(), { timeout: 1500 });
  else window.setTimeout(warmUp, 300);
}

export function useWarmup(): WarmupState {
  const [current, setCurrent] = useState(getWarmup);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(getWarmup());
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}
