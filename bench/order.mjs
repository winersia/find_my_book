/**
 * 왼쪽부터 자리별로 채점한다. 순서와 권수까지 본다.
 *
 *   node bench/order.mjs <정답.txt> <bench/read.mjs 출력> [앞에서 몇 권, 기본 전부]
 *
 * 자리마다 셋 중 하나다.
 *  - 맞음: 제목 전체가 90% 이상 같다 (글자만 비교, 띄어쓰기·문장부호 무시)
 *  - 빈칸: 못 읽어서 비워 뒀다. 사용자가 적으면 된다
 *  - 틀림: 엉뚱한 제목이 들어갔다. 사용자가 알아채지 못하면 그대로 남는다
 * 앞 자리에서 책이 빠지거나 끼어들면 뒤가 줄줄이 틀린다. 그래서 정렬도 같이 보여 준다.
 */
import fs from "node:fs";

const [truthFile, readFile, limitArg] = process.argv.slice(2);
const truth = fs.readFileSync(truthFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const limit = Number(limitArg ?? truth.length);
const readings = fs
  .readFileSync(readFile, "utf8")
  .split("\n")
  .filter((line) => /^\s*\d+\.\s*x/.test(line))
  .map((line) => line.replace(/^\s*\d+\.\s*x\S+\s+\d+%\s*/, "").split("[대안")[0].trim())
  .map((text) => (text === "(못 읽음)" ? "" : text));

const letters = (text) => (text.normalize("NFC").match(/[A-Za-z0-9가-힣]/g) ?? []).join("").toLowerCase();
function similarity(a, b) {
  const x = [...letters(a)];
  const y = [...letters(b)];
  if (!x.length || !y.length) return 0;
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (x[i - 1] === y[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - row[y.length] / Math.max(x.length, y.length);
}

// 자리별 판정
const verdict = (truthTitle, text) => {
  if (!letters(text)) return "빈칸";
  return similarity(truthTitle, text) >= 0.9 ? "맞음" : "틀림";
};
let tally = { 맞음: 0, 빈칸: 0, 틀림: 0 };
console.log(`읽은 권수 ${readings.length}권 (정답 ${truth.length}권)`);
console.log(`앞에서 ${limit}권, 자리별:`);
for (let i = 0; i < limit; i++) {
  const text = readings[i] ?? "";
  const v = readings[i] === undefined ? "틀림" : verdict(truth[i], text);
  tally[v]++;
  const sim = letters(text) ? `${Math.round(similarity(truth[i], text) * 100)}%` : "";
  console.log(`  ${String(i + 1).padStart(2)}. ${v}  ${truth[i].padEnd(18)} ← ${text || "(빈칸)"} ${sim}`);
}
console.log(`  = 맞음 ${tally.맞음} · 빈칸 ${tally.빈칸} · 틀림 ${tally.틀림}`);

// 정렬: 읽은 줄과 정답을 순서대로 짝짓는다. 빠진 책·끼어든 책을 찾는다.
const n = truth.length;
const m = readings.length;
const score = (i, j) => (letters(readings[j]) ? similarity(truth[i], readings[j]) : 0.35);
const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
const move = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
for (let i = 1; i <= n; i++) move[i][0] = 1;
for (let j = 1; j <= m; j++) move[0][j] = 2;
for (let i = 1; i <= n; i++) {
  for (let j = 1; j <= m; j++) {
    const options = [best[i - 1][j - 1] + score(i - 1, j - 1), best[i - 1][j] - 0.1, best[i][j - 1] - 0.1];
    const k = options.indexOf(Math.max(...options));
    best[i][j] = options[k];
    move[i][j] = k;
  }
}
const pairs = [];
for (let i = n, j = m; i > 0 || j > 0; ) {
  const k = i === 0 ? 2 : j === 0 ? 1 : move[i][j];
  if (k === 0) pairs.unshift([truth[--i], readings[--j], j + 1]);
  else if (k === 1) pairs.unshift([truth[--i], null, null]);
  else pairs.unshift([null, readings[--j], j]);
  if (k === 2) pairs[0][2] = j + 1;
}
const firstTruthLimit = truth[limit - 1];
console.log(`정렬 (앞 ${limit}권 범위):`);
for (const [t, r, k] of pairs) {
  if (t === null) console.log(`     + 끼어듦   #${k} ${r || "(빈칸)"}`);
  else if (r === null) console.log(`     - 빠짐     ${t}`);
  else console.log(`       #${String(k).padEnd(3)} ${t.padEnd(18)} ← ${r || "(빈칸)"}`);
  if (t === firstTruthLimit) break;
}
