import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
