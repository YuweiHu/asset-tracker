/* ===== 計算與格式化（接近純函式，僅讀 store）===== */
import { isCash, isFutures, isLiability } from './config.js';
import { store } from './store.js';

export function priceKey(h) {
  if (isFutures(h.type)) return 'tw_futures:' + h.code;
  return h.type + ':' + h.symbol.toUpperCase();
}

function fxRate() { return store.state.cache.fxUSDTWD?.rate || null; }

// 把任意原幣別金額換成目前顯示幣別；缺匯率時回傳 null
export function convert(amount, fromCcy) {
  const rate = fxRate();
  if (fromCcy === store.displayCcy) return amount;
  if (!rate) return null;
  if (fromCcy === 'USD' && store.displayCcy === 'TWD') return amount * rate;
  if (fromCcy === 'TWD' && store.displayCcy === 'USD') return amount / rate;
  return amount;
}

// 回傳單筆持股的計算結果（以顯示幣別）
export function evalHolding(h) {
  // 現金與負債同為「金額型」：回傳正值 magnitude，正負由 app 依類別處理
  if (isCash(h.type) || isLiability(h.type)) {
    return { value: convert(h.amount, h.currency), pnl: null, pnlPct: null, dayPct: null, priceMissing: false };
  }
  if (isFutures(h.type)) {
    const p = store.state.cache.prices[priceKey(h)];
    if (!p) return { value: null, pnl: null, pnlPct: null, dayPct: null, priceMissing: true };
    const mult = h.multiplier || 0;
    const pnlTWD = (p.price - h.entryPrice) * mult * h.lots;   // 未實現損益（台幣）
    const valueTWD = (h.margin || 0) + pnlTWD;                  // 保證金 + 未實現損益
    return {
      value: convert(valueTWD, 'TWD'),
      pnl: convert(pnlTWD, 'TWD'),
      pnlPct: h.margin ? (pnlTWD / h.margin) * 100 : null,      // 對保證金的報酬率
      dayPct: p.dayPct ?? null,
      priceMissing: false, price: p.price, ccy: 'TWD', contract: p.contract
    };
  }
  // 股票（美股 / 台股）
  const p = store.state.cache.prices[priceKey(h)];
  if (!p) return { value: null, pnl: null, pnlPct: null, dayPct: null, priceMissing: true };
  const nativeVal = p.price * h.shares;
  const value = convert(nativeVal, p.currency);
  let pnl = null, pnlPct = null;
  if (h.avgCost != null && !isNaN(h.avgCost)) {
    const cost = h.avgCost * h.shares;
    pnl = convert(nativeVal - cost, p.currency);
    pnlPct = cost ? ((p.price - h.avgCost) / h.avgCost) * 100 : null;
  }
  const dayPct = p.prevClose ? ((p.price - p.prevClose) / p.prevClose) * 100 : null;
  return { value, pnl, pnlPct, dayPct, priceMissing: false, price: p.price, ccy: p.currency };
}

export function fmt(n, ccy) {
  if (n == null || isNaN(n)) return '—';
  const c = ccy || store.displayCcy;
  const opts = c === 'TWD'
    ? { maximumFractionDigits: 0 }
    : { maximumFractionDigits: 2, minimumFractionDigits: 2 };
  const sym = c === 'TWD' ? 'NT$' : 'US$';
  return sym + n.toLocaleString('en-US', opts);
}

export function pct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

// 縮寫金額（K/M/B），給走勢圖 y 軸用：100000 → US$100K、3101208 → NT$3.1M
export function fmtCompact(n, ccy) {
  if (n == null || isNaN(n)) return '';
  const c = ccy || store.displayCcy;
  const sym = c === 'TWD' ? 'NT$' : 'US$';
  return sym + Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
}
