/**
 * 실제 사진 읽기 결과를 정답 제목과 대본다.
 *
 * 합성 벤치(run.mjs)는 정답을 스스로 그리지만, 실제 사진은 정답을 손으로 적어야 한다.
 * 제목 한 줄씩 적은 파일을 만들어 두고 이 스크립트로 잰다.
 *
 *   node bench/read.mjs ~/사진.jpg > 결과.txt
 *   node bench/score.mjs 정답.txt 결과.txt
 *
 * 세는 법: 제목이 읽기 결과 **어딘가에** 거의 그대로 들어 있으면 찾은 것으로 본다.
 * 앞뒤 군더더기는 공짜로 두고 제목 안의 오탈자만 센다 (부분 일치 편집 거리).
 * "연속 몇 글자가 그대로" 같은 잣대는 한 글자 차이로 0점이 되어 못 쓴다.
 */
import fs from "node:fs";

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("사용법: node bench/score.mjs <정답.txt> <결과.txt> [결과2.txt ...]");
  process.exit(1);
}

const norm = (value) => value.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
const truth = fs
  .readFileSync(args[0], "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

/** needle 이 haystack 의 어느 부분과 가장 닮았는지. 1이면 그대로 들어 있다. */
function partialSimilarity(needle, haystack) {
  if (!needle.length || !haystack.length) return 0;
  let previous = new Array(haystack.length + 1).fill(0); // 어디서 시작하든 공짜
  for (let i = 1; i <= needle.length; i++) {
    const current = [i];
    for (let j = 1; j <= haystack.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (needle[i - 1] === haystack[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - Math.min(...previous) / needle.length;
}

/**
 * 채점할 읽기들.
 *
 * 기본은 본 제목만 본다. 사용자가 입력칸에서 보는 것이 그것이다.
 * ALT=1 이면 "다르게 읽기" 후보까지 본다. 화면에서 골라 쓸 수는 있지만 확인 필요로
 * 표시된 책에만 나오고, 무엇보다 사용자가 직접 찾아 골라야 한다. 예전 숫자와 견줄 때만 쓴다.
 */
const withAlternatives = process.env.ALT === "1";
function readingsOf(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => /^\s*\d+\./.test(line))
    .map((line) => line.replace(/^\s*\d+\.\s*x\S+\s+\d+%\s*/, ""))
    .flatMap((line) =>
      withAlternatives
        ? line.split(/\[대안|\|/).map((part) => part.replace(/\]/g, "").trim())
        : [line.split("[대안")[0].trim()],
    )
    .filter((text) => text && text !== "(못 읽음)");
}

const BUCKETS = [
  [0.9, 1.01, "거의 정확"],
  [0.7, 0.9, "고치면 됨"],
  [0.4, 0.7, "비슷은 함"],
  [0, 0.4, "못 읽음"],
];

for (const file of args.slice(1)) {
  const readings = readingsOf(file);
  const header = fs.readFileSync(file, "utf8").split("\n").find((line) => /권 ·/.test(line)) ?? "";
  const scored = truth.map((title) => {
    const key = norm(title);
    let best = 0;
    let text = "";
    for (const reading of readings) {
      const score = partialSimilarity(key, norm(reading));
      if (score > best) {
        best = score;
        text = reading;
      }
    }
    return { title, best, text };
  });

  console.log(`\n■ ${file}`);
  if (header) console.log(`   ${header.trim()}`);
  for (const [low, high, label] of BUCKETS) {
    const rows = scored.filter((row) => row.best >= low && row.best < high);
    console.log(`   ${label.padEnd(6)} ${String(rows.length).padStart(2)}/${truth.length}  ${"█".repeat(rows.length)}`);
  }
  if (args.includes("--detail") || process.env.DETAIL) {
    for (const row of scored.sort((a, b) => b.best - a.best)) {
      console.log(`   ${String(Math.round(row.best * 100)).padStart(3)}%  ${row.title.padEnd(24)} ← ${row.text.slice(0, 44)}`);
    }
  }
}
