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
    settings: { defaultCcy: 'TWD' },
    cache: { prices: {}, fxUSDTWD: null }
  };
}

export const store = {
  state: loadState(),
  displayCcy: 'TWD',
};
store.displayCcy = store.state.settings.defaultCcy || 'TWD';

export function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(store.state));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
