// コーギーの顔ドット絵から assets/app.ico（PNG埋め込みICO）を生成する
// 使い方: node tools/generate-icon.js
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const PAL = {
  O: [0xe8, 0x97, 0x4e],
  W: [0xff, 0xf6, 0xe9],
  K: [0x35, 0x24, 0x1a],
  P: [0xf2, 0xa0, 0xa0],
};

function canvas(w, h) { return { w, h, data: new Uint8Array(w * h * 4) }; }
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
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (!isOpaque(c, x, y)) continue;
    const edge = !isOpaque(c, x - 1, y) || !isOpaque(c, x + 1, y) ||
                 !isOpaque(c, x, y - 1) || !isOpaque(c, x, y + 1);
    if (!edge) continue;
    const i = (y * c.w + x) * 4;
    for (let ch = 0; ch < 3; ch++) {
      out[i + ch] = Math.round(c.data[i + ch] * (1 - amount) + K[ch] * amount);
    }
  }
  c.data = out;
}
function scaleCanvas(c, f) {
  const s = canvas(c.w * f, c.h * f);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const si = (y * s.w + x) * 4;
    const ci = ((y / f | 0) * c.w + (x / f | 0)) * 4;
    s.data[si] = c.data[ci]; s.data[si + 1] = c.data[ci + 1];
    s.data[si + 2] = c.data[ci + 2]; s.data[si + 3] = c.data[ci + 3];
  }
  return s;
}
function toPngBuffer(c) {
  const png = new PNG({ width: c.w, height: c.h });
  Buffer.from(c.data).copy(png.data);
  return PNG.sync.write(png);
}

// generate-corgi.js の drawFace と同じ正面顔
function drawFace() {
  const c = canvas(16, 16);
  px(c, 3, 0, 'O'); rect(c, 2, 1, 3, 2, 'O'); px(c, 3, 2, 'P');
  px(c, 12, 0, 'O'); rect(c, 11, 1, 3, 2, 'O'); px(c, 12, 2, 'P');
  rect(c, 2, 3, 12, 10, 'O');
  clearPx(c, 2, 3); clearPx(c, 13, 3); clearPx(c, 2, 12); clearPx(c, 13, 12);
  rect(c, 7, 3, 2, 4, 'W');
  px(c, 5, 7, 'K'); px(c, 10, 7, 'K');
  rect(c, 5, 8, 6, 5, 'W');
  rect(c, 7, 8, 2, 2, 'K');
  edgeDarken(c);
  return c;
}

// ICO 形式（PNG埋め込み）で書き出し
function writeIco(pngs, file) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2);  // palette
    e.writeUInt8(0, 3);  // reserved
    e.writeUInt16LE(1, 4);  // planes
    e.writeUInt16LE(32, 6); // bit count
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  fs.writeFileSync(file, Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]));
}

const face = drawFace();
const sizes = [16, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => ({ size, buf: toPngBuffer(scaleCanvas(face, size / 16)) }));
const outFile = path.join(__dirname, '..', 'assets', 'app.ico');
writeIco(pngs, outFile);

// mac 用 512px アイコン（electron-builder が icns に変換する）
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon-512.png'), toPngBuffer(scaleCanvas(face, 32)));

// 目視確認用プレビュー（128px）
fs.writeFileSync(path.join(__dirname, 'preview-icon.png'), toPngBuffer(scaleCanvas(face, 8)));

console.log('アイコン生成完了: ' + outFile);
