/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 언어 데이터 경로. 비우면 공개 CDN을 쓴다. */
  readonly VITE_TESSDATA_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** package.json 의 버전 (vite.config.ts 가 빌드 때 넣는다) */
declare const __APP_VERSION__: string;
