/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 언어 데이터 경로. 비우면 공개 CDN을 쓴다. */
  readonly VITE_TESSDATA_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
