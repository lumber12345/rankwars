/* Torn Rank Wars — tiny zero-dependency server
 * - Serves the frontend from ./public
 * - Proxies allow-listed Torn API v2 faction/user endpoints (server-side, avoids
 *   CORS and works from sandboxed previews). API keys never leave this process
 *   except to api.torn.com.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const TORN_BASE = 'api.torn.com';
const CACHE_TTL_MS = 10 * 1000; // short server-side cache so polling is gentle on the API

/* ---------------------------------------------------------------- cache */
const cache = new Map(); // cacheKey -> { ts, status, body }
function cacheGet(k) {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(k);
    return null;
  }
  return hit;
}
function cacheSet(k, status, body) {
  if (cache.size > 500) cache.clear();
  cache.set(k, { ts: Date.now(), status, body });
}

/* ------------------------------------------------------------ validation */
const PATH_OK = [
  /^\/faction\/(basic|members|wars|warfareranked|rankedwars|rankedwarreport)$/,
  /^\/faction\/\d+\/(basic|members|wars|rankedwars|rankedwarreport|chain|attacks)$/,
  /^\/user\/(basic|profile)$/,
];
const PARAM_OK = new Set(['sort', 'from', 'to', 'limit', 'offset', 'cat', 'striptags', 'timestamp', 'filters']);

/* ------------------------------------------------------------ torn proxy */
function fetchTorn(v2path, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params);
    qs.set('comment', 'RankWarsApp');
    const options = {
      hostname: TORN_BASE,
      path: `/v2${v2path}?${qs.toString()}`,
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'TornRankWarsApp/1.0 (unofficial fan tool)',
      },
      timeout: 12000,
    };
    const req = https.request(options, (res) => {
      let chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 4 * 1024 * 1024) req.destroy(); // sanity cap
        else chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    req.end();
  });
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers));
  res.end(body);
}

/* ---------------------------------------------------------------- static */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = rel.split('?')[0];
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, '{"error":{"error":"forbidden"}}');
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA-ish fallback: unknown non-asset paths get the shell
      if (!path.extname(rel)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) return send(res, 404, '{"error":{"error":"not found"}}');
          res.writeHead(200, { 'content-type': MIME['.html'] });
          res.end(html);
        });
      }
      return send(res, 404, '{"error":{"error":"not found"}}');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

/* ------------------------------------------------------------ ff scouter */
/* Proxy for ffscouter.com official API (v1). Modes:
 *   stats    GET /api/v1/get-stats?key&targets   (<=205 ids/call, 20/min/IP)
 *   check    GET /api/v1/check-key?key           (10/min/IP)
 *   register POST /api/v1/register               (3/min/IP, JSON body)
 */
const FF_HOST = 'ffscouter.com';
const FF_TTL_MS = { stats: 5 * 60 * 1000, check: 60 * 1000 };
function fetchFF(pathname, { method = 'GET', body = null, params = {} }) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params);
    const options = {
      hostname: FF_HOST,
      path: `${pathname}${qs.toString() ? '?' + qs.toString() : ''}`,
      method,
      headers: { accept: 'application/json', 'user-agent': 'TornRankWarsApp/1.1 (unofficial fan tool)' },
      timeout: 15000,
    };
    let payload = null;
    if (body) {
      payload = JSON.stringify(body);
      options.headers['content-type'] = 'application/json';
      options.headers['content-length'] = Buffer.byteLength(payload);
    }
    const req = https.request(options, (res) => {
      let chunks = [], size = 0;
      res.on('data', (c) => { size += c.length; if (size > 2 * 1024 * 1024) req.destroy(); else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('FF Scouter timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------------------------------------------------------------- server */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (u.pathname === '/api/ping') {
    return send(res, 200, JSON.stringify({ ok: true, ts: Date.now() }));
  }

  if (u.pathname === '/api/ffscouter') {
    const key = u.searchParams.get('key') || '';
    const mode = u.searchParams.get('mode') || '';
    if (!key) return send(res, 400, JSON.stringify({ error: { code: 1, error: 'Missing API key' } }));
    if (!['stats', 'check', 'register'].includes(mode)) {
      return send(res, 400, JSON.stringify({ error: { code: 400, error: `Unknown FF Scouter mode: ${mode}` } }));
    }
    const mask = (s) => (s || '').split(key).join('***');
    const finish = (status, body) => send(res, status, key && body.includes(key) ? mask(body) : body);

    if (mode === 'stats') {
      const idsRaw = (u.searchParams.get('ids') || '').trim();
      if (!idsRaw) return send(res, 400, JSON.stringify({ error: { code: 3, error: 'The targets parameter is required' } }));
      const ids = idsRaw.split(',').map((x) => x.trim()).filter(Boolean);
      if (!ids.length || ids.length > 205) return send(res, 400, JSON.stringify({ error: { code: 4, error: 'Between 1 and 205 target IDs required' } }));
      if (!ids.every((x) => /^\d+$/.test(x))) return send(res, 400, JSON.stringify({ error: { code: 5, error: 'All target IDs must be positive integers' } }));
      const ck = 'ff:stats:' + ids.slice().sort((a, b) => a - b).join(',');
      const hit = cacheGet(ck);
      if (hit && !u.searchParams.get('nocache')) return send(res, hit.status, key && hit.body.includes(key) ? mask(hit.body) : hit.body, { 'x-ff-cache': 'HIT' });
      fetchFF('/api/v1/get-stats', { params: { key, targets: ids.join(',') } })
        .then(({ status, body }) => {
          const ok = status >= 200 && status < 300;
          if (ok) cacheSet(ck, status, body);
          finish(status === 429 ? 429 : status, body);
        })
        .catch((err) => send(res, 504, JSON.stringify({ error: { code: 504, error: 'FF Scouter request failed: ' + err.message } })));
      return;
    }

    if (mode === 'check') {
      const ck = 'ff:check:' + Buffer.from(key).toString('base64');
      const hit = cacheGet(ck);
      if (hit) return send(res, hit.status, key && hit.body.includes(key) ? mask(hit.body) : hit.body, { 'x-ff-cache': 'HIT' });
      fetchFF('/api/v1/check-key', { params: { key } })
        .then(({ status, body }) => { if (status >= 200 && status < 300) cacheSet(ck, status, body); finish(status, body); })
        .catch((err) => send(res, 504, JSON.stringify({ error: { code: 504, error: 'FF Scouter request failed: ' + err.message } })));
      return;
    }

    // mode === 'register' — client must have shown the data-policy consent first
    fetchFF('/api/v1/register', {
      method: 'POST',
      body: { key, agree_to_data_policy: true, signup_source: 'TornRankWarsApp' },
    })
      .then(({ status, body }) => finish(status, body))
      .catch((err) => send(res, 504, JSON.stringify({ error: { code: 504, error: 'FF Scouter request failed: ' + err.message } })));
    return;
  }

  if (u.pathname === '/api/torn') {
    const key = u.searchParams.get('key') || '';
    const p = u.searchParams.get('path') || '';
    if (!key) return send(res, 400, JSON.stringify({ error: { code: 400, error: 'Missing API key' } }));
    if (!PATH_OK.some((re) => re.test(p))) {
      return send(res, 400, JSON.stringify({ error: { code: 400, error: `Path not allowed: ${p}` } }));
    }
    const fwd = {};
    for (const [k, v] of u.searchParams.entries()) {
      if (PARAM_OK.has(k) && v !== '') fwd[k] = v;
    }
    const cacheKey = p + '?' + new URLSearchParams(fwd).toString() + '#k=' + Buffer.from(key).toString('base64');
    const noCache = u.searchParams.get('nocache') === '1';
    if (!noCache) {
      const hit = cacheGet(cacheKey);
      if (hit) return send(res, hit.status, hit.body, { 'x-rw-cache': 'HIT' });
    }
    fwd.key = key;
    fetchTorn(p, fwd)
      .then(({ status, body }) => {
        let ok = false;
        try {
          const data = JSON.parse(body);
          ok = status >= 200 && status < 300 && !(data && data.error);
        } catch (_) {}
        if (ok) cacheSet(cacheKey, status, body);
        // mask key if echoed anywhere in an error message
        const safe = key && body.includes(key) ? body.split(key).join('***') : body;
        send(res, status === 200 && !ok ? 200 : status, safe, { 'x-rw-cache': 'MISS' });
      })
      .catch((err) => {
        send(res, 504, JSON.stringify({ error: { code: 504, error: 'Upstream request failed: ' + err.message } }));
      });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, u.pathname);
  send(res, 405, '{"error":{"error":"method not allowed"}}');
});

server.listen(PORT, HOST, () => {
  console.log(`[rank-wars] listening on http://${HOST}:${PORT}`);
});
