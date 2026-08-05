// スプライトシートPNGからキャラクター（スキン）を生成する
// 依存は pngjs のみ（electron 不要・単体テスト可能）
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// コマ数ごとのフレーム構成（スキン機構のフォールバックに合わせる）
// 6: 待機2 + 作業2 + 睡眠2 / 4: 待機2 + 作業2 / 1: 静止画
const FRAME_LAYOUTS = {
  1: ['idle_0'],
  4: ['idle_0', 'idle_1', 'work_0', 'work_1'],
  6: ['idle_0', 'idle_1', 'work_0', 'work_1', 'sleep_0', 'sleep_1'],
};

function sliceGeometry(width, height, frameCount) {
  if (!FRAME_LAYOUTS[frameCount]) throw new Error(`コマ数は 1 / 4 / 6 のいずれかにしてください（指定: ${frameCount}）`);
  const frameWidth = Math.floor(width / frameCount);
  if (frameWidth < 8 || height < 8) throw new Error('画像が小さすぎます（1コマ8px以上必要）');
  return { frameWidth, frameHeight: height };
}

// 四隅の不透明ピクセルの平均色を背景色とみなし、
// 「画像の縁から繋がっている背景色の領域だけ」をフラッドフィルで透過させる。
// キャラ内部の類似色（白い服・白目など）は縁と繋がっていないため残る。
// 全隅がすでに透明なら何もしない。処理したら true を返す。
function chromaKeyByCorners(png, tolerance = 30) {
  const { width: w, height: h, data } = png;
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  const opaque = corners.filter(([x, y]) => data[(y * w + x) * 4 + 3] > 200);
  if (opaque.length === 0) return false; // すでに透過済み
  let r = 0, g = 0, b = 0;
  for (const [x, y] of opaque) {
    const i = (y * w + x) * 4;
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  r /= opaque.length; g /= opaque.length; b /= opaque.length;

  const isBg = (idx) => {
    const i = idx * 4;
    if (data[i + 3] === 0) return false; // すでに透明
    const d = Math.max(Math.abs(data[i] - r), Math.abs(data[i + 1] - g), Math.abs(data[i + 2] - b));
    return d <= tolerance;
  };

  const visited = new Uint8Array(w * h);
  const queue = [];
  // 外周の背景色ピクセルを起点にする
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const idx = y * w + x;
      if (!visited[idx] && isBg(idx)) { visited[idx] = 1; queue.push(idx); }
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      const idx = y * w + x;
      if (!visited[idx] && isBg(idx)) { visited[idx] = 1; queue.push(idx); }
    }
  }
  // BFS（4近傍）
  while (queue.length > 0) {
    const idx = queue.pop();
    data[idx * 4 + 3] = 0;
    const x = idx % w, y = (idx / w) | 0;
    const neighbors = [];
    if (x > 0) neighbors.push(idx - 1);
    if (x < w - 1) neighbors.push(idx + 1);
    if (y > 0) neighbors.push(idx - w);
    if (y < h - 1) neighbors.push(idx + w);
    for (const nIdx of neighbors) {
      if (!visited[nIdx] && isBg(nIdx)) { visited[nIdx] = 1; queue.push(nIdx); }
    }
  }
  return true;
}

// 指定矩形 [x0..x1) × [top..bottom) を切り出し、
// frameWidth × frameHeight の透明キャンバスに中央寄せ・下端揃えで配置する
function sliceRegionNormalized(png, x0, x1, top, bottom, frameWidth, frameHeight) {
  const out = new PNG({ width: frameWidth, height: frameHeight });
  const rw = x1 - x0;
  const rh = bottom - top;
  const offX = Math.floor((frameWidth - rw) / 2);
  const offY = frameHeight - rh; // 下端揃え
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const si = ((top + y) * png.width + x0 + x) * 4;
      const di = ((offY + y) * frameWidth + offX + x) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

// bounds（トリム調整）を検証・補完して確定させる。
// bounds = { xs: [x0..xN] 昇順の縦区切り(コマ数+1個), top, bottom }。未指定なら等分割
function resolveBounds(width, height, frameCount, bounds) {
  const clampX = (v) => Math.max(0, Math.min(width, Math.round(v)));
  const clampY = (v) => Math.max(0, Math.min(height, Math.round(v)));
  if (bounds && Array.isArray(bounds.xs) && bounds.xs.length === frameCount + 1) {
    const xs = bounds.xs.map(clampX);
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] < 8) throw new Error('コマの幅が狭すぎます（8px以上にしてください）');
    }
    const top = clampY(bounds.top ?? 0);
    const bottom = clampY(bounds.bottom ?? height);
    if (bottom - top < 8) throw new Error('コマの高さが狭すぎます（8px以上にしてください）');
    return { xs, top, bottom };
  }
  // 等分割
  const fw = Math.floor(width / frameCount);
  const xs = [];
  for (let i = 0; i <= frameCount; i++) xs.push(i === frameCount ? fw * frameCount : i * fw);
  return { xs, top: 0, bottom: height };
}

function buildManifest({ name, frameWidth, frameHeight, scale, accent, frameCount }) {
  const animations = {
    idle: frameCount >= 4
      ? { frames: ['idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_0.png', 'idle_1.png'], fps: 2 }
      : { frames: ['idle_0.png'], fps: 1 },
  };
  if (frameCount >= 4) animations.work = { frames: ['work_0.png', 'work_1.png'], fps: 3 };
  if (frameCount >= 6) animations.sleep = { frames: ['sleep_0.png', 'sleep_1.png'], fps: 1 };
  const manifest = { name, frameWidth, frameHeight, scale, animations };
  if (accent) manifest.theme = { accent };
  return manifest;
}

// 名前から安全なフォルダIDを作る（日本語名でも衝突しないようタイムスタンプ付与）
function makeId(name) {
  const ascii = String(name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  return `${ascii || 'custom'}-${Date.now().toString(36)}`;
}

// メイン処理: シートPNG → キャラフォルダ生成。生成先フォルダのパスとIDを返す
// bounds（任意）: ユーザーのトリム調整。コマ幅が不揃いでも最大幅に正規化する
// id（任意）: フォルダ名を固定したい場合に指定（図鑑スロット上書き等）。省略時は名前から自動生成
function createCharacter({ imagePath, frameCount, name, accent, targetWidth, chromaKey, tolerance, outBaseDir, bounds, id }) {
  if (!FRAME_LAYOUTS[frameCount]) throw new Error(`コマ数は 1 / 4 / 6 のいずれかにしてください（指定: ${frameCount}）`);
  const png = PNG.sync.read(fs.readFileSync(imagePath));
  const { xs, top, bottom } = resolveBounds(png.width, png.height, frameCount, bounds);
  if (chromaKey) chromaKeyByCorners(png, tolerance || 30);

  // 正規化後のフレームサイズ = 最大コマ幅 × トリム後の高さ
  let frameWidth = 0;
  for (let i = 0; i < frameCount; i++) frameWidth = Math.max(frameWidth, xs[i + 1] - xs[i]);
  const frameHeight = bottom - top;
  if (frameWidth < 8 || frameHeight < 8) throw new Error('画像が小さすぎます（1コマ8px以上必要）');

  id = id || makeId(name);
  const dir = path.join(outBaseDir, id);
  fs.mkdirSync(dir, { recursive: true });

  const layout = FRAME_LAYOUTS[frameCount];
  layout.forEach((frameName, i) => {
    const frame = sliceRegionNormalized(png, xs[i], xs[i + 1], top, bottom, frameWidth, frameHeight);
    fs.writeFileSync(path.join(dir, frameName + '.png'), PNG.sync.write(frame));
  });

  const scale = Math.round((targetWidth / frameWidth) * 1000) / 1000;
  const manifest = buildManifest({
    name: String(name).slice(0, 30) || 'カスタム',
    frameWidth, frameHeight, scale, accent, frameCount,
  });
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(manifest, null, 2));
  return { id, dir };
}

module.exports = { createCharacter, sliceGeometry, chromaKeyByCorners, buildManifest, resolveBounds, FRAME_LAYOUTS };
