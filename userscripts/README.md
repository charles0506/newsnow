# Windy 更新時間徽章

在 [windy.com](https://www.windy.com) 的地圖上常駐一個小徽章，直接顯示目前預測模式
**多久前更新**、**下次更新倒數**、參考時間（ref 12Z）與更新間隔，
不用再點進 <https://www.windy.com/info> 才看得到。

檔案：[`windy-update-badge.user.js`](./windy-update-badge.user.js)

## 該做瀏覽器擴充功能，還是暴力猴腳本？

| 做法 | 適合什麼 | 成本 |
| --- | --- | --- |
| **暴力猴 / 油猴 使用者腳本**（本專案採用） | 只是要在 windy.com 頁面上多顯示一點東西，自己用、順手改 | 一個 `.js` 檔，貼上就能跑 |
| Chrome / Edge 擴充功能 | 需要背景執行（windy 沒開著也要通知）、要上架商店、要跨分頁狀態 | 要 manifest、打包、上架審查 |
| [Windy 官方外掛](https://docs.windy-plugins.com/)（windy-plugins） | 想用官方 API（Svelte + `@windy/*` 模組）、想上架 Windy 外掛庫給別人用 | 要用官方 boilerplate、dev server、送審 |

只是「不想開資訊頁就看到更新時間」的話，**暴力猴腳本是最划算的**：擴充功能能做的這件事它都能做，
但少了 manifest、打包和上架的流程。真正需要擴充功能的理由只有一個 —— 你想在**沒開 windy.com 的時候**
也能被提醒（背景排程 + 系統通知）；那時再把這支腳本的邏輯搬進 background service worker 即可。
如果之後想公開給其他 Windy 使用者裝，才值得改寫成官方 Windy 外掛。

## 安裝

1. 瀏覽器裝 [Violentmonkey（暴力猴）](https://violentmonkey.github.io/) 或 Tampermonkey。
2. 開啟擴充功能的「新增腳本」，把 `windy-update-badge.user.js` 全文貼上並儲存。
   （或在檔案總管把 `.user.js` 拖進瀏覽器視窗，暴力猴會跳出安裝畫面。）
3. 重新整理 <https://www.windy.com>，右上角會出現徽章。

操作：**拖曳**可搬到任何位置（位置會記住），**單擊**可收合／展開詳細資料。

## 它是怎麼拿到更新時間的

Windy 沒有公開的「模式更新時間」API，所以腳本同時用三個來源，哪個先拿到就用哪個：

1. **攔截頁面的 fetch / XHR** —— 在 `document-start` 就包住 `window.fetch` 與 `XMLHttpRequest`，
   掃描回應 JSON 裡的 `refTime` / `updateTime` / `nextUpdate` / `updateInterval` 欄位。
   這條路最耐 Windy 改版，因為資料無論如何都得從網路來。
2. **`window.W`** —— Windy 把內部模組掛在這個全域變數上，會去讀
   `W.store.get("product")` 對應的 `W.products[...]`（也會退一步掃 `W.store` / `W.models`）。
   這是判斷「使用者現在看的是哪個模式」的權威來源，換模式時會清掉舊模式的數字，避免兩個模式混在一起。
3. **DOM** —— 如果剛好開過資訊頁，直接從畫面上抓 `2026-08-31T12:00:00Z` 這種參考時間字串。

「下次更新」優先用抓到的 `nextUpdate`；沒有的話就用「上次更新 + 更新間隔」往後推算到未來的第一個時間點。

## 壞掉了怎麼辦

Windy 改版換掉欄位名稱時，徽章會顯示「更新時間 —」。這時：

1. 把腳本開頭 `CONFIG.debug` 改成 `true`，重新整理，主控台會印出每一次抓到資料的來源。
2. 在主控台輸入 `__windyUpdateBadge.state` 看目前抓到什麼、`__windyUpdateBadge.probe()` 手動重探一次。
3. 需要調整時，改腳本裡的 `FIELDS` 常數（欄位名稱清單）就好，其他邏輯不用動。

> 這支腳本依賴 Windy 未公開的內部資料結構，Windy 改版時可能需要照上面步驟微調欄位名稱。
