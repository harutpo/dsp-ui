// 「デスクに座った男の子」（正面向き）のドット絵スプライトを生成するスクリプト
// 使い方: node tools/generate-boy.js
// 出力: characters/boy/*.png, characters/boy/character.json, tools/preview-boy.png
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ---- パレット ----
const PAL = {
  H: [0x4a, 0x36, 0x29], // 髪（こげ茶）
  S: [0xf4, 0xc8, 0x96], // 肌
  B: [0x4f, 0x7f, 0xca], // シャツ（青）
  T: [0xa5, 0x70, 0x2f], // デスク天板
  U: [0x7d, 0x54, 0x23], // デスク脚（濃い木目）
  K: [0x2b, 0x21, 0x18], // 目
  W: [0xff, 0xf6, 0xe9], // 白（襟）
};

// ---- ミニ描画ライブラリ（generate-corgi.js と同方式） ----
function canvas(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) };
}
function px(c, x, y, col) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  const rgb = PAL[col];
  c.data[i] = rgb[0]; c.data[i + 1] = rgb[1]; c.data[i + 2] = rgb[2]; c.data[i + 3] = 255;
}
function rect(c, x, y, w, h, col) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(c, i, j, col);
}
function clearPx(c, x, y) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  c.data[(y * c.w + x) * 4 + 3] = 0;
}
function isOpaque(c, x, y) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return false;
  return c.data[(y * c.w + x) * 4 + 3] > 0;
}
function edgeDarken(c, amount = 0.55) {
  const out = new Uint8Array(c.data);
  const K = PAL.K;
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (!isOpaque(c, x, y)) continue;
      const edge = !isOpaque(c, x - 1, y) || !isOpaque(c, x + 1, y) ||
                   !isOpaque(c, x, y - 1) || !isOpaque(c, x, y + 1);
      if (!edge) continue;
      const i = (y * c.w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        out[i + ch] = Math.round(c.data[i + ch] * (1 - amount) + K[ch] * amount);
      }
    }
  }
  c.data = out;
}
function scaleCanvas(c, f) {
  const s = canvas(c.w * f, c.h * f);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const si = (y * s.w + x) * 4;
      const ci = ((y / f | 0) * c.w + (x / f | 0)) * 4;
      s.data[si] = c.data[ci]; s.data[si + 1] = c.data[ci + 1];
      s.data[si + 2] = c.data[ci + 2]; s.data[si + 3] = c.data[ci + 3];
    }
  }
  return s;
}
function savePng(c, file) {
  const png = new PNG({ width: c.w, height: c.h });
  Buffer.from(c.data).copy(png.data);
  fs.writeFileSync(file, PNG.sync.write(png));
}

const FW = 32, FH = 26;

// ---- デスク（共通パーツ） ----
function drawDesk(c) {
  rect(c, 6, 20, 20, 2, 'T');   // 天板
  rect(c, 7, 22, 2, 4, 'U');    // 左脚
  rect(c, 23, 22, 2, 4, 'U');   // 右脚
}

// ---- 座りポーズ（正面） ----
// opts: { blink, handL: 0|1, handR: 0|1 } hand=1で持ち上げ（タイピング）
function drawSitting(o = {}) {
  const c = canvas(FW, FH);
  // 胴体（シャツ）
  rect(c, 10, 12, 12, 7, 'B');
  clearPx(c, 10, 12); clearPx(c, 21, 12); // 肩を丸く
  // 襟
  px(c, 15, 12, 'W'); px(c, 16, 12, 'W');
  // 腕（左右、デスクに向かって下ろす）
  rect(c, 8, 13, 2, 6, 'B');
  rect(c, 22, 13, 2, 6, 'B');
  // 首
  px(c, 15, 11, 'S'); px(c, 16, 11, 'S');
  // 頭
  rect(c, 11, 4, 10, 7, 'S');   // 顔 y4-10
  clearPx(c, 11, 4); clearPx(c, 20, 4);
  // 髪（上＋前髪＋サイド）
  rect(c, 11, 2, 10, 3, 'H');   // y2-4
  px(c, 12, 1, 'H'); px(c, 15, 1, 'H'); px(c, 18, 1, 'H'); // 毛先
  px(c, 11, 5, 'H'); px(c, 14, 5, 'H'); px(c, 17, 5, 'H'); px(c, 20, 5, 'H'); // 前髪ギザギザ
  px(c, 10, 5, 'S'); px(c, 21, 5, 'S'); // 耳
  // 目・口
  if (o.blink) {
    px(c, 13, 8, 'H'); px(c, 14, 8, 'H');
    px(c, 17, 8, 'H'); px(c, 18, 8, 'H');
  } else {
    px(c, 13, 8, 'K'); px(c, 18, 8, 'K');
  }
  px(c, 15, 10, 'K'); px(c, 16, 10, 'K'); // 口
  // デスク
  drawDesk(c);
  // 手（デスクの上）タイピングで上下
  const ly = o.handL ? 18 : 19;
  const ry = o.handR ? 18 : 19;
  rect(c, 11, ly, 3, 1, 'S');
  rect(c, 18, ry, 3, 1, 'S');
  edgeDarken(c);
  return c;
}

// ---- 突っ伏して寝るポーズ ----
// opts: { lift } lift=1 で頭がわずかに上がる（寝息）
function drawSleeping(o = {}) {
  const c = canvas(FW, FH);
  const dy = o.lift ? -1 : 0;
  // 胴体（少し見える背中）
  rect(c, 10, 15, 12, 4, 'B');
  // 頭（デスクに伏せる・横に傾けてこちら向き）
  rect(c, 11, 12 + dy, 10, 6, 'S');
  clearPx(c, 11, 12 + dy); clearPx(c, 20, 12 + dy);
  // 髪
  rect(c, 11, 10 + dy, 10, 3, 'H');
  px(c, 12, 9 + dy, 'H'); px(c, 16, 9 + dy, 'H'); px(c, 19, 9 + dy, 'H');
  // 閉じた目
  px(c, 13, 15 + dy, 'H'); px(c, 14, 15 + dy, 'H');
  px(c, 17, 15 + dy, 'H'); px(c, 18, 15 + dy, 'H');
  // 腕（頭の下で組む）
  rect(c, 9, 18, 14, 2, 'B');
  rect(c, 11, 19, 3, 1, 'S'); rect(c, 18, 19, 3, 1, 'S'); // 手
  // デスク
  drawDesk(c);
  edgeDarken(c);
  return c;
}

// ---- 出力 ----
const outDir = path.join(__dirname, '..', 'characters', 'boy');
fs.mkdirSync(outDir, { recursive: true });

const frames = {
  'idle_0': drawSitting({}),
  'idle_1': drawSitting({ blink: true }),
  'work_0': drawSitting({ handL: 1, handR: 0 }),
  'work_1': drawSitting({ handL: 0, handR: 1 }),
  'sleep_0': drawSleeping({}),
  'sleep_1': drawSleeping({ lift: 1 }),
};
for (const [name, cv] of Object.entries(frames)) {
  savePng(cv, path.join(outDir, name + '.png'));
}

const manifest = {
  name: '男の子',
  frameWidth: FW,
  frameHeight: FH,
  scale: 1,
  facing: 'front',
  animations: {
    idle: { frames: ['idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_1.png'], fps: 2 },
    work: { frames: ['work_0.png', 'work_1.png'], fps: 4 },
    sleep: { frames: ['sleep_0.png', 'sleep_1.png'], fps: 1 },
  },
};
fs.writeFileSync(path.join(outDir, 'character.json'), JSON.stringify(manifest, null, 2));

// プレビュー（全フレーム横並び・6倍・薄グレー背景）
{
  const names = Object.keys(frames);
  const gap = 2, sc = 6;
  const sheet = canvas((FW + gap) * names.length, FH + 4);
  for (let i = 0; i < sheet.data.length; i += 4) {
    sheet.data[i] = 0xdd; sheet.data[i + 1] = 0xdd; sheet.data[i + 2] = 0xdd; sheet.data[i + 3] = 255;
  }
  names.forEach((n, idx) => {
    const f = frames[n];
    const ox = idx * (FW + gap);
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const ci = (y * f.w + x) * 4;
      if (f.data[ci + 3] === 0) continue;
      const si = ((y + 2) * sheet.w + x + ox) * 4;
      sheet.data[si] = f.data[ci]; sheet.data[si + 1] = f.data[ci + 1];
      sheet.data[si + 2] = f.data[ci + 2]; sheet.data[si + 3] = 255;
    }
  });
  savePng(scaleCanvas(sheet, sc), path.join(__dirname, 'preview-boy.png'));
}

console.log('男の子スプライト生成完了: ' + outDir);
