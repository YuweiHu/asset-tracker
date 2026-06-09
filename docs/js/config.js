/* ===== 設定與類別表 =====
 * 所有「類別相關」的行為都收斂在 TYPES。新增一種資產類別，原則上只需在此加一筆，
 * 其餘模組透過 kind / suffix / currency 等欄位驅動，不再各自寫 if (type === ...)。
 */
export const STORE_KEY = 'assetTracker.v1';

export const TYPES = {
  us_stock:     { label: '美股複委託',     color: '#4f46e5', kind: 'stock',   currency: 'USD', dataset: 'USStockPrice',    closeField: 'Close' },
  us_firstrade: { label: '美股 Firstrade', color: '#7c3aed', kind: 'stock',   currency: 'USD', dataset: 'USStockPrice',    closeField: 'Close' },
  tw_stock:     { label: '台股',           color: '#0891b2', kind: 'stock',   currency: 'TWD', dataset: 'TaiwanStockPrice', closeField: 'close' },
  tw_futures:   { label: '台股期貨',       color: '#f59e0b', kind: 'futures', currency: 'TWD' },
  cash:         { label: '現金',           color: '#94a3b8', kind: 'cash' },
  liability:    { label: '負債',           color: '#ef4444', kind: 'liability' },
};

export const CATS = Object.keys(TYPES);
export const CAT_LABEL = Object.fromEntries(CATS.map(t => [t, TYPES[t].label]));
export const CAT_COLOR = Object.fromEntries(CATS.map(t => [t, TYPES[t].color]));

export const isStock = t => TYPES[t]?.kind === 'stock';
export const isFutures = t => TYPES[t]?.kind === 'futures';
export const isCash = t => TYPES[t]?.kind === 'cash';
export const isLiability = t => TYPES[t]?.kind === 'liability';

/* 視覺 / 行為常數（取代散落的魔術數字） */
export const SEG_BORDER = '#ffffff';          // 圓餅圖分段描邊
export const CHART_ANIM_MS = 300;             // 圖表動畫時間
export const STALE_MS = 10 * 60 * 1000;       // 報價超過此時間視為過期 → 開啟時自動更新
export const PRICE_LOOKBACK_DAYS = 14;        // 股價/匯率回溯天數（確保至少兩個交易日，可算今日%）
export const FUT_LOOKBACK_DAYS = 12;          // 期貨日資料回溯天數（確保含近月）

/* FinMind API：所有資料（美股/台股/期貨/匯率）單一來源，原生支援 CORS，免金鑰。 */
export const FINMIND_API = 'https://api.finmindtrade.com/api/v4/data';

/* 雲端同步後端（Cloudflare Worker）：登入、持倉同步、每日歷史。 */
export const SYNC_API = 'https://asset-sync.asset-sync.workers.dev';
