// 接続アプリ向けのローカルHTTP APIサーバー（母体機能）
// 依存は Node 標準 http のみ。127.0.0.1 にのみバインドする。
//
// セキュリティ方針:
// - 127.0.0.1 のみバインド（LANや外部からは到達できない）
// - CORSヘッダは意図的に付けない: ブラウザ上のページからのクロスオリジン読み取りと
//   JSONのpreflight付きPOSTを遮断する。接続アプリは別プロセスなのでCORSの影響を受けない
// - token を設定した場合は X-Pet-Token ヘッダが一致しないと 401
const http = require('http');

const MAX_BODY = 64 * 1024; // POSTボディの上限（安全弁）

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// handlers: main プロセスが注入する実装
//   status() / getProgress() / addProgress(pts) / listDex() /
//   getSprite(no) -> Buffer|null / selectDex(no) -> bool / setWorking(bool)
// 戻り値: Promise<{ server, port, broadcast(type, data), close() }>
function createPetServer({ port, host = '127.0.0.1', token = null, handlers }) {
  const sseClients = new Set();

  const server = http.createServer(async (req, res) => {
    try {
      if (token && req.headers['x-pet-token'] !== token) {
        return sendJson(res, 401, { error: 'unauthorized（X-Pet-Token ヘッダが必要です）' });
      }
      const { pathname } = new URL(req.url, `http://${host}`);

      if (req.method === 'GET' && pathname === '/api/status') {
        return sendJson(res, 200, handlers.status());
      }

      if (pathname === '/api/progress') {
        if (req.method === 'GET') return sendJson(res, 200, handlers.getProgress());
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const pts = Number(body.points);
          if (!Number.isFinite(pts) || pts < 0) {
            return sendJson(res, 400, { error: 'points は0以上の数値で指定してください' });
          }
          return sendJson(res, 200, handlers.addProgress(pts));
        }
      }

      if (req.method === 'GET' && pathname === '/api/dex') {
        return sendJson(res, 200, handlers.listDex());
      }

      const sprite = /^\/api\/dex\/(\d{1,3})\/sprite\.png$/.exec(pathname);
      if (req.method === 'GET' && sprite) {
        const buf = handlers.getSprite(parseInt(sprite[1], 10));
        if (!buf) return sendJson(res, 404, { error: 'スロットが見つかりません' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length });
        return res.end(buf);
      }

      if (req.method === 'POST' && pathname === '/api/select') {
        const body = await readJsonBody(req);
        const no = parseInt(body.no, 10);
        const ok = Number.isFinite(no) ? handlers.selectDex(no) : false;
        return sendJson(res, ok ? 200 : 404, ok ? { ok: true, no } : { ok: false, error: 'スロットが見つかりません' });
      }

      if (req.method === 'POST' && pathname === '/api/working') {
        const body = await readJsonBody(req);
        handlers.setWorking(!!body.working);
        return sendJson(res, 200, { ok: true, working: !!body.working });
      }

      // SSE: progress / evolved / character-changed イベントを配信
      if (req.method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write(': connected\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      sendJson(res, 404, { error: 'unknown endpoint' });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
  });

  function broadcast(type, data) {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data || {})}\n\n`;
    for (const client of sseClients) {
      try { client.write(msg); } catch { sseClients.delete(client); }
    }
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        server,
        port: server.address().port,
        broadcast,
        close: () => { for (const c of sseClients) try { c.end(); } catch {} server.close(); },
      });
    });
  });
}

module.exports = { createPetServer };
