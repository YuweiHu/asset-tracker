/* ===== 集中 DOM 參考 =====
 * 啟動時一次抓好所有用到的元素，避免散落且易打錯的 getElementById。
 * （fType / fCurrency 為下拉掛載點，由 Dropdown 以 id 自行取得，不在此列。）
 */
const IDS = [
  'refreshBtn', 'totalLabel', 'totalValue', 'totalPnl', 'allocChart', 'allocLegend', 'holdingsList', 'fxLine',
  'twChart', 'twLegend', 'usChart', 'usLegend',
  'trendChart', 'chartCarousel', 'chartDots', 'rangeToggle', 'trendMeta',
  'formModal', 'formTitle', 'fDelete', 'fSymbol', 'fShares', 'fAvgCost', 'fName', 'fAmount',
  'fFutSearch', 'fFutResults', 'fFutSelected', 'fFutLots', 'fFutMult', 'fFutEntry', 'fFutMargin',
  'fabAdd', 'fCancel', 'fSave', 'settingsBtn', 'settingsModal', 'sClose', 'sExport',
  'sImport', 'sImportFile', 'ccyToggle', 'viewToggle', 'themeToggle',
  'loginOverlay', 'loginUser', 'loginPass', 'loginBtn', 'loginErr', 'logoutBtn', 'syncStatus',
];

export const el = {};
for (const id of IDS) el[id] = document.getElementById(id);
