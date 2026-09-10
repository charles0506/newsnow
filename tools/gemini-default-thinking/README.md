# Gemini 預設延伸思考（Tampermonkey 使用者腳本）

每次開新對話，自動把 [gemini.google.com](https://gemini.google.com) 切換成「**延伸思考**」模式；也可以順便鎖定慣用模型（例如 `3.1 Pro`）。

![icon](./icon.svg)

## 功能

| 功能 | 說明 |
| --- | --- |
| 自動開啟延伸思考 | 每次載入 / 開新對話自動套用，不用每次自己點選單 |
| 鎖定預設模型（可選） | 先切模型再開思考；留空就只管思考模式、不動模型 |
| 已開啟就不動作 | 膠囊按鈕若已顯示「延伸 / Thinking」，連選單都不開，畫面不閃 |
| 安全煞車 | 認不出任何勾選狀態時**寧可不點**，避免把已開的思考模式反向關掉 |
| 尊重手動操作 | 你自己在同一段對話關掉思考模式後，腳本不再硬開回去 |
| 多語系 | 內建 繁中／簡中／英文 字樣，可自行增補 |
| Tampermonkey 選單設定 | 總開關、預設模型、提示訊息、除錯訊息，免改程式碼 |

## 安裝

1. 瀏覽器安裝 [Tampermonkey](https://www.tampermonkey.net/)（Chrome 需在「擴充功能」開啟**開發人員模式**，MV3 之後才能執行使用者腳本）。
2. 開啟 Tampermonkey → 「新增指令碼」→ 貼上 `gemini-default-thinking.user.js` 全部內容 → 存檔（Ctrl+S）。
   - 或把 `.user.js` 檔案直接拖進瀏覽器視窗，Tampermonkey 會跳出安裝頁。
3. 重新整理 gemini.google.com，右下角出現「✨ 已切換為『延伸思考』」就成功了。

## 設定（Tampermonkey 圖示 → 本腳本的選單）

| 選單項目 | 預設 | 說明 |
| --- | --- | --- |
| ✅ 自動延伸思考 | 開啟 | 總開關，切換後會重新整理頁面 |
| 🤖 預設模型 | 不指定 | 輸入選單上看得到的字，例如 `3.1 Pro`、`3.8 Flash`、`3.5 Flash-Lite` |
| 🔔 提示訊息 | 開 | 右下角小提示 |
| 🐞 除錯訊息 | 關 | 在 DevTools Console 印出每一步判斷 |
| 🔁 立刻套用一次 | — | 手動重跑（例如剛剛自己關掉又想開回來） |

## 運作方式

1. 先看輸入框旁的膠囊按鈕文字（`button.gds-mode-switch-button .logo-pill-label-container`）。含「延伸／Thinking」→ 直接結束。
2. 否則打開模型選單，抓所有 `[role="menuitem*"] / .mat-mdc-menu-item`。
3. **安全檢查**：目前使用中的模型一定是勾選狀態，如果腳本連一個勾都認不出來，代表 Gemini 改版、偵測失效 → 直接放棄，不做任何點擊。
4. 找到「延伸思考」那一列，已勾選就關閉選單；未勾選才點下去。
5. 監聽 SPA 網址變化；`/app` → `/app/<id>`（送出第一則訊息）視為同一段對話，不重跑。

## Gemini 改版後怎麼自救

1. 打開選單 🐞 除錯訊息 → F12 Console 看卡在哪一步。
2. 若是字樣改了：修改腳本最上方的 `THINKING_LABELS` / `PILL_HINTS`。
3. 若是元素改了：修改 `SWITCHER_SELECTORS` / `MENU_SELECTORS` / `ITEM_SELECTORS`。
4. 若是勾選記號改了：修改 `isChecked()`。

## 自我測試（可選，開發用）

用 jsdom 模擬 Gemini 選單，驗證 6 種情境（含「已開啟時絕不誤關」與「改版時安全煞車」）：

```bash
npm i jsdom
node selftest.mjs
```

## 已知限制

- 只做**畫面自動化**，不碰 Gemini 內部 API；Google 大改版時需要更新選擇器。
- 部分模型本身就會思考、選單裡沒有這個選項，此時腳本會略過（Console 會說明）。
- 帳號層級沒有「永久預設思考模式」的官方設定，所以每段新對話都要重新套用一次，這是 Gemini 的行為、不是腳本漏做。
