/** 인식된 책 한 권. 서버와 웹이 공유하는 형태다. */
export interface RecognizedBook {
  /** 정규화된 책 제목 */
  title: string;
  /** 저자. 책등에서 읽지 못하면 빈 문자열 */
  author: string;
  /** 출판사. 읽지 못하면 빈 문자열 */
  publisher: string;
  /** 책등에서 실제로 읽어낸 원문 */
  spineText: string;
  /** 표기 언어 (ko, en, ja ...) */
  language: string;
  /** 인식 신뢰도 0~1 */
  confidence: number;
  /** Open Library 보강 정보 (없을 수 있음) */
  match?: BookMatch;
}

/** 외부 도서 데이터베이스에서 찾은 보강 정보 */
export interface BookMatch {
  title: string;
  author: string;
  firstPublishYear?: number;
  isbn?: string;
  coverUrl?: string;
  infoUrl?: string;
}

export interface ScanResponse {
  books: RecognizedBook[];
  /** 모델이 남긴 참고 메모 (흐릿한 책등 등) */
  notes: string;
  /** 사용량 및 모델 정보 */
  meta: {
    model: string;
    imageCount: number;
    inputTokens: number;
    outputTokens: number;
    elapsedMs: number;
  };
}
