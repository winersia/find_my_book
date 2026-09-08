export interface BookMatch {
  title: string;
  author: string;
  firstPublishYear?: number;
  isbn?: string;
  coverUrl?: string;
  infoUrl?: string;
}

export interface RecognizedBook {
  title: string;
  author: string;
  publisher: string;
  spineText: string;
  language: string;
  confidence: number;
  match?: BookMatch;
}

export interface ScanMeta {
  model: string;
  imageCount: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

export interface ScanResponse {
  books: RecognizedBook[];
  notes: string;
  meta: ScanMeta;
}

/** 내 서재에 저장된 책 */
export interface SavedBook extends RecognizedBook {
  id: string;
  savedAt: string;
}
