/* ===== 路由 / 殼：sidebar 導覽 + 視圖切換 + 手機抽屜 ===== */
import { store, saveLocal } from "./store.js";
import { el } from "./dom.js";
import { resizeCharts } from "./assets.js";

function openDrawer() {
  el.sidebar.classList.add("open");
  el.sidebarScrim.classList.add("show");
}
function closeDrawer() {
  el.sidebar.classList.remove("open");
  el.sidebarScrim.classList.remove("show");
}

export function showView(name) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.toggle("active", v.dataset.view === name));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.toggle("active", n.dataset.view === name));
  store.state.settings.view = name;
  saveLocal(); // 記住目前視圖，但不觸發雲端推送
  closeDrawer();
  // 從 display:none 切回資產視圖時，校正圖表尺寸
  if (name === "assets") requestAnimationFrame(() => resizeCharts());
}

export function initRouter() {
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.addEventListener("click", () => showView(n.dataset.view)));
  document
    .querySelectorAll(".hamburger")
    .forEach((h) => h.addEventListener("click", openDrawer));
  el.sidebarScrim.addEventListener("click", closeDrawer);

  showView(store.state.settings.view || "assets");
}
