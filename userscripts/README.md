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

關鍵是：Windy 說的「已更新於 5 小時前」是資料**實際發布**的時間，不是參考時間。
ECMWF 12Z 的跑批大約 +8 小時才發布，所以拿參考時間直接算「多久前」會整整差 8 小時。
而這個發布時間 Windy 並沒有公開的 API。

所以腳本不猜，改成**抄 Windy 自己算好的數字**：

1. **校準（做一次就好）** —— 按徽章上的「校準」，腳本會開一個 `/info` 分頁，
   從頁面上讀走三個語言無關的數字：倒數 `7h 58m 57s`、間隔 `12 - 13 hrs`、
   參考時間 `2026-08-31T12:00:00Z`，再用「已更新 N 小時前」挑出對得起來的那個間隔，
   反推出精準的發布時間。讀完分頁自己關掉。
2. **記住落後量** —— 把「發布時間 − 參考時間」（例如 ECMWF 是 +8 小時）
   和更新間隔存進 `localStorage`，每個模式各存一份。
3. **之後都在地圖頁算** —— 腳本用兩條路盯著「現在是哪一個跑批」：
   攔截頁面 fetch/XHR 回應裡的 `refTime`，以及讀 `window.W` 的
   `W.store.get("product")` / `W.products[...]`。拿到參考時間後，
   `發布時間 = 參考時間 + 落後量`、`下次更新 = 發布時間 + 間隔`，倒數每秒重畫。

徽章的「來源」欄會標明目前的數字是哪來的：**資訊頁**（現讀）、
**已校準**（用落後量推算）、**上次紀錄**（快取墊檔，還沒對到新跑批）。

## 壞掉了怎麼辦

主控台可以直接檢查：

| 指令 | 用途 |
| --- | --- |
| `__windyUpdateBadge.state` | 目前算出來的值與來源 |
| `__windyUpdateBadge.calibration()` | 存起來的落後量／間隔 |
| `__windyUpdateBadge.parseInfoPage()` | 在資訊頁上測試解析結果 |
| `__windyUpdateBadge.calibrate()` | 手動重新校準 |
| `__windyUpdateBadge.reset()` | 清掉所有紀錄重來 |

- 數字整個對不上 → 先 `reset()` 再校準一次。
- 一直顯示「未校準」→ 按「校準」按鈕；若分頁沒自動關，代表 Windy 的資訊頁文字換了格式，
  把 `parseInfoPage()` 的輸出貼出來就能對症調整（要改的只有 `parseInfoPage` 裡那幾條 regex）。
- 想看每一次抓到什麼 → 把腳本開頭 `CONFIG.debug` 改成 `true` 後重新整理。

> 校準值只是「發布時間比參考時間晚多久」的估計，來源是 Windy 頁面上以小時為單位的文字，
> 所以可能有幾分鐘誤差；每進一次資訊頁都會自動重新校準一次。
