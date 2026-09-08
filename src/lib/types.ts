/** 외부 도서 데이터베이스(Open Library)에서 찾은 보강 정보 */
export interface BookMatch {
  title: string;
  author: string;
  firstPublishYear?: number;
  isbn?: string;
  coverUrl?: string;
  infoUrl?: string;
  /** OCR 원문과 이 후보가 얼마나 닮았는지 0~1 */
  similarity: number;
}

/** 사진 한 장에서 읽어낸 책 한 권 */
export interface RecognizedBook {
  /** 화면에 보여 줄 제목. 보강에 성공하면 정식 제목으로 바뀐다. */
  title: string;
  author: string;
  /** OCR이 책등에서 읽은 원문 (다듬기 전) */
  spineText: string;
  /** 다른 방향/모델로 읽은 결과들 */
  alternatives: string[];
  /** 0~1 */
  confidence: number;
  match?: BookMatch;
}

/** 내 서재에 저장된 책 */
export interface SavedBook extends RecognizedBook {
  id: string;
  savedAt: string;
}
