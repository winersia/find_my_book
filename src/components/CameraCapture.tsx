import { useCallback, useEffect, useRef, useState } from "react";
import { toWorkingCanvas } from "../lib/image";

interface Props {
  onCapture: (canvas: HTMLCanvasElement) => void;
  disabled: boolean;
  remaining: number;
}

export function CameraCapture({ onCapture, disabled, remaining }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저에서는 카메라를 열 수 없습니다. 아래에서 사진을 선택해 주세요.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
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
        "카메라를 사용할 수 없습니다. 권한을 확인하거나, HTTPS 주소에서 열어 주세요. 아래에서 사진을 선택할 수도 있습니다.",
      );
      setActive(false);
    }
  }, []);

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    onCapture(await toWorkingCanvas(canvas));
  }, [onCapture]);

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
        <video ref={videoRef} playsInline muted />
        {!active && (
          <div className="viewport-placeholder">
            <span className="viewport-icon" aria-hidden="true">
              📚
            </span>
            <p>책장 한 칸이 화면에 꽉 차게 찍어 주세요.</p>
            <p className="hint">정면에서, 책등 글자가 또렷하게 보이도록 찍을수록 잘 읽습니다.</p>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="camera-actions">
        {active ? (
          <>
            <button type="button" className="primary" onClick={shoot} disabled={disabled}>
              촬영
            </button>
            <button type="button" onClick={stop}>
              카메라 끄기
            </button>
          </>
        ) : (
          <button type="button" className="primary" onClick={start} disabled={disabled}>
            카메라 켜기
          </button>
        )}

        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled}>
          사진 선택
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(event) => void pickFiles(event.target.files)}
        />
      </div>
    </section>
  );
}
