// キャラクター設定ウィンドウ: 一覧・切替・削除・AI連携作成ウィザード（トリム調整つき）
const api = window.petApi;

const viewList = document.getElementById('view-list');
const viewCreate = document.getElementById('view-create');
const gridEl = document.getElementById('grid');
const promptEl = document.getElementById('prompt-text');
const pickedNameEl = document.getElementById('picked-name');
const frameCountEl = document.getElementById('frame-count');
const chromaEl = document.getElementById('chroma');
const toleranceEl = document.getElementById('tolerance');
const toleranceValEl = document.getElementById('tolerance-val');
const trimWrapEl = document.getElementById('trim-wrap');
const trimCanvas = document.getElementById('trim-editor');
const previewWrapEl = document.getElementById('preview-wrap');
const previewEl = document.getElementById('preview');
const nameEl = document.getElementById('char-name');
const sizeEl = document.getElementById('target-size');
const accentEl = document.getElementById('accent');
const btnCreate = document.getElementById('btn-create');
const createMsgEl = document.getElementById('create-msg');
const viewDex = document.getElementById('view-dex');
const dexGridEl = document.getElementById('dex-grid');
const dexProgressEl = document.getElementById('dex-progress');
const createTargetEl = document.getElementById('create-target');

let dexTarget = null; // ウィザードで登録する図鑑スロット番号（null=通常のキャラ作成）

const PROMPT = `以下の仕様で、デスクトップペット用のスプライトシート画像を1枚だけ作ってください。

【キャラクター】
添付した画像のキャラクターを、シンプルで可愛い2Dゲーム風（ドット絵風）にデフォルメしてください。

【画像の仕様（厳守）】
- 1枚のPNG画像に、同じ大きさのコマを「横一列に6コマ」並べる（画像全体の縦横比はおよそ 横6:縦1）
- 各コマの内容:
  1. 立ち姿（正面または右向き）
  2. 1と同じ姿勢で目を閉じた「まばたき」
  3. 作業中の姿（パソコンに向かう・道具を持つ など）
  4. 3と少しだけ違う作業ポーズ
  5. 眠っている姿
  6. 5と少しだけ違う寝姿
- 全コマでキャラクターの位置と大きさをそろえる
- 背景は完全な透明（透過PNG）。地面・影・枠・文字は描かない`;

promptEl.value = PROMPT;

let picked = null;   // { path, url }
let sheetImg = null; // 読み込んだ Image
// トリム範囲（元画像ピクセル座標）
let bounds = null;   // { xs: [x0..xN], top, bottom }
const MIN_PX = 8;

// ---------- 一覧 ----------
async function refreshList() {
  const list = await api.listCharactersFull();
  gridEl.innerHTML = '';
  for (const c of list) {
    const card = document.createElement('div');
    card.className = 'card' + (c.isCurrent ? ' current' : '');
    const img = document.createElement('img');
    img.src = c.previewUrl;
    img.alt = c.name;
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = c.name;
    card.appendChild(img);
    card.appendChild(name);
    if (c.isCurrent) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '選択中';
      card.appendChild(badge);
    }
    if (c.isUser) {
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '🗑';
      del.title = 'このキャラクターを削除';
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`「${c.name}」を削除しますか？`)) return;
        await api.deleteCharacter(c.id);
        refreshList();
      };
      card.appendChild(del);
    }
    card.onclick = async () => {
      await api.selectCharacter(c.id);
      refreshList();
    };
    gridEl.appendChild(card);
  }
}
refreshList();

// ---------- ビュー切替 ----------
document.getElementById('btn-new').onclick = () => {
  dexTarget = null;
  createTargetEl.classList.add('hidden');
  viewList.classList.add('hidden');
  viewCreate.classList.remove('hidden');
};
document.getElementById('btn-back').onclick = () => {
  viewCreate.classList.add('hidden');
  if (dexTarget != null) {
    dexTarget = null;
    createTargetEl.classList.add('hidden');
    viewDex.classList.remove('hidden');
    refreshDex();
  } else {
    viewList.classList.remove('hidden');
    refreshList();
  }
};
document.getElementById('btn-dex').onclick = () => {
  viewList.classList.add('hidden');
  viewDex.classList.remove('hidden');
  refreshDex();
};
document.getElementById('btn-dex-back').onclick = () => {
  viewDex.classList.add('hidden');
  viewList.classList.remove('hidden');
  refreshList();
};

// ---------- 図鑑（151の保存枠） ----------
const pad3 = (n) => String(n).padStart(3, '0');

async function refreshDex() {
  const [list, prog] = await Promise.all([api.listDex(), api.getProgress()]);
  let line = `🏅 成果ポイント: ${prog.points} pt`;
  if (prog.currentNo != null && prog.nextEvolveAt != null) {
    line += `（次の進化まで あと ${Math.max(0, prog.nextEvolveAt - prog.points)} pt）`;
  } else if (prog.currentNo != null) {
    line += '（最終形態！）';
  } else {
    line += '（図鑑のモンスターを選ぶと成果で進化します）';
  }
  dexProgressEl.textContent = line;

  dexGridEl.innerHTML = '';
  for (const d of list) {
    const cell = document.createElement('div');
    cell.className = 'dex-cell' + (d.isCurrent ? ' current' : '');
    const no = document.createElement('div');
    no.className = 'no';
    no.textContent = 'No.' + pad3(d.no);
    cell.appendChild(no);
    if (d.previewUrl) {
      const img = document.createElement('img');
      img.src = d.previewUrl;
      img.alt = d.name;
      cell.appendChild(img);
    } else {
      const q = document.createElement('div');
      q.className = 'empty';
      q.textContent = '？';
      cell.appendChild(q);
    }
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = d.name;
    name.title = d.name;
    cell.appendChild(name);
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.textContent = '★'.repeat(d.stage) + (d.evolvesTo ? ` → No.${pad3(d.evolvesTo)}` : '');
    cell.appendChild(stage);
    if (d.isUser) {
      const badge = document.createElement('span');
      badge.className = 'user-badge';
      badge.textContent = '自作';
      badge.title = 'クリックで同梱モンスターに戻す';
      badge.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`No.${pad3(d.no)} の上書きを取り消して元に戻しますか？`)) return;
        await api.deleteDexOverride(d.no);
        refreshDex();
      };
      cell.appendChild(badge);
    }
    const reg = document.createElement('button');
    reg.className = 'reg';
    reg.textContent = '登録';
    reg.title = 'この枠を手持ちの画像で差し替える';
    reg.onclick = (e) => {
      e.stopPropagation();
      openDexCreate(d);
    };
    cell.appendChild(reg);
    cell.onclick = async () => {
      await api.selectDex(d.no);
      refreshDex();
    };
    dexGridEl.appendChild(cell);
  }
}

// スロット上書きモードでウィザードを開く
function openDexCreate(d) {
  dexTarget = d.no;
  createTargetEl.textContent = `📖 図鑑 No.${pad3(d.no)}「${d.name}」の枠に登録します。この枠の見た目が選んだ画像に差し替わります（保存先はこのPCの中だけ）。`;
  createTargetEl.classList.remove('hidden');
  nameEl.value = d.name;
  viewDex.classList.add('hidden');
  viewCreate.classList.remove('hidden');
}

// ---------- プロンプトコピー ----------
document.getElementById('btn-copy').onclick = async () => {
  await navigator.clipboard.writeText(PROMPT);
  const b = document.getElementById('btn-copy');
  b.textContent = '✅ コピーしました！画像と一緒にAIへ';
  setTimeout(() => { b.textContent = '📋 プロンプトをコピー'; }, 2500);
};

// ---------- 画像選択 ----------
document.getElementById('btn-pick').onclick = async () => {
  const res = await api.pickImage();
  if (!res) return;
  picked = res;
  pickedNameEl.textContent = res.path.split(/[\\/]/).pop();
  const img = new Image();
  img.onload = () => {
    sheetImg = img;
    initBounds();
    trimWrapEl.classList.remove('hidden');
    drawEditor();
    renderPreview();
    btnCreate.disabled = false;
  };
  img.src = res.url;
};

frameCountEl.onchange = () => { if (sheetImg) { initBounds(); drawEditor(); renderPreview(); } };
chromaEl.onchange = () => { if (sheetImg) renderPreview(); };
toleranceEl.oninput = () => { toleranceValEl.textContent = toleranceEl.value; };
toleranceEl.onchange = () => { if (sheetImg) renderPreview(); };
document.getElementById('btn-reset-trim').onclick = () => {
  if (sheetImg) { initBounds(); drawEditor(); renderPreview(); }
};

function frameCount() { return parseInt(frameCountEl.value, 10); }

function initBounds() {
  const count = frameCount();
  const w = sheetImg.width;
  const xs = [];
  for (let i = 0; i <= count; i++) xs.push(Math.round((w / count) * i));
  bounds = { xs, top: 0, bottom: sheetImg.height };
}

// ---------- トリムエディタ ----------
function dispScale() {
  return Math.min(460, sheetImg.width) / sheetImg.width;
}

function drawEditor() {
  const s = dispScale();
  const w = Math.round(sheetImg.width * s);
  const h = Math.round(sheetImg.height * s);
  trimCanvas.width = w;
  trimCanvas.height = h;
  const ctx = trimCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(sheetImg, 0, 0, w, h);
  // トリム範囲外を暗く
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  const x0 = bounds.xs[0] * s, xN = bounds.xs[bounds.xs.length - 1] * s;
  const t = bounds.top * s, b = bounds.bottom * s;
  ctx.fillRect(0, 0, w, t);
  ctx.fillRect(0, b, w, h - b);
  ctx.fillRect(0, t, x0, b - t);
  ctx.fillRect(xN, t, w - xN, b - t);
  // 縦線（コマ区切り）
  ctx.strokeStyle = '#e8974e';
  ctx.lineWidth = 2;
  for (const x of bounds.xs) {
    ctx.beginPath();
    ctx.moveTo(x * s, 0);
    ctx.lineTo(x * s, h);
    ctx.stroke();
  }
  // 横線（上下トリム）
  ctx.strokeStyle = '#4f7fca';
  for (const y of [bounds.top, bounds.bottom]) {
    ctx.beginPath();
    ctx.moveTo(0, y * s);
    ctx.lineTo(w, y * s);
    ctx.stroke();
  }
}

// ドラッグ対象の検出
let dragTarget = null; // { type: 'x', i } | { type: 'top' } | { type: 'bottom' }
function hitTest(dx, dy) {
  const s = dispScale();
  const HIT = 8;
  let best = null, bestDist = HIT;
  bounds.xs.forEach((x, i) => {
    const d = Math.abs(dx - x * s);
    if (d < bestDist) { best = { type: 'x', i }; bestDist = d; }
  });
  for (const type of ['top', 'bottom']) {
    const d = Math.abs(dy - bounds[type] * s);
    if (d < bestDist) { best = { type }; bestDist = d; }
  }
  return best;
}

trimCanvas.addEventListener('pointermove', (e) => {
  const r = trimCanvas.getBoundingClientRect();
  const dx = e.clientX - r.left, dy = e.clientY - r.top;
  if (dragTarget) {
    const s = dispScale();
    if (dragTarget.type === 'x') {
      const i = dragTarget.i;
      const min = i === 0 ? 0 : bounds.xs[i - 1] + MIN_PX;
      const max = i === bounds.xs.length - 1 ? sheetImg.width : bounds.xs[i + 1] - MIN_PX;
      bounds.xs[i] = Math.round(Math.max(min, Math.min(max, dx / s)));
    } else if (dragTarget.type === 'top') {
      bounds.top = Math.round(Math.max(0, Math.min(bounds.bottom - MIN_PX, dy / s)));
    } else {
      bounds.bottom = Math.round(Math.max(bounds.top + MIN_PX, Math.min(sheetImg.height, dy / s)));
    }
    drawEditor();
  } else {
    const hit = hitTest(dx, dy);
    trimCanvas.style.cursor = hit ? (hit.type === 'x' ? 'col-resize' : 'row-resize') : 'default';
  }
});
trimCanvas.addEventListener('pointerdown', (e) => {
  const r = trimCanvas.getBoundingClientRect();
  dragTarget = hitTest(e.clientX - r.left, e.clientY - r.top);
  if (dragTarget) trimCanvas.setPointerCapture(e.pointerId);
});
trimCanvas.addEventListener('pointerup', (e) => {
  if (!dragTarget) return;
  dragTarget = null;
  trimCanvas.releasePointerCapture(e.pointerId);
  renderPreview();
});

// ---------- 分割プレビュー（正規化後の見た目） ----------
function renderPreview() {
  if (!sheetImg) return;
  const count = frameCount();
  const { xs, top, bottom } = bounds;
  const fh = bottom - top;
  let fw = 0;
  for (let i = 0; i < count; i++) fw = Math.max(fw, xs[i + 1] - xs[i]);
  if (fw < MIN_PX || fh < MIN_PX) return;

  // シート全体に透過処理をかけてから切り出す（作成時のエンジンと同じ順序・同じ結果）
  const sheet = processedSheet();

  previewEl.innerHTML = '';
  const scale = Math.min(1, 96 / fh);
  for (let i = 0; i < count; i++) {
    const rw = xs[i + 1] - xs[i];
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(fw * scale));
    cv.height = Math.max(1, Math.round(fh * scale));
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = scale < 1;
    // 中央寄せ・下端揃え（charfactory の正規化と同じ配置）
    const dx = Math.round(((fw - rw) / 2) * scale);
    ctx.drawImage(sheet, xs[i], top, rw, fh, dx, 0, Math.round(rw * scale), cv.height);
    previewEl.appendChild(cv);
  }
  previewWrapEl.classList.remove('hidden');
}

// 透過処理済みのシートcanvasを返す（チェックOFFなら元画像のまま）
function processedSheet() {
  const cv = document.createElement('canvas');
  cv.width = sheetImg.width;
  cv.height = sheetImg.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sheetImg, 0, 0);
  if (chromaEl.checked) {
    const d = ctx.getImageData(0, 0, cv.width, cv.height);
    floodKeyFromEdges(d, parseInt(toleranceEl.value, 10));
    ctx.putImageData(d, 0, 0);
  }
  return cv;
}

// charfactory.js の chromaKeyByCorners と同じアルゴリズム:
// 四隅の平均色をキーに、縁から繋がっている類似色だけをBFSで透過
function floodKeyFromEdges(imageData, tolerance) {
  const { width: w, height: h, data } = imageData;
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  const opaque = corners.filter(([x, y]) => data[(y * w + x) * 4 + 3] > 200);
  if (opaque.length === 0) return;
  let r = 0, g = 0, b = 0;
  for (const [x, y] of opaque) {
    const i = (y * w + x) * 4;
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  r /= opaque.length; g /= opaque.length; b /= opaque.length;
  const isBg = (idx) => {
    const i = idx * 4;
    if (data[i + 3] === 0) return false;
    const d = Math.max(Math.abs(data[i] - r), Math.abs(data[i + 1] - g), Math.abs(data[i + 2] - b));
    return d <= tolerance;
  };
  const visited = new Uint8Array(w * h);
  const queue = [];
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
}

// ---------- 作成 ----------
btnCreate.onclick = async () => {
  if (!picked || !bounds) return;
  btnCreate.disabled = true;
  createMsgEl.className = '';
  createMsgEl.textContent = '作成中…';
  const payload = {
    imagePath: picked.path,
    frameCount: frameCount(),
    name: nameEl.value.trim() || 'カスタム',
    accent: accentEl.value,
    targetWidth: parseInt(sizeEl.value, 10),
    chromaKey: chromaEl.checked,
    tolerance: parseInt(toleranceEl.value, 10),
    bounds: { xs: [...bounds.xs], top: bounds.top, bottom: bounds.bottom },
  };
  // 図鑑スロット登録モードならスロット上書き、通常モードなら新規キャラ作成
  const res = dexTarget != null
    ? await api.createDexCharacter({ no: dexTarget, ...payload })
    : await api.createCharacter(payload);
  if (res && res.ok) {
    const wasDex = dexTarget != null;
    createMsgEl.className = 'ok';
    createMsgEl.textContent = wasDex
      ? '✨ 図鑑の枠に登録しました！ペットにも反映されています'
      : '✨ 作成しました！デスクトップのペットが新しいキャラになっています';
    picked = null;
    sheetImg = null;
    pickedNameEl.textContent = '';
    trimWrapEl.classList.add('hidden');
    previewWrapEl.classList.add('hidden');
    nameEl.value = '';
    setTimeout(() => {
      viewCreate.classList.add('hidden');
      createMsgEl.textContent = '';
      if (wasDex) {
        dexTarget = null;
        createTargetEl.classList.add('hidden');
        viewDex.classList.remove('hidden');
        refreshDex();
      } else {
        viewList.classList.remove('hidden');
        refreshList();
      }
    }, 1800);
  } else {
    createMsgEl.className = 'err';
    createMsgEl.textContent = '⚠ 失敗: ' + ((res && res.error) || '不明なエラー');
    btnCreate.disabled = false;
  }
};
