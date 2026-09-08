import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enrichBooks } from "./enrich.js";
import { ScanError, normalizeImages, recognizeBooks } from "./scan.js";
import type { ScanResponse } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
const port = Number(process.env.PORT ?? 8787);

const app = express();
app.use(express.json({ limit: "30mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: process.env.BOOKSHELF_MODEL ?? "claude-opus-5",
  });
});

app.post("/api/scan", async (req, res) => {
  const startedAt = Date.now();
  try {
    const images = normalizeImages(req.body);
    const wantsEnrichment = req.body?.enrich !== false;

    const result = await recognizeBooks(images);
    const books = wantsEnrichment ? await enrichBooks(result.books) : result.books;

    const payload: ScanResponse = {
      books,
      notes: result.notes,
      meta: {
        model: result.model,
        imageCount: images.length,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        elapsedMs: Date.now() - startedAt,
      },
    };
    res.json(payload);
  } catch (error) {
    handleError(error, res);
  }
});

// 빌드된 웹 앱이 있으면 같은 포트에서 함께 서빙한다.
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

function handleError(error: unknown, res: express.Response): void {
  if (error instanceof ScanError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  const status =
    typeof (error as { status?: unknown }).status === "number"
      ? ((error as { status: number }).status ?? 500)
      : 500;
  const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";

  console.error("[scan] 실패:", message);

  if (status === 401) {
    res.status(401).json({ error: "ANTHROPIC_API_KEY가 없거나 올바르지 않습니다." });
    return;
  }
  if (status === 429) {
    res.status(429).json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." });
    return;
  }
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
}

app.listen(port, () => {
  console.log(`책장 스캐너 서버: http://localhost:${port}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("경고: ANTHROPIC_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.");
  }
});
