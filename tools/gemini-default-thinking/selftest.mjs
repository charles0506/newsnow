import { JSDOM } from 'jsdom';
import fs from 'node:fs';


const CODE = fs.readFileSync(new URL('./gemini-default-thinking.user.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function build({ pill, checkedModel, thinkingOn, useAria = false, breakChecks = false }) {
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
  doc.querySelector('button.gds-mode-switch-button').addEventListener('click', renderMenu);
  doc.addEventListener('keydown', e => { if (e.key === 'Escape') doc.querySelector('.mat-mdc-menu-panel')?.remove(); });

  const store = { enabled: true, toast: false, debug: !!process.env.DBG, model: '' };
  Object.assign(window, {
    GM_getValue: (k, d) => (k in store ? store[k] : d),
    GM_setValue: (k, v) => { store[k] = v; },
    GM_registerMenuCommand: () => 1,
    GM_unregisterMenuCommand: () => {},
  });
  return { window, doc, clicks, state, store };
}

const results = [];
async function scenario(name, opts, expect) {
  const env = build(opts);
  if (opts.cfgModel) env.store.model = opts.cfgModel;
  env.window.eval(CODE);
  await sleep(opts.wait || 5200);
  const got = { clicks: env.clicks.join(','), thinking: env.state.thinking, model: env.state.model };
  const ok = got.clicks === expect.clicks && got.thinking === expect.thinking && got.model === expect.model;
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  console.log(`   點擊=[${got.clicks}] 思考=${got.thinking} 模型=${got.model}  (預期 點擊=[${expect.clicks}] 思考=${expect.thinking} 模型=${expect.model})`);
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

const pass = results.filter(Boolean).length;
console.log(`\n結果：${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
