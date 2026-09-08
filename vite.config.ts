import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // OCR은 전부 브라우저에서 돈다. 백엔드도 API 키도 없다.
  server: { host: true, port: 5173 },
  build: { outDir: "dist" },
});
