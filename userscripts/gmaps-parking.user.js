// ==UserScript==
// @name         Google Maps 附近停車場
// @namespace    https://github.com/charles0506/gmaps-parking
// @version      2.5
// @description  在 Google Maps 最上排加「🅿️ 停車場」分類鈕，一鍵搜尋目前視角附近的停車場；載入時預設開啟路況圖層；裸開 /maps 時定位在自訂住家（未設定則台灣全島）；「已儲存」清單每列加顯示/隱藏開關
// @homepageURL  https://github.com/charles0506/gmaps-parking
// @supportURL   https://github.com/charles0506/gmaps-parking/issues
// @updateURL    https://raw.githubusercontent.com/charles0506/gmaps-parking/main/gmaps-parking.user.js
// @downloadURL  https://raw.githubusercontent.com/charles0506/gmaps-parking/main/gmaps-parking.user.js
// @match        https://www.google.com/maps*
// @match        https://www.google.com.tw/maps*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @noframes
// @run-at       document-start
// ==/UserScript==

(() => {
  "use strict";

  const CHIP_ID = "gmp-parking-chip";
  const FAB_ID = "gmp-parking-btn";

  // 用來定位最上排分類鈕的現成標籤（zh-TW / en 都認）
  const SAMPLE_LABELS = ["餐廳", "飯店", "Restaurants", "Hotels"];

  // 按鈕文字前面帶 icon font 的私用區字元（如 U+E56C），比對前要剝掉
  const PUA_RE = new RegExp("[\\uE000-\\uF8FF]", "g");
  const cleanLabel = (s) => (s || "").replace(PUA_RE, "").trim();

  function currentView() {
    // Google Maps URL 內含 @lat,lng,zoom
    const m = location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)z/);
    if (!m) return null;
    return { lat: m[1], lng: m[2], zoom: m[3] };
  }

  // Maps URL 的路況圖層參數
  const TRAFFIC_DATA = "!5m1!1e1";

  function searchParking() {
    const v = currentView();
    const query = encodeURIComponent("停車場");
    const base = v
      ? `https://www.google.com/maps/search/${query}/@${v.lat},${v.lng},${v.zoom}z`
      : `https://www.google.com/maps/search/${query}`;
    location.assign(`${base}/data=${TRAFFIC_DATA}`);
  }

  // 載入時預設開路況：URL 補 data 參數後 replace 一次。
  // sessionStorage 記已做過，之後使用者自己關路況不會被強制開回來。
  // 注意：裸 /maps（還沒有 @lat,lng,zoom）掛 data= 會變 /maps/data=… 直接 404，
  // 所以沒座標時先不做也不標記，等 Maps 把座標寫進網址後由 mutation 迴圈再試。
  let trafficDone = false;
  function markTrafficDone() {
    trafficDone = true;
    try {
      sessionStorage.setItem("gmp-traffic-done", "1");
    } catch (e) {
      /* 隱私模式等情況拿不到 storage，就靠 trafficDone 撐這一頁 */
    }
  }
  function enableTraffic() {
    if (trafficDone) return;
    try {
      if (sessionStorage.getItem("gmp-traffic-done")) {
        trafficDone = true;
        return;
      }
    } catch (e) {}
    if (location.href.includes(TRAFFIC_DATA)) {
      markTrafficDone();
      return;
    }
    if (!/@-?\d+\.\d+,-?\d+\.\d+,/.test(location.pathname)) return; // 還沒座標，下輪再試
    markTrafficDone();
    const u = new URL(location.href);
    u.pathname = u.pathname.includes("/data=")
      ? u.pathname + TRAFFIC_DATA
      : u.pathname.replace(/\/$/, "") + "/data=" + TRAFFIC_DATA;
    location.replace(u.toString());
  }

  // 裸 /maps 開啟（沒指定地點）時固定落在住家視角，不讓 Google 依 IP 亂猜。
  // 住家座標只存在本機 userscript 儲存區（選單指令設定），不寫進原始碼；沒設定就用台灣全島。
  // 用 navigation entry 看「當初載入的網址」，因為 Maps 很快會把自己猜的座標寫進網址列。
  const TAIWAN_VIEW = "@23.7,120.96,8z";
  const HOME_KEY = "home_view";
  const VIEW_RE = /^@-?\d+\.\d+,-?\d+\.\d+,\d+(\.\d+)?z$/;

  function defaultView() {
    const saved = GM_getValue(HOME_KEY, "");
    return VIEW_RE.test(saved) ? saved : TAIWAN_VIEW;
  }

  GM_registerMenuCommand("📍 將目前視角設為住家", () => {
    const v = currentView();
    if (!v) {
      alert("讀不到目前地圖座標（街景或特殊模式），請切回一般地圖再設定。");
      return;
    }
    GM_setValue(HOME_KEY, `@${v.lat},${v.lng},${v.zoom}z`);
    alert("已設為住家。之後開 google.com/maps 會直接落在這個視角。");
  });
  GM_registerMenuCommand("🗑️ 清除住家（改回台灣全島）", () => {
    GM_deleteValue(HOME_KEY);
    alert("已清除住家設定。");
  });
  const HARMLESS_PARAMS = ["authuser", "hl", "entry", "g_ep", "ved", "tab"];
  function redirectBareToTaiwan() {
    let initial;
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      initial = new URL(nav && nav.name ? nav.name : location.href);
    } catch (e) {
      initial = new URL(location.href);
    }
    if (!/^\/maps\/?$/.test(initial.pathname)) return false;
    // 帶 ?q= / ?ll= 這類參數代表有指定目的地，不干涉
    for (const key of initial.searchParams.keys()) {
      if (!HARMLESS_PARAMS.includes(key)) return false;
    }
    const u = new URL(location.href);
    u.pathname = `/maps/${defaultView()}/data=${TRAFFIC_DATA}`;
    u.search = initial.search;
    u.hash = "";
    location.replace(u.toString());
    return true;
  }


  // ───────── 已儲存清單：每列加「顯示在地圖上」開關 ─────────
  // 原生要「⋮ → 不顯示在你的地圖上」點兩下，這裡直接在列上放一顆開關。
  // 做法：點開關時代點那顆 ⋮、在選單裡找「(不)顯示在你的地圖上」點下去；
  // 初次看到清單時用「隱形選單」探一次目前狀態，結果存本機，之後直接顯示。
  const TOGGLE_CLS = "gmp-list-toggle";
  const PROBING_CLS = "gmp-probing";
  const STATE_KEY = "list_visibility"; // { 清單名稱: true(顯示)/false(隱藏) }
  // 「私人·1,308 個地點」「Private · 40 places」
  const COUNT_RE = /^(私人|公開|共用|已共用|Private|Public|Shared)?\s*[·・•]?\s*[\d,]+\s*(個地點|places?)$/i;
  const SHOW_ITEM_RE = /顯示在你的地圖上|顯示在地圖上|(show|hide).*(on|in) your map/i;
  const HIDE_WORD_RE = /不顯示|隱藏|hide|don.?t show/i; // 選單寫「不顯示」= 目前是顯示中

  let listState = {};
  try {
    listState = JSON.parse(GM_getValue(STATE_KEY, "{}")) || {};
  } catch (e) {}
  const saveState = () => GM_setValue(STATE_KEY, JSON.stringify(listState));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout = 1500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(50);
    }
    return null;
  }
  const findShowItem = () =>
    [...document.querySelectorAll('[role^="menuitem"], [role="option"]')].find(
      (el) => el.offsetParent !== null && SHOW_ITEM_RE.test(cleanLabel(el.textContent))
    );
  function closeMenu() {
    const ev = { key: "Escape", code: "Escape", keyCode: 27, bubbles: true };
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", ev));
    document.dispatchEvent(new KeyboardEvent("keydown", ev));
  }

  // 一次只操作一個選單，排隊執行
  let queue = Promise.resolve();
  const enqueue = (job) => (queue = queue.then(job, job));

  // 開 ⋮ 選單讀狀態；doToggle=true 時順便點下去切換。回傳切換後（或目前）是否顯示。
  function operate(row, doToggle) {
    return enqueue(async () => {
      if (!row.menuBtn.isConnected) return null;
      const silent = !doToggle;
      if (silent) document.documentElement.classList.add(PROBING_CLS);
      try {
        row.menuBtn.click();
        const item = await waitFor(findShowItem);
        if (!item) {
          closeMenu();
          return null;
        }
        const visibleNow = HIDE_WORD_RE.test(cleanLabel(item.textContent));
        if (!doToggle) {
          closeMenu();
          await waitFor(() => !findShowItem(), 800);
          return visibleNow;
        }
        item.click();
        await waitFor(() => !findShowItem(), 800);
        return !visibleNow;
      } finally {
        if (silent) document.documentElement.classList.remove(PROBING_CLS);
      }
    });
  }

  function paint(btn, visible) {
    btn.dataset.state = visible == null ? "unknown" : visible ? "on" : "off";
    btn.title =
      visible == null ? "點一下切換是否顯示在地圖上"
      : visible ? "目前顯示在地圖上，點一下隱藏" : "目前未顯示，點一下顯示在地圖上";
    btn.setAttribute("aria-pressed", visible ? "true" : "false");
  }

  let toggleStyleDone = false;
  function injectToggleStyle() {
    if (toggleStyleDone) return;
    toggleStyleDone = true;
    const st = document.createElement("style");
    st.textContent = `
      .${TOGGLE_CLS} {
        flex: none; align-self: center; position: relative; width: 36px; height: 20px;
        margin: 0 4px; padding: 0; border: none; border-radius: 10px; cursor: pointer;
        background: #bdc1c6; transition: background .15s; vertical-align: middle;
      }
      .${TOGGLE_CLS}::after {
        content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
        border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3);
        transition: left .15s;
      }
      .${TOGGLE_CLS}[data-state="on"] { background: #1a73e8; }
      .${TOGGLE_CLS}[data-state="on"]::after { left: 18px; }
      .${TOGGLE_CLS}[data-state="unknown"] { background: #dadce0; }
      .${TOGGLE_CLS}[data-busy] { opacity: .5; cursor: progress; }
      html.${PROBING_CLS} [role="menu"], html.${PROBING_CLS} [role="listbox"] {
        opacity: 0 !important; pointer-events: none !important;
      }`;
    document.head.appendChild(st);
  }

  // 由「N 個地點」那行往上找：第一個包含「另一顆按鈕」（⋮）的祖先就是整列
  function findRow(countEl) {
    let node = countEl;
    for (let i = 0; i < 7 && node.parentElement; i++) {
      node = node.parentElement;
      const btns = [...node.querySelectorAll("button, [role='button']")].filter(
        (b) => !b.contains(countEl) && !b.classList.contains(TOGGLE_CLS)
      ); // ⋮ 可能 hover 才出現（display:none），所以不檢查寬度
      if (btns.length) {
        // 同一容器若混到別列就放棄（避免一顆開關控到別的清單）
        const counts = [...node.querySelectorAll("*")].filter(
          (el) => !el.children.length && COUNT_RE.test(el.textContent.trim())
        );
        if (counts.length > 1) return null;
        return { container: node, menuBtn: btns[btns.length - 1] };
      }
    }
    return null;
  }

  // 清單名稱：count 那行的前一個有字的葉節點
  function listName(countEl, container) {
    const leaves = [...container.querySelectorAll("*")].filter(
      (el) => !el.children.length && cleanLabel(el.textContent)
    );
    const i = leaves.indexOf(countEl);
    return i > 0 ? cleanLabel(leaves[i - 1].textContent) : "";
  }

  // 使用者自己用 ⋮ 選單切換時也同步開關狀態
  let lastMenuRow = null;
  document.addEventListener(
    "click",
    (e) => {
      if (document.documentElement.classList.contains(PROBING_CLS)) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      for (const row of rows) {
        if (row.menuBtn.contains(t)) {
          lastMenuRow = row;
          return;
        }
      }
      const item = t.closest('[role^="menuitem"], [role="option"]');
      if (item && lastMenuRow && SHOW_ITEM_RE.test(cleanLabel(item.textContent)) && e.isTrusted) {
        const v = !HIDE_WORD_RE.test(cleanLabel(item.textContent));
        const r = lastMenuRow;
        listState[r.name] = v;
        saveState();
        paint(r.btn, v);
      }
    },
    true
  );

  const rows = new Set();
  let lastScan = 0;
  function ensureListToggles() {
    // Maps DOM 變動極頻繁，掃描節流到 400ms 一次
    const now = Date.now();
    if (now - lastScan < 400) {
      clearTimeout(ensureListToggles.t);
      ensureListToggles.t = setTimeout(ensureListToggles, 450);
      return;
    }
    lastScan = now;
    for (const row of rows) if (!row.btn.isConnected) rows.delete(row);
    const counts = [...document.querySelectorAll("div, span")].filter(
      (el) => !el.children.length && COUNT_RE.test(el.textContent.trim())
    );
    for (const countEl of counts) {
      const found = findRow(countEl);
      if (!found || found.container.querySelector("." + TOGGLE_CLS)) continue;
      injectToggleStyle();
      const name = listName(countEl, found.container) || countEl.textContent.trim();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = TOGGLE_CLS;
      const row = { name, btn, menuBtn: found.menuBtn };
      rows.add(row);
      paint(btn, listState[name]);
      btn.addEventListener(
        "click",
        async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (btn.dataset.busy) return;
          btn.dataset.busy = "1";
          const v = await operate(row, true);
          delete btn.dataset.busy;
          if (v == null) {
            btn.title = "找不到「顯示在你的地圖上」選項，請改用 ⋮ 選單";
            return;
          }
          listState[name] = v;
          saveState();
          paint(btn, v);
        },
        true
      );
      // 擋掉 mousedown/pointerdown，避免觸發外層「開啟清單」
      ["mousedown", "pointerdown", "mouseup", "pointerup"].forEach((t) =>
        btn.addEventListener(t, (e) => e.stopPropagation(), true)
      );
      found.menuBtn.parentElement.insertBefore(btn, found.menuBtn);
      // 沒記錄過的清單，靜默探一次真實狀態
      if (!(name in listState)) {
        operate(row, false).then((v) => {
          if (v == null) return;
          listState[name] = v;
          saveState();
          paint(btn, v);
        });
      }
    }
  }

  GM_registerMenuCommand("🔄 重新讀取清單顯示狀態", () => {
    listState = {};
    saveState();
    for (const row of rows) row.btn.remove();
    rows.clear();
    ensureListToggles();
  });

  function onChipClick(e) {
    e.preventDefault();
    e.stopPropagation();
    searchParking();
  }

  // 複製一顆原生分類鈕當模板，外觀就跟最上排一致
  function injectChip() {
    // 頁面有多組分類鈕（頂列 + 摺疊列），取畫面最上方且可見那組
    let sample = null;
    let bestY = Infinity;
    for (const b of document.querySelectorAll("button")) {
      if (!SAMPLE_LABELS.includes(cleanLabel(b.textContent))) continue;
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.y < bestY) {
        bestY = r.y;
        sample = b;
      }
    }
    if (!sample || !sample.parentElement || !sample.parentElement.parentElement)
      return false;

    // 每顆 chip 外面包一層 wrapper div，要複製整包插進容器才不會跑版
    const wrap = sample.parentElement.cloneNode(true);
    const chip = wrap.querySelector("button") || wrap;
    chip.id = CHIP_ID;
    chip.title = "搜尋附近停車場";
    // 拔掉 Maps 原生事件掛勾，點擊才不會被它自己的 handler 吃掉
    [wrap, ...wrap.querySelectorAll("[jsaction]")].forEach((el) =>
      el.removeAttribute("jsaction")
    );
    wrap.querySelectorAll("img, svg").forEach((el) => el.remove());

    const leaves = [...chip.querySelectorAll("*")].filter(
      (el) => !el.children.length && el.textContent.trim()
    );
    (leaves[leaves.length - 1] || chip).textContent = "🅿️ 停車場";

    chip.addEventListener("click", onChipClick, true);
    sample.parentElement.parentElement.insertBefore(
      wrap,
      sample.parentElement
    );
    return true;
  }

  // 找不到最上排時的退路：浮動鈕（樣式一次性注入）
  let fabStyleDone = false;
  function injectFab() {
    if (!fabStyleDone) {
      fabStyleDone = true;
      const st = document.createElement("style");
      st.textContent = `
        #${FAB_ID} {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          z-index: 9999; padding: 10px 18px; border: none; border-radius: 24px;
          background: #1a73e8; color: #fff; font-size: 15px; font-weight: 500;
          font-family: Roboto, "Microsoft JhengHei", sans-serif; cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
        }
        #${FAB_ID}:hover { background: #1765cc; }`;
      document.head.appendChild(st);
    }
    const btn = document.createElement("button");
    btn.id = FAB_ID;
    btn.type = "button";
    btn.title = "搜尋附近停車場";
    btn.textContent = "🅿️ 附近停車場";
    btn.addEventListener("click", searchParking);
    document.body.appendChild(btn);
  }

  function ensure() {
    // 快速路徑：按鈕還掛在 DOM 上就什麼都不做（Maps mutation 極頻繁）
    const chip = document.getElementById(CHIP_ID);
    if (chip && chip.isConnected) return;

    if (injectChip()) {
      document.getElementById(FAB_ID)?.remove();
    } else if (!document.getElementById(FAB_ID)) {
      injectFab();
    }
  }

  // Maps 是 SPA 且 DOM 狂變：rAF 節流 + 上面的快速路徑，避免每次 mutation 掃全頁
  let scheduled = false;
  function onMutate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enableTraffic(); // 裸 /maps 載入時要等座標進網址才補路況參數
      ensure();
      ensureListToggles();
    });
  }

  function init() {
    enableTraffic();
    ensure();
    ensureListToggles();
    new MutationObserver(onMutate).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (redirectBareToTaiwan()) return;
  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
})();
