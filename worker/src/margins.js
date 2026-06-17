/**
 * 期交所（TAIFEX）保證金一覽 — 伺服器端代理 + 每日快取。
 * TAIFEX OpenAPI 回 JSON 但「沒有 CORS」，前端無法直連 → 由 Worker 代抓並補上 CORS。
 * 來源每日更新，故快取 12 小時即可，避免每次都打 TAIFEX。
 *   /IndexFuturesAndOptionsMargining  指數類（台指期…）：原始/維持 為 NT$ 金額
 *   /SingleStockFuturesMargining      個股期貨：原始/維持 為「比例」（契約價值 %）
 */
const TAIFEX = 'https://openapi.taifex.com.tw/v1/';
const CACHE_MS = 12 * 3600 * 1000;

function pctToNum(s) {
  const n = parseFloat(String(s).replace('%', ''));
  return isNaN(n) ? null : n / 100;
}
async function fetchTaifex(path) {
  const res = await fetch(TAIFEX + path);
  if (!res.ok) throw new Error('TAIFEX ' + path + ' ' + res.status);
  return res.json();
}

export async function getMargins(env) {
  // 讀快取（KV）
  try {
    const raw = await env.HOLDINGS.get('margins_cache');
    if (raw) {
      const c = JSON.parse(raw);
      if (Date.now() - c.fetchedAt < CACHE_MS) return c;
    }
  } catch (e) {
    /* 快取壞了就重抓 */
  }

  const [idx, stk] = await Promise.all([
    fetchTaifex('IndexFuturesAndOptionsMargining'),
    fetchTaifex('SingleStockFuturesMargining'),
  ]);

  let date = '';
  const index = {}; // 以中文契約名為鍵
  for (const r of idx) {
    if (r.Date) date = r.Date;
    index[r.Contract] = {
      initial: Number(r.InitialMargin),
      maintenance: Number(r.MaintenanceMargin),
    };
  }
  const stock = {}; // 以期貨代碼為鍵
  for (const r of stk) {
    if (r.Date) date = r.Date;
    stock[r.Contract] = {
      name: r.ContractName,
      sec: r.UnderlyingSecurityCode,
      level: r.GroupLevel,
      initRate: pctToNum(r.InitialMarginRate),
      maintRate: pctToNum(r.MaintenanceMarginRate),
    };
  }

  const payload = { fetchedAt: Date.now(), date, index, stock };
  try {
    await env.HOLDINGS.put('margins_cache', JSON.stringify(payload));
  } catch (e) {
    /* 寫快取失敗不影響回應 */
  }
  return payload;
}
