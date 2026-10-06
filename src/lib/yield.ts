/**
 * 브라우저에 화면을 한 번 그릴 틈을 준다.
 *
 * 인식은 전부 메인 스레드에서 돈다. onnxruntime 의 추론도 await 로 부르지만 안에서는
 * 쉬지 않고 계산하므로, 그 사이 프레임이 하나도 그려지지 않는다. CPU 를 4배 느리게 건
 * 휴대폰 조건에서 셔터를 누른 뒤 170초 동안 화면이 그대로였다. 진행 표시도, 그만두기도
 * 안 됐다. 무거운 단계 사이와 책등 한 줄마다 이걸 부른다.
 *
 * 앱을 내린 상태에서는 requestAnimationFrame 이 멈추므로 setTimeout 만 쓴다.
 */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document !== "undefined" && !document.hidden && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}
