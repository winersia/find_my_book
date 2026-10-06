import { useBusy } from "../lib/busy";

/**
 * 앱이 잠깐 응답하지 못하는 동안 덮는 로딩 화면.
 *
 * 0.3초 뒤에 나타나므로 금방 끝나는 일에는 보이지 않는다. 떠 있는 동안에는 탭을 막는다.
 * 멈춘 앱에 탭이 쌓였다가 한꺼번에 처리되면 셔터가 두 번 눌리는 식의 사고가 난다.
 */
export function BusyOverlay() {
  const labels = useBusy();
  if (!labels.length) return null;
  return (
    <div className="busy-overlay" role="status" aria-live="polite" data-busy-indicator="overlay">
      <div className="busy-card">
        <span className="spinner" aria-hidden="true" />
        <span className="busy-label">{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}
