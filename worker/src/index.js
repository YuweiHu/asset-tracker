/**
 * asset-sync — 個人資產管理的後端
 *   KV (HOLDINGS)  : 存「目前持倉」整包 JSON，做跨裝置同步
 *   D1 (DB)        : 存「每日結算快照」，做歷史走勢
 *
 * 認證：POST /login 帳密正確 → 簽發 30 天 JWT；其餘路由都要帶 Bearer token。
 *
 * Secrets（用 `wrangler secret put` 設定，不寫進程式碼）：
 *   AUTH_USER       帳號
 *   AUTH_PASS_HASH  密碼的 SHA-256（十六進位小寫，64 字元）
 *   JWT_SECRET      JWT 簽章金鑰
 */

import { settle } from './settle.js';
import { getMargins } from './margins.js';

const enc = new TextEncoder();
const TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 天

// ---------- 小工具 ----------
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function b64url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64url(enc.encode(JSON.stringify(header)));
  const p = b64url(enc.encode(JSON.stringify(payload)));
  const data = `${h}.${p}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return `${data}.${b64url(sig)}`;
}
async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlToBytes(s), enc.encode(`${h}.${p}`));
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  } catch {
    return null;
  }
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}
async function requireAuth(req, env) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  return verifyJWT(token, env.JWT_SECRET);
}

// ---------- 路由 ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    // 登入：帳密 → token
    if (url.pathname === '/login' && req.method === 'POST') {
      const { username, password } = await req.json().catch(() => ({}));
      const hash = await sha256Hex(password || '');
      const ok =
        env.AUTH_USER && env.AUTH_PASS_HASH && username === env.AUTH_USER && hash === env.AUTH_PASS_HASH;
      if (!ok) return json({ error: '帳號或密碼錯誤' }, 401);
      const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
      const token = await signJWT({ sub: username, exp }, env.JWT_SECRET);
      return json({ token, exp });
    }

    // 健康檢查（免認證）
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'asset-sync' });
    }

    // 期交所保證金一覽（公開、代理 + 每日快取、補 CORS）
    if (url.pathname === '/margins' && req.method === 'GET') {
      try {
        return json(await getMargins(env));
      } catch (e) {
        return json({ error: 'margins fetch failed: ' + (e && e.message) }, 502);
      }
    }

    // 手動觸發結算（給 cron 金鑰，非 JWT；供測試/補算用）
    if (url.pathname === '/settle' && req.method === 'POST') {
      if (req.headers.get('X-Cron-Key') !== env.CRON_SECRET) {
        return json({ error: 'forbidden' }, 403);
      }
      const session = url.searchParams.get('session') === 'us' ? 'us' : 'tw';
      const r = await settle(env, session);
      return json(r);
    }

    // 以下全部需要有效 token
    const payload = await requireAuth(req, env);
    if (!payload) return json({ error: 'unauthorized' }, 401);

    // 目前持倉：整包 JSON 同步
    if (url.pathname === '/holdings') {
      if (req.method === 'GET') {
        const data = await env.HOLDINGS.get('state');
        return new Response(data || 'null', {
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }
      if (req.method === 'PUT') {
        const body = await req.text();
        await env.HOLDINGS.put('state', body);
        return json({ ok: true });
      }
    }

    // 歷史快照：查區間（以 ts 過濾、排序）
    if (url.pathname === '/history' && req.method === 'GET') {
      const days = Math.min(parseInt(url.searchParams.get('days') || '90', 10) || 90, 3650);
      const sinceTs = Date.now() - days * 86400000;
      const { results } = await env.DB.prepare(
        'SELECT date, session, ts, total_twd, total_usd, breakdown_json FROM snapshots WHERE ts >= ? ORDER BY ts ASC'
      )
        .bind(sinceTs)
        .all();
      return json({ snapshots: results });
    }

    return json({ error: 'not found' }, 404);
  },

  // 每日結算（cron）：依觸發的排程決定場次（台股 / 美股）
  async scheduled(event, env, ctx) {
    const session = event.cron === '0 21 * * 1-5' ? 'us' : 'tw';
    ctx.waitUntil(
      settle(env, session).catch((e) => console.log('settle error:', e && e.message))
    );
  },
};
