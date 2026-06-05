/* ===== 對外資料抓取 — 單一來源 FinMind =====
 * 美股 USStockPrice / 台股 TaiwanStockPrice / 期貨 TaiwanFuturesDaily / 匯率 TaiwanExchangeRate
 * FinMind 原生支援 CORS（Access-Control-Allow-Origin: *），直連、不需代理、免金鑰。
 * 資料皆為每日盤後（EOD）；美股可能因時差延遲約一天。
 */
import { TYPES, FINMIND_API, PRICE_LOOKBACK_DAYS, FUT_LOOKBACK_DAYS } from './config.js';
import { store, save } from './store.js';

export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// FinMind 查詢 → 回傳 data 陣列
async function finmind(params) {
  const qs = new URLSearchParams(params).toString();
  const data = await fetchJson(`${FINMIND_API}?${qs}`);
  if (data.status && data.status !== 200) throw new Error(data.msg || ('FinMind ' + data.status));
  return data.data || [];
}

function lookbackDate(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

// 股價（美股 / 台股）：取最近兩個交易日，算最新收盤與今日漲跌
export async function fetchPrice(h) {
  const cfg = TYPES[h.type];
  const rows = await finmind({ dataset: cfg.dataset, data_id: h.symbol, start_date: lookbackDate(PRICE_LOOKBACK_DAYS) });
  const valid = rows
    .filter(r => r[cfg.closeField] > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!valid.length) throw new Error('無報價');
  const last = valid[valid.length - 1];
  const prev = valid.length > 1 ? valid[valid.length - 2] : last;
  return {
    price: last[cfg.closeField],
    prevClose: prev[cfg.closeField],
    currency: cfg.currency
  };
}

// 匯率 USD→TWD：用台銀即期賣出（spot_sell）最新值
export async function fetchFx() {
  const rows = await finmind({ dataset: 'TaiwanExchangeRate', data_id: 'USD', start_date: lookbackDate(PRICE_LOOKBACK_DAYS) });
  const valid = rows
    .filter(r => r.spot_sell > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!valid.length) throw new Error('無匯率');
  return valid[valid.length - 1].spot_sell;
}

// 台股期貨：商品代碼↔中文名 對照表（抓一次後快取）
export async function ensureFutInfo() {
  if (store.state.cache.futInfo && store.state.cache.futInfo.length) return store.state.cache.futInfo;
  const rows = await finmind({ dataset: 'TaiwanFutOptDailyInfo' });
  const list = rows
    .filter(x => x.type === 'TaiwanFuturesDaily' && x.name)
    .map(x => ({ code: x.code, name: x.name }));
  store.state.cache.futInfo = list;
  save();
  return list;
}

// 依商品名稱建議「每口乘數」（使用者可改）
export function suggestMultiplier(name) {
  if (!name) return null;
  if (name.includes('臺指') || name.includes('台指')) {
    if (name.includes('微型')) return 10;
    if (name.includes('小型')) return 50;
    return 200; // 大台
  }
  if (name.includes('小型')) return 100;   // 小型個股期貨
  if (name.includes('期貨')) return 2000;  // 一般個股期貨
  return null;
}

// 抓某期貨商品「近一」（最近到期月、單式）收盤
export async function fetchFuturesPrice(code) {
  const rows = (await finmind({ dataset: 'TaiwanFuturesDaily', data_id: code, start_date: lookbackDate(FUT_LOOKBACK_DAYS) }))
    .filter(r => r.close > 0 && !String(r.contract_date).includes('/'));
  if (!rows.length) throw new Error('無期貨報價');
  const lastDate = rows[rows.length - 1].date;
  const sameDay = rows.filter(r => r.date === lastDate)
    .sort((a, b) => String(a.contract_date).localeCompare(String(b.contract_date)));
  const near = sameDay[0]; // 最小到期月 = 近一
  return { price: near.close, contract: near.contract_date, dayPct: near.spread_per ?? null, date: lastDate, ts: Date.now() };
}
