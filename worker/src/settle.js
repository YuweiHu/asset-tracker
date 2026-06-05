/**
 * 每日結算：讀 KV 持倉 → 抓 FinMind 收盤價/匯率 → 估值 → 寫一筆快照到 D1。
 * 估值邏輯與前端 calc.js 一致：
 *   股票  = 收盤價 × 股數（美股再乘匯率換台幣）
 *   期貨  = 保證金 + 未實現損益((price-entry)×乘數×口數)
 *   現金  = 金額（美元再乘匯率）
 * 全部以台幣為基準，total_usd = total_twd / 匯率。
 */
const FINMIND = 'https://api.finmindtrade.com/api/v4/data';
const PRICE_LOOKBACK_DAYS = 14;
const FUT_LOOKBACK_DAYS = 12;

const TYPES = {
  us_stock: { kind: 'stock', currency: 'USD', dataset: 'USStockPrice', closeField: 'Close' },
  us_firstrade: { kind: 'stock', currency: 'USD', dataset: 'USStockPrice', closeField: 'Close' },
  tw_stock: { kind: 'stock', currency: 'TWD', dataset: 'TaiwanStockPrice', closeField: 'close' },
  tw_futures: { kind: 'futures', currency: 'TWD' },
  cash: { kind: 'cash' },
};
const CATS = Object.keys(TYPES);

function lookbackDate(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}
async function finmind(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${FINMIND}?${qs}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.status && data.status !== 200) throw new Error(data.msg || 'FinMind ' + data.status);
  return data.data || [];
}
async function fetchStockClose(cfg, symbol) {
  const rows = await finmind({
    dataset: cfg.dataset,
    data_id: symbol,
    start_date: lookbackDate(PRICE_LOOKBACK_DAYS),
  });
  const valid = rows
    .filter((r) => r[cfg.closeField] > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!valid.length) throw new Error('無報價 ' + symbol);
  return valid[valid.length - 1][cfg.closeField];
}
async function fetchFx() {
  const rows = await finmind({
    dataset: 'TaiwanExchangeRate',
    data_id: 'USD',
    start_date: lookbackDate(PRICE_LOOKBACK_DAYS),
  });
  const valid = rows
    .filter((r) => r.spot_sell > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!valid.length) throw new Error('無匯率');
  return valid[valid.length - 1].spot_sell;
}
async function fetchFutClose(code) {
  const rows = (
    await finmind({ dataset: 'TaiwanFuturesDaily', data_id: code, start_date: lookbackDate(FUT_LOOKBACK_DAYS) })
  ).filter((r) => r.close > 0 && !String(r.contract_date).includes('/'));
  if (!rows.length) throw new Error('無期貨報價 ' + code);
  const lastDate = rows[rows.length - 1].date;
  const sameDay = rows
    .filter((r) => r.date === lastDate)
    .sort((a, b) => String(a.contract_date).localeCompare(String(b.contract_date)));
  return sameDay[0].close; // 最小到期月 = 近一
}

const round2 = (n) => Math.round(n * 100) / 100;

// 估值：回傳 { total_twd, total_usd, breakdown, fx, failed }
export async function computeSnapshot(state) {
  const holdings = (state && state.holdings) || [];
  const fx = await fetchFx(); // USD→TWD
  const breakdown = {};
  CATS.forEach((c) => (breakdown[c] = 0));
  let totalTwd = 0;
  const failed = [];

  for (const h of holdings) {
    const cfg = TYPES[h.type] || {};
    let valTwd = 0;
    try {
      if (cfg.kind === 'cash') {
        valTwd = h.currency === 'USD' ? (h.amount || 0) * fx : h.amount || 0;
      } else if (cfg.kind === 'futures') {
        const price = await fetchFutClose(h.code);
        const pnlTwd = (price - h.entryPrice) * (h.multiplier || 0) * h.lots;
        valTwd = (h.margin || 0) + pnlTwd;
      } else {
        const price = await fetchStockClose(cfg, h.symbol);
        const native = price * h.shares;
        valTwd = cfg.currency === 'USD' ? native * fx : native;
      }
    } catch (e) {
      failed.push(h.symbol || h.code || h.name);
      continue;
    }
    breakdown[h.type] = round2(breakdown[h.type] + valTwd);
    totalTwd += valTwd;
  }

  return {
    total_twd: round2(totalTwd),
    total_usd: round2(totalTwd / fx),
    breakdown,
    fx,
    failed,
  };
}

// 結算並寫入 D1（同一天同一場次以 upsert 覆蓋）
export async function settle(env, session) {
  const raw = await env.HOLDINGS.get('state');
  if (!raw) return { ok: false, error: 'KV 內無持倉' };
  const state = JSON.parse(raw);
  const snap = await computeSnapshot(state);
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); // 台灣日期
  const ts = Date.now();
  await env.DB.prepare(
    `INSERT INTO snapshots(date,session,ts,total_twd,total_usd,breakdown_json)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(date,session) DO UPDATE SET
       ts=excluded.ts, total_twd=excluded.total_twd,
       total_usd=excluded.total_usd, breakdown_json=excluded.breakdown_json`
  )
    .bind(date, session, ts, snap.total_twd, snap.total_usd, JSON.stringify(snap.breakdown))
    .run();
  return { ok: true, date, session, ...snap };
}
