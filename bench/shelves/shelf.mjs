/**
 * 합성 책장 사진 생성기.
 * 실제 사진을 쓸 수 없으니, 조건을 통제한 이미지를 만들어 정확도를 잰다.
 * 기울기와 흐림을 넣어 손으로 찍은 사진에 가깝게 만든다.
 */

const PALETTE = [
  ["#b8402f", "#fff2e0"],
  ["#e6dcc4", "#2b2118"],
  ["#1d4a63", "#eef5ff"],
  ["#2c6437", "#f0ffe6"],
  ["#d4a03c", "#241d0c"],
  ["#54356f", "#f5ecff"],
  ["#1a1a1c", "#e8e8ea"],
  ["#c96a2c", "#fff4e8"],
  ["#f2ede1", "#33291d"],
  ["#3a6d6a", "#eafffd"],
];

/**
 * @param {object} spec
 * @param {string[]} spec.titles 책등에 넣을 제목
 * @param {"rotated"|"stacked"} spec.layout 책등 글자 배치
 * @param {string} spec.fontFace @font-face 규칙 (없으면 시스템 폰트)
 * @param {string} spec.fontFamily
 * @param {number} spec.tiltDeg 사진 기울기
 */
export function shelfHtml({ titles, layout, fontFace = "", fontFamily = "sans-serif", tiltDeg = -1.2 }) {
  const spines = titles
    .map((title, index) => {
      const [bg, fg] = PALETTE[index % PALETTE.length];
      const width = 46 + ((index * 7) % 22);
      const height = 360 + ((index * 13) % 70);
      const direction = index % 2 === 0 ? "cw" : "ccw";
      const size = layout === "stacked" ? Math.round(width * 0.62) : Math.round(width * 0.46);
      const inner =
        layout === "stacked"
          ? `<span class="stacked" style="font-size:${size}px">${[...title.replace(/\s/g, "")].join("<br>")}</span>`
          : `<span style="font-size:${size}px">${title}</span>`;
      return `<div class="spine ${layout === "stacked" ? "flat" : direction}" style="width:${width}px;height:${height}px;background:${bg};color:${fg}">${inner}</div>`;
    })
    .join("\n");

  return `<!doctype html><meta charset="utf-8">
<style>
 ${fontFace}
 body { margin:0; background:#2a1e14; }
 .wrap { position:relative; width:1280px; height:520px; overflow:hidden;
         background:repeating-linear-gradient(90deg,#4b3a26 0 3px,#402d1d 3px 7px,#4a3a2a 7px 11px);
         filter: blur(0.5px) saturate(0.95); }
 .wrap::after { content:""; position:absolute; inset:0;
   background:radial-gradient(ellipse at 25% 20%, rgba(255,240,200,.3), rgba(0,0,0,.5) 78%); }
 .shelf { display:flex; align-items:flex-end; height:100%; padding:0 40px 26px;
          transform: rotate(${tiltDeg}deg) scale(1.02); transform-origin:center bottom; }
 .spine { display:flex; align-items:center; justify-content:center; margin-right:2px;
          border-radius:2px 2px 0 0;
          box-shadow: inset -7px 0 14px rgba(0,0,0,.45), inset 5px 0 8px rgba(255,255,255,.08); }
 .spine span { white-space:nowrap; font-weight:700; font-family:${fontFamily}; }
 .cw span { transform: rotate(90deg); }
 .ccw span { transform: rotate(-90deg); }
 .flat { align-items:flex-start; padding-top:26px; }
 .stacked { white-space:normal; text-align:center; line-height:1.02; }
</style>
<div class="wrap"><div class="shelf">
${spines}
</div></div>`;
}
