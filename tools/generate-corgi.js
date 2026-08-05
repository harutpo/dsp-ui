// コーギーのドット絵スプライトを生成するスクリプト
// 使い方: npm run sprites
// 出力: characters/corgi/*.png, characters/corgi/character.json, assets/tray.png, tools/preview.png
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ---- パレット ----
const PAL = {
  O: [0xe8, 0x97, 0x4e], // 体のオレンジ
  D: [0xc8, 0x76, 0x3a], // 濃いオレンジ（まぶた等）
  W: [0xff, 0xf6, 0xe9], // 白（胸・マズル）
  K: [0x35, 0x24, 0x1a], // こげ茶（目・鼻・輪郭）
  P: [0xf2, 0xa0, 0xa0], // ピンク（耳の内側・舌）
};

// ---- ミニ描画ライブラリ ----
function canvas(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) }; // RGBA, alpha0=透明
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
// 透明部分と接するピクセルをこげ茶側に寄せて輪郭っぽくする
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

// ---- 立ちポーズ（右向き）32x22 ----
// opts: { legPhase: 0-3, tailUp, blink, earTwitch, tongue }
function drawStanding(o = {}) {
  const c = canvas(32, 22);
  // しっぽ（ふさふさ）
  if (o.tailUp !== false) {
    rect(c, 1, 6, 3, 4, 'O'); px(c, 0, 7, 'O');
    rect(c, 1, 6, 2, 2, 'W');
  } else {
    rect(c, 1, 9, 3, 4, 'O'); px(c, 0, 12, 'O');
    rect(c, 1, 11, 2, 2, 'W');
  }
  // 脚（先に描いて体を上に重ねる）短足4本
  const phase = o.legPhase | 0;
  for (const x of [5, 10, 16, 21]) {
    const lifted = (phase === 1 && (x === 5 || x === 16)) ||
                   (phase === 3 && (x === 10 || x === 21));
    const lx = lifted ? x + 1 : x;
    const bottom = lifted ? 20 : 21;
    rect(c, lx, 17, 3, bottom - 17 + 1, 'O');
    rect(c, lx, bottom, 3, 1, 'W');
    px(c, lx + 3, bottom, 'W'); // つま先
  }
  // 胴体
  rect(c, 4, 8, 20, 9, 'O');
  clearPx(c, 4, 8); clearPx(c, 4, 16); // おしり側を丸く
  // おなか・胸の白
  rect(c, 9, 13, 14, 4, 'W');
  rect(c, 20, 11, 4, 6, 'W');
  // あご下の白い胸元
  rect(c, 24, 11, 4, 2, 'W');
  rect(c, 24, 13, 2, 2, 'W');
  // 頭
  rect(c, 20, 3, 10, 8, 'O');
  clearPx(c, 20, 3); clearPx(c, 29, 3);
  // 顔の白いライン
  rect(c, 28, 4, 2, 3, 'W');
  // マズル（口まわり）
  rect(c, 27, 6, 5, 4, 'W');
  // 鼻・口
  px(c, 30, 6, 'K'); px(c, 31, 6, 'K');
  px(c, 31, 8, 'K');
  if (o.tongue) { px(c, 30, 9, 'P'); px(c, 31, 9, 'P'); px(c, 30, 10, 'P'); }
  // 目
  px(c, 25, 5, o.blink ? 'D' : 'K');
  // 耳（三角形2つ）
  px(c, 21, 0, 'O'); rect(c, 20, 1, 3, 1, 'O'); rect(c, 20, 2, 3, 1, 'O'); px(c, 21, 2, 'P');
  const s = o.earTwitch ? 1 : 0;
  px(c, 26 + s, 0, 'O'); rect(c, 25 + s, 1, 3, 1, 'O'); rect(c, 25 + s, 2, 3, 1, 'O'); px(c, 26 + s, 2, 'P');
  edgeDarken(c);
  return c;
}

// ---- 寝ポーズ 32x22 ----
function drawSleeping(o = {}) {
  const c = canvas(32, 22);
  // しっぽ（丸まる）
  rect(c, 0, 16, 4, 3, 'O');
  rect(c, 0, 16, 2, 2, 'W');
  // 胴体（伏せ）
  rect(c, 3, 15, 21, 7, 'O');
  clearPx(c, 3, 15);
  if (o.breathe) rect(c, 5, 14, 16, 1, 'O'); // 吸ったとき背中が少し上がる
  // おなかの白
  rect(c, 7, 19, 15, 3, 'W');
  // 前足ブロック
  rect(c, 24, 18, 6, 4, 'O');
  rect(c, 26, 20, 4, 2, 'W');
  // 頭（伏せて前を向く）
  rect(c, 21, 10, 10, 8, 'O');
  clearPx(c, 21, 10); clearPx(c, 30, 10);
  // たれ耳
  rect(c, 21, 8, 2, 2, 'O');
  rect(c, 26, 8, 2, 2, 'O'); px(c, 27, 9, 'P');
  // 顔の白いライン・マズル
  rect(c, 27, 10, 2, 3, 'W');
  rect(c, 26, 13, 5, 4, 'W');
  px(c, 29, 13, 'K'); px(c, 30, 13, 'K'); // 鼻
  // 閉じた目
  px(c, 24, 12, 'K'); px(c, 25, 12, 'K');
  edgeDarken(c);
  return c;
}

// ---- トレイアイコン（正面顔）16x16 ----
function drawFace() {
  const c = canvas(16, 16);
  // 耳
  px(c, 3, 0, 'O'); rect(c, 2, 1, 3, 2, 'O'); px(c, 3, 2, 'P');
  px(c, 12, 0, 'O'); rect(c, 11, 1, 3, 2, 'O'); px(c, 12, 2, 'P');
  // 頭
  rect(c, 2, 3, 12, 10, 'O');
  clearPx(c, 2, 3); clearPx(c, 13, 3); clearPx(c, 2, 12); clearPx(c, 13, 12);
  // 顔の白いライン
  rect(c, 7, 3, 2, 4, 'W');
  // 目
  px(c, 5, 7, 'K'); px(c, 10, 7, 'K');
  // マズル・鼻
  rect(c, 5, 8, 6, 5, 'W');
  rect(c, 7, 8, 2, 2, 'K');
  edgeDarken(c);
  return c;
}

// ---- 出力 ----
const outDir = path.join(__dirname, '..', 'characters', 'corgi');
const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(assetsDir, { recursive: true });

const frames = {
  'idle_0': drawStanding({ tailUp: true }),
  'idle_1': drawStanding({ tailUp: true, blink: true }),
  'walk_0': drawStanding({ legPhase: 0 }),
  'walk_1': drawStanding({ legPhase: 1 }),
  'walk_2': drawStanding({ legPhase: 2, tailUp: false }),
  'walk_3': drawStanding({ legPhase: 3, tailUp: false }),
  'work_0': drawStanding({ tailUp: true, tongue: true, earTwitch: false }),
  'work_1': drawStanding({ tailUp: false, tongue: true, earTwitch: true }),
  'sleep_0': drawSleeping({}),
  'sleep_1': drawSleeping({ breathe: true }),
};
for (const [name, cv] of Object.entries(frames)) {
  savePng(cv, path.join(outDir, name + '.png'));
}

const manifest = {
  name: 'コーギー',
  frameWidth: 32,
  frameHeight: 22,
  scale: 1,
  facing: 'right',
  animations: {
    idle: { frames: ['idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_1.png'], fps: 2 },
    walk: { frames: ['walk_0.png', 'walk_1.png', 'walk_2.png', 'walk_3.png'], fps: 7 },
    work: { frames: ['work_0.png', 'work_1.png'], fps: 4 },
    sleep: { frames: ['sleep_0.png', 'sleep_1.png'], fps: 1 },
  },
};
fs.writeFileSync(path.join(outDir, 'character.json'), JSON.stringify(manifest, null, 2));

// トレイアイコン（32x32）
savePng(scaleCanvas(drawFace(), 2), path.join(assetsDir, 'tray.png'));

// プレビュー（全フレーム横並び・6倍・薄グレー背景）
{
  const names = Object.keys(frames);
  const fw = 32, fh = 22, gap = 2, sc = 6;
  const sheet = canvas((fw + gap) * names.length, fh + 4);
  // 背景
  for (let i = 0; i < sheet.data.length; i += 4) {
    sheet.data[i] = 0xdd; sheet.data[i + 1] = 0xdd; sheet.data[i + 2] = 0xdd; sheet.data[i + 3] = 255;
  }
  names.forEach((n, idx) => {
    const f = frames[n];
    const ox = idx * (fw + gap);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const ci = (y * f.w + x) * 4;
      if (f.data[ci + 3] === 0) continue;
      const si = ((y + 2) * sheet.w + x + ox) * 4;
      sheet.data[si] = f.data[ci]; sheet.data[si + 1] = f.data[ci + 1];
      sheet.data[si + 2] = f.data[ci + 2]; sheet.data[si + 3] = 255;
    }
  });
  savePng(scaleCanvas(sheet, sc), path.join(__dirname, 'preview.png'));
}

console.log('スプライト生成完了: ' + outDir);
