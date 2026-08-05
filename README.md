# desktop-pet-ui

**接続したアプリの成果で育つデスクトップペットUIの母体**です。
透過・最前面・フレームレスのペットウィンドウ、スプライトアニメーション、151枠の図鑑と進化、キャラクター作成ウィザードを備え、外部アプリとは **ローカルHTTP API** で進捗を共有します。

接続アプリ（言語・フレームワーク不問）は、成果が出たときに `POST /api/progress` を送るだけでペットが育ち、しきい値に達すると進化します。ペット側の状態（図鑑・進捗・スプライト画像）も HTTP で取得できるので、接続アプリ側のUIにモンスターや進捗を表示することもできます。

Electronアプリに直接組み込みたい場合は、`renderer/`（UI）と `window.petApi` インターフェース（IPC契約）を移植する方法も引き続き使えます。

## まず動かす

```bash
npm install
npm start
```

画面右下にコーギーが表示されます。ドラッグで移動、クリックで進捗パネル（累計ポイント・次の進化までのバー）、放置で居眠り、ときどき散歩します。起動と同時に接続アプリ用のHTTP APIが `http://127.0.0.1:34561` で立ち上がります（ログにURLが出ます）。

選択したキャラクター・ペットの位置・累計ポイントは `userData/state.json`（Windowsでは `%APPDATA%\desktop-pet-ui\state.json`）に保存され、再起動後も復帰します。ウィザードで作成したキャラクターも `userData` に保存されるため再起動後も残ります。

キャラクター設定ウィンドウの「📖 図鑑（151の保存枠）」からオリジナルモンスター151体を選べます。接続アプリから届く成果ポイントが一定に達すると、選択中のモンスターが自動で進化します（詳細は「図鑑と進化」の節）。動作を今すぐ試すには:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:34561/api/progress -ContentType 'application/json' -Body '{"points":30}'
```

## 構成

```
renderer/            UI本体（移植対象のコア。ロジックへの依存ゼロ）
├── index.html       ペットウィンドウのDOM（#pet, #tooltip, #panel, #toast, #shift-bubble, #zzz）
├── pet.js           表示・アニメーション・ドラッグ・散歩・クリック透過・パネル
├── style.css        ペットUIのスタイル（--accent 等のCSS変数でテーマ色を変更）
├── characters.html  キャラクター設定ウィンドウのDOM
├── characters.js    キャラ一覧・切替・削除・AI画像からのキャラ作成ウィザード
└── characters.css   設定ウィンドウのスタイル
demo/                動作するリファレンス実装（メインプロセス側 = 母体）
├── main.js          ウィンドウ生成 + IPCハンドラ + HTTP API起動（状態は state.json に永続化）
└── preload.js       contextBridge で window.petApi を公開（そのまま流用可能）
lib/petserver.js     接続アプリ向けローカルHTTP APIサーバー（Node標準httpのみ）
lib/charfactory.js   スプライトシートPNG → キャラ生成（依存は pngjs のみ）
lib/dex.js           図鑑データ読み込みと進化判定の純関数（npm test でテスト）
characters/          同梱キャラ（corgi / boy / _template）と SKIN-GUIDE.md
dex/                 図鑑: 151の保存枠（001〜151 の生成モンスター + dex.json）
assets/              トレイ・アプリアイコン
tools/               同梱スプライトのジェネレータ（npm run sprites / npm run dex）
```

依存の向きは一方通行です:

```
renderer(UI) ──window.petApi──▶ preload.js ──IPC──▶ メインプロセス ──▶ あなたのアプリのロジック
```

rendererはNodeモジュールを一切requireしません（`contextIsolation: true` 前提）。

## 移植手順（Electronアプリへ）

1. `renderer/` をそのままコピーする
2. `demo/preload.js` をコピーする（変更不要）
3. ペットウィンドウを作る。必須オプション:

   ```js
   new BrowserWindow({
     width: 300, height: 230,
     transparent: true,      // 背景透過
     frame: false,           // フレームレス
     resizable: false,
     alwaysOnTop: true,      // 最前面（さらに win.setAlwaysOnTop(true, 'screen-saver')）
     skipTaskbar: true,      // タスクバーに出さない
     hasShadow: false,       // 透過ウィンドウの影を消す
     webPreferences: { preload: <preload.jsのパス>, contextIsolation: true },
   });
   win.loadFile('renderer/index.html');
   ```

4. 下記「petApi インターフェース仕様」のIPCハンドラを実装する。全チャンネルの動くリファレンスが `demo/main.js` です。使わない機能はデモと同じようにスタブでOK
5. キャラクター設定ウィンドウ（任意）: 520×640で `renderer/characters.html` をロード。キャラ作成ウィザードを使うなら `lib/charfactory.js`（要 `pngjs`）も一緒にコピー
6. `characters/` をアプリに同梱し、起動時にスキャンする（`demo/main.js` の `scanCharacters()` を参照）

Electron以外のフレームワーク（Tauri等）へ移植する場合は、`window.petApi` と同じ形のオブジェクトをグローバルに生やし、各メソッドを自分のIPC機構につなげば renderer はそのまま動きます。

## petApi インターフェース仕様

`demo/preload.js` が公開する契約です。UI（renderer）はこれ以外の手段でメインプロセスと通信しません。

### renderer → メイン（invoke: 応答あり）

| メソッド | 引数 | 戻り値 | 用途 |
|---|---|---|---|
| `getInit()` | — | `{ character, working, progress }` | 起動時の初期状態。`character` は下記ペイロード、`working` は作業アニメ状態、`progress` は `{ points, currentNo, nextEvolveAt }` |
| `cycleCharacter()` | — | キャラペイロード または `null` | 次のキャラへ循環切替 |
| `listCharactersFull()` | — | `[{ id, name, previewUrl, isCurrent, isUser }]` | 設定ウィンドウ用のキャラ一覧。`isUser` はユーザー作成キャラ（削除可）か |
| `selectCharacter(id)` | キャラID | `boolean` | キャラを選択して反映 |
| `pickImage()` | — | `{ path, url }` または `null` | ファイルダイアログでPNGを選ぶ |
| `createCharacter(opts)` | `{ imagePath, frameCount, name, accent, targetWidth, chromaKey, tolerance, bounds }` | `{ ok, id? , error? }` | スプライトシートからキャラを生成（`lib/charfactory.js`） |
| `deleteCharacter(id)` | キャラID | `{ ok, error? }` | ユーザー作成キャラを削除 |
| `listDex()` | — | `[{ no, name, stage, evolvesTo, evolveAt, previewUrl, isUser, isCurrent }]` ×151 | 図鑑の全スロット一覧 |
| `selectDex(no)` | 図鑑番号 | `boolean` | スロットのモンスターをペットに反映 |
| `createDexCharacter(payload)` | `{ no, imagePath, frameCount, name, ... }`（createCharacterと同じ+no） | `{ ok, no?, error? }` | スロットを手持ち画像で上書き登録（保存先はローカルの `userData/dex/NNN`） |
| `deleteDexOverride(no)` | 図鑑番号 | `{ ok, error? }` | スロットの上書きを取り消して同梱モンスターに戻す |
| `addProgress(pts)` | ポイント数 | `{ points, evolvedTo }` | **成果ポイントを加算**し進化判定。接続先アプリはこれを呼ぶだけでよい |
| `getProgress()` | — | `{ points, currentNo, nextEvolveAt }` | 累計ポイントと次の進化しきい値 |

### renderer → メイン（send: 応答なし）

| メソッド | 引数 | 用途 |
|---|---|---|
| `moveBy(dx, dy)` | 相対移動量 | ドラッグ・散歩によるウィンドウ移動。メイン側で画面内にクランプして `win.setPosition` |
| `dragEnd()` | — | ドラッグ終了（位置の保存タイミング） |
| `setMouseIgnore(ignore)` | `boolean` | クリック透過の切替。`win.setIgnoreMouseEvents(ignore, { forward: true })` を呼ぶこと（`forward: true` が必須） |
| `openCharacterManager()` | — | キャラクター設定ウィンドウを開く |

### メイン → renderer（イベント）

`win.webContents.send('pet-event', data)` で送ると、UIは `petApi.onEvent(cb)` で受け取ります。`data.type` で分岐:

| type | 追加フィールド | UIの反応 |
|---|---|---|
| `open-panel` | — | 進捗パネルを開く（トレイクリック等から） |
| `working-changed` | `working` | 作業アニメのON/OFF |
| `character-changed` | `character`（ペイロード） | キャラを差し替え |
| `progress` | `progress: { points, currentNo, nextEvolveAt }` | 進捗パネル・ツールチップの表示更新 |
| `toast` | `message` | トースト表示（3.5秒） |

### キャラペイロード

```js
{
  id: 'corgi',
  baseUrl: 'file:///C:/.../characters/corgi/',  // 末尾スラッシュ必須。フレーム画像はここからの相対
  manifest: { /* character.json の内容 */ }
}
```

`character.json` の形式（詳細は [characters/SKIN-GUIDE.md](characters/SKIN-GUIDE.md)）:

```json
{
  "name": "コーギー",
  "frameWidth": 32, "frameHeight": 22, "scale": 4,
  "theme": { "accent": "#e8974e" },
  "animations": {
    "idle":  { "frames": ["idle_0.png", "idle_1.png"], "fps": 2 },
    "walk":  { "frames": ["walk_0.png", "..."], "fps": 7 },
    "work":  { "frames": ["..."], "fps": 3 },
    "sleep": { "frames": ["..."], "fps": 1 }
  }
}
```

`idle` だけが必須です。`walk` がないキャラは散歩しません。`theme.accent` はUIのテーマ色（CSS変数 `--accent`）に反映されます。

## 図鑑と進化（151の保存枠）

`dex/` に番号 001〜151 の保存枠があり、それぞれにオリジナルの生成モンスター（3段進化×45系統 + 2段進化×8系統）が入っています。各枠は通常のスキンと同じ `character.json` + PNG の形式です。

### 仕組み

- **選択**: キャラクター設定ウィンドウ →「📖 図鑑」→ クリックでペットに反映。内部的にはキャラIDとして `dex:NNN` が `state.json` に保存されます（HTTP の `POST /api/select` でも可）
- **成果ポイント**: 接続アプリが `POST /api/progress`（または petApi.addProgress）で送った値の累計が `state.json` の `points` に貯まります
- **進化**: 選択中のモンスターの `evolveAt`（stage1→2 は累計60pt、stage2→3 は累計240pt）に達すると、進化先スロットのキャラへ自動で切り替わります。不在中にしきい値を超えていた場合は次回起動時に進化します。判定ロジックは [lib/dex.js](lib/dex.js)（純関数、`npm test`）
- **枠の上書き**: 図鑑の「登録」ボタンから、手持ちの画像でスロットの見た目を差し替えられます。保存先は各自のPCの `userData/dex/NNN` で、リポジトリには影響しません。「自作」バッジのクリックで元に戻せます

### 接続アプリとの連携

「一定以上の成果を挙げたら進化」を実現するには、成果が出たタイミングで `POST /api/progress` を送るだけです（次節「接続アプリ連携（HTTP API）」参照）。Electronに直接組み込む場合は `petApi.addProgress(pts)` / メインプロセスの `addProgress(pts)` でも同じことができます。

ポイントの単位（作業分数・完了タスク数・売上など）は接続アプリの自由です。しきい値を変えたい場合は `dex/dex.json` の `evolveAt` を編集してください。

## 接続アプリ連携（HTTP API）

起動すると `http://127.0.0.1:34561` にAPIサーバーが立ちます（母体機能）。ポートとトークンは `userData/server.json` で変更できます:

```json
{ "port": 34561, "token": null }
```

`token` を設定すると、全リクエストに `X-Pet-Token: <値>` ヘッダが必要になります。

| メソッド / パス | 内容 |
|---|---|
| `GET /api/status` | `{ app, version, character:{id,name}, working, points, currentNo, nextEvolveAt }` |
| `GET /api/progress` | `{ points, currentNo, nextEvolveAt }` |
| `POST /api/progress` `{"points": 30}` | 成果を加算 → `{ points, evolvedTo }`（進化したら図鑑番号、しなければ null） |
| `GET /api/dex` | 図鑑151件 `{ no, name, stage, evolvesTo, evolveAt, isUser, isCurrent }` |
| `GET /api/dex/:no/sprite.png` | そのスロットのスプライトPNG（接続アプリのUIにモンスターを表示できます） |
| `POST /api/select` `{"no": 25}` | 図鑑スロットをペットに反映 |
| `POST /api/working` `{"working": true}` | ペットの作業アニメON/OFF（アプリの作業状態と同期） |
| `GET /api/events` | Server-Sent Events。`progress` / `evolved` / `character-changed` を配信 |

使用例:

```bash
# 成果を30pt報告（curl）
curl -X POST http://127.0.0.1:34561/api/progress -H "Content-Type: application/json" -d "{\"points\":30}"

# 進化イベントを購読（SSE）
curl -N http://127.0.0.1:34561/api/events
```

```js
// 接続アプリ（JavaScript）での購読例
const es = new EventSource('http://127.0.0.1:34561/api/events');
es.addEventListener('evolved', (e) => console.log('進化!', JSON.parse(e.data)));
```

セキュリティ: サーバーは 127.0.0.1 のみにバインドし、CORSヘッダを付けないためブラウザ上のページからのクロスオリジンアクセスは遮断されます（接続アプリが別プロセスなら影響ありません）。必要なら `token` を設定してください。

### dex/dex.json の形式

```json
{ "no": 1, "name": "メラッコ", "stage": 1, "family": 1, "element": "fire",
  "evolvesTo": 2, "evolveAt": 60 }
```

151体の再生成は `npm run dex`（決定的生成なので同じ結果になります）。

### ⚠ 画像の差し替えと著作権

ポケモン等の公式画像をこのリポジトリに追加・配布することはできません（著作権侵害になります）。図鑑の「登録」機能による差し替えは各自のPC内（userData）に留まり、リポジトリには含まれない設計です。公開・配布するのは同梱のオリジナルモンスターと自分に権利がある画像だけにしてください。

## UIの主な挙動（renderer/pet.js）

- **アニメ選択**: 作業中（`POST /api/working`）→`work`、散歩中→`walk`、10分無操作→`sleep`（💤付き）、それ以外→`idle`
- **散歩**: 待機中に15〜45秒間隔でランダムに左右へ歩く（`moveBy` を50ms間隔で送信）
- **クリック透過**: `mousemove` のたびにペット・パネル等の上かを判定し `setMouseIgnore` を送る。透明な余白のクリックは下のアプリに通る
- **ドラッグ**: ペットをつかんで移動。2px以下の移動はクリック（パネル開閉）と判定

## ライセンス

MIT
