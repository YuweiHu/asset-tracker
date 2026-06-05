/* ===== 雲端同步 =====
 * 與 Cloudflare Worker (asset-sync) 溝通：登入取得 JWT、持倉拉取/推送。
 * 衝突策略：單人多裝置，以 state.meta.updatedAt 時間戳「較新者勝」。
 */
import { SYNC_API } from './config.js';
import { store } from './store.js';

const TOKEN_KEY = 'assetTracker.token';
const PUSH_DEBOUNCE = 1500;

let pushTimer = null;
let status = 'idle'; // idle | pending | syncing | ok | error | offline
let lastSync = null;
let statusListener = null;
let authLostHandler = null;

/* ---------- token ---------- */
export function getToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw);
    if (exp && Date.now() / 1000 > exp) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}
export function isLoggedIn() {
  return !!getToken();
}
export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}
export function setAuthLostHandler(fn) {
  authLostHandler = fn;
}

/* ---------- 狀態回報 ---------- */
export function onStatus(fn) {
  statusListener = fn;
}
function setStatus(s) {
  status = s;
  statusListener?.({ status, lastSync });
}

/* ---------- 登入 ---------- */
export async function login(username, password) {
  const res = await fetch(`${SYNC_API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `登入失敗 (${res.status})`);
  }
  const { token, exp } = await res.json();
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp }));
  return true;
}

/* ---------- 帶 token 請求 ---------- */
async function authFetch(path, opts = {}) {
  const token = getToken();
  if (!token) {
    authLostHandler?.();
    throw new Error('未登入');
  }
  const res = await fetch(`${SYNC_API}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    logout();
    authLostHandler?.();
    throw new Error('登入已過期，請重新登入');
  }
  return res;
}

/* ---------- 持倉拉取 / 推送 ---------- */
export async function pull() {
  const res = await authFetch('/holdings');
  if (!res.ok) throw new Error(`拉取失敗 (${res.status})`);
  const text = await res.text();
  if (!text || text === 'null') return null;
  return JSON.parse(text);
}

export async function pushNow() {
  setStatus('syncing');
  try {
    const res = await authFetch('/holdings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store.state),
    });
    if (!res.ok) throw new Error(`推送失敗 (${res.status})`);
    lastSync = Date.now();
    setStatus('ok');
    return true;
  } catch (e) {
    setStatus('error');
    throw e;
  }
}

// 存檔後呼叫：延遲合併多次變更，最後推一次
export function schedulePush() {
  clearTimeout(pushTimer);
  setStatus('pending');
  pushTimer = setTimeout(() => {
    pushNow().catch(() => {}); // 失敗（如離線）下次存檔或重開時會再推
  }, PUSH_DEBOUNCE);
}
