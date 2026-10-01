import { useCallback, useEffect, useRef, useState } from "react";
import { maxBooksPerShot, toWorkingCanvas } from "../lib/image";

interface Props {
  onCapture: (canvas: HTMLCanvasElement) => void;
  disabled: boolean;
  remaining: number;
  /** 화면이 열리자마자 카메라를 켠다. "촬영하기"를 눌렀으면 카메라가 켜져 있는 게 당연하다. */
  autoStart?: boolean;
}

/**
 * 칸 하나를 찍는 카메라.
 * 셔터는 사진 앱과 같은 자리(아래 가운데)에 크게 둔다. 화면의 안내 틀은
 * "이 안에 칸을 꽉 채우라"는 말을 글 대신 보여 준다.
 */
export function CameraCapture({ onCapture, disabled, remaining, autoStart = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  /** 첫 프레임이 들어오기 전에는 찍어도 빈 사진이 된다. 그 사이 버튼을 막는다. */
  const [ready, setReady] = useState(false);
  /** 이 카메라가 실제로 주는 가로 화소. 한 번에 몇 권까지 담을지가 여기서 정해진다. */
  const [captureWidth, setCaptureWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
    setReady(false);
    setCaptureWidth(0);
  }, []);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (autoStart) void start();
    // start 는 한 번만 부른다. 사용자가 껐다 켤 때는 버튼으로 부른다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저에서는 카메라를 열 수 없습니다. 아래에서 사진을 골라 주세요.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          // 책등 하나가 사진 가로의 2%도 안 되는 칸이 흔하다. 1920px로 받으면
          // 책등이 40px도 안 돼 한글 획이 뭉개진다. 기기가 주는 만큼 크게 받는다.
          // ideal 이라 지원하지 않는 기기는 알아서 낮춰 준다.
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setError(
        "카메라를 쓸 수 없습니다. 권한을 확인하거나 HTTPS 주소로 열어 주세요. 사진을 직접 고를 수도 있습니다.",
      );
      setActive(false);
      setReady(false);
    }
  }, []);

  // 이 기종의 카메라로 한 번에 담아도 제목이 읽히는 권수.
  const maxBooks = maxBooksPerShot(captureWidth);

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    stop();
    onCapture(await toWorkingCanvas(canvas));
  }, [onCapture, stop]);

  const pickFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList) return;
      for (const file of Array.from(fileList).slice(0, remaining)) {
        onCapture(await toWorkingCanvas(file));
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [onCapture, remaining],
  );

  return (
    <section className="camera">
      <div className={`viewport ${active ? "live" : ""}`}>
        <video
          ref={videoRef}
          playsInline
          muted
          onLoadedMetadata={(e) => {
            setReady(e.currentTarget.videoWidth > 0);
            setCaptureWidth(e.currentTarget.videoWidth);
          }}
        />
        {active ? (
          <div className="frame-guide" aria-hidden="true">
            <span>
              칸을 꽉 채워 주세요
              {maxBooks > 0 && ` · 한 번에 ${maxBooks}권까지`}
            </span>
          </div>
        ) : (
          <div className="viewport-placeholder">
            <span className="viewport-icon" aria-hidden="true">
              📷
            </span>
            <p className="hint">칸 하나를 정면에서</p>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {active ? (
        <div className="shutter-row">
          {/* 카메라가 흐리거나 이미 찍어 둔 사진을 쓰고 싶을 때를 위해 옆에 남겨 둔다. */}
          {/* 셔터가 화면 한가운데 오도록 양옆에 같은 무게를 둔다. */}
          <span aria-hidden="true" />
          <button
            type="button"
            className="shutter"
            onClick={shoot}
            disabled={disabled || !ready}
            aria-label={ready ? "촬영" : "카메라 준비 중"}
          >
            <span className="shutter-ring" aria-hidden="true" />
            {/* 큰 원형 셔터는 사진 앱에서 배운 모양이다. 이름표는 준비 중일 때만 필요하다. */}
            {!ready && <span className="shutter-label">준비 중…</span>}
          </button>
          <button type="button" className="ghost gallery" onClick={() => fileInputRef.current?.click()}>
            사진 고르기
          </button>
        </div>
      ) : (
        <div className="camera-actions">
          <button type="button" className="primary" onClick={start} disabled={disabled}>
            카메라 켜기
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled}>
            사진 고르기
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(event) => void pickFiles(event.target.files)}
      />
    </section>
  );
}
