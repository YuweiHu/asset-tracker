/* ===== 期貨計算機：保證金追繳計算機（依投入金額）=====
 * 選期貨（帶入現價、乘數、期交所原始/維持保證金）→ 設定你要放的保證金 →
 * 算「價格走到多少，權益會跌破維持保證金 → 收到 margin call」。
 *
 * 真實模型：
 *   名目價值 = 成本價 × 乘數 × 口數
 *   權益 = 投入保證金(D) + 未實現損益；　損益(做多) = (現價 − 成本價) × 乘數 × 口數
 *   維持保證金(M)：期交所固定 → 指數類 = 每口金額 × 口數；個股 = 維持比例 × 名目
 *   追繳(margin call)：權益 < M → 下跌量 = (D − M) / (乘數×口數)
 *   強平/歸零：權益 = 0 → 下跌量 = D / (乘數×口數)
 *   有效槓桿 = 名目 / 投入
 *   做多向下、做空向上。
 */
import { el } from "./dom.js";
import { ensureFutInfo, suggestMultiplier, fetchFuturesPrice } from "./api.js";
import { SYNC_API } from "./config.js";

let selectedFut = null; // {code,name}
let dir = "long"; // long | short
let marginData = null; // 期交所保證金一覽（抓一次後快取）
let mInfo = null; // 目前選定商品的保證金規格 {kind, initRate/maintRate | initial/maintenance}

function fmtNum(n) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtTwd(n) {
  return "NT$" + Math.round(n).toLocaleString("en-US");
}
function fmtMarginDate(s) {
  return s && s.length === 8 ? `${+s.slice(4, 6)}/${+s.slice(6, 8)}` : "";
}

function clearResult() {
  el.fcCallPrice.textContent = "—";
  el.fcCallDist.textContent = "";
  el.fcLiqPrice.textContent = "—";
  el.fcLiqDist.textContent = "—";
  el.fcEffLev.textContent = "—";
  el.fcMaintShow.textContent = "—";
  el.fcInitShow.textContent = "—";
}

function compute() {
  const entry = parseFloat(el.fcEntry.value);
  const lots = parseFloat(el.fcLots.value) || 1;
  const mult = parseFloat(el.fcMult.value);
  const D = parseFloat(el.fcDeposit.value);
  const long = dir === "long";
  const word = long ? "下跌" : "上漲";
  const s = long ? -1 : 1;

  if (!(entry > 0) || !(mult > 0) || !(lots > 0)) {
    clearResult();
    return;
  }
  const perPt = mult * lots; // 每點損益
  const notional = entry * perPt;

  // 維持 / 原始保證金（取自期交所；未選商品則未知）
  let M = null,
    init = null;
  if (mInfo) {
    if (mInfo.kind === "stock") {
      init = mInfo.initRate * notional;
      M = mInfo.maintRate * notional;
    } else {
      init = mInfo.initial * lots;
      M = mInfo.maintenance * lots;
    }
    el.fcInitShow.textContent = fmtTwd(init);
    el.fcMaintShow.textContent = fmtTwd(M);
  } else {
    el.fcInitShow.textContent = "—（選商品）";
    el.fcMaintShow.textContent = "—（選商品）";
  }

  el.fcEffLev.textContent = D > 0 ? (notional / D).toFixed(2) + "x" : "—";

  if (!(D > 0)) {
    el.fcCallPrice.textContent = "—";
    el.fcCallDist.textContent = "請填投入保證金";
    el.fcLiqPrice.textContent = "—";
    el.fcLiqDist.textContent = "—";
    return;
  }

  // 強平 / 歸零（只需投入）
  const liqDrop = D / perPt;
  el.fcLiqPrice.textContent = fmtNum(entry + s * liqDrop);
  el.fcLiqDist.textContent = `${word} ${fmtNum(liqDrop)} 點（${((liqDrop / entry) * 100).toFixed(2)}%）`;

  // 追繳（需維持保證金）
  if (M == null) {
    el.fcCallPrice.textContent = "—";
    el.fcCallDist.textContent = "選期貨商品以取得維持保證金";
    return;
  }
  const callDrop = (D - M) / perPt;
  if (callDrop <= 0) {
    el.fcCallPrice.textContent = fmtNum(entry);
    el.fcCallDist.textContent = "投入已低於維持保證金，等同立即追繳";
  } else {
    el.fcCallPrice.textContent = fmtNum(entry + s * callDrop);
    el.fcCallDist.textContent = `${word} ${fmtNum(callDrop)} 點（${((callDrop / entry) * 100).toFixed(2)}%）`;
  }
}

/* ---------- 期交所保證金（經 Worker 代理 + 快取）---------- */
async function ensureMargins() {
  if (marginData) return marginData;
  try {
    const res = await fetch(SYNC_API + "/margins");
    if (!res.ok) throw new Error("HTTP " + res.status);
    marginData = await res.json();
    return marginData;
  } catch (e) {
    return null;
  }
}

// 依 FinMind 商品 {name,code} 對應 TAIFEX 保證金（個股比代碼/名稱、指數比名稱）
function findMargin(md, name, code) {
  if (md.stock[code]) return { kind: "stock", ...md.stock[code] };
  for (const v of Object.values(md.stock))
    if (v.name === name) return { kind: "stock", ...v };
  if (md.index[name]) return { kind: "index", ...md.index[name] };
  const stripped = name.replace(/期貨$/, "");
  if (md.index[stripped]) return { kind: "index", ...md.index[stripped] };
  for (const k of Object.keys(md.index))
    if (name.includes(k)) return { kind: "index", ...md.index[k] };
  return null;
}

// 選到商品後：記住保證金規格、預設投入＝原始保證金、顯示期交所數值
async function applyMargin(name, code) {
  el.fcMarginInfo.textContent = "查詢期交所保證金中…";
  const md = await ensureMargins();
  if (!md) {
    mInfo = null;
    el.fcMarginInfo.textContent = "期交所保證金查詢失敗（仍可手動填投入，只算強平價）";
    return;
  }
  const hit = findMargin(md, name, code);
  if (!hit) {
    mInfo = null;
    el.fcMarginInfo.textContent = "查無此商品的期交所保證金（手動模式）";
    return;
  }
  mInfo = hit;
  const d = fmtMarginDate(md.date);
  const lots = parseFloat(el.fcLots.value) || 1;
  const entry = parseFloat(el.fcEntry.value);
  const mult = parseFloat(el.fcMult.value);
  let init;
  if (hit.kind === "stock") {
    init = hit.initRate * entry * mult * lots;
    el.fcMarginInfo.textContent = `期交所 ${d}｜原始 ${(hit.initRate * 100).toFixed(2)}%・維持 ${(hit.maintRate * 100).toFixed(2)}%・${hit.level}`;
  } else {
    init = hit.initial * lots;
    el.fcMarginInfo.textContent = `期交所 ${d}｜原始 ${fmtTwd(hit.initial)}・維持 ${fmtTwd(hit.maintenance)}（每口）`;
  }
  el.fcDeposit.value = Math.round(init); // 預設投入＝原始保證金（最低門檻）
}

/* ---------- 商品搜尋（沿用資產表單的樣式）---------- */
async function searchFut(q) {
  q = q.trim();
  if (!q) {
    el.fcFutResults.innerHTML = "";
    return;
  }
  let list;
  try {
    list = await ensureFutInfo();
  } catch (e) {
    el.fcFutResults.innerHTML =
      '<div class="hint">商品清單載入失敗，請確認網路</div>';
    return;
  }
  const ql = q.toUpperCase();
  const hits = list
    .filter((x) => x.name.includes(q) || x.code.toUpperCase().includes(ql))
    .slice(0, 20);
  el.fcFutResults.innerHTML = hits.length
    ? hits
        .map(
          (x) =>
            `<div class="fut-result" data-code="${x.code}" data-name="${x.name}">${x.name}<span class="code">${x.code}</span></div>`,
        )
        .join("")
    : '<div class="hint">查無商品</div>';
  el.fcFutResults.querySelectorAll(".fut-result").forEach((node) =>
    node.addEventListener("click", () => selectFut(node.dataset.code, node.dataset.name)),
  );
}

async function selectFut(code, name) {
  selectedFut = { code, name };
  el.fcFutSelected.className = "fut-selected has";
  el.fcFutSelected.innerHTML = `已選：${name}<span class="code">${code}</span>`;
  el.fcFutSearch.value = "";
  el.fcFutResults.innerHTML = "";
  // 乘數：依商品帶入（覆蓋）
  const m = suggestMultiplier(name);
  if (m) el.fcMult.value = m;
  // 現價 → 帶入成本價（覆蓋）
  el.fcCurPrice.textContent = "查詢現價中…";
  try {
    const p = await fetchFuturesPrice(code);
    el.fcCurPrice.textContent = `近月現價 ${fmtNum(p.price)}${p.contract ? "（" + p.contract + "）" : ""}`;
    el.fcEntry.value = p.price;
  } catch (e) {
    el.fcCurPrice.textContent = "現價查詢失敗（可手動輸入成本價）";
  }
  await applyMargin(name, code); // 記住規格、帶入投入＝原始保證金
  compute(); // 一定重算下方結果
}

export function initFutures() {
  el.fcLots.value = el.fcLots.value || "1";

  el.fcFutSearch.addEventListener("input", (e) => searchFut(e.target.value));

  el.fcDir.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    dir = b.dataset.dir;
    el.fcDir
      .querySelectorAll("button")
      .forEach((x) => x.classList.toggle("active", x === b));
    compute();
  });

  // 任一輸入變動即時重算
  [el.fcEntry, el.fcLots, el.fcMult, el.fcDeposit].forEach((input) =>
    input.addEventListener("input", compute),
  );

  compute();
}
