/* ===== 進入點：啟用各模組 + 註冊 Service Worker =====
 * 資產追蹤與期貨計算機各自獨立模組，router 負責 sidebar 切換。
 */
import { initRouter } from "./router.js";
import { initAssets } from "./assets.js";
import { initFutures } from "./futures.js";

initAssets(); // 先啟用資產視圖（會 renderIcons 全頁、建立圖表）
initFutures();
initRouter(); // 最後依記住的視圖顯示對應頁

// 註冊 Service Worker（PWA 離線）
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
