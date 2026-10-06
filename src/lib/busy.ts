/**
 * 메인 스레드를 붙잡는 작업 앞에 로딩 화면을 세운다.
 *
 * 멈춘 동안에는 자바스크립트가 아무것도 그리지 못한다. 그래서 순서가 중요하다.
 *  1) 로딩 화면을 DOM 에 넣고
 *  2) 브라우저가 그것을 실제로 한 번 그리게 기다린 뒤
 *  3) 무거운 일을 시작한다.
 * 로딩 화면은 CSS 애니메이션(투명도·회전)만으로 움직인다. 이런 애니메이션은 브라우저가
 * 메인 스레드와 따로 돌려서, 앱이 멈춘 동안에도 돈다. 0.3초 안에 끝나는 일에는 깜빡이지
 * 않도록 나타나는 것도 CSS 지연으로 한다. 멈춘 중에도 그 지연은 정확히 흐른다.
 */
import { useEffect, useState } from "react";
import { yieldToPaint } from "./yield";

let labels: string[] = [];
const listeners = new Set<(labels: string[]) => void>();

function publish(): void {
  for (const listener of listeners) listener(labels);
}

/** 로딩 화면을 세운다. 돌려받은 함수를 부르면 내린다. 여러 개가 겹쳐도 된다. */
export function beginBusy(label: string): () => void {
  labels = [...labels, label];
  publish();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const index = labels.indexOf(label);
    labels = labels.filter((_, i) => i !== index);
    publish();
  };
}

/**
 * 로딩 화면을 세우고, 그것이 그려진 뒤에 일을 한다.
 * 일이 끝나거나 실패하면 내린다.
 */
export async function runBusy<T>(label: string, work: () => Promise<T> | T): Promise<T> {
  const end = beginBusy(label);
  try {
    // 한 번은 React 가 DOM 에 넣는 틈, 한 번은 브라우저가 그리는 틈.
    await yieldToPaint();
    await yieldToPaint();
    return await work();
  } finally {
    end();
  }
}

export function useBusy(): string[] {
  const [current, setCurrent] = useState(labels);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(labels);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}
