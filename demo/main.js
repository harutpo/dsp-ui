// ペットUIのリファレンス実装（メインプロセス）
// ウィンドウ生成・キャラ管理・図鑑と進化・接続アプリ向けHTTP APIの起動を担う。
// 自アプリへ組み込む際は、このファイルを土台に必要な部分を差し替える。
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createCharacter } = require('../lib/charfactory');
const { loadDex, dexNoFromId, dexIdFromNo, decideEvolution, nextEvolveAt } = require('../lib/dex');
const { createPetServer } = require('../lib/petserver');

const WIN_W = 300;
const WIN_H = 230;

const rootDir = path.join(__dirname, '..');
const charactersDir = path.join(rootDir, 'characters');
const dexRepoDir = path.join(rootDir, 'dex');

let dex = new Map(); // 図鑑データ（no -> { no, name, stage, evolvesTo, evolveAt, ... }）

let win = null;
let tray = null;
let managerWin = null;

// 選択キャラ・ペット位置・累計ポイントは userData/state.json に保存し、再起動後も復帰する
let state = { character: null, position: null, points: 0 };
let working = false; // 接続アプリの作業状態（workアニメの条件。永続化しない）
let petServer = null; // 接続アプリ向けHTTP API（lib/petserver.js）

function statePath() {
  return path.join(app.getPath('userData'), 'state.json');
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (s && typeof s === 'object') state = { character: null, position: null, points: 0, ...s };
    if (!Number.isFinite(state.points) || state.points < 0) state.points = 0;
  } catch {} // 初回起動・破損時は既定値のまま
}

function saveState() {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state));
  } catch (e) {
    console.warn('state.json 保存失敗:', e.message);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) win.show(); });
  app.whenReady().then(main);
}

function main() {
  fs.mkdirSync(userCharactersDir(), { recursive: true });
  fs.mkdirSync(userDexDir(), { recursive: true });
  try {
    dex = loadDex(path.join(dexRepoDir, 'dex.json'));
  } catch (e) {
    console.warn('図鑑データの読み込み失敗（npm run dex で生成できます）:', e.message);
  }
  loadState();
  applyStartupEvolution();
  createWindow();
  createTray();
  setupIpc();
  startPetServer();
  console.log('読み込んだスキン:', listCharacters().join(', ') || 'なし');
  console.log('図鑑スロット:', scanDexSlots().size + ' / ' + dex.size);
}

// 不在中にしきい値を超えていた場合、起動時に静かに進化を反映する
function applyStartupEvolution() {
  const no = dexNoFromId(state.character);
  if (no == null) return;
  const target = decideEvolution(dex, no, state.points);
  if (target != null && scanDexSlots().has(target)) {
    state.character = dexIdFromNo(target);
    saveState();
  }
}

// ---------- キャラクター（スキン） ----------
// スキンは 同梱の characters/ と ユーザーの userData/characters の2箇所からスキャン。
// 同名IDはユーザー側を優先。「_」で始まるフォルダ（_template等）は一覧に出さない。
function userCharactersDir() {
  return path.join(app.getPath('userData'), 'characters');
}

// スキン契約の最低条件: name / サイズ / idleアニメ1フレーム以上（詳細は characters/SKIN-GUIDE.md）
function validateManifest(m) {
  return !!(m && typeof m.name === 'string' &&
    Number.isFinite(m.frameWidth) && m.frameWidth > 0 &&
    Number.isFinite(m.frameHeight) && m.frameHeight > 0 &&
    m.animations && m.animations.idle &&
    Array.isArray(m.animations.idle.frames) && m.animations.idle.frames.length > 0);
}

// id -> スキンフォルダの絶対パス（検証を通ったもののみ）
let _scanCache = { at: 0, map: null };
function scanCharacters() {
  if (_scanCache.map && Date.now() - _scanCache.at < 5000) return _scanCache.map;
  const map = new Map();
  for (const base of [charactersDir, userCharactersDir()]) {
    let entries = [];
    try { entries = fs.readdirSync(base); } catch { continue; }
    for (const id of entries) {
      if (id.startsWith('_')) continue;
      const file = path.join(base, id, 'character.json');
      if (!fs.existsSync(file)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (validateManifest(m)) {
          map.set(id, path.join(base, id));
        } else {
          console.warn('スキンを無視（スキーマ不備）:', file);
        }
      } catch (e) {
        console.warn('スキンを無視（読み込み失敗）:', file, e.message);
      }
    }
  }
  _scanCache = { at: Date.now(), map };
  return map;
}

function listCharacters() {
  return [...scanCharacters().keys()];
}

function characterPayload(id) {
  const no = dexNoFromId(id);
  const dir = no != null ? scanDexSlots().get(no) : scanCharacters().get(id);
  if (!dir) return null;
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf8'));
  // pathToFileURL で Windows/mac 両対応の file:// URL にする
  return { id, baseUrl: require('url').pathToFileURL(dir).href + '/', manifest };
}

function currentCharacterId() {
  const savedDexNo = dexNoFromId(state.character);
  if (savedDexNo != null && scanDexSlots().has(savedDexNo)) return state.character;
  const list = listCharacters();
  return list.includes(state.character) ? state.character : (list[0] || null);
}

// ---------- 図鑑（151の保存枠） ----------
// スロットは 同梱の dex/NNN と ユーザーの userData/dex/NNN の2箇所からスキャン。
// 同番号はユーザー側を優先（＝手元の画像でスロットを上書き登録できる）。
function userDexDir() {
  return path.join(app.getPath('userData'), 'dex');
}

// no -> スロットフォルダの絶対パス（検証を通ったもののみ）
let _dexScanCache = { at: 0, map: null };
function scanDexSlots() {
  if (_dexScanCache.map && Date.now() - _dexScanCache.at < 5000) return _dexScanCache.map;
  const map = new Map();
  for (const base of [dexRepoDir, userDexDir()]) {
    let entries = [];
    try { entries = fs.readdirSync(base); } catch { continue; }
    for (const id of entries) {
      if (!/^\d{3}$/.test(id)) continue;
      const file = path.join(base, id, 'character.json');
      if (!fs.existsSync(file)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (validateManifest(m)) map.set(parseInt(id, 10), path.join(base, id));
        else console.warn('図鑑スロットを無視（スキーマ不備）:', file);
      } catch (e) {
        console.warn('図鑑スロットを無視（読み込み失敗）:', file, e.message);
      }
    }
  }
  _dexScanCache = { at: Date.now(), map };
  return map;
}

// 成果ポイントを加算し、しきい値を超えたら進化させる。
// 接続アプリからの成果報告（HTTP APIと petApi.addProgress）はすべてここを通る。
// 戻り値: { points, evolvedTo: 図鑑番号|null }
function progressInfo() {
  const no = dexNoFromId(state.character);
  return {
    points: state.points,
    currentNo: no,
    nextEvolveAt: no != null ? nextEvolveAt(dex, no) : null,
  };
}

function addProgress(pts) {
  const n = Math.max(0, Math.round(Number(pts) || 0));
  state.points += n;
  let evolvedTo = null;
  const no = dexNoFromId(state.character);
  if (no != null) {
    const target = decideEvolution(dex, no, state.points);
    if (target != null && scanDexSlots().has(target)) {
      const fromName = (dex.get(no) || {}).name || dexIdFromNo(no);
      const toName = (dex.get(target) || {}).name || dexIdFromNo(target);
      applyCharacter(dexIdFromNo(target));
      evolvedTo = target;
      broadcastToApps('evolved', { from: no, to: target, name: toName });
      // 見た目は即座に切り替わる。トーストは +pt トーストの後に出す
      setTimeout(() => {
        sendToPet({ type: 'toast', message: `✨ おめでとう！${fromName}は${toName}に進化した！` });
      }, 1500);
    }
  }
  saveState();
  rebuildTrayMenu();
  const info = progressInfo();
  if (n > 0 && !evolvedTo) sendToPet({ type: 'toast', message: `🏅 +${n}pt（累計 ${state.points}pt）` });
  sendToPet({ type: 'progress', progress: info });
  broadcastToApps('progress', info);
  return { points: state.points, evolvedTo };
}

// 図鑑の全スロット一覧（設定ウィンドウのIPCとHTTP APIの両方で使う）
function dexListPayload() {
  const slots = scanDexSlots();
  const userBase = userDexDir();
  const current = dexNoFromId(state.character);
  return [...dex.values()].map((e) => {
    const dir = slots.get(e.no);
    let previewUrl = null;
    let displayName = e.name;
    let isUser = false;
    if (dir) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf8'));
        previewUrl = require('url').pathToFileURL(dir).href + '/' + m.animations.idle.frames[0];
        displayName = m.name || e.name;
        isUser = dir.startsWith(userBase);
      } catch {}
    }
    return {
      no: e.no,
      name: displayName,
      stage: e.stage,
      evolvesTo: e.evolvesTo,
      evolveAt: e.evolveAt,
      previewUrl,
      isUser,
      isCurrent: e.no === current,
    };
  });
}

// 接続アプリの作業状態 → ペットのworkアニメに反映
function setWorking(v) {
  working = !!v;
  sendToPet({ type: 'working-changed', working });
}

// SSEで接続アプリへイベントを配信（サーバー未起動時は何もしない）
function broadcastToApps(type, data) {
  if (petServer) petServer.broadcast(type, data);
}

// ---------- 接続アプリ向けHTTP API（母体機能） ----------
// 設定は userData/server.json（初回起動時に既定値で作成）。
// token を設定すると X-Pet-Token ヘッダが必須になる。
async function startPetServer() {
  const cfgPath = path.join(app.getPath('userData'), 'server.json');
  let cfg = { port: 34561, token: null };
  try {
    cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
  } catch {
    try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch {}
  }
  try {
    petServer = await createPetServer({
      port: cfg.port,
      token: cfg.token,
      handlers: {
        status: () => {
          const id = currentCharacterId();
          const p = id ? characterPayload(id) : null;
          return {
            app: 'desktop-pet-ui',
            version: app.getVersion(),
            character: p ? { id: p.id, name: p.manifest.name } : null,
            working,
            ...progressInfo(),
          };
        },
        getProgress: () => progressInfo(),
        addProgress: (pts) => addProgress(pts),
        listDex: () => dexListPayload(),
        getSprite: (no) => {
          const dir = scanDexSlots().get(no);
          if (!dir) return null;
          try {
            const m = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf8'));
            return fs.readFileSync(path.join(dir, m.animations.idle.frames[0]));
          } catch { return null; }
        },
        selectDex: (no) => applyCharacter(dexIdFromNo(no)),
        setWorking: (v) => setWorking(v),
      },
    });
    console.log(`接続アプリ用API: http://127.0.0.1:${petServer.port}${cfg.token ? '（token必須）' : ''}`);
  } catch (e) {
    console.warn('APIサーバー起動失敗（ポート使用中？ userData/server.json で変更できます）:', e.message);
  }
}

// ---------- ペットウィンドウ ----------
// 移植時のポイント: transparent / frame:false / alwaysOnTop / skipTaskbar / hasShadow:false
// と contextIsolation + preload の組み合わせが必須。
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const pos = state.position;
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: pos ? pos[0] : workArea.x + workArea.width - WIN_W - 40,
    y: pos ? pos[1] : workArea.y + workArea.height - WIN_H,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(rootDir, 'renderer', 'index.html'));
  // before-quit 時点ではウィンドウが破棄済みのことがあるため、閉じる直前に位置を保存
  win.on('close', () => {
    state.position = win.getPosition();
    saveState();
  });
  win.on('closed', () => { win = null; });
}

function resetPosition() {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setPosition(workArea.x + workArea.width - WIN_W - 40, workArea.y + workArea.height - WIN_H);
  state.position = win.getPosition();
  saveState();
}

// ---------- キャラクター設定ウィンドウ ----------
function openCharacterManager() {
  if (managerWin) { managerWin.show(); managerWin.focus(); return; }
  managerWin = new BrowserWindow({
    width: 520,
    height: 640,
    title: 'キャラクター設定',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(path.join(rootDir, 'assets', 'tray.png')),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  managerWin.loadFile(path.join(rootDir, 'renderer', 'characters.html'));
  managerWin.on('closed', () => { managerWin = null; });
}

function applyCharacter(id) {
  const payload = characterPayload(id);
  if (!payload) return false;
  state.character = id;
  saveState();
  rebuildTrayMenu();
  sendToPet({ type: 'character-changed', character: payload });
  broadcastToApps('character-changed', { id, name: payload.manifest.name, no: dexNoFromId(id) });
  return true;
}

function sendToPet(data) {
  if (win) win.webContents.send('pet-event', data);
}

// ---------- トレイ ----------
function createTray() {
  const icon = nativeImage.createFromPath(path.join(rootDir, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('デスクトップペットUIデモ');
  tray.on('click', () => sendToPet({ type: 'open-panel' }));
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: `🏅 累計 ${state.points} pt`, enabled: false },
    { type: 'separator' },
    {
      label: 'キャラクター',
      submenu: listCharacters().map((id) => {
        const p = characterPayload(id);
        return {
          label: (p && p.manifest.name) || id,
          type: 'radio',
          checked: id === currentCharacterId(),
          click: () => applyCharacter(id),
        };
      }),
    },
    { label: 'キャラクター設定・図鑑…', click: () => openCharacterManager() },
    { label: 'ペットの位置をリセット', click: () => resetPosition() },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---------- IPC ----------
// チャンネル仕様の全体は README.md「petApi インターフェース仕様」を参照。
function setupIpc() {
  ipcMain.handle('get-init', () => ({
    character: currentCharacterId() ? characterPayload(currentCharacterId()) : null,
    working,
    progress: progressInfo(),
  }));

  // パネルUIからのキャラ循環切り替え
  ipcMain.handle('cycle-character', () => {
    const list = listCharacters();
    if (list.length === 0) return null;
    const next = list[(list.indexOf(currentCharacterId()) + 1) % list.length];
    state.character = next;
    saveState();
    rebuildTrayMenu();
    return characterPayload(next);
  });

  // ドラッグ・散歩によるウィンドウ移動（画面内にゆるくクランプ）
  ipcMain.on('move-by', (_e, { dx, dy }) => {
    if (!win) return;
    const [x, y] = win.getPosition();
    const disp = screen.getDisplayNearestPoint({ x: x + WIN_W / 2, y: y + WIN_H / 2 });
    const wa = disp.workArea;
    const nx = Math.min(Math.max(x + Math.round(dx), wa.x - WIN_W + 100), wa.x + wa.width - 100);
    const ny = Math.min(Math.max(y + Math.round(dy), wa.y - 40), wa.y + wa.height - 80);
    win.setPosition(nx, ny);
  });

  ipcMain.on('drag-end', () => {
    if (!win) return;
    state.position = win.getPosition();
    saveState();
  });

  // クリック透過: 透明な余白は下のアプリへイベントを通す
  ipcMain.on('set-ignore', (_e, ignore) => {
    if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
  });

  // ---------- キャラクター設定ウィンドウ用 ----------
  ipcMain.on('open-character-manager', () => openCharacterManager());

  ipcMain.handle('list-characters-full', () => {
    const current = currentCharacterId();
    const userBase = userCharactersDir();
    const dirs = scanCharacters();
    return listCharacters().map((id) => {
      const p = characterPayload(id);
      if (!p) return null;
      return {
        id,
        name: p.manifest.name || id,
        previewUrl: p.baseUrl + p.manifest.animations.idle.frames[0],
        isCurrent: id === current,
        isUser: dirs.get(id).startsWith(userBase),
      };
    }).filter(Boolean);
  });

  ipcMain.handle('select-character', (_e, id) => applyCharacter(id));

  ipcMain.handle('pick-image', async () => {
    const res = await dialog.showOpenDialog(managerWin, {
      title: 'スプライトシートPNGを選ぶ',
      filters: [{ name: 'PNG画像', extensions: ['png'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return { path: res.filePaths[0], url: require('url').pathToFileURL(res.filePaths[0]).href };
  });

  ipcMain.handle('create-character', (_e, opts) => {
    try {
      const { id } = createCharacter({
        imagePath: opts.imagePath,
        frameCount: opts.frameCount,
        name: opts.name,
        accent: opts.accent,
        targetWidth: opts.targetWidth,
        chromaKey: opts.chromaKey,
        tolerance: opts.tolerance,
        bounds: opts.bounds,
        outBaseDir: userCharactersDir(),
      });
      applyCharacter(id);
      return { ok: true, id };
    } catch (e) {
      console.error('キャラ作成失敗:', e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('delete-character', (_e, id) => {
    const dir = scanCharacters().get(id);
    if (!dir || !dir.startsWith(userCharactersDir())) {
      return { ok: false, error: '同梱キャラクターは削除できません' };
    }
    fs.rmSync(dir, { recursive: true, force: true });
    if (state.character === id) {
      state.character = null;
      saveState();
      const fallback = currentCharacterId();
      if (fallback) applyCharacter(fallback);
    }
    rebuildTrayMenu();
    return { ok: true };
  });

  // ---------- 図鑑（151の保存枠） ----------
  ipcMain.handle('list-dex', () => dexListPayload());

  ipcMain.handle('select-dex', (_e, no) => applyCharacter(dexIdFromNo(no)));

  // ウィザードの画像でスロットを上書き登録（保存先はローカルの userData/dex/NNN）
  ipcMain.handle('create-dex-character', (_e, opts) => {
    const no = parseInt(opts.no, 10);
    if (!dex.has(no)) return { ok: false, error: `図鑑番号が不正です: ${opts.no}` };
    try {
      createCharacter({
        imagePath: opts.imagePath,
        frameCount: opts.frameCount,
        name: opts.name || (dex.get(no) || {}).name,
        accent: opts.accent,
        targetWidth: opts.targetWidth,
        chromaKey: opts.chromaKey,
        tolerance: opts.tolerance,
        bounds: opts.bounds,
        outBaseDir: userDexDir(),
        id: String(no).padStart(3, '0'),
      });
      _dexScanCache = { at: 0, map: null };
      applyCharacter(dexIdFromNo(no));
      return { ok: true, no };
    } catch (e) {
      console.error('スロット登録失敗:', e.message);
      return { ok: false, error: e.message };
    }
  });

  // スロットの上書きを取り消して同梱モンスターに戻す
  ipcMain.handle('delete-dex-override', (_e, no) => {
    const dir = path.join(userDexDir(), String(parseInt(no, 10)).padStart(3, '0'));
    if (!fs.existsSync(dir)) return { ok: false, error: 'この枠は上書きされていません' };
    fs.rmSync(dir, { recursive: true, force: true });
    _dexScanCache = { at: 0, map: null };
    if (dexNoFromId(state.character) === parseInt(no, 10)) {
      applyCharacter(dexIdFromNo(parseInt(no, 10))); // 同梱側で再適用
    }
    return { ok: true };
  });

  // 接続先アプリからの成果報告口。任意のポイントを加算し、進化判定まで行う
  ipcMain.handle('add-progress', (_e, pts) => addProgress(pts));

  ipcMain.handle('get-progress', () => {
    const no = dexNoFromId(state.character);
    return {
      points: state.points,
      currentNo: no,
      nextEvolveAt: no != null ? nextEvolveAt(dex, no) : null,
    };
  });
}

app.on('before-quit', () => {
  if (win) state.position = win.getPosition();
  saveState();
});
app.on('window-all-closed', () => app.quit());
