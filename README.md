# 책장 스캐너 (find_my_book)

책장을 카메라로 찍으면 책등 글자를 읽어 책 목록을 만들어 주는 웹 앱입니다.
휴대폰 브라우저에서 바로 촬영할 수 있고, 인식한 책은 "내 서재"에 쌓아 두었다가
CSV/JSON으로 내려받을 수 있습니다.

인식은 Claude(기본값 `claude-opus-5`)의 비전 기능으로 처리하고,
표지·ISBN·출간연도는 Open Library에서 보강합니다.

## 화면 흐름

1. **촬영** 탭에서 카메라를 켜고 책장을 찍습니다. 넓은 책장은 최대 4장까지 나눠 찍을 수 있습니다.
2. **목록 만들기**를 누르면 서버가 사진을 Claude에 보내 책등을 읽습니다.
3. 결과에서 잘못 읽은 제목을 고치고, 책이 아닌 항목은 체크를 해제합니다.
4. **서재에 담기**를 누르면 중복을 걸러 내 서재에 저장됩니다. 저장은 브라우저 localStorage에 남습니다.

## 실행

```bash
npm install
cp .env.example .env      # ANTHROPIC_API_KEY 를 채웁니다
npm run dev               # 서버 :8787, 웹 :5173
```

브라우저에서 http://localhost:5173 을 엽니다.

프로덕션 빌드는 웹을 정적 파일로 만들고 서버가 같은 포트에서 함께 서빙합니다.

```bash
npm run build
npm start                 # http://localhost:8787
```

### 휴대폰에서 카메라 쓰기

브라우저는 `localhost`가 아닌 주소에서 **HTTPS일 때만** 카메라를 열어 줍니다.
같은 와이파이의 휴대폰에서 테스트하려면 ngrok 같은 터널로 HTTPS 주소를 만들어 접속하세요.
카메라를 못 여는 환경에서는 **사진 선택** 버튼으로 갤러리 사진을 쓸 수 있습니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (필수) | Anthropic API 키. `ant auth login` 프로필도 인식합니다. |
| `PORT` | `8787` | 서버 포트 |
| `BOOKSHELF_MODEL` | `claude-opus-5` | 책등 인식에 쓰는 모델 |
| `BOOKSHELF_FALLBACK_MODEL` | `claude-opus-4-8` | 1차 모델이 요청을 거절했을 때만 쓰는 예비 모델 |

## 구조

```
server/src/scan.ts    책장 사진 → Claude 비전 호출 → 구조화된 책 목록 (zod 스키마)
server/src/enrich.ts  Open Library 조회로 표지/ISBN/연도 보강 (실패해도 무시)
server/src/index.ts   Express API (/api/scan, /api/health) + 빌드된 웹 서빙
web/src/components/   카메라, 인식 결과 편집, 내 서재 화면
web/src/lib/          API 호출, 이미지 축소, localStorage 서재 관리
```

### API

`POST /api/scan`

```json
{ "images": ["data:image/jpeg;base64,..."], "enrich": true }
```

응답에는 책 배열(`title`, `author`, `publisher`, `spineText`, `language`, `confidence`, `match`),
모델이 남긴 메모, 사용 토큰과 소요 시간이 담깁니다.

## 인식이 잘 되게 찍는 요령

- 책장 한 칸 정도가 화면에 꽉 차게, 정면에서 찍습니다. 멀리서 책장 전체를 담으면 글자가 뭉갭니다.
- 책등에 그림자나 반사가 생기지 않게 합니다.
- 넓은 책장은 칸별로 나눠 찍은 뒤 한 번에 인식하는 편이 정확합니다.

사진은 업로드 전에 긴 변 1600px JPEG로 줄여 보냅니다. 원본을 그대로 보내지 않으므로
전송량과 토큰 비용이 줄어듭니다.

## 한계

- 글자가 작거나 가려진 책등은 놓치거나 다르게 읽습니다. 신뢰도 배지가 `불확실`이면 직접 확인하세요.
- Open Library는 한국어 도서 수록이 고르지 않아 표지가 안 붙는 책이 많습니다.
- 서재는 브라우저에 저장됩니다. 기기를 바꾸면 JSON으로 내보낸 뒤 옮겨야 합니다.
