// ペットの表示・アニメーション・操作
const api = window.petApi;

const petEl = document.getElementById('pet');
const tooltipEl = document.getElementById('tooltip');
const panelEl = document.getElementById('panel');
const panelCharEl = document.getElementById('panel-char');
const panelPointsEl = document.getElementById('panel-points');
const panelBarEl = document.getElementById('panel-bar');
const panelNextEl = document.getElementById('panel-next');
const charLineEl = document.getElementById('char-line');
const toastEl = document.getElementById('toast');
const zzzEl = document.getElementById('zzz');

let character = null;      // { id, baseUrl, manifest }
let anim = null;           // 現在のアニメ名
let frameIdx = 0;
let animTimer = null;
let working = false;       // 接続アプリの作業状態（workアニメの条件）
let progress = { points: 0, currentNo: null, nextEvolveAt: null };
let lastInteraction = Date.now();
let hovering = false;
let walking = 0;           // 0=停止, -1=左, 1=右
let walkTimer = null;
let nextWalkAt = Date.now() + randInt(15000, 40000);
let toastTimer = null;

const SLEEP_AFTER_MS = 10 * 60 * 1000; // 10分操作なしで居眠り

// ---------- 初期化 ----------
(async function init() {
  const init = await api.getInit();
  working = !!init.working;
  if (init.progress) progress = init.progress;
  if (init.character) setCharacter(init.character);
  setInterval(tick, 1000);
  // 何もない透明部分のクリックは下のアプリへ通す
  api.setMouseIgnore(true);
})();

api.onEvent((data) => {
  switch (data.type) {
    case 'open-panel':
      openPanel();
      break;
    case 'working-changed':
      working = !!data.working;
      chooseAnim();
      break;
    case 'character-changed':
      setCharacter(data.character);
      refreshProgress();
      break;
    case 'progress':
      if (data.progress) progress = data.progress;
      if (!panelEl.classList.contains('hidden')) updatePanel();
      if (hovering) updateTooltip();
      break;
    case 'toast':
      showToast(data.message);
      break;
  }
});

async function refreshProgress() {
  progress = await api.getProgress();
  if (!panelEl.classList.contains('hidden')) updatePanel();
}

// ---------- キャラクター ----------
function setCharacter(ch) {
  stopWalk();
  petEl.classList.remove('flip');
  character = ch;
  const m = ch.manifest;
  const scale = m.scale || 4;
  petEl.style.width = (m.frameWidth * scale) + 'px';
  // 拡大表示ならドット絵をくっきり、縮小表示（AI生成画像等）なら滑らかに
  petEl.style.imageRendering = scale >= 1 ? 'pixelated' : 'auto';
  // スキンのテーマ色（任意）。未指定なら既定のオレンジ
  const accent = (m.theme && m.theme.accent) || '#e8974e';
  document.documentElement.style.setProperty('--accent', accent);
  // ペットの大きさに合わせて吹き出し・💤の位置を調整
  const petH = m.frameHeight * scale;
  const petW = m.frameWidth * scale;
  document.documentElement.style.setProperty('--popup-bottom', (4 + petH + 8) + 'px');
  document.documentElement.style.setProperty('--zzz-left', `calc(50% + ${Math.round(petW * 0.3)}px)`);
  // 全フレームを先読み
  for (const a of Object.values(m.animations)) {
    for (const f of a.frames) { new Image().src = ch.baseUrl + f; }
  }
  anim = null;
  chooseAnim(true);
}

function setAnim(name) {
  if (!character || anim === name) return;
  const a = character.manifest.animations[name] || character.manifest.animations.idle;
  anim = name;
  frameIdx = 0;
  clearInterval(animTimer);
  petEl.src = character.baseUrl + a.frames[0];
  animTimer = setInterval(() => {
    frameIdx = (frameIdx + 1) % a.frames.length;
    petEl.src = character.baseUrl + a.frames[frameIdx];
  }, Math.round(1000 / (a.fps || 4)));
  zzzEl.classList.toggle('hidden', name !== 'sleep');
}

// 状態からアニメを決める
function chooseAnim(force) {
  if (!character) return;
  if (force) anim = null;
  if (working) return setAnim('work');
  if (walking !== 0) return setAnim('walk');
  if (Date.now() - lastInteraction > SLEEP_AFTER_MS) return setAnim('sleep');
  setAnim('idle');
}

// ---------- 毎秒の更新 ----------
function tick() {
  chooseAnim();
  // ときどき散歩（待機中のみ・walkアニメを持つキャラのみ）
  if (character && character.manifest.animations.walk &&
      !working && walking === 0 && !hovering && !dragging &&
      panelEl.classList.contains('hidden') &&
      Date.now() - lastInteraction < SLEEP_AFTER_MS &&
      Date.now() > nextWalkAt) {
    startWalk();
  }
  if (hovering) updateTooltip();
}

// ---------- 散歩 ----------
function startWalk() {
  walking = Math.random() < 0.5 ? -1 : 1;
  petEl.classList.toggle('flip', walking < 0);
  chooseAnim();
  const duration = randInt(1500, 3500);
  walkTimer = setInterval(() => api.moveBy(walking * 2, 0), 50);
  setTimeout(stopWalk, duration);
}
function stopWalk() {
  if (walking === 0) return;
  clearInterval(walkTimer);
  walking = 0;
  nextWalkAt = Date.now() + randInt(15000, 45000);
  chooseAnim();
}

// ---------- ホバー: ツールチップ ----------
petEl.addEventListener('pointerenter', () => {
  hovering = true;
  wake();
  if (panelEl.classList.contains('hidden')) {
    updateTooltip();
    tooltipEl.classList.remove('hidden');
  }
});
petEl.addEventListener('pointerleave', () => {
  hovering = false;
  tooltipEl.classList.add('hidden');
});

function updateTooltip() {
  const name = character ? character.manifest.name : '';
  tooltipEl.textContent = `${name}  🏅 ${progress.points}pt`;
}

// ---------- クリック / ドラッグ ----------
let dragging = false;
let dragMoved = false;
let lastScreenX = 0;
let lastScreenY = 0;

petEl.addEventListener('pointerdown', (e) => {
  wake();
  stopWalk();
  dragging = true;
  dragMoved = false;
  lastScreenX = e.screenX;
  lastScreenY = e.screenY;
  petEl.setPointerCapture(e.pointerId);
});
petEl.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastScreenX;
  const dy = e.screenY - lastScreenY;
  if (Math.abs(dx) + Math.abs(dy) === 0) return;
  dragMoved = dragMoved || Math.abs(dx) + Math.abs(dy) > 2;
  if (dragMoved) {
    api.moveBy(dx, dy);
    lastScreenX = e.screenX;
    lastScreenY = e.screenY;
  }
});
petEl.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  petEl.releasePointerCapture(e.pointerId);
  if (dragMoved) {
    api.dragEnd();
  } else {
    togglePanel();
  }
});

// ---------- 進捗パネル ----------
function togglePanel() {
  if (panelEl.classList.contains('hidden')) openPanel();
  else closePanel();
}
function openPanel() {
  tooltipEl.classList.add('hidden');
  panelEl.classList.remove('hidden');
  updatePanel();
  refreshProgress(); // 最新値で描き直す
}
function closePanel() {
  panelEl.classList.add('hidden');
}

function updatePanel() {
  panelCharEl.textContent = `🐾 ${character ? character.manifest.name : '-'}`;
  panelPointsEl.textContent = `🏅 ${progress.points} pt`;
  if (progress.currentNo == null) {
    panelBarEl.style.width = '0%';
    panelNextEl.textContent = '図鑑のモンスターを選ぶと成果で進化します';
  } else if (progress.nextEvolveAt == null) {
    panelBarEl.style.width = '100%';
    panelNextEl.textContent = '最終形態！';
  } else {
    const pct = Math.min(100, (progress.points / progress.nextEvolveAt) * 100);
    panelBarEl.style.width = pct + '%';
    panelNextEl.textContent = `次の進化まで あと ${Math.max(0, progress.nextEvolveAt - progress.points)} pt`;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
});

// ---------- キャラ切り替え ----------
charLineEl.textContent = '🎨 キャラ変更・図鑑を開く';
charLineEl.addEventListener('click', () => {
  api.openCharacterManager();
  closePanel();
});

// ---------- トースト ----------
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3500);
}

// ---------- クリック透過の制御 ----------
// ペットやUIの上ではクリックを受け、透明な余白は下のアプリへ通す
document.addEventListener('mousemove', (e) => {
  if (dragging) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const interactive = el && (el.closest('#pet') || el.closest('#panel') || el.closest('#toast'));
  api.setMouseIgnore(!interactive);
});

function wake() { lastInteraction = Date.now(); }
function randInt(min, max) { return Math.floor(min + Math.random() * (max - min)); }
