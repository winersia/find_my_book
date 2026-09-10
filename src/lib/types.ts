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
