import { JSDOM } from 'jsdom';
import fs from 'node:fs';


const CODE = fs.readFileSync(new URL('./gemini-default-thinking.user.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function build({ pill, checkedModel, thinkingOn, useAria = false, breakChecks = false, nav, noToggle = false, winWidth }) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button class="gds-mode-switch-button mat-mdc-button-base" aria-haspopup="menu">
      <span class="logo-pill-label-container"><span>${pill}</span></span>
    </button></body></html>`, { url: 'https://gemini.google.com/app', pretendToBeVisual: true, runScripts: 'outside-only' });

  const { window } = dom;
  const doc = window.document;
  // jsdom 沒有版面計算 → 讓 visible() 能運作
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode ? doc.body : null; }, configurable: true });
  window.HTMLElement.prototype.getClientRects = function () { return [{ width: 10, height: 10 }]; };
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; }, configurable: true });

  window.console = console;
  const clicks = [];
  const state = { model: checkedModel, thinking: thinkingOn };
  const rows = [
    { key: '3.5 Flash-Lite', label: '3.5 Flash-Lite 回覆最快', kind: 'model' },
    { key: '3.8 Flash',      label: '3.8 Flash 全方位協助 新模型', kind: 'model' },
    { key: '3.1 Pro',        label: '3.1 Pro 進階推論', kind: 'model' },
    { key: '延伸思考',        label: '延伸思考 解決複雜問題', kind: 'think' },
  ];

  function renderMenu() {
    if (doc.querySelector('.mat-mdc-menu-panel')) return;
    const menu = doc.createElement('div');
    menu.className = 'mat-mdc-menu-panel';
    menu.setAttribute('role', 'menu');
    for (const r of rows) {
      const b = doc.createElement('button');
      b.className = 'mat-mdc-menu-item';
      b.setAttribute('role', r.kind === 'model' ? 'menuitemradio' : 'menuitemcheckbox');
      const on = r.kind === 'model' ? state.model === r.key : state.thinking;
      if (!breakChecks) {
        if (useAria) b.setAttribute('aria-checked', String(on));
        else if (on) { const i = doc.createElement('mat-icon'); i.textContent = 'check'; b.appendChild(i); }
      }
      const s = doc.createElement('span'); s.textContent = r.label; b.appendChild(s);
      b.addEventListener('click', () => {
        clicks.push(r.key);
        if (r.kind === 'model') state.model = r.key; else state.thinking = !state.thinking;
        doc.querySelector('.logo-pill-label-container span').textContent =
          state.model.replace(/^\d[\d.]*\s*/, '') + (state.thinking ? ' 延伸' : '');
        menu.remove();
      });
      menu.appendChild(b);
    }
    doc.body.appendChild(menu);
  }
  // 側欄模擬
  let navW = nav;
  if (nav !== undefined) {
    const navEl = doc.createElement('bard-sidenav');
    doc.body.appendChild(navEl);
    navEl.getBoundingClientRect = () => ({ width: navW, height: 600, top: 0, left: 0, right: navW, bottom: 600 });
    if (!noToggle) {
      const tb = doc.createElement('button');
      tb.setAttribute('data-test-id', 'side-nav-menu-button');
      tb.setAttribute('aria-label', '主選單');
      tb.textContent = 'menu';
      tb.addEventListener('click', () => { clicks.push('側欄開關'); navW = navW < 140 ? 280 : 72; });
      doc.body.appendChild(tb);
    }
  }
  if (winWidth) Object.defineProperty(window, 'innerWidth', { value: winWidth, configurable: true });

  doc.querySelector('button.gds-mode-switch-button').addEventListener('click', renderMenu);
  doc.addEventListener('keydown', e => { if (e.key === 'Escape') doc.querySelector('.mat-mdc-menu-panel')?.remove(); });

  const store = { enabled: true, toast: false, debug: !!process.env.DBG, model: '' };
  Object.assign(window, {
    GM_getValue: (k, d) => (k in store ? store[k] : d),
    GM_setValue: (k, v) => { store[k] = v; },
    GM_registerMenuCommand: () => 1,
    GM_unregisterMenuCommand: () => {},
  });
  return { window, doc, clicks, state, store, getNavW: () => navW };
}

const results = [];
async function scenario(name, opts, expect) {
  const env = build(opts);
  if (opts.cfgModel) env.store.model = opts.cfgModel;
  env.window.eval(CODE);
  await sleep(opts.wait || 5200);
  const got = { clicks: env.clicks.join(','), thinking: env.state.thinking, model: env.state.model };
  if (expect.navW !== undefined) got.navW = env.getNavW();
  const ok = got.clicks === expect.clicks && got.thinking === expect.thinking && got.model === expect.model
    && (expect.navW === undefined || got.navW === expect.navW);
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  const nw = expect.navW === undefined ? '' : ` 側欄寬=${got.navW}`;
  const nwE = expect.navW === undefined ? '' : ` 側欄寬=${expect.navW}`;
  console.log(`   點擊=[${got.clicks}] 思考=${got.thinking} 模型=${got.model}${nw}  (預期 點擊=[${expect.clicks}] 思考=${expect.thinking} 模型=${expect.model}${nwE})`);
  env.window.close();
}

console.log('=== Gemini 預設延伸思考：行為測試 ===');
await scenario('A 思考關閉 → 自動開啟',
  { pill: 'Flash', checkedModel: '3.8 Flash', thinkingOn: false },
  { clicks: '延伸思考', thinking: true, model: '3.8 Flash' });

await scenario('B 已開啟（膠囊顯示「延伸」）→ 完全不動作、不開選單',
  { pill: 'Flash 延伸', checkedModel: '3.8 Flash', thinkingOn: true },
  { clicks: '', thinking: true, model: '3.8 Flash' });

await scenario('C 已開啟但膠囊看不出來 → 開選單確認後仍不點（不會關掉）',
  { pill: 'Pro', checkedModel: '3.1 Pro', thinkingOn: true },
  { clicks: '', thinking: true, model: '3.1 Pro' });

await scenario('D aria-checked 版面 + 思考關閉 → 正確開啟',
  { pill: 'Flash', checkedModel: '3.8 Flash', thinkingOn: false, useAria: true },
  { clicks: '延伸思考', thinking: true, model: '3.8 Flash' });

await scenario('E 改版導致勾選偵測失效 → 安全煞車，一次都不點',
  { pill: 'Pro', checkedModel: '3.1 Pro', thinkingOn: true, breakChecks: true },
  { clicks: '', thinking: true, model: '3.1 Pro' });

await scenario('F 鎖定 3.1 Pro + 思考關閉 → 先換模型再開思考',
  { pill: 'Flash', checkedModel: '3.8 Flash', thinkingOn: false, cfgModel: '3.1 Pro', wait: 6500 },
  { clicks: '3.1 Pro,延伸思考', thinking: true, model: '3.1 Pro' });

await scenario('G 側欄收合 → 自動展開',
  { pill: 'Flash 延伸', checkedModel: '3.8 Flash', thinkingOn: true, nav: 72, wait: 6000 },
  { clicks: '側欄開關', thinking: true, model: '3.8 Flash', navW: 280 });

await scenario('H 側欄已展開 → 一下都不點（不會反而收起來）',
  { pill: 'Flash 延伸', checkedModel: '3.8 Flash', thinkingOn: true, nav: 280, wait: 6000 },
  { clicks: '', thinking: true, model: '3.8 Flash', navW: 280 });

await scenario('I 視窗過窄（900px）→ 側欄維持原樣，避免浮動遮罩擋內容',
  { pill: 'Flash 延伸', checkedModel: '3.8 Flash', thinkingOn: true, nav: 72, winWidth: 900, wait: 6000 },
  { clicks: '', thinking: true, model: '3.8 Flash', navW: 72 });

await scenario('J 找不到側欄開關 → 不亂點別的按鈕',
  { pill: 'Flash 延伸', checkedModel: '3.8 Flash', thinkingOn: true, nav: 72, noToggle: true, wait: 6000 },
  { clicks: '', thinking: true, model: '3.8 Flash', navW: 72 });

await scenario('K 側欄收合 + 思考關閉 → 兩件事都做',
  { pill: 'Flash', checkedModel: '3.8 Flash', thinkingOn: false, nav: 72, wait: 7000 },
  { clicks: '側欄開關,延伸思考', thinking: true, model: '3.8 Flash', navW: 280 });

const pass = results.filter(Boolean).length;
console.log(`\n結果：${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
