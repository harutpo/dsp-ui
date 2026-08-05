// 図鑑（151の保存枠）と進化判定
// 依存なしの純関数のみ（electron 不要・単体テスト可能）

// dex.json を読み込んで Map(no -> entry) を返す
function loadDex(dexJsonPath) {
  const fs = require('fs');
  const list = JSON.parse(fs.readFileSync(dexJsonPath, 'utf8'));
  return new Map(list.map((e) => [e.no, e]));
}

// "dex:025" 形式のキャラIDから図鑑番号を取り出す（該当しなければ null）
function dexNoFromId(id) {
  const m = /^dex:(\d{3})$/.exec(String(id || ''));
  if (!m) return null;
  const no = parseInt(m[1], 10);
  return no >= 1 ? no : null;
}

function dexIdFromNo(no) {
  return 'dex:' + String(no).padStart(3, '0');
}

// 累計ポイントに応じた進化先を判定する。
// dexMap: Map(no -> { no, evolvesTo, evolveAt, ... })
// currentNo: 現在の図鑑番号 / points: 累計成果ポイント
// 戻り値: 進化後の番号（多段進化は連鎖して最終到達点）。進化しないなら null
function decideEvolution(dexMap, currentNo, points) {
  let cur = dexMap.get(currentNo);
  if (!cur) return null;
  let evolved = null;
  // しきい値を超えている限り連鎖進化（不在中に大きく貯まったケース）
  while (cur && cur.evolvesTo != null && cur.evolveAt != null && points >= cur.evolveAt) {
    const next = dexMap.get(cur.evolvesTo);
    if (!next) break; // データ不整合時は打ち切り
    evolved = next.no;
    cur = next;
  }
  return evolved;
}

// 次の進化までの残りポイント（進化しない/最終形態なら null）
function nextEvolveAt(dexMap, currentNo) {
  const cur = dexMap.get(currentNo);
  if (!cur || cur.evolvesTo == null || cur.evolveAt == null) return null;
  return cur.evolveAt;
}

module.exports = { loadDex, dexNoFromId, dexIdFromNo, decideEvolution, nextEvolveAt };
