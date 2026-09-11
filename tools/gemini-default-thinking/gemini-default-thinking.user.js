// ==UserScript==
// @name         Gemini 預設延伸思考（Default Thinking Mode）
// @name:en      Gemini Default Thinking Mode
// @namespace    https://github.com/charles0506/newsnow
// @version      1.2.0
// @description  每次開新對話自動把 gemini.google.com 切成「延伸思考」模式，並讓左側選單預設展開；可選擇一併鎖定預設模型。內建安全檢查，狀態判斷不出來時寧可不動作，絕不會把已開啟的功能反向關掉。
// @description:en Automatically enables Gemini's "Thinking" mode and keeps the left sidebar expanded, with optional model lock.
// @author       charles0506
// @match        https://gemini.google.com/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4IiB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iIzQyODVGNCIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjQ1JSIgc3RvcC1jb2xvcj0iIzlCNzJDQiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNEOTY1NzAiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHg9IjQiIHk9IjQiIHdpZHRoPSIxMjAiIGhlaWdodD0iMTIwIiByeD0iMjgiIGZpbGw9InVybCgjZykiLz4KICA8cGF0aCBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9Ii45NSIKICAgICAgICBkPSJNNjQgMjZjMi42IDE0LjcgMTAuNyAyMi44IDI1LjQgMjUuNEM3NC43IDU0IDY2LjYgNjIuMSA2NCA3Ni44IDYxLjQgNjIuMSA1My4zIDU0IDM4LjYgNTEuNCA1My4zIDQ4LjggNjEuNCA0MC43IDY0IDI2eiIvPgogIDxjaXJjbGUgY3g9IjkzIiBjeT0iOTMiIHI9IjI0IiBmaWxsPSIjZmZmIi8+CiAgPHBhdGggZD0iTTgyIDkzLjVsNy41IDcuNUwxMDUgODUiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzFhNzNlOCIgc3Ryb2tlLXdpZHRoPSI3IgogICAgICAgIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgogIDxjaXJjbGUgY3g9IjQxIiBjeT0iOTIiIHI9IjciIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjkiLz4KICA8Y2lyY2xlIGN4PSIyNiIgY3k9IjEwNCIgcj0iNCIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIuNyIvPgo8L3N2Zz4K
// @downloadURL  https://raw.githubusercontent.com/charles0506/newsnow/refs/heads/claude/confident-wright-2vek02/tools/gemini-default-thinking/gemini-default-thinking.user.js
// @updateURL    https://raw.githubusercontent.com/charles0506/newsnow/refs/heads/claude/confident-wright-2vek02/tools/gemini-default-thinking/gemini-default-thinking.user.js
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  /* ─────────────────────────── 設定（也可用 Tampermonkey 選單修改）─────────────────────────── */
  const CFG = {
    enabled:       () => GM_getValue('enabled', true),          // 總開關
    model:         () => GM_getValue('model', ''),              // 想鎖定的模型，例如 "3.1 Pro"；空字串＝不動模型
    sidebar:       () => GM_getValue('sidebar', true),          // 左側選單預設展開
    navWidth:      () => GM_getValue('navWidth', 0),            // 側欄寬度（px）；0 ＝跟隨 Gemini 預設
    resizer:       () => GM_getValue('resizer', true),          // 側欄右緣可拖曳調寬
    sections:      () => GM_getValue('sections', []),           // 要預設收合的側欄區塊標題
    sectionUI:     () => GM_getValue('sectionUI', true),        // 在區塊標題旁注入摺疊箭頭
    toast:         () => GM_getValue('toast', true),            // 右下角提示
    debug:         () => GM_getValue('debug', false),           // 主控台除錯訊息
  };

  // 「延伸思考」在不同語系／版本的字樣。要新增自己的語系，往這裡加就好。
  const THINKING_LABELS = [
    '延伸思考', '延展思考', '深度思考', '思考模式',
    'thinking', 'extended thinking', 'deep think',
  ];
  // 上方那顆膠囊按鈕（例如截圖中的「Flash 延伸」）只要出現這些字，就代表思考模式已開 → 直接跳過，不開選單、不閃畫面。
  const PILL_HINTS = ['延伸', '延展', '深度思考', '思考', 'thinking'];

  const SWITCHER_SELECTORS = [
    'button.gds-mode-switch-button',
    'bard-mode-switcher button',
    '[data-test-id="bard-mode-menu-button"]',
    'button[aria-haspopup="menu"] .logo-pill-label-container',
    'button[aria-haspopup="true"] .logo-pill-label-container',
  ];
  const PILL_SELECTORS = [
    'button.gds-mode-switch-button .logo-pill-label-container',
    'bard-mode-switcher [data-test-id="attribution-text"]',
    '.current-mode-title',
    'button.gds-mode-switch-button',
  ];
  const MENU_SELECTORS = ['.mat-mdc-menu-panel', '.mat-mdc-menu-content', '[role="menu"]'];
  const ITEM_SELECTORS = ['[role="menuitemradio"]', '[role="menuitemcheckbox"]', '[role="menuitem"]', 'button.mat-mdc-menu-item', '.mat-mdc-menu-item'];

  // 左側選單（側欄）
  const SIDENAV_SELECTORS = ['bard-sidenav', 'mat-sidenav', '[data-test-id="side-nav"]', '.side-nav-container'];
  const MENU_WORDS = ['主選單', '主菜單', '主菜单', '選單', '菜单', '導覽', '导航', 'main menu', 'menu', 'navigation'];
  const SIDEBAR_MIN_WINDOW = 1000;   // 視窗比這窄時側欄是浮動遮罩，展開反而擋內容 → 不動作
  const SIDEBAR_RAIL_MAX = 140;      // 收合狀態的窄軌大約 72px，展開約 260px 以上
  const NAV_W_MIN = 200, NAV_W_MAX = 560;
  // 可摺疊的側欄區塊標題（完全相符才算，避免誤判對話標題）
  const SECTION_TITLES = ['筆記本', '筆記本清單', 'Notebooks', 'Gem', 'Gems', '近期對話', '最近的對話', 'Recent', 'Recent chats'];

  const TIMING = { boot: 1200, afterOpen: 500, afterClick: 900, betweenSteps: 700, poll: 150, timeout: 8000 };

  /* ────────────────────────────────── 小工具 ────────────────────────────────── */
  const log  = (...a) => CFG.debug() && console.log('%c[Gemini 延伸思考]', 'color:#9B72CB;font-weight:bold', ...a);
  const warn = (...a) => console.warn('[Gemini 延伸思考]', ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const hasAny = (text, words) => { const t = norm(text); return !!t && words.some(w => t.includes(norm(w))); };

  function qsAny(selectors, root = document) {
    for (const sel of selectors) { const el = root.querySelector(sel); if (el) return el; }
    return null;
  }
  // 取「所有選擇器的聯集」而不是第一個命中的（模型列與思考列的 role 可能不同，只取第一個會漏掉）
  function qsaUnion(selectors, root = document) {
    const set = new Set();
    for (const sel of selectors) root.querySelectorAll(sel).forEach(el => set.add(el));
    const all = [...set];
    // 若外層容器與內層按鈕同時命中，只留最內層，避免同一列被算兩次
    return all.filter(el => !all.some(o => o !== el && el.contains(o)));
  }
  const visible = el => !!el && !!el.offsetParent && el.getClientRects().length > 0;

  async function waitFor(fn, timeout = TIMING.timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(TIMING.poll); }
    return null;
  }

  /* ────────────────────────────── 讀取目前狀態 ────────────────────────────── */
  function getSwitcher() {
    for (const sel of SWITCHER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) { const btn = el.closest('button') || el; if (visible(btn)) return btn; }
    }
    return null;
  }
  function getPillText() {
    for (const sel of PILL_SELECTORS) { const el = document.querySelector(sel); if (el) return el.textContent || ''; }
    return '';
  }
  const pillSaysThinking = () => hasAny(getPillText(), PILL_HINTS);

  // 判斷選單項目是否「已勾選」。多重來源，寧可保守。
  function isChecked(item) {
    const aria = item.getAttribute('aria-checked') || item.getAttribute('aria-selected') || item.getAttribute('aria-pressed');
    if (aria === 'true') return true;
    if (aria === 'false') return false;
    if (/\b(mat-mdc-menu-item-checked|mdc-list-item--selected|is-selected|selected|checked|active)\b/.test(item.className || '')) return true;
    if (item.querySelector('mat-icon[data-mat-icon-name="check"], mat-icon[fonticon="check"], [data-test-id="checkmark"], .checkmark')) return true;
    for (const ic of item.querySelectorAll('mat-icon, .material-symbols-outlined, .google-symbols, .material-icons')) {
      const t = norm(ic.textContent);
      if (t === 'check' || t === 'done' || t === 'check_small') return true;
    }
    return false;
  }
  const itemLabel = item => (item.innerText || item.textContent || '').replace(/\s+/g, ' ').trim();

  /* ────────────────────────────── 選單操作 ────────────────────────────── */
  async function openMenu() {
    const btn = getSwitcher();
    if (!btn) { log('找不到模型切換按鈕'); return null; }
    if (qsAny(MENU_SELECTORS)) return qsAny(MENU_SELECTORS);   // 已經開著
    btn.click();
    const menu = await waitFor(() => { const m = qsAny(MENU_SELECTORS); return m && visible(m) ? m : null; }, 3000);
    if (menu) await sleep(TIMING.afterOpen);
    return menu;
  }
  async function closeMenu() {
    if (!qsAny(MENU_SELECTORS)) return;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(250);
    if (qsAny(MENU_SELECTORS)) document.body.click();
  }
  function menuItems(menu) {
    return qsaUnion(ITEM_SELECTORS, menu).filter(el => itemLabel(el).length > 0);
  }

  /* ────────────────────────────── 主流程 ────────────────────────────── */
  const state = { scope: null, done: false, busy: false, userOverride: false, sidebarOverride: false, lastPill: '', lastNavW: 0 };

  function scopeOf() {
    const m = location.pathname.match(/\/app\/([^/?#]+)/);
    return m ? m[1] : 'new';
  }

  /* ───────────────────────── 左側選單預設展開 ───────────────────────── */
  function getSidenav() {
    for (const sel of SIDENAV_SELECTORS) { const el = document.querySelector(sel); if (el) return el; }
    return null;
  }
  function sidenavState() {
    const nav = getSidenav();
    if (!nav) return 'unknown';
    const cls = nav.className || '';
    if (/\b(collapsed|is-collapsed|closed)\b/.test(cls)) return 'collapsed';
    const w = nav.getBoundingClientRect().width;
    if (w === 0) return 'hidden';                       // 窄視窗的浮動遮罩模式
    return w < SIDEBAR_RAIL_MAX ? 'collapsed' : 'expanded';
  }
  function findSidenavToggle() {
    const byId = document.querySelector('[data-test-id="side-nav-menu-button"]');
    if (byId) { const b = byId.closest('button') || byId.querySelector('button') || byId; if (visible(b)) return b; }
    for (const b of document.querySelectorAll('button')) {
      if (!visible(b) || b.getAttribute('aria-haspopup') || b.closest('bard-mode-switcher')) continue;   // 別誤點模型選單
      const hasMenuIcon = !!b.querySelector('mat-icon[data-mat-icon-name="menu"], mat-icon[fonticon="menu"]')
        || [...b.querySelectorAll('mat-icon, .material-symbols-outlined, .google-symbols, .material-icons')]
             .some(i => norm(i.textContent) === 'menu');
      const label = norm(b.getAttribute('aria-label') || '');
      if (hasMenuIcon || (label && MENU_WORDS.some(w => label.includes(norm(w))))) return b;
    }
    return null;
  }
  async function ensureSidebarExpanded() {
    if (!CFG.sidebar() || state.sidebarOverride) return 'off';
    if (window.innerWidth < SIDEBAR_MIN_WINDOW) { log('視窗太窄，側欄維持原樣'); return 'narrow'; }

    const before = sidenavState();
    if (before === 'expanded') { log('側欄已展開'); return 'already'; }
    if (before === 'unknown') { log('找不到側欄元素，略過'); return 'unknown'; }

    const btn = findSidenavToggle();
    if (!btn) { log('找不到側欄開關按鈕，略過（不亂點）'); return 'nobutton'; }

    const beforeW = getSidenav().getBoundingClientRect().width;
    log('展開側欄，點擊：', norm(btn.getAttribute('aria-label') || btn.textContent));
    btn.click();
    await sleep(600);
    const afterW = getSidenav() ? getSidenav().getBoundingClientRect().width : 0;
    if (afterW > beforeW) return 'clicked';
    // 沒變寬甚至更窄 → 可能點錯或方向相反，點回去還原，然後放棄
    if (afterW < beforeW) { warn('側欄反而變窄，還原並放棄。'); btn.click(); await sleep(300); }
    return 'failed';
  }

  /* ───────────────────── 側欄寬度：自訂 + 拖曳調整 ───────────────────── */
  const clampW = w => Math.min(NAV_W_MAX, Math.max(NAV_W_MIN, Math.round(w)));

  function applyNavWidth() {
    const want = CFG.navWidth();
    const id = 'gdt-nav-width';
    let style = document.getElementById(id);
    // 只有在側欄「展開」時才套用，收合的窄軌不能被撐開
    const ok = want && sidenavState() === 'expanded';
    if (!ok) { if (style) style.remove(); return; }
    const w = clampW(want);
    if (!style) { style = document.createElement('style'); style.id = id; (document.head || document.documentElement).appendChild(style); }
    const css = `bard-sidenav, bard-sidenav > .sidenav-container, bard-sidenav mat-sidenav, mat-sidenav.mat-drawer {
      width: ${w}px !important; min-width: ${w}px !important; max-width: ${w}px !important; }`;
    if (style.textContent !== css) style.textContent = css;
  }

  function installResizer() {
    if (!CFG.resizer() || document.getElementById('gdt-resizer')) return;
    const nav = getSidenav();
    if (!nav || sidenavState() !== 'expanded') return;

    const bar = document.createElement('div');
    bar.id = 'gdt-resizer';
    Object.assign(bar.style, {
      position: 'fixed', top: '0', bottom: '0', width: '6px', zIndex: 2147483646,
      cursor: 'col-resize', background: 'transparent',
    });
    const place = () => { const r = getSidenav()?.getBoundingClientRect(); if (r) bar.style.left = (r.right - 3) + 'px'; };
    place();
    bar.addEventListener('mouseenter', () => { bar.style.background = 'rgba(155,114,203,.45)'; });
    bar.addEventListener('mouseleave', () => { if (!bar.dataset.dragging) bar.style.background = 'transparent'; });
    bar.addEventListener('mousedown', e => {
      e.preventDefault(); bar.dataset.dragging = '1'; bar.style.background = 'rgba(155,114,203,.75)';
      const move = ev => { GM_setValue('navWidth', clampW(ev.clientX)); applyNavWidth(); place(); };
      const up = () => {
        delete bar.dataset.dragging; bar.style.background = 'transparent';
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        toast('側欄寬度：' + clampW(CFG.navWidth()) + ' px');
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    document.body.appendChild(bar);
    window.addEventListener('resize', place);
    setInterval(place, 1500);
  }

  /* ───────────────────── 側欄區塊摺疊（筆記本 / Gem / 近期對話）───────────────────── */
  const sectionSet = () => new Set(CFG.sections());
  // 比對文字時要把自己注入的箭頭去掉，否則第二輪會把同一列認成不同節點、重複注入
  const CARET_RE = /[▾▸]/g;
  const cleanText = el => ((el.textContent || '').replace(CARET_RE, '')).trim();
  const firstLineOf = el => (((el.innerText || el.textContent || '').replace(CARET_RE, '')).trim().split('\n')[0] || '').trim();
  const isTitle = t => !!t && SECTION_TITLES.some(w => norm(w) === norm(t));

  function sectionHeaders() {
    const nav = getSidenav();
    if (!nav) return [];
    const found = [];
    for (const el of nav.querySelectorAll('div, span, h1, h2, h3, h4, p, label')) {
      if (el.classList.contains('gdt-caret')) continue;
      if ([...el.children].some(c => !c.classList.contains('gdt-caret'))) continue;   // 只挑純文字節點
      const t = cleanText(el);
      if (!isTitle(t)) continue;
      let row = el;                                           // 往上找出代表「這一列」的容器
      while (row.parentElement && row.parentElement !== nav && cleanText(row.parentElement) === t) row = row.parentElement;
      if (row.parentElement && !found.some(f => f.row === row)) found.push({ title: t, row });
    }
    return found;
  }

  function sectionItems(h) {
    const items = [];
    let n = h.row.nextElementSibling;
    while (n) { if (isTitle(firstLineOf(n))) break; items.push(n); n = n.nextElementSibling; }
    if (!items.length) {                                      // 標題自成一個容器的版面
      const sib = h.row.parentElement && h.row.parentElement.nextElementSibling;
      if (sib && !isTitle(firstLineOf(sib))) items.push(sib);
    }
    return items;
  }

  function applySections() {
    if (!CFG.sectionUI() && !CFG.sections().length) return;
    const collapsed = sectionSet();
    for (const h of sectionHeaders()) {
      const hide = collapsed.has(h.title);
      for (const it of sectionItems(h)) {
        if (hide) { if (it.style.display !== 'none') { it.dataset.gdtHidden = '1'; it.style.display = 'none'; } }
        else if (it.dataset.gdtHidden) { delete it.dataset.gdtHidden; it.style.display = ''; }
      }
      if (CFG.sectionUI()) injectCaret(h, hide);
    }
  }

  function injectCaret(h, hidden) {
    let caret = h.row.querySelector('.gdt-caret');
    if (!caret) {
      caret = document.createElement('span');
      caret.className = 'gdt-caret';
      caret.title = '收合／展開這個區塊';
      Object.assign(caret.style, { cursor: 'pointer', marginInlineStart: '6px', opacity: '.65', fontSize: '11px', userSelect: 'none' });
      caret.addEventListener('click', e => {
        e.stopPropagation(); e.preventDefault();
        const list = CFG.sections().slice();
        const i = list.indexOf(h.title);
        if (i >= 0) list.splice(i, 1); else list.push(h.title);
        GM_setValue('sections', list);
        applySections();
      });
      h.row.appendChild(caret);
    }
    const want = hidden ? '▸' : '▾';
    if (caret.textContent !== want) caret.textContent = want;
  }

  /* ───────────────────── 除錯：傾印側欄結構 ───────────────────── */
  function dumpSidenav() {
    const nav = getSidenav();
    if (!nav) { console.warn('[Gemini 延伸思考] 找不到側欄元素'); return; }
    const rows = [];
    const walk = (el, depth) => {
      if (depth > 6) return;
      for (const c of el.children) {
        const t = (c.textContent || '').trim().slice(0, 24);
        rows.push({ 深度: depth, 標籤: c.tagName.toLowerCase(), class: (c.className || '').toString().slice(0, 48), 文字: t, 寬: Math.round(c.getBoundingClientRect().width) });
        walk(c, depth + 1);
      }
    };
    walk(nav, 0);
    console.log('%c[Gemini 延伸思考] 側欄結構（把這張表截圖回報即可）', 'color:#9B72CB;font-weight:bold');
    console.table(rows.slice(0, 120));
    console.log('偵測到的區塊標題：', sectionHeaders().map(h => h.title));
    console.log('側欄狀態：', sidenavState(), '寬度：', Math.round(nav.getBoundingClientRect().width));
  }

  async function ensurePreferredModel() {
    const want = (CFG.model() || '').trim();
    if (!want) return true;

    const menu = await openMenu();
    if (!menu) return false;
    const items = menuItems(menu);
    if (!items.some(isChecked)) { warn('無法辨識目前選中的模型，為了安全不做任何點擊。'); await closeMenu(); return false; }

    const target = items.find(it => hasAny(itemLabel(it), [want]) && !hasAny(itemLabel(it), THINKING_LABELS));
    if (!target) { log('選單裡找不到模型：', want); await closeMenu(); return true; }
    if (isChecked(target)) { log('模型已是', want); return true; }

    log('切換模型 →', itemLabel(target));
    target.click();
    await sleep(TIMING.afterClick);
    return true;
  }

  async function ensureThinking() {
    // 快路徑：膠囊已顯示「延伸／Thinking」，完全不用開選單
    if (pillSaysThinking()) { log('膠囊顯示已是延伸思考，跳過。目前：', getPillText().trim()); return 'already'; }

    const menu = await openMenu();
    if (!menu) return 'nomenu';
    const items = menuItems(menu);

    // 安全閥：目前的模型一定是勾選狀態，如果我們一個勾都認不出來 →
    // 代表勾選偵測失效，這時候點下去有可能反而把思考模式關掉，所以直接放棄。
    if (!items.some(isChecked)) { warn('偵測不到任何勾選狀態（Gemini 版面可能改了），為了避免誤關思考模式，本次不動作。'); await closeMenu(); return 'unsafe'; }

    const target = items.find(it => hasAny(itemLabel(it), THINKING_LABELS));
    if (!target) { log('選單裡沒有「延伸思考」選項（此模型可能不支援或本來就會思考）'); await closeMenu(); return 'missing'; }
    if (isChecked(target)) { log('延伸思考已開啟'); await closeMenu(); return 'already'; }

    log('點擊開啟延伸思考：', itemLabel(target));
    target.click();
    await sleep(TIMING.afterClick);
    await closeMenu();
    return 'clicked';
  }

  // 後備方案：某些版本把「延伸思考」做成輸入框旁的開關按鈕（有 aria-pressed，狀態明確才動）
  async function tryToolbarToggle() {
    const btns = [...document.querySelectorAll('button[aria-pressed], [role="switch"], [role="button"][aria-pressed]')];
    const t = btns.find(b => visible(b) && hasAny((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || ''), THINKING_LABELS));
    if (!t) return false;
    const pressed = t.getAttribute('aria-pressed') || t.getAttribute('aria-checked');
    if (pressed === 'false') { log('用工具列開關開啟延伸思考'); t.click(); await sleep(TIMING.afterClick); return true; }
    return pressed === 'true';
  }

  async function run(reason) {
    if (!CFG.enabled() || state.busy || state.done || state.userOverride) return;
    state.busy = true;
    try {
      const ok = await waitFor(() => getSwitcher(), TIMING.timeout);
      if (!ok) { log('等不到模型切換按鈕，放棄（', reason, '）'); return; }

      const sb = await ensureSidebarExpanded();
      if (sb === 'clicked') { log('側欄已展開'); await sleep(300); }
      applyNavWidth(); installResizer(); applySections();

      await ensurePreferredModel();
      await sleep(TIMING.betweenSteps);
      let result = await ensureThinking();
      if (result === 'missing' || result === 'nomenu') { if (await tryToolbarToggle()) result = 'clicked'; }

      if (result === 'clicked') { state.done = true; toast('已切換為「延伸思考」' + (CFG.model() ? '（' + CFG.model() + '）' : '')); }
      else if (result === 'already') { state.done = true; }
      else if (result === 'unsafe') { state.done = true; toast('版面似乎改版了，本次未自動切換', true); }
      log('完成，結果＝', result, '原因＝', reason, '膠囊＝', getPillText().trim());
    } catch (e) { warn('執行失敗：', e); }
    finally { state.busy = false; state.lastPill = getPillText(); }
  }

  /* ─────────────────── 尊重手動操作：使用者自己關掉就不再硬開 ─────────────────── */
  function watchManualOverride() {
    setInterval(() => {
      if (state.busy) { state.lastPill = getPillText(); return; }
      const now = getPillText();
      if (state.lastPill && hasAny(state.lastPill, PILL_HINTS) && now && !hasAny(now, PILL_HINTS)) {
        state.userOverride = true;
        log('偵測到你手動關閉了延伸思考，本次對話不再自動開啟。');
      }
      state.lastPill = now;

      const nav = getSidenav();
      const w = nav ? nav.getBoundingClientRect().width : 0;
      if (state.lastNavW >= SIDEBAR_RAIL_MAX && w > 0 && w < SIDEBAR_RAIL_MAX) {
        state.sidebarOverride = true;
        log('偵測到你手動收合側欄，之後不再自動展開（重新整理後恢復）。');
      }
      state.lastNavW = w;

      applyNavWidth(); installResizer(); applySections();
    }, 1500);
  }

  /* ─────────────────────────── SPA 路由變化 ─────────────────────────── */
  function onUrlChange() {
    const s = scopeOf();
    if (s === state.scope) return;
    // 從新對話（/app）送出第一則訊息後會變成 /app/<id>，那是同一段對話 → 不重跑、也保留手動覆寫
    if (state.scope === 'new' && s !== 'new') { state.scope = s; log('新對話取得 id，沿用目前狀態'); return; }
    log('切換對話：', state.scope, '→', s);
    state.scope = s; state.done = false; state.userOverride = false;
    setTimeout(() => run('url-change'), 600);
  }
  function hookHistory() {
    for (const k of ['pushState', 'replaceState']) {
      const orig = history[k];
      history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(onUrlChange); return r; };
    }
    window.addEventListener('popstate', onUrlChange);
    let last = location.href;
    setInterval(() => { if (location.href !== last) { last = location.href; onUrlChange(); } }, 800);
  }

  /* ─────────────────────────── 提示訊息 ─────────────────────────── */
  function toast(msg, isWarn) {
    if (!CFG.toast()) return;
    const el = document.createElement('div');
    el.textContent = (isWarn ? '⚠️ ' : '✨ ') + msg;
    Object.assign(el.style, {
      position: 'fixed', right: '18px', bottom: '18px', zIndex: 2147483647,
      padding: '10px 14px', borderRadius: '12px', font: '500 13px/1.4 system-ui,"Noto Sans TC",sans-serif',
      color: '#fff', background: isWarn ? 'rgba(180,80,40,.95)' : 'rgba(60,64,67,.95)',
      boxShadow: '0 4px 16px rgba(0,0,0,.28)', opacity: '0', transition: 'opacity .25s, transform .25s',
      transform: 'translateY(8px)', pointerEvents: 'none', maxWidth: '60vw',
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2600);
  }

  /* ─────────────────────────── Tampermonkey 選單 ─────────────────────────── */
  let menuIds = [];
  function buildMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (typeof GM_unregisterMenuCommand === 'function') menuIds.forEach(id => { try { GM_unregisterMenuCommand(id); } catch (e) {} });
    menuIds = [];
    const add = (label, fn) => menuIds.push(GM_registerMenuCommand(label, fn));

    add(`${CFG.enabled() ? '✅' : '⛔'} 自動延伸思考：${CFG.enabled() ? '開啟中' : '已關閉'}（點擊切換）`,
      () => { GM_setValue('enabled', !CFG.enabled()); buildMenu(); location.reload(); });
    add(`🤖 預設模型：${CFG.model() || '不指定'}（點擊修改）`, () => {
      const v = prompt('要鎖定哪個模型？輸入選單上看得到的字即可，例如：3.1 Pro / 3.8 Flash / 3.5 Flash-Lite。\n留空＝不改模型，只開延伸思考。', CFG.model());
      if (v !== null) { GM_setValue('model', v.trim()); buildMenu(); toast('已設定預設模型：' + (v.trim() || '不指定')); }
    });
    add(`${CFG.sidebar() ? '📂' : '📁'} 左側選單預設展開：${CFG.sidebar() ? '開' : '關'}`,
      () => { GM_setValue('sidebar', !CFG.sidebar()); buildMenu(); toast('左側選單預設展開：' + (!CFG.sidebar() ? '關' : '開')); });
    add(`📐 側欄寬度：${CFG.navWidth() ? clampW(CFG.navWidth()) + ' px' : '跟隨 Gemini'}（點擊修改）`, () => {
      const v = prompt(`側欄寬度（${NAV_W_MIN}–${NAV_W_MAX} px）。輸入 0 或留空＝跟隨 Gemini 預設。\n也可以直接用滑鼠拖曳側欄右緣調整。`, CFG.navWidth() || '');
      if (v === null) return;
      const n = parseInt(v, 10);
      GM_setValue('navWidth', !n || isNaN(n) ? 0 : clampW(n));
      applyNavWidth(); buildMenu();
      toast('側欄寬度：' + (CFG.navWidth() ? CFG.navWidth() + ' px' : '跟隨 Gemini'));
    });
    add(`↔️ 拖曳調整側欄寬度：${CFG.resizer() ? '開' : '關'}`, () => {
      GM_setValue('resizer', !CFG.resizer()); buildMenu();
      document.getElementById('gdt-resizer')?.remove(); installResizer();
    });
    add(`🗂 側欄區塊摺疊箭頭：${CFG.sectionUI() ? '開' : '關'}${CFG.sections().length ? '（已收合：' + CFG.sections().join('、') + '）' : ''}`, () => {
      GM_setValue('sectionUI', !CFG.sectionUI()); buildMenu();
      if (!CFG.sectionUI()) document.querySelectorAll('.gdt-caret').forEach(c => c.remove());
      applySections();
    });
    add('↩️ 全部區塊展開', () => { GM_setValue('sections', []); applySections(); buildMenu(); toast('已展開所有側欄區塊'); });
    add('🧪 傾印側欄結構（開發者除錯）', dumpSidenav);
    add(`🔔 提示訊息：${CFG.toast() ? '開' : '關'}`, () => { GM_setValue('toast', !CFG.toast()); buildMenu(); });
    add(`🐞 除錯訊息：${CFG.debug() ? '開' : '關'}`, () => { GM_setValue('debug', !CFG.debug()); buildMenu(); });
    add('🔁 立刻套用一次', () => { state.done = false; state.userOverride = false; state.sidebarOverride = false; run('manual'); });
  }

  /* ─────────────────────────── 啟動 ─────────────────────────── */
  state.scope = scopeOf();
  state.lastPill = getPillText();
  state.lastNavW = getSidenav() ? getSidenav().getBoundingClientRect().width : 0;
  buildMenu();
  hookHistory();
  watchManualOverride();
  setTimeout(() => run('boot'), TIMING.boot);
})();
