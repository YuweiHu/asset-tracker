/* ===== 主程式：渲染、表單、事件、啟動 ===== */
import {
  CATS,
  CAT_LABEL,
  CAT_COLOR,
  TYPES,
  SEG_BORDER,
  CHART_ANIM_MS,
  STALE_MS,
  isCash,
  isFutures,
  isStock,
} from "./config.js";
import { store, save, uid } from "./store.js";
import {
  fetchPrice,
  fetchFx,
  fetchFuturesPrice,
  ensureFutInfo,
  suggestMultiplier,
} from "./api.js";
import { evalHolding, priceKey, fmt, pct } from "./calc.js";
import { Dropdown } from "./dropdown.js";
import { el } from "./dom.js";
import { svgIcon, renderIcons } from "./icons.js";

let editingId = null;
let allocChart = null;
let selectedFut = null; // 期貨表單目前選定的商品 {code,name}
let refreshing = false; // 報價更新中旗標（避免併發）
let ddType, ddCurrency;

/* ---------- 更新資產 ---------- */
async function refreshAll() {
  if (refreshing) return; // 併發保護：進行中直接略過
  refreshing = true;
  el.refreshBtn.classList.add("loading");
  el.refreshBtn.querySelector(".btn-label").textContent = "更新中…";
  try {
    const priced = store.state.holdings.filter((h) => !isCash(h.type));
    let okFx = true;
    const failed = [];

    // 匯率
    try {
      const rate = await fetchFx();
      store.state.cache.fxUSDTWD = { rate, ts: Date.now() };
    } catch (e) {
      okFx = false;
    }

    // 股價 / 期貨報價（逐一抓，避免被限流）
    for (const h of priced) {
      try {
        if (isFutures(h.type)) {
          store.state.cache.prices[priceKey(h)] = await fetchFuturesPrice(
            h.code,
          );
        } else {
          store.state.cache.prices[priceKey(h)] = {
            ...(await fetchPrice(h)),
            ts: Date.now(),
          };
        }
      } catch (e) {
        failed.push(isFutures(h.type) ? h.name || h.code : h.symbol);
      }
    }
    store.state.cache.lastUpdate = Date.now();
    save();
    render();

    if (failed.length || !okFx) {
      const msg = [];
      if (failed.length) msg.push("股價抓取失敗: " + failed.join(", "));
      if (!okFx) msg.push("匯率抓取失敗");
      msg.push("\n若持續失敗，請到設定填入 CORS 代理網址。");
      alert(msg.join("\n"));
    }
  } finally {
    refreshing = false;
    el.refreshBtn.classList.remove("loading");
    el.refreshBtn.querySelector(".btn-label").textContent = "更新資產";
  }
}

/* ---------- 渲染 ---------- */
function render() {
  const totals = {};
  CATS.forEach((c) => (totals[c] = 0));
  let total = 0,
    totalPnl = 0,
    hasPnl = false;
  for (const h of store.state.holdings) {
    const r = evalHolding(h);
    if (r.value == null) continue; // 缺報價/匯率：跳過不計入
    totals[h.type] += r.value;
    total += r.value;
    if (r.pnl != null) {
      totalPnl += r.pnl;
      hasPnl = true;
    }
  }

  el.totalValue.textContent = store.state.holdings.length ? fmt(total) : "—";
  if (hasPnl) {
    const up = totalPnl >= 0;
    el.totalPnl.className = "total-sub " + (up ? "up" : "down");
    el.totalPnl.innerHTML = `未實現損益 ${svgIcon(up ? "arrow-up" : "arrow-down", 14)} ${fmt(Math.abs(totalPnl))}`;
  } else {
    el.totalPnl.textContent = "";
  }

  renderCharts(totals);
  renderList();

  const fx = store.state.cache.fxUSDTWD;
  el.fxLine.textContent = fx
    ? `目前匯率 1 USD = ${fx.rate.toFixed(3)} TWD（${new Date(fx.ts).toLocaleString("zh-TW")}）`
    : "尚未取得匯率";
}

function renderCharts(totals) {
  const cats = CATS.filter((c) => totals[c] > 0);
  const allocData = cats.map((c) => totals[c]);
  const allocColors = cats.map((c) => CAT_COLOR[c]);

  if (allocChart) allocChart.destroy();
  allocChart = new window.Chart(el.allocChart, {
    type: "doughnut",
    data: {
      labels: cats.map((c) => CAT_LABEL[c]),
      datasets: [
        {
          data: allocData,
          backgroundColor: allocColors,
          borderColor: SEG_BORDER,
          borderWidth: 2,
        },
      ],
    },
    options: {
      cutout: "62%",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      animation: { duration: CHART_ANIM_MS },
    },
  });
  const total = allocData.reduce((a, b) => a + b, 0) || 1;
  el.allocLegend.innerHTML =
    cats
      .map(
        (c) =>
          `<span><i style="background:${CAT_COLOR[c]}"></i>${CAT_LABEL[c]} ${((totals[c] / total) * 100).toFixed(1)}%</span>`,
      )
      .join("") || '<span style="color:var(--muted)">尚無資料</span>';
}

// 損益列：今日漲跌% 與 損益%，各自依正負上色（漲綠跌紅）
function pnlLine(r) {
  const parts = [];
  if (r.dayPct != null)
    parts.push(
      `<div class="${r.dayPct >= 0 ? "up" : "down"}">今日 ${pct(r.dayPct)}</div>`,
    );
  if (r.pnlPct != null)
    parts.push(
      `<div class="${r.pnlPct >= 0 ? "up" : "down"}">損益 ${pct(r.pnlPct)}</div>`,
    );
  return parts.length ? `<div class="h-pnl">${parts.join("")}</div>` : "";
}

function renderList() {
  if (!store.state.holdings.length) {
    el.holdingsList.innerHTML =
      '<div class="empty">尚無資產，點右下角 ＋ 新增<br>美股、台股或現金</div>';
    return;
  }
  let html = "";
  for (const cat of CATS) {
    const items = store.state.holdings.filter((h) => h.type === cat);
    if (!items.length) continue;
    html += `<div class="group-title">${CAT_LABEL[cat]}</div>`;
    for (const h of items) {
      const r = evalHolding(h);
      let meta,
        right,
        pnlHtml = "",
        name;
      if (isCash(cat)) {
        name = h.name;
        meta = h.currency;
        right = fmt(r.value);
      } else if (isFutures(cat)) {
        name = h.name || h.code;
        const lotTxt = `${h.lots > 0 ? "多" : "空"} ${Math.abs(h.lots)} 口`;
        meta =
          lotTxt +
          (r.price != null
            ? ` ・ 近月 ${r.price}${r.contract ? "（" + r.contract + "）" : ""}`
            : "");
        right = r.priceMissing
          ? '<span style="color:var(--muted)">待更新</span>'
          : fmt(r.value);
        if (!r.priceMissing) pnlHtml = pnlLine(r);
      } else {
        name = h.symbol;
        meta =
          `${h.shares} 股` +
          (r.price != null ? `<br>@ ${fmt(r.price, r.ccy)}` : "");
        right = r.priceMissing
          ? '<span style="color:var(--muted)">待更新</span>'
          : fmt(r.value);
        if (!r.priceMissing) pnlHtml = pnlLine(r);
      }
      html += `<div class="holding" data-id="${h.id}">
        <div class="h-left"><div class="h-name">${name}</div><div class="h-meta">${meta}</div></div>
        <div class="h-right"><div class="h-val">${right}</div>${pnlHtml}</div>
      </div>`;
    }
  }
  el.holdingsList.innerHTML = html;
  el.holdingsList
    .querySelectorAll(".holding")
    .forEach((node) =>
      node.addEventListener("click", () => openForm(node.dataset.id)),
    );
}

/* ---------- 表單 ---------- */
function openForm(id) {
  editingId = id || null;
  const h = id ? store.state.holdings.find((x) => x.id === id) : null;
  el.formTitle.textContent = h ? "編輯資產" : "新增資產";
  el.fDelete.style.display = h ? "block" : "none";
  ddType.set(h ? h.type : "us_stock", true);
  el.fSymbol.value = h && h.symbol ? h.symbol : "";
  el.fShares.value = h && h.shares != null ? h.shares : "";
  el.fAvgCost.value = h && h.avgCost != null ? h.avgCost : "";
  el.fName.value = h && h.name ? h.name : "";
  ddCurrency.set(h && h.currency ? h.currency : "TWD", true);
  el.fAmount.value = h && h.amount != null ? h.amount : "";
  // 期貨欄位
  selectedFut = h && isFutures(h.type) ? { code: h.code, name: h.name } : null;
  el.fFutSearch.value = "";
  el.fFutResults.innerHTML = "";
  renderFutSelected();
  el.fFutLots.value = h && h.lots != null ? h.lots : "";
  el.fFutMult.value = h && h.multiplier != null ? h.multiplier : "";
  el.fFutEntry.value = h && h.entryPrice != null ? h.entryPrice : "";
  el.fFutMargin.value = h && h.margin != null ? h.margin : "";
  syncFormFields();
  el.formModal.classList.add("show");
}

function renderFutSelected() {
  if (selectedFut) {
    el.fFutSelected.className = "fut-selected has";
    el.fFutSelected.innerHTML = `已選：${selectedFut.name}<span class="code">${selectedFut.code}</span>`;
  } else {
    el.fFutSelected.className = "fut-selected";
    el.fFutSelected.innerHTML = "";
  }
}

async function searchFut(q) {
  q = q.trim();
  if (!q) {
    el.fFutResults.innerHTML = "";
    return;
  }
  let list;
  try {
    list = await ensureFutInfo();
  } catch (e) {
    el.fFutResults.innerHTML =
      '<div class="hint">商品清單載入失敗，請確認網路</div>';
    return;
  }
  const ql = q.toUpperCase();
  const hits = list
    .filter((x) => x.name.includes(q) || x.code.toUpperCase().includes(ql))
    .slice(0, 20);
  el.fFutResults.innerHTML = hits.length
    ? hits
        .map(
          (x) =>
            `<div class="fut-result" data-code="${x.code}" data-name="${x.name}">${x.name}<span class="code">${x.code}</span></div>`,
        )
        .join("")
    : '<div class="hint">查無商品</div>';
  el.fFutResults.querySelectorAll(".fut-result").forEach((node) =>
    node.addEventListener("click", () => {
      selectedFut = { code: node.dataset.code, name: node.dataset.name };
      if (!el.fFutMult.value) {
        const m = suggestMultiplier(selectedFut.name);
        if (m) el.fFutMult.value = m;
      }
      el.fFutSearch.value = "";
      el.fFutResults.innerHTML = "";
      renderFutSelected();
    }),
  );
}

function closeForm() {
  el.formModal.classList.remove("show");
}

function syncFormFields() {
  const t = ddType.value;
  document.querySelector(".field-stock").style.display = isStock(t)
    ? "block"
    : "none";
  document.querySelector(".field-cash").style.display = isCash(t)
    ? "block"
    : "none";
  document.querySelector(".field-futures").style.display = isFutures(t)
    ? "block"
    : "none";
}

function saveForm() {
  const type = ddType.value;
  let h;
  if (isCash(type)) {
    const name = el.fName.value.trim();
    const amount = parseFloat(el.fAmount.value);
    if (!name || isNaN(amount)) return alert("請填寫帳戶名稱與金額");
    h = { type, name, currency: ddCurrency.value, amount };
  } else if (isFutures(type)) {
    if (!selectedFut) return alert("請先搜尋並選擇期貨商品");
    const lots = parseFloat(el.fFutLots.value);
    const multiplier = parseFloat(el.fFutMult.value);
    const entryPrice = parseFloat(el.fFutEntry.value);
    const margin = parseFloat(el.fFutMargin.value);
    if (isNaN(lots) || lots === 0) return alert("請填寫口數（做空填負數）");
    if (isNaN(multiplier) || isNaN(entryPrice) || isNaN(margin))
      return alert("請填寫乘數、進場價與保證金");
    h = {
      type,
      code: selectedFut.code,
      name: selectedFut.name,
      lots,
      multiplier,
      entryPrice,
      margin,
    };
  } else {
    const symbol = el.fSymbol.value.trim().toUpperCase();
    const shares = parseFloat(el.fShares.value);
    const avgRaw = el.fAvgCost.value.trim();
    if (!symbol || isNaN(shares)) return alert("請填寫股票代號與股數");
    h = {
      type,
      symbol,
      shares,
      avgCost: avgRaw === "" ? null : parseFloat(avgRaw),
    };
  }
  if (editingId) {
    h.id = editingId;
    const i = store.state.holdings.findIndex((x) => x.id === editingId);
    store.state.holdings[i] = h;
  } else {
    h.id = uid();
    store.state.holdings.push(h);
  }
  save();
  closeForm();
  render();
  if (!isCash(type)) refreshAll(); // 新增/編輯股票/期貨後自動抓一次報價
}

function deleteHolding() {
  if (!editingId) return;
  if (!confirm("確定刪除這筆資產？")) return;
  store.state.holdings = store.state.holdings.filter((x) => x.id !== editingId);
  save();
  closeForm();
  render();
}

/* ---------- 設定 / 備份 ---------- */
function openSettings() {
  el.settingsModal.classList.add("show");
}

function closeSettings() {
  el.settingsModal.classList.remove("show");
}

function exportData() {
  const blob = new Blob([JSON.stringify(store.state, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `asset-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.holdings) throw new Error("格式錯誤");
      store.state = data;
      if (!store.state.settings) store.state.settings = { defaultCcy: "TWD" };
      if (!store.state.cache)
        store.state.cache = { prices: {}, fxUSDTWD: null };
      store.displayCcy = store.state.settings.defaultCcy;
      save();
      setCcyButtons();
      render();
      alert("匯入成功");
    } catch (e) {
      alert("匯入失敗：" + e.message);
    }
  };
  reader.readAsText(file);
}

/* ---------- 幣別切換 ---------- */
function setCcyButtons() {
  el.ccyToggle
    .querySelectorAll("button")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.ccy === store.displayCcy),
    );
}

/* ---------- 事件綁定 ---------- */
el.fabAdd.addEventListener("click", () => openForm(null));
el.fCancel.addEventListener("click", closeForm);
el.fSave.addEventListener("click", saveForm);
el.fDelete.addEventListener("click", deleteHolding);
el.fFutSearch.addEventListener("input", (e) => searchFut(e.target.value));
el.refreshBtn.addEventListener("click", refreshAll);
el.settingsBtn.addEventListener("click", openSettings);
el.sClose.addEventListener("click", closeSettings);
el.sExport.addEventListener("click", exportData);
el.sImport.addEventListener("click", () => el.sImportFile.click());
el.sImportFile.addEventListener("change", (e) => {
  if (e.target.files[0]) importData(e.target.files[0]);
});
el.ccyToggle.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  store.displayCcy = b.dataset.ccy;
  store.state.settings.defaultCcy = store.displayCcy; // 記住選擇，重開沿用
  save();
  setCcyButtons();
  render();
});
// 點背景關閉彈窗
el.formModal.addEventListener("click", (e) => {
  if (e.target === el.formModal) closeForm();
});
el.settingsModal.addEventListener("click", (e) => {
  if (e.target === el.settingsModal) closeSettings();
});

/* ---------- 啟動 ---------- */
ddType = new Dropdown(
  "fType",
  CATS.map((t) => ({ value: t, label: TYPES[t].label })),
  syncFormFields,
);
ddCurrency = new Dropdown("fCurrency", [
  { value: "TWD", label: "TWD 台幣" },
  { value: "USD", label: "USD 美元" },
]);

renderIcons(); // 把 HTML 內的 data-icon 換成 Lucide SVG
setCcyButtons();
render();

// 開啟時若有股票/期貨且報價過期，自動更新一次
if (store.state.holdings.some((h) => !isCash(h.type))) {
  const stale =
    !store.state.cache.lastUpdate ||
    Date.now() - store.state.cache.lastUpdate > STALE_MS;
  if (stale) refreshAll();
}

// 註冊 Service Worker（PWA 離線）
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
