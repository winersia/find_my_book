import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { RecognizedBook } from "./types.js";

const MODEL = process.env.BOOKSHELF_MODEL ?? "claude-opus-5";
/** 1차 모델이 정책상 응답을 거절했을 때만 쓰는 예비 모델 */
const FALLBACK_MODEL = process.env.BOOKSHELF_FALLBACK_MODEL ?? "claude-opus-4-8";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

const BookSchema = z.object({
  title: z
    .string()
    .describe("책 제목. 부제는 빼고 표지에 적힌 주 제목만. 확실하지 않으면 읽은 그대로."),
  author: z.string().describe("저자명. 책등에서 읽을 수 없으면 빈 문자열."),
  publisher: z.string().describe("출판사명. 읽을 수 없으면 빈 문자열."),
  spine_text: z.string().describe("책등에서 실제로 읽어낸 글자 전체."),
  language: z.string().describe("제목의 표기 언어 코드. 예: ko, en, ja."),
  confidence: z
    .number()
    .describe("이 책을 정확히 읽었다는 확신도. 0.0~1.0 사이 값."),
});

const ScanSchema = z.object({
  books: z.array(BookSchema).describe("사진에서 확인한 책들. 왼쪽에서 오른쪽, 위에서 아래 순서."),
  notes: z
    .string()
    .describe("흐릿하거나 가려져서 읽지 못한 책이 있으면 한국어 한두 문장으로 설명. 없으면 빈 문자열."),
});

const SYSTEM_PROMPT = `당신은 책장 사진에서 책등(spine)을 읽어 장서 목록을 만드는 도구다.

규칙:
- 사진에 실제로 보이는 책만 나열한다. 추측으로 책을 만들어내지 않는다.
- 책등 글자는 대부분 세로로 회전되어 있다. 회전된 글자도 읽어낸다.
- 한 권이 여러 각도에서 보여도 한 번만 나열한다. 같은 책이 실제로 여러 권 꽂혀 있으면 각각 나열한다.
- 눕혀서 쌓인 책, 표지가 보이는 책도 포함한다.
- 책이 아닌 물건(액자, 화분, 소품, 파일 박스)은 제외한다.
- 글자가 잘리거나 흐려서 일부만 읽히면 읽은 만큼만 적고 confidence를 낮춘다.
- 명백한 오독은 실제 존재하는 책 제목으로 보정하되, 원문은 spine_text에 그대로 남긴다.
- 왼쪽에서 오른쪽, 위 칸에서 아래 칸 순서로 나열한다.`;

const USER_PROMPT = `이 책장 사진에서 책등을 읽어 책 목록을 만들어 줘. 각 책의 제목, 저자, 출판사, 표기 언어, 신뢰도를 채워 줘. 읽지 못한 항목은 빈 문자열로 둬.`;

export class ScanError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ScanError";
  }
}

interface ParsedImage {
  mediaType: AllowedMediaType;
  data: string;
}

/** `data:image/jpeg;base64,...` 형태의 문자열을 검증하고 분해한다. */
export function parseDataUrl(input: string): ParsedImage {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(input.trim());
  if (!match) {
    throw new ScanError("이미지는 base64 data URL 형식이어야 합니다.", 400);
  }
  const mediaType = match[1].toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType as AllowedMediaType)) {
    throw new ScanError(`지원하지 않는 이미지 형식입니다: ${mediaType}`, 415);
  }
  const data = match[2];
  const bytes = Math.floor((data.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new ScanError("이미지가 너무 큽니다. 5MB 이하로 줄여 주세요.", 413);
  }
  return { mediaType: mediaType as AllowedMediaType, data };
}

export function normalizeImages(body: unknown): ParsedImage[] {
  const payload = body as { image?: unknown; images?: unknown };
  const raw: unknown[] = Array.isArray(payload?.images)
    ? payload.images
    : payload?.image
      ? [payload.image]
      : [];

  if (raw.length === 0) {
    throw new ScanError("이미지가 없습니다.", 400);
  }
  if (raw.length > MAX_IMAGES) {
    throw new ScanError(`이미지는 한 번에 최대 ${MAX_IMAGES}장까지 보낼 수 있습니다.`, 400);
  }
  return raw.map((item) => {
    if (typeof item !== "string") {
      throw new ScanError("이미지는 문자열이어야 합니다.", 400);
    }
    return parseDataUrl(item);
  });
}

export interface ScanResult {
  books: RecognizedBook[];
  notes: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    // API 키는 ANTHROPIC_API_KEY 환경변수 또는 `ant auth login` 프로필에서 읽는다.
    client = new Anthropic();
  }
  return client;
}

async function askClaude(images: ParsedImage[], model: string) {
  return getClient().messages.parse({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: image.mediaType,
              data: image.data,
            },
          })),
          { type: "text" as const, text: USER_PROMPT },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ScanSchema) },
  });
}

/** 책장 사진에서 책 목록을 인식한다. */
export async function recognizeBooks(images: ParsedImage[]): Promise<ScanResult> {
  let response = await askClaude(images, MODEL);
  let usedModel = MODEL;

  // 정책상 거절된 경우에만 예비 모델로 한 번 더 시도한다.
  if (response.stop_reason === "refusal" && FALLBACK_MODEL && FALLBACK_MODEL !== MODEL) {
    response = await askClaude(images, FALLBACK_MODEL);
    usedModel = FALLBACK_MODEL;
  }

  if (response.stop_reason === "refusal") {
    throw new ScanError("모델이 이 이미지의 처리를 거절했습니다. 다른 사진으로 시도해 주세요.", 422);
  }
  if (!response.parsed_output) {
    throw new ScanError("책 목록을 해석하지 못했습니다. 다시 시도해 주세요.", 502);
  }

  const books: RecognizedBook[] = response.parsed_output.books
    .filter((book) => book.title.trim().length > 0)
    .map((book) => ({
      title: book.title.trim(),
      author: book.author.trim(),
      publisher: book.publisher.trim(),
      spineText: book.spine_text.trim(),
      language: book.language.trim().toLowerCase(),
      confidence: clamp(book.confidence),
    }));

  return {
    books,
    notes: response.parsed_output.notes.trim(),
    model: usedModel,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
