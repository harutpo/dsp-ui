// lib/dex.js の進化判定テスト（依存なし・node tools/test-dex.js で実行）
const assert = require('assert');
const path = require('path');
const { loadDex, dexNoFromId, dexIdFromNo, decideEvolution, nextEvolveAt } = require('../lib/dex');

const dex = loadDex(path.join(__dirname, '..', 'dex', 'dex.json'));

// --- データの健全性 ---
assert.strictEqual(dex.size, 151, '図鑑は151体');
for (const [no, e] of dex) {
  assert.strictEqual(e.no, no);
  assert.ok(e.name && typeof e.name === 'string', `#${no} に名前がある`);
  if (e.evolvesTo != null) {
    assert.ok(dex.has(e.evolvesTo), `#${no} の進化先 #${e.evolvesTo} が存在する`);
    assert.ok(e.evolveAt > 0, `#${no} にしきい値がある`);
    assert.strictEqual(dex.get(e.evolvesTo).stage, e.stage + 1, `#${no} の進化先は次の段階`);
  }
}
// 名前の重複なし
const names = [...dex.values()].map((e) => e.name);
assert.strictEqual(new Set(names).size, 151, '名前が151種すべてユニーク');

// --- ID変換 ---
assert.strictEqual(dexNoFromId('dex:001'), 1);
assert.strictEqual(dexNoFromId('dex:151'), 151);
assert.strictEqual(dexNoFromId('corgi'), null);
assert.strictEqual(dexNoFromId(null), null);
assert.strictEqual(dexIdFromNo(25), 'dex:025');

// --- 進化判定（#1 は3段系統: 60pt→#2, 240pt→#3） ---
assert.strictEqual(decideEvolution(dex, 1, 0), null, 'しきい値未満は進化しない');
assert.strictEqual(decideEvolution(dex, 1, 59), null, '59ptでは進化しない');
assert.strictEqual(decideEvolution(dex, 1, 60), 2, '60ptで第2段階へ');
assert.strictEqual(decideEvolution(dex, 1, 239), 2, '239ptでは第2段階止まり');
assert.strictEqual(decideEvolution(dex, 1, 240), 3, '240ptで連鎖して最終形態へ');
assert.strictEqual(decideEvolution(dex, 1, 99999), 3, '大量ptでも最終形態止まり');
assert.strictEqual(decideEvolution(dex, 2, 240), 3, '第2段階からも進化する');
assert.strictEqual(decideEvolution(dex, 3, 99999), null, '最終形態は進化しない');
assert.strictEqual(decideEvolution(dex, 999, 100), null, '存在しない番号はnull');

// --- 2段系統（最後の8系統 = #136以降）: stage1→stage2 で終わり ---
const twoStage = [...dex.values()].find((e) => e.no >= 136 && e.stage === 1);
assert.ok(twoStage, '2段系統が存在する');
assert.strictEqual(decideEvolution(dex, twoStage.no, 99999), twoStage.evolvesTo, '2段系統は第2段階まで');
assert.strictEqual(dex.get(twoStage.evolvesTo).evolvesTo, null, '2段系統の第2段階は最終形態');

// --- nextEvolveAt ---
assert.strictEqual(nextEvolveAt(dex, 1), 60);
assert.strictEqual(nextEvolveAt(dex, 2), 240);
assert.strictEqual(nextEvolveAt(dex, 3), null);

console.log('✅ test-dex: すべてのテストに合格');
