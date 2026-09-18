# Windy 更新時間徽章

在 [windy.com](https://www.windy.com) 的地圖上常駐一個小徽章，直接顯示目前預測模式
**多久前更新**、**下次更新倒數**、參考時間（ref 12Z）與更新間隔，
不用再點進 <https://www.windy.com/info> 才看得到。

順便處理兩個每次都要手動點的預設值：**進站直接選降雨圖層**、
**「此地點的天氣預報」打開時直接切到 Meteogram**。

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
2. 開啟這個連結，暴力猴就會跳出安裝畫面：
   <https://raw.githubusercontent.com/charles0506/newsnow/main/userscripts/windy-update-badge.user.js>
   （腳本帶 `@updateURL`，之後按「檢查更新」就能升級。也可以把 `.user.js` 全文貼進
   擴充功能的「新增腳本」手動安裝。）
3. 重新整理 <https://www.windy.com>，右上角會出現徽章。

操作：**拖曳**可搬到任何位置（位置會記住），**單擊**可收合／展開詳細資料。

## 它是怎麼拿到更新時間的

關鍵是：Windy 說的「已更新於 5 小時前」是資料**實際發布**的時間，不是參考時間。
ECMWF 12Z 的跑批大約 +8 小時才發布，所以拿參考時間直接算「多久前」會整整差 8 小時。
而這個發布時間 Windy 並沒有公開的 API。

所以腳本不猜，改成**抄 Windy 自己算好的數字**：

1. **校準（做一次就好）** —— 按徽章上的「校準」，腳本會開一個 `/info` 分頁，
   從頁面上讀走三個語言無關的數字：倒數 `11h 21m 27s`、間隔 `12 - 13 hrs`、
   參考時間 `2026-09-15T12:00:00Z`，再配合「已更新於 …前」推出發布時間。
   那句話有兩種寫法要分開處理：寫成「1 小時 38 分鐘前」時準確到分，
   發布時間直接算得出來，間隔就等於「下次更新 − 發布時間」；
   只寫「5 小時前」時才需要從 12/13 小時裡挑出對得起來的那個。讀完分頁自己關掉。
2. **記住落後量** —— 把「發布時間 − 參考時間」（例如 ECMWF 是 +8 小時）
   和更新間隔存進 `localStorage`，每個模式各存一份。
3. **之後都在地圖頁算** —— 腳本用兩條路盯著「現在是哪一個跑批」：
   攔截頁面 fetch/XHR 回應裡的 `refTime`，以及讀 `window.W` 的
   `W.store.get("product")` / `W.products[...]`。拿到參考時間後，
   `發布時間 = 參考時間 + 落後量`、`下次更新 = 發布時間 + 間隔`，倒數每秒重畫。

徽章的「來源」欄會標明目前的數字是哪來的：**資訊頁**（現讀）、
**已校準**（用參考時間＋落後量推算）、**推測**（讀不到參考時間，照間隔往後推的）、
**上次紀錄**（快取墊檔）。

> `window.W` 的 Product 物件實測並沒有公開 `refTime`，所以拿不到參考時間時會走「推測」：
> 過了預定更新時間一小時還沒有新資料，就照間隔往後推一輪，免得徽章永遠停在上次校準的那一輪。
> 想校準回精確值，進一次資訊頁或按一次「校準」即可。

## 順手的預設值

腳本開頭的 `CONFIG` 有兩個開關，不想要就設成 `null`：

| 設定 | 預設 | 作用 |
| --- | --- | --- |
| `defaultOverlay` | `"rain"` | 進站自動選降雨圖層。優先呼叫 `W.store.set("overlay", "rain")`，失敗才退回點畫面上的按鈕。**網址已經指定別的圖層**（例如 `windy.com/?wind,25.03,121.56,8`）時不會覆蓋，尊重你點進來的那個連結 |
| `autoTabs` | 見下 | 面板一畫好就自動點好指定的頁籤。用 `MutationObserver` 等面板出現，再從畫面上找出文字相符的頁籤來點 |

`autoTabs` 是一張由上往下比對的規則表，`path` 命中網址就用那條，省略 `path` 的是「其他頁面」：

```js
autoTabs: [
  { path: "/multimodel", label: "Clouds.Rain" }, // 比較不同預報模式
  { label: "Meteogram" },                        // 此地點的天氣預報
],
```

因為只有第一條命中的規則會生效，在 `/multimodel` 上就只會點 Clouds.Rain，不會去碰 Meteogram。
比對前會先拿掉網址的語言前綴（Windy 實際的網址是 `/zh-TW/multimodel/...`，不是 `/multimodel/...`），
所以 `path` 只要寫 `/multimodel` 就好，各語言介面都適用。
Windy 是單頁應用，切頁只改 path 不重新載入，所以每次 DOM 有變動都會重新比對規則。
頁籤文字（`Meteogram`、`Clouds.Rain`）在中文介面下也是英文，所以不受語言影響；`label` 裡的 `.` 會當字面比對。

找頁籤時會排序候選：`<a>` / `<button>`、class 或 id 帶 `tab`/`btn` 的優先，
免得誤點到面板裡同名的圖表標題。面板關掉再打開會再切一次，同一次開啟只會點一次。

主控台可以手動試：`__windyUpdateBadge.setOverlay("rain")`、`__windyUpdateBadge.openTab()`
（`openTab()` 不給參數就用目前網址命中的規則，也可以指定名稱，例如 `openTab("Clouds.Rain")`；
`__windyUpdateBadge.tabRule()` 可以看現在命中哪一條規則）。

## 壞掉了怎麼辦

主控台可以直接檢查：

| 指令 | 用途 |
| --- | --- |
| `__windyUpdateBadge.state` | 目前算出來的值與來源 |
| `__windyUpdateBadge.calibration()` | 存起來的落後量／間隔 |
| `__windyUpdateBadge.parseInfoPage()` | 在資訊頁上測試解析結果 |
| `__windyUpdateBadge.calibrate()` | 手動重新校準 |
| `__windyUpdateBadge.reset()` | 清掉所有紀錄重來 |
| `__windyUpdateBadge.dump()` | **回報問題用**：一次印出版本、狀態、校準表、原始與去掉語言前綴的網址、`W.store` 各鍵的值、`window.W` 裡所有能解析成時間的欄位及其路徑、命中的頁籤規則與所有候選（含評分），直接複製主控台輸出即可 |

- 數字整個對不上 → 先 `reset()` 再校準一次。
- 一直顯示「未校準」→ 按「校準」按鈕；若分頁沒自動關，代表 Windy 的資訊頁文字換了格式，
  把 `parseInfoPage()` 的輸出貼出來就能對症調整（要改的只有 `parseInfoPage` 裡那幾條 regex）。
- 想看每一次抓到什麼 → 把腳本開頭 `CONFIG.debug` 改成 `true` 後重新整理。
- 圖層或頁籤沒自動切 → `setOverlay()` / `openTab()` 手動跑一次看主控台訊息；
  Windy 換了 DOM 結構的話，要調的是 `applyDefaultOverlay` 的選擇器與 `findTab` 的評分。
- 想再加一個頁面的預設頁籤 → 在 `autoTabs` 最前面加一條 `{ path: "/xxx", label: "…" }` 就好。

> 校準值只是「發布時間比參考時間晚多久」的估計，來源是 Windy 頁面上以小時為單位的文字，
> 所以可能有幾分鐘誤差；每進一次資訊頁都會自動重新校準一次。
