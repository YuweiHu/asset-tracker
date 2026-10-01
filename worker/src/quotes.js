/**
 * 美股即時/收盤報價 — Yahoo Finance chart API（v8，免金鑰）
 * Yahoo 不開 CORS，故由 Worker 代理；前端 /quotes 與每日結算共用。
 *   range=1d：regularMarketPrice = 盤中即時價或最新收盤，chartPreviousClose = 前一交易日收盤
 * 代號正規化：大寫、'.' → '-'（BRK.B → BRK-B，Yahoo 格式）
 */
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const MAX_SYMBOLS = 50;

export const normalizeUsSymbol = (s) => String(s || '').trim().toUpperCase().replace(/\./g, '-');

export async function yahooQuote(symbol) {
  const sym = normalizeUsSymbol(symbol);
  if (!sym) throw new Error('空代號');
  const res = await fetch(`${YAHOO_CHART}${encodeURIComponent(sym)}?range=1d&interval=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  });
  if (res.status === 404) throw new Error('查無代號 ' + sym);
  if (!res.ok) throw new Error('Yahoo HTTP ' + res.status);
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (!(price > 0)) throw new Error('無報價 ' + sym);
  const prev = meta.chartPreviousClose > 0 ? meta.chartPreviousClose : price;
  return {
    price,
    prevClose: prev,
    currency: meta.currency || 'USD',
    time: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
  };
}

// 批次：回傳 { 原代號: {price,prevClose,currency,time} | {error} }，單檔失敗不影響其他
export async function getQuotes(symbols) {
  const list = [...new Set(symbols.map((s) => String(s).trim()).filter(Boolean))].slice(0, MAX_SYMBOLS);
  const out = {};
  await Promise.all(
    list.map(async (s) => {
      try {
        out[s] = await yahooQuote(s);
      } catch (e) {
        out[s] = { error: (e && e.message) || 'failed' };
      }
    })
  );
  return out;
}
