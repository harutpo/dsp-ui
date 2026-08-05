// 図鑑用オリジナルモンスター151体を手続き生成するスクリプト
// 使い方: npm run dex
// 出力: dex/001〜151/*.png + character.json, dex/dex.json, tools/preview-dex.png
//
// 系統構成: 3段進化×45系統 + 2段進化×8系統 = 151体
// 番号をシードにした決定的生成なので、再実行しても同じ絵・同じ名前になる。
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const FW = 24;
const FH = 24;
const EVOLVE_AT = { 1: 60, 2: 240 }; // stage1→2: 累計60pt, stage2→3: 累計240pt

// ---- 決定的乱数 ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- ミニ描画ライブラリ（generate-corgi.js と同方式、色は直接RGB） ----
function canvas(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) };
}
function px(c, x, y, rgb) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  c.data[i] = rgb[0]; c.data[i + 1] = rgb[1]; c.data[i + 2] = rgb[2]; c.data[i + 3] = 255;
}
function rect(c, x, y, w, h, rgb) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(c, i, j, rgb);
}
function clearPx(c, x, y) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  c.data[(y * c.w + x) * 4 + 3] = 0;
}
function isOpaque(c, x, y) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return false;
  return c.data[(y * c.w + x) * 4 + 3] > 0;
}
function edgeDarken(c, outline, amount = 0.5) {
  const out = new Uint8Array(c.data);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (!isOpaque(c, x, y)) continue;
      const edge = !isOpaque(c, x - 1, y) || !isOpaque(c, x + 1, y) ||
                   !isOpaque(c, x, y - 1) || !isOpaque(c, x, y + 1);
      if (!edge) continue;
      const i = (y * c.w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        out[i + ch] = Math.round(c.data[i + ch] * (1 - amount) + outline[ch] * amount);
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
function hex2rgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// ---- 属性パレット（10属性） ----
const ELEMENTS = [
  { id: 'fire',     body: '#e8603a', dark: '#a83a1e', light: '#ffd9a0', accent: '#ffdf5e', outline: '#3a1a10' },
  { id: 'water',    body: '#4f9fe8', dark: '#2f6fb2', light: '#d6f0ff', accent: '#7de0ff', outline: '#122a44' },
  { id: 'grass',    body: '#6fbf4f', dark: '#4a8c34', light: '#e0f5c8', accent: '#a8e063', outline: '#1c3512' },
  { id: 'electric', body: '#f2c94c', dark: '#c29a1f', light: '#fff7d1', accent: '#ffe45e', outline: '#4a3a08' },
  { id: 'ice',      body: '#8fd8e8', dark: '#5aa7bf', light: '#f0fbff', accent: '#cdf2ff', outline: '#1e3d47' },
  { id: 'rock',     body: '#b09070', dark: '#7d6248', light: '#e8d9c4', accent: '#d4b483', outline: '#2e2318' },
  { id: 'wind',     body: '#a8d8b9', dark: '#6faf8a', light: '#f0fff5', accent: '#cfeee0', outline: '#23402f' },
  { id: 'dark',     body: '#7a6b9d', dark: '#4d4066', light: '#d8cfec', accent: '#a58fd0', outline: '#1c1528' },
  { id: 'light',    body: '#f2d98c', dark: '#c2a54f', light: '#fffbe8', accent: '#ffefa8', outline: '#453a14' },
  { id: 'bug',      body: '#9bbf3f', dark: '#6b8a24', light: '#eaf5c4', accent: '#c4e05e', outline: '#26320c' },
];
const SWEAT = [0x7d, 0xd8, 0xff]; // 作業中の汗
const EYE = [0x28, 0x20, 0x20];

// ---- 系統の名前（53系統: f%10 が属性に対応） ----
const STEMS = [
  'メラ', 'シズ', 'ハパ', 'ビリ', 'ユキ', 'イワ', 'カゼ', 'ヤミ', 'ヒカ', 'カブ',
  'ヒバ', 'ナミ', 'モリ', 'デン', 'コオ', 'ガン', 'ソヨ', 'カゲ', 'キラ', 'テン',
  'ゴウ', 'プク', 'ツタ', 'ゴロ', 'フブ', 'ゴツ', 'ハヤ', 'クロ', 'テラ', 'ハチ',
  'カエ', 'ウズ', 'コケ', 'イナ', 'ヒョ', 'ジャ', 'アラ', 'ヨル', 'アサ', 'クモ',
  'ヨウ', 'シオ', 'サボ', 'スパ', 'ツラ', 'ドロ', 'フウ', 'マヨ', 'シラ', 'セミ',
  'ボカ', 'アワ', 'キノ',
];
const SUFFIXES = [
  ['ッコ', 'ルガ', 'ドラス'],
  ['ポン', 'ドン', 'ガイザー'],
  ['ミュ', 'バーン', 'グランデ'],
  ['チチ', 'ロス', 'ザウルス'],
  ['プチ', 'ガル', 'ティラン'],
  ['ペコ', 'モス', 'カイザー'],
];
const FAMILY_COUNT = 53;
const THREE_STAGE_FAMILIES = 45; // 先頭45系統が3段進化、残り8系統が2段進化

// ---- モンスター描画 ----
// t: 系統の見た目トレイト { shape, ear, deco, pattern, eyeStyle, pal }
// o: { stage, pose: 'idle'|'work'|'sleep', alt }
function drawMonster(t, o) {
  const c = canvas(FW, FH);
  const pal = t.pal;
  const B = hex2rgb(pal.body), D = hex2rgb(pal.dark), L = hex2rgb(pal.light), A = hex2rgb(pal.accent);
  const OUT = hex2rgb(pal.outline);

  // 体のサイズ（段階が上がると大きくなる）
  let { w, h } = [{ w: 10, h: 8 }, { w: 13, h: 10 }, { w: 16, h: 13 }][o.stage - 1];
  if (t.shape === 1) { w -= 2; h += 2; }      // 縦長
  else if (t.shape === 2) { w += 2; h -= 1; } // ずんぐり

  if (o.pose === 'sleep') {
    // 伏せて眠る
    const lw = Math.min(20, w + 4);
    const lh = Math.max(4, h - 3);
    const x0 = (FW - lw) >> 1;
    const y0 = FH - 1 - lh;
    rect(c, x0, y0, lw, lh, B);
    clearPx(c, x0, y0); clearPx(c, x0 + lw - 1, y0);
    if (o.alt) rect(c, x0 + 2, y0 - 1, lw - 4, 1, B); // 呼吸で背中が上がる
    rect(c, x0 + 2, y0 + Math.ceil(lh / 2), lw - 4, Math.max(1, Math.floor(lh / 2) - 1), L);
    // 閉じた目
    const ey = y0 + 1;
    rect(c, x0 + Math.round(lw * 0.6), ey, 2, 1, D);
    edgeDarken(c, OUT);
    return c;
  }

  // 立ちポーズ（作業中のaltフレームはぷにっと潰れる）
  if (o.pose === 'work' && o.alt) { h = Math.max(5, h - 1); w = Math.min(20, w + 2); }
  const x0 = (FW - w) >> 1;
  const bottom = FH - 1;
  const y0 = bottom - 1 - h; // 下2pxは足

  // 足
  rect(c, x0 + 1, bottom - 1, 2, 2, D);
  rect(c, x0 + w - 3, bottom - 1, 2, 2, D);
  // 体
  rect(c, x0, y0, w, h, B);
  clearPx(c, x0, y0); clearPx(c, x0 + w - 1, y0);
  clearPx(c, x0, y0 + h - 1); clearPx(c, x0 + w - 1, y0 + h - 1);
  // おなか
  rect(c, x0 + 2, y0 + Math.ceil(h / 2), w - 4, Math.max(1, Math.floor(h / 2) - 1), L);
  // 模様
  if (t.pattern === 1) {
    for (let i = 0; i < 3; i++) px(c, x0 + 2 + ((t.seedDots + i * 3) % (w - 4)), y0 + 2 + (i % 2), D);
  } else if (t.pattern === 2) {
    rect(c, x0 + 2, y0 + 1, w - 4, 1, D);
  }
  // 目
  const ey = y0 + 2 + (o.stage >= 2 ? 1 : 0);
  const exL = x0 + Math.round(w * 0.28);
  const exR = x0 + w - 1 - Math.round(w * 0.28);
  if (o.pose === 'idle' && o.alt) {
    // まばたき
    px(c, exL, ey, D); px(c, exR, ey, D);
  } else {
    px(c, exL, ey, EYE); px(c, exR, ey, EYE);
    if (t.eyeStyle === 1) { px(c, exL, ey + 1, EYE); px(c, exR, ey + 1, EYE); }
  }
  // 口
  px(c, x0 + (w >> 1), ey + 2, D);
  // 耳・角（stage2以上）
  const cx = x0 + (w >> 1);
  if (o.stage >= 2) {
    if (t.ear === 0) {
      px(c, x0 + 2, y0 - 2, B); rect(c, x0 + 1, y0 - 1, 3, 1, B);
      px(c, x0 + w - 3, y0 - 2, B); rect(c, x0 + w - 4, y0 - 1, 3, 1, B);
    } else if (t.ear === 1) {
      px(c, cx, y0 - 3, A); px(c, cx, y0 - 2, A); rect(c, cx - 1, y0 - 1, 3, 1, A);
    } else {
      rect(c, x0 - 1, y0 + 1, 1, 2, D); rect(c, x0 + w, y0 + 1, 1, 2, D);
    }
    // しっぽ
    rect(c, x0 + w, bottom - 3, 2, 2, D);
  }
  // 最終段階の追加装飾
  if (o.stage >= 3) {
    if (t.deco === 0) {
      // 翼
      rect(c, x0 - 3, y0 + 2, 3, 2, A); px(c, x0 - 2, y0 + 4, A);
      rect(c, x0 + w, y0 + 2, 3, 2, A); px(c, x0 + w + 1, y0 + 4, A);
    } else if (t.deco === 1) {
      // 背中のトゲ
      for (let x = x0 + 2; x < x0 + w - 2; x += 3) px(c, x, y0 - 1, A);
    } else {
      // 王冠
      px(c, cx - 2, y0 - 2, A); px(c, cx, y0 - 2, A); px(c, cx + 2, y0 - 2, A);
      rect(c, cx - 2, y0 - 1, 5, 1, A);
    }
  }
  // 作業中の汗
  if (o.pose === 'work') {
    px(c, x0 + w + 1, y0, SWEAT);
    px(c, x0 + w + 1, y0 + 1, SWEAT);
  }
  edgeDarken(c, OUT);
  return c;
}

// ---- 図鑑データの組み立て ----
function buildDex() {
  const entries = [];
  let no = 1;
  for (let f = 0; f < FAMILY_COUNT; f++) {
    const stages = f < THREE_STAGE_FAMILIES ? 3 : 2;
    const suffix = SUFFIXES[f % SUFFIXES.length];
    const names = stages === 3
      ? [STEMS[f] + suffix[0], STEMS[f] + suffix[1], STEMS[f] + suffix[2]]
      : [STEMS[f] + suffix[0], STEMS[f] + suffix[2]];
    for (let s = 1; s <= stages; s++) {
      entries.push({
        no,
        name: names[s - 1],
        stage: s,
        family: f + 1,
        element: ELEMENTS[f % ELEMENTS.length].id,
        evolvesTo: s < stages ? no + 1 : null,
        evolveAt: s < stages ? EVOLVE_AT[s] : null,
      });
      no++;
    }
  }
  return entries;
}

// ---- 出力 ----
const dexDir = path.join(__dirname, '..', 'dex');
fs.mkdirSync(dexDir, { recursive: true });

const entries = buildDex();
if (entries.length !== 151) throw new Error(`151体になっていません: ${entries.length}`);

const pad3 = (n) => String(n).padStart(3, '0');

for (const e of entries) {
  const f = e.family - 1;
  const rng = mulberry32(1000 + f);
  const traits = {
    shape: (rng() * 3) | 0,
    ear: (rng() * 3) | 0,
    deco: (rng() * 3) | 0,
    pattern: (rng() * 3) | 0,
    eyeStyle: (rng() * 2) | 0,
    seedDots: (rng() * 7) | 0,
    pal: ELEMENTS[f % ELEMENTS.length],
  };
  const dir = path.join(dexDir, pad3(e.no));
  fs.mkdirSync(dir, { recursive: true });
  const frames = {
    idle_0: drawMonster(traits, { stage: e.stage, pose: 'idle', alt: false }),
    idle_1: drawMonster(traits, { stage: e.stage, pose: 'idle', alt: true }),
    work_0: drawMonster(traits, { stage: e.stage, pose: 'work', alt: false }),
    work_1: drawMonster(traits, { stage: e.stage, pose: 'work', alt: true }),
    sleep_0: drawMonster(traits, { stage: e.stage, pose: 'sleep', alt: false }),
    sleep_1: drawMonster(traits, { stage: e.stage, pose: 'sleep', alt: true }),
  };
  for (const [name, cv] of Object.entries(frames)) {
    savePng(cv, path.join(dir, name + '.png'));
  }
  const manifest = {
    name: e.name,
    frameWidth: FW,
    frameHeight: FH,
    scale: 3,
    theme: { accent: traits.pal.body },
    animations: {
      idle: { frames: ['idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_1.png'], fps: 2 },
      work: { frames: ['work_0.png', 'work_1.png'], fps: 3 },
      sleep: { frames: ['sleep_0.png', 'sleep_1.png'], fps: 1 },
    },
  };
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(manifest, null, 2));
}

fs.writeFileSync(path.join(dexDir, 'dex.json'), JSON.stringify(entries, null, 2));

// プレビューシート（16列グリッド・idle_0）
{
  const cols = 16;
  const rows = Math.ceil(entries.length / cols);
  const sheet = canvas(cols * (FW + 2), rows * (FH + 2));
  for (let i = 0; i < sheet.data.length; i += 4) {
    sheet.data[i] = 0xdd; sheet.data[i + 1] = 0xdd; sheet.data[i + 2] = 0xdd; sheet.data[i + 3] = 255;
  }
  entries.forEach((e, idx) => {
    const f = e.family - 1;
    const rng = mulberry32(1000 + f);
    const traits = {
      shape: (rng() * 3) | 0, ear: (rng() * 3) | 0, deco: (rng() * 3) | 0,
      pattern: (rng() * 3) | 0, eyeStyle: (rng() * 2) | 0, seedDots: (rng() * 7) | 0,
      pal: ELEMENTS[f % ELEMENTS.length],
    };
    const cv = drawMonster(traits, { stage: e.stage, pose: 'idle', alt: false });
    const ox = (idx % cols) * (FW + 2) + 1;
    const oy = ((idx / cols) | 0) * (FH + 2) + 1;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const ci = (y * cv.w + x) * 4;
      if (cv.data[ci + 3] === 0) continue;
      const si = ((oy + y) * sheet.w + ox + x) * 4;
      sheet.data[si] = cv.data[ci]; sheet.data[si + 1] = cv.data[ci + 1];
      sheet.data[si + 2] = cv.data[ci + 2]; sheet.data[si + 3] = 255;
    }
  });
  savePng(scaleCanvas(sheet, 4), path.join(__dirname, 'preview-dex.png'));
}

console.log(`図鑑生成完了: ${entries.length}体 → ${dexDir}`);
console.log('プレビュー: tools/preview-dex.png');
