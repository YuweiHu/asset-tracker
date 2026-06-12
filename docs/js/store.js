/* ===== 狀態與本機儲存 =====
 * store 是全 App 共用的可變狀態容器（只改它的屬性、不重新賦值整個物件，
 * 以維持各模組 import 後拿到的是同一份參考）。
 */
import { STORE_KEY } from './config.js';

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('讀取本機資料失敗，改用空白資料：', e);
  }
  return {
    holdings: [],
    settings: { defaultCcy: 'TWD', assetView: 'gross', theme: 'light' },
    cache: { prices: {}, fxUSDTWD: null },
    meta: { updatedAt: 0 }
  };
}

export const store = {
  state: loadState(),
  displayCcy: 'TWD',
  onSave: null, // 由同步模組掛上：每次存檔後排程推送
};
store.displayCcy = store.state.settings.defaultCcy || 'TWD';

export function save() {
  if (!store.state.meta) store.state.meta = {};
  store.state.meta.updatedAt = Date.now(); // 蓋上時間戳，供多裝置「較新者勝」
  localStorage.setItem(STORE_KEY, JSON.stringify(store.state));
  store.onSave?.();
}

// 只寫本機、不蓋時間戳、不觸發推送（採用雲端資料後落地用）
export function saveLocal() {
  localStorage.setItem(STORE_KEY, JSON.stringify(store.state));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
