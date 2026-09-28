import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * 개발 서버에서 public/ort 를 손대지 않고 그대로 내준다.
 *
 * onnxruntime-web 런타임은 실행 중에 불러온다 (src/lib/ppocr.ts 주석 참고).
 * 그런데 vite 개발 서버는 public 안의 JS 를 모듈로 가로채 "?import" 를 붙이고 거절한다.
 * 빌드 결과물은 public 을 그대로 복사하므로 이 문제가 없다. 개발 때만 필요한 우회다.
 */
function serveOrtRaw(): Plugin {
  const types: Record<string, string> = {
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
  };
  return {
    name: "serve-ort-raw",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split("?")[0] ?? "";
        if (!name.startsWith("/ort/")) return next();
        const file = path.resolve("public", name.slice(1));
        if (!fs.existsSync(file)) return next();
        res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
        res.end(fs.readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveOrtRaw()],
  /**
   * GitHub Pages 는 저장소 이름이 붙은 하위 경로로 서비스된다
   * (사용자.github.io/find_my_book/). 배포 워크플로가 VITE_BASE 를 넣어 준다.
   * 로컬에서는 그냥 루트다.
   */
  base: process.env.VITE_BASE || "/",
  // OCR은 전부 브라우저에서 돈다. 백엔드도 API 키도 없다.
  server: { host: true, port: 5173 },
  build: { outDir: "dist" },
});
