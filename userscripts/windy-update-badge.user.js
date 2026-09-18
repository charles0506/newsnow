// ==UserScript==
// @name         Windy 更新時間徽章 (Windy Update Badge)
// @name:en      Windy Update Badge
// @namespace    https://github.com/charles0506/newsnow
// @version      2.4.0
// @description  直接在 windy.com 地圖上顯示目前預測模式的「多久前更新」與「下次更新倒數」，不用再打開 /info 資訊頁面。
// @description:en Show model last-update / next-update countdown directly on the windy.com map, without opening the /info page.
// @author       charles0506
// @license      MIT
// @homepageURL  https://github.com/charles0506/newsnow/tree/main/userscripts
// @supportURL   https://github.com/charles0506/newsnow/issues
// @downloadURL  https://raw.githubusercontent.com/charles0506/newsnow/main/userscripts/windy-update-badge.user.js
// @updateURL    https://raw.githubusercontent.com/charles0506/newsnow/main/userscripts/windy-update-badge.user.js
// @match        https://www.windy.com/*
// @match        https://*.windy.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

// 注意：@grant none 是刻意的。這樣腳本會跑在頁面本身的 context，
// 才能讀到 window.W（Windy 內部模組）並攔截頁面自己發出的 fetch/XHR。
//
// 做法：Windy 的「已更新於 N 小時前」用的是資料**實際發布**的時間，不是參考時間
// （ref 12Z 的跑批大約 +8 小時才發布），而發布時間並沒有公開 API。
// 所以這支腳本不猜，改成直接抄 Windy 自己算好的數字：
//   1. 進過一次資訊頁 → 解析頁面上的倒數與間隔，反推「發布時間 − 參考時間」的落後量
//   2. 把落後量與更新間隔存起來（每個模式一份）
//   3. 之後在地圖頁只要知道參考時間，就能算出正確的「多久前更新 / 下次更新倒數」

(function () {
  "use strict"

  // ---------------------------------------------------------------------------
  // 設定
  // ---------------------------------------------------------------------------
  const CONFIG = {
    // 開 true 之後，主控台會印出每一次抓到資料的來源，方便排查 Windy 改版
    debug: false,
    // 重新探測的間隔（毫秒）
    probeIntervalMs: 4000,
    // 校準分頁最多等幾毫秒
    calibrateTimeoutMs: 25_000,
    // 進站時自動選好的圖層（Windy 的 overlay 代號）。設成 null 就不要動它
    defaultOverlay: "rain",
    // 面板打開時自動點好的頁籤（比對頁籤上的文字，與介面語言無關）。
    // 由上往下比對 path，第一個命中的規則生效；path 省略代表「其他頁面」。
    // 整個設成 [] 就不要動任何頁籤。
    autoTabs: [
      { path: "/multimodel", label: "Clouds.Rain" }, // 比較不同預報模式
      { label: "Meteogram" }, // 此地點的天氣預報
    ],
  }

  const KEY = {
    pos: "windy-update-badge:pos",
    collapsed: "windy-update-badge:collapsed",
    calib: "windy-update-badge:calib", // 每個模式的落後量與間隔
    snapshot: "windy-update-badge:snapshot", // 最後一次算出來的結果
    request: "windy-update-badge:calibrate-request", // 校準分頁的暗號
  }

  const HOUR = 3_600_000
  const log = (...args) => CONFIG.debug && console.log("[windy-update-badge]", ...args)

  const readJSON = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "") ?? fallback
    } catch {
      return fallback
    }
  }
  const writeJSON = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch { /* 無痕模式之類的就算了 */ }
  }

  // ---------------------------------------------------------------------------
  // 狀態
  // ---------------------------------------------------------------------------
  const state = {
    product: null, // 模式代號，例如 ecmwf
    modelName: null, // 顯示用名稱，例如 ECMWF 9km
    refTime: null, // 參考時間（ref 12Z 的那個 12Z）
    lastUpdate: null, // 資料實際發布時間 ← 這才是「多久前更新」要用的
    nextUpdate: null, // 下次更新時間
    intervalMs: null, // 更新間隔
    origin: null, // measured = 資訊頁現讀；derived = 用校準值推算；cached = 上次的結果
    source: null, // debug 用
  }

  // ---------------------------------------------------------------------------
  // 時間解析：Windy 的時間欄位有好幾種長相
  //   ISO 字串 "2026-08-31T12:00:00Z"、epoch 毫秒、epoch 秒、"2026083112"(YYYYMMDDHH)
  // ---------------------------------------------------------------------------
  function toMs(value) {
    if (value == null) return null

    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null
      if (value > 1e12) return value // epoch 毫秒
      if (value > 1e9) return value * 1000 // epoch 秒
      if (value > 1e9 / 100 && value < 1e10) return fromYmdh(String(value)) // YYYYMMDDHH
      return null
    }

    if (typeof value === "string") {
      const trimmed = value.trim()
      if (/^\d{10}$/.test(trimmed)) return fromYmdh(trimmed)
      if (/^\d+$/.test(trimmed)) return toMs(Number(trimmed))
      const parsed = Date.parse(trimmed)
      return Number.isNaN(parsed) ? null : parsed
    }

    if (value instanceof Date) return value.getTime()

    return null
  }

  function fromYmdh(str) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(str)
    if (!m) return null
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4])
    return Number.isNaN(ms) ? null : ms
  }

  // 合理性檢查：只接受最近 30 天到未來 30 天之間的時間
  function isSaneTime(ms) {
    if (!ms) return false
    const now = Date.now()
    return ms > now - 30 * 864e5 && ms < now + 30 * 864e5
  }

  // ---------------------------------------------------------------------------
  // 一、解析資訊頁（/info）—— 唯一能拿到「實際發布時間」的地方
  //
  // 頁面上長這樣（中英文都適用，數字與單位是語言無關的）：
  //   已更新於 5 小時前 (ref 12Z)          → 幾小時前 + 跑批時刻
  //   預期下一次的更新時間在 17:01, 在 7h 58m 57s → 下次更新倒數（精準到秒）
  //   更新間隔: 12 - 13 hrs                → 間隔範圍
  //   參考時間: 2026-08-31T12:00:00Z       → 參考時間
  // ---------------------------------------------------------------------------
  // 解析「1 小時 38 分鐘前」「5 小時前」「38 分鐘前」「1 hour 38 minutes ago」
  // 回傳 { ms, precise }；precise 代表有講到分鐘，準確度到分而不是到小時
  function parseAgo(segment) {
    if (!segment) return null

    let hours = null
    let minutes = null
    const unlabeled = []

    for (const [, num, tail] of segment.matchAll(/(\d+)\s*([^\d]{0,6})/g)) {
      const n = Number(num)
      if (/小時|小时|時|时|hour|hr|h/i.test(tail)) hours = (hours ?? 0) + n
      else if (/分|minute|min|m/i.test(tail)) minutes = (minutes ?? 0) + n
      else unlabeled.push(n)
    }

    // 看不懂單位時，照「時、分」的順序認
    if (hours == null && minutes == null && unlabeled.length) {
      hours = unlabeled[0]
      if (unlabeled.length > 1) minutes = unlabeled[1]
    }
    if (hours == null && minutes == null) return null
    if (hours > 240 || minutes > 59) return null // 解析歪了就不要用

    return { ms: (hours || 0) * HOUR + (minutes || 0) * 60_000, precise: minutes != null }
  }

  function parseInfoPage(text) {
    if (!text) return null

    const isoMatch = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.exec(text)
    const refTime = isoMatch ? toMs(isoMatch[0]) : null
    if (!isSaneTime(refTime)) return null

    // 「5 小時前 (ref 12Z)」「1 小時 38 分鐘前 (ref 12Z)」「1 hour 38 minutes ago (ref 12Z)」
    // 取 "(ref" 前面那一整段來解析，不能只抓最近的數字（不然 38 分會被當成 38 小時）
    const agoMatch = /([^\n]{0,40}?)\(\s*ref\s*(\d{1,2})Z\s*\)/i.exec(text)
    const ago = agoMatch ? parseAgo(agoMatch[1]) : null

    // 倒數「7h 58m 57s」。一定要有秒，才不會誤抓高級版廣告裡的「1h 58m」
    const cdMatch = /(?:(\d+)\s*h\s*)?(\d+)\s*m\s*(\d+)\s*s/i.exec(text)
    const countdownMs = cdMatch
      ? ((Number(cdMatch[1] || 0) * 60 + Number(cdMatch[2])) * 60 + Number(cdMatch[3])) * 1000
      : null

    // 間隔「12 - 13 hrs」或「6 hrs」
    const rangeMatch = /(\d+)\s*[-–—]\s*(\d+)\s*hrs?\b/i.exec(text)
    const singleMatch = /(\d+)\s*hrs?\b/i.exec(text)
    let candidates = []
    if (rangeMatch) {
      const lo = Number(rangeMatch[1])
      const hi = Number(rangeMatch[2])
      for (let h = lo; h <= hi && h - lo < 24; h++) candidates.push(h)
    } else if (singleMatch) {
      candidates = [Number(singleMatch[1])]
    }
    candidates = candidates.filter(h => h > 0 && h <= 48)

    const nextUpdate = countdownMs != null ? Date.now() + countdownMs : null

    let lastUpdate = null
    let intervalMs = null

    // 最好的狀況：「N 小時 M 分鐘前」精確到分，發布時間直接算得出來，
    // 間隔也不必用猜的 —— 下次更新減發布時間就是了
    if (ago?.precise) {
      lastUpdate = Date.now() - ago.ms
      if (nextUpdate) {
        const hours = Math.round((nextUpdate - lastUpdate) / HOUR)
        if (hours > 0 && hours <= 48) intervalMs = hours * HOUR
      }
    }

    // 只有「N 小時前」時：用「下次更新 − 間隔」回推，挑出對得起來的那個間隔
    if (lastUpdate == null && nextUpdate) {
      for (const h of candidates) {
        const candidate = nextUpdate - h * HOUR
        if (!ago || Math.floor((Date.now() - candidate) / HOUR) === Math.floor(ago.ms / HOUR)) {
          lastUpdate = candidate
          intervalMs = h * HOUR
          break
        }
      }
    }

    // 都對不起來就退而求其次：用「N 小時前」的中位數當發布時間
    if (lastUpdate == null && ago) {
      lastUpdate = Date.now() - ago.ms - (ago.precise ? 0 : 30 * 60_000)
      if (candidates.length) intervalMs = candidates[0] * HOUR
    }
    if (lastUpdate == null) return null

    const modelMatch = /(?:^|\n)\s*[^\n:：]{0,24}[:：]\s*([A-Z][\w\s.+-]{1,24}?)\s*\n/.exec(text)

    return {
      refTime,
      lastUpdate,
      nextUpdate: nextUpdate || (intervalMs ? lastUpdate + intervalMs : null),
      intervalMs,
      modelName: modelMatch ? modelMatch[1].trim() : null,
      source: "info-page",
    }
  }

  function looksLikeInfoPage(text) {
    return !!text && /\(\s*ref\s*\d{1,2}Z\s*\)/i.test(text)
  }

  // 把資訊頁量到的結果換算成「落後量 + 間隔」存起來，之後在地圖頁就能自己算
  function saveCalibration(parsed, product) {
    const key = product || parsed.modelName || "default"
    const lagMs = parsed.lastUpdate - parsed.refTime
    if (lagMs < -HOUR || lagMs > 36 * HOUR) return // 離譜就不要存

    const calib = readJSON(KEY.calib, {})
    calib[key] = {
      // 落後量抓到最近的 5 分鐘，因為「N 小時前」本身就有 ±30 分的誤差
      lagMs: Math.round(lagMs / 300_000) * 300_000,
      intervalMs: parsed.intervalMs || calib[key]?.intervalMs || null,
      modelName: parsed.modelName || calib[key]?.modelName || null,
      savedAt: Date.now(),
    }
    // 再存一份 default，讓還沒認出模式代號時也有東西可用
    calib.default = calib[key]
    writeJSON(KEY.calib, calib)
    log("已校準", key, calib[key])
  }

  function getCalibration(product, modelName) {
    const calib = readJSON(KEY.calib, {})
    return calib[product] || calib[modelName] || calib.default || null
  }

  // ---------------------------------------------------------------------------
  // 二、地圖頁的參考時間來源
  //     （只用來知道「現在是哪一個跑批」，絕不拿它當更新時間）
  // ---------------------------------------------------------------------------
  const REF_KEYS = ["refTime", "reftime", "ref_time", "referenceTime"]
  const PRODUCT_KEYS = ["product", "model", "modelName", "ident"]

  function harvestRef(obj, source, maxDepth = 3) {
    const found = {}
    const seen = new Set()

    const walk = (node, depth) => {
      if (!node || depth > maxDepth || typeof node !== "object" || seen.has(node)) return
      seen.add(node)

      for (const [key, raw] of Object.entries(node)) {
        let value = raw
        if (typeof value === "function") {
          if (value.length !== 0) continue
          try {
            value = value.call(node)
          } catch {
            continue
          }
        }

        if (!found.refTime && REF_KEYS.includes(key)) {
          const ms = toMs(value)
          if (isSaneTime(ms)) found.refTime = ms
        }
        if (!found.product && PRODUCT_KEYS.includes(key) && typeof value === "string" && value.length < 32) {
          found.product = value
        }
        if (value && typeof value === "object") walk(value, depth + 1)
      }
    }

    try {
      walk(obj, 0)
    } catch (err) {
      log("harvest 失敗", source, err)
    }

    return found.refTime ? { ...found, source } : null
  }

  // 攔截頁面的 fetch / XHR：不管 Windy 內部怎麼改，參考時間一定得從網路來
  function sniffText(text, url) {
    if (!text || text.length > 2_000_000 || !/refTime/i.test(text)) return

    // 別的模式的 refTime 套上本模式的落後量會算出錯的時間，
    // 所以已經知道現在看的是哪個模式時，只收提到該模式的回應
    if (state.product) {
      const haystack = `${url} ${text.slice(0, 4000)}`.toLowerCase()
      if (!haystack.includes(state.product.toLowerCase())) return
    }

    try {
      const found = harvestRef(JSON.parse(text), `network:${url}`)
      // product 一律以 window.W 為準，不讓回應裡的名稱把它改掉（會連帶清空 refTime）
      if (found) applyRef(found.refTime, null, found.source)
    } catch { /* 不是 JSON 就算了 */ }
  }

  function installNetworkSniffer() {
    const originalFetch = window.fetch
    if (typeof originalFetch === "function") {
      window.fetch = function (...args) {
        return originalFetch.apply(this, args).then((res) => {
          try {
            const url = typeof args[0] === "string" ? args[0] : res.url
            res.clone().text().then(text => sniffText(text, url)).catch(() => {})
          } catch { /* 不影響原本的請求 */ }
          return res
        })
      }
    }

    const originalOpen = XMLHttpRequest.prototype.open
    const originalSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__wubUrl = url
      return originalOpen.call(this, method, url, ...rest)
    }
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        try {
          if (["", "text", "json"].includes(this.responseType)) {
            sniffText(this.responseType === "json" ? JSON.stringify(this.response) : this.responseText, this.__wubUrl || "")
          }
        } catch { /* 忽略 */ }
      })
      return originalSend.apply(this, args)
    }
  }

  function probeWindyInternals() {
    const W = window.W
    if (!W) return

    let ident = null
    try {
      ident = W.store?.get?.("product") ?? null
    } catch { /* 忽略 */ }

    const product = ident && W.products ? W.products[ident] : null
    const found = (product && harvestRef(product, `W.products.${ident}`, 2))
      || harvestRef(W.store, "W.store", 2)
      || harvestRef(W.models, "W.models", 2)

    if (found || ident) applyRef(found?.refTime ?? null, ident || found?.product || null, found?.source || "W.store")
  }

  // ---------------------------------------------------------------------------
  // 三、把來源湊成畫面上的數字
  // ---------------------------------------------------------------------------
  function applyRef(refTime, product, source) {
    let changed = false

    if (product && product !== state.product) {
      state.product = product
      state.refTime = null
      changed = true
    }
    if (refTime && refTime !== state.refTime) {
      state.refTime = refTime
      changed = true
    }
    if (changed) {
      state.source = source
      recompute()
    }
  }

  function applyInfoPage(parsed) {
    saveCalibration(parsed, state.product)
    Object.assign(state, {
      refTime: parsed.refTime,
      lastUpdate: parsed.lastUpdate,
      nextUpdate: parsed.nextUpdate,
      intervalMs: parsed.intervalMs,
      modelName: parsed.modelName || state.modelName,
      origin: "measured",
      source: parsed.source,
    })
    persistSnapshot()
    render()
  }

  // 用校準值把參考時間換算成發布時間與下次更新
  function recompute() {
    if (state.origin === "measured" && state.lastUpdate) return

    const calib = getCalibration(state.product, state.modelName)
    if (state.refTime && calib?.lagMs != null) {
      state.lastUpdate = state.refTime + calib.lagMs
      state.intervalMs = calib.intervalMs || state.intervalMs
      state.nextUpdate = state.intervalMs ? state.lastUpdate + state.intervalMs : null
      state.modelName = state.modelName || calib.modelName
      state.origin = "derived"
      persistSnapshot()
      render()
      return
    }

    // 讀不到參考時間（W 沒有公開）時，過了預定更新時間就照間隔往後推一輪，
    // 免得徽章永遠停在上次校準的那一輪。推算出來的會標成「推測」。
    if (state.lastUpdate && state.intervalMs && state.nextUpdate) {
      const grace = 60 * 60_000 // Windy 實際發布時間會浮動，給一小時緩衝
      let rolled = false
      for (let i = 0; i < 64 && state.nextUpdate + grace < Date.now(); i++) {
        state.lastUpdate = state.nextUpdate
        state.nextUpdate += state.intervalMs
        rolled = true
      }
      if (rolled) {
        state.origin = "rolled"
        persistSnapshot()
      }
    }
    render()
  }

  function persistSnapshot() {
    writeJSON(KEY.snapshot, {
      product: state.product,
      modelName: state.modelName,
      refTime: state.refTime,
      lastUpdate: state.lastUpdate,
      nextUpdate: state.nextUpdate,
      intervalMs: state.intervalMs,
      savedAt: Date.now(),
    })
  }

  function restoreSnapshot() {
    const snap = readJSON(KEY.snapshot, null)
    if (!snap?.lastUpdate) return
    // 只有在還沒有更好的資料時才拿來墊檔
    if (state.lastUpdate) return
    Object.assign(state, {
      product: state.product || snap.product,
      modelName: snap.modelName,
      refTime: state.refTime || snap.refTime,
      lastUpdate: snap.lastUpdate,
      nextUpdate: snap.nextUpdate,
      intervalMs: snap.intervalMs,
      origin: "cached",
      source: "snapshot",
    })
  }

  // ---------------------------------------------------------------------------
  // 四、校準：開一個 /info 分頁，讀完數字自己關掉
  // ---------------------------------------------------------------------------
  // Windy 的網址帶語言前綴（/zh-TW/multimodel/...），比對規則前要先拿掉
  const LOCALE_PREFIX = /^\/[a-z]{2}(-[A-Za-z]{2,4})?(?=\/|$)/
  const localePrefix = () => (LOCALE_PREFIX.exec(location.pathname) || [""])[0]
  const normalizedPath = () => location.pathname.replace(LOCALE_PREFIX, "") || "/"

  const isInfoPage = /\/info\b/.test(location.pathname)
  const calibrateRequested = () => {
    const at = Number(localStorage.getItem(KEY.request) || 0)
    return at > 0 && Date.now() - at < 60_000
  }

  function startCalibration() {
    localStorage.setItem(KEY.request, String(Date.now()))
    window.open(`${location.origin}${localePrefix()}/info?wub=calibrate`, "_blank")
  }

  function runCalibrationTab() {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const parsed = parseInfoPage(document.body?.innerText)
      if (parsed) {
        probeWindyInternals() // 順便問一下現在是哪個模式，校準值才好分開存
        saveCalibration(parsed, state.product)
        writeJSON(KEY.snapshot, {
          product: state.product,
          modelName: parsed.modelName,
          refTime: parsed.refTime,
          lastUpdate: parsed.lastUpdate,
          nextUpdate: parsed.nextUpdate,
          intervalMs: parsed.intervalMs,
          savedAt: Date.now(),
        })
        localStorage.removeItem(KEY.request)
        clearInterval(timer)
        window.close()
      } else if (Date.now() - startedAt > CONFIG.calibrateTimeoutMs) {
        localStorage.removeItem(KEY.request)
        clearInterval(timer)
      }
    }, 500)
  }

  // ---------------------------------------------------------------------------
  // 顯示用格式
  // ---------------------------------------------------------------------------
  function fmtAgo(ms) {
    const diff = Date.now() - ms
    if (diff < 60_000) return "剛剛更新"
    const mins = Math.floor(diff / 60_000)
    if (mins < 60) return `${mins} 分鐘前`
    const hours = Math.floor(mins / 60)
    if (hours < 2) return `${hours} 小時 ${mins % 60} 分鐘前`
    if (hours < 48) return `${hours} 小時前`
    return `${Math.floor(hours / 24)} 天前`
  }

  function fmtCountdown(ms) {
    const total = Math.max(0, Math.round(ms / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    return h ? `${h}h ${m}m ${String(s).padStart(2, "0")}s` : `${m}m ${String(s).padStart(2, "0")}s`
  }

  const fmtZ = ms => `${String(new Date(ms).getUTCHours()).padStart(2, "0")}Z`

  function fmtLocal(ms) {
    const d = new Date(ms)
    const pad = n => String(n).padStart(2, "0")
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // ---------------------------------------------------------------------------
  // 五、徽章 UI
  // ---------------------------------------------------------------------------
  let el = null
  let collapsed = localStorage.getItem(KEY.collapsed) === "1"

  function createBadge() {
    if (el || !document.body) return

    el = document.createElement("div")
    el.id = "windy-update-badge"
    el.innerHTML = `
      <style>
        #windy-update-badge {
          position: fixed; z-index: 2147483000; top: 12px; right: 12px;
          font: 12px/1.45 -apple-system, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif;
          color: #eaeaea; background: rgba(20, 20, 24, .88); backdrop-filter: blur(6px);
          border: 1px solid rgba(255, 255, 255, .14); border-radius: 8px;
          padding: 6px 10px; cursor: move; user-select: none;
          box-shadow: 0 4px 14px rgba(0, 0, 0, .35); min-width: 124px; max-width: 240px;
        }
        #windy-update-badge .wub-main { display: flex; align-items: center; gap: 6px; font-weight: 600; }
        #windy-update-badge .wub-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; flex: none; }
        #windy-update-badge.wub-stale .wub-dot { background: #fbbf24; }
        #windy-update-badge.wub-unknown .wub-dot { background: #94a3b8; }
        #windy-update-badge .wub-sub { opacity: .75; margin-top: 2px; font-size: 11px; }
        #windy-update-badge .wub-details { margin-top: 6px; padding-top: 6px; font-size: 11px; opacity: .8;
          border-top: 1px solid rgba(255, 255, 255, .12); display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
        #windy-update-badge .wub-details b { font-weight: 500; opacity: .65; }
        #windy-update-badge.wub-collapsed .wub-details,
        #windy-update-badge.wub-collapsed .wub-sub,
        #windy-update-badge.wub-collapsed .wub-cal { display: none; }
        #windy-update-badge .wub-cal { margin-top: 6px; width: 100%; padding: 3px 6px; font: inherit; font-size: 11px;
          color: #eaeaea; background: rgba(255, 255, 255, .12); border: 0; border-radius: 5px; cursor: pointer; }
        #windy-update-badge .wub-cal:hover { background: rgba(255, 255, 255, .2); }
      </style>
      <div class="wub-main"><span class="wub-dot"></span><span class="wub-ago">讀取中…</span></div>
      <div class="wub-sub"></div>
      <div class="wub-details"></div>
      <button class="wub-cal" type="button">校準（開一次資訊頁）</button>
    `
    document.body.appendChild(el)

    el.querySelector(".wub-cal").addEventListener("click", (e) => {
      e.stopPropagation()
      startCalibration()
    })

    restorePosition()
    makeDraggable(el)

    el.addEventListener("click", () => {
      if (el.__dragged) return
      collapsed = !collapsed
      localStorage.setItem(KEY.collapsed, collapsed ? "1" : "0")
      render()
    })

    render()
  }

  function restorePosition() {
    const pos = readJSON(KEY.pos, null)
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      el.style.left = `${Math.min(pos.left, window.innerWidth - 60)}px`
      el.style.top = `${Math.min(pos.top, window.innerHeight - 40)}px`
      el.style.right = "auto"
    }
  }

  function makeDraggable(node) {
    let startX = 0; let startY = 0; let baseLeft = 0; let baseTop = 0; let dragging = false

    node.addEventListener("pointerdown", (e) => {
      if (e.target.classList.contains("wub-cal")) return
      dragging = true
      node.__dragged = false
      startX = e.clientX
      startY = e.clientY
      const rect = node.getBoundingClientRect()
      baseLeft = rect.left
      baseTop = rect.top
      node.setPointerCapture(e.pointerId)
    })

    node.addEventListener("pointermove", (e) => {
      if (!dragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.abs(dx) + Math.abs(dy) > 3) node.__dragged = true
      node.style.left = `${baseLeft + dx}px`
      node.style.top = `${baseTop + dy}px`
      node.style.right = "auto"
    })

    node.addEventListener("pointerup", () => {
      if (!dragging) return
      dragging = false
      const rect = node.getBoundingClientRect()
      writeJSON(KEY.pos, { left: rect.left, top: rect.top })
      setTimeout(() => { node.__dragged = false }, 0)
    })
  }

  function render() {
    if (!el) return

    const agoEl = el.querySelector(".wub-ago")
    const subEl = el.querySelector(".wub-sub")
    const detailsEl = el.querySelector(".wub-details")
    const calEl = el.querySelector(".wub-cal")

    const { lastUpdate, nextUpdate } = state
    const overdue = !!(nextUpdate && nextUpdate < Date.now())

    el.classList.toggle("wub-collapsed", collapsed)
    el.classList.toggle("wub-unknown", !lastUpdate)
    el.classList.toggle("wub-stale", overdue)
    calEl.style.display = lastUpdate && state.origin !== "cached" ? "none" : ""

    if (!lastUpdate) {
      agoEl.textContent = state.refTime ? `ref ${fmtZ(state.refTime)} · 未校準` : "更新時間 —"
      subEl.textContent = "按下面的按鈕抓一次更新時間"
      detailsEl.innerHTML = state.refTime
        ? `<b>參考時間</b><span>${fmtLocal(state.refTime)}</span>`
        : "<b>提示</b><span>等 Windy 載完，或先校準一次</span>"
      return
    }

    agoEl.textContent = fmtAgo(lastUpdate)
    subEl.textContent = !nextUpdate
      ? "下次更新時間未知"
      : overdue
        ? "應該隨時會更新"
        : `下次更新 ${fmtCountdown(nextUpdate - Date.now())}`

    const originText = { measured: "資訊頁", derived: "已校準", rolled: "推測", cached: "上次紀錄" }[state.origin] || "—"
    const rows = []
    if (state.modelName || state.product) rows.push(["模式", state.modelName || state.product])
    if (state.refTime) rows.push(["參考時間", `${fmtZ(state.refTime)}（${fmtLocal(state.refTime)}）`])
    rows.push(["發布於", fmtLocal(lastUpdate)])
    if (nextUpdate) rows.push(["下次", fmtLocal(nextUpdate)])
    if (state.intervalMs) rows.push(["間隔", `${Math.round(state.intervalMs / HOUR)} 小時`])
    rows.push(["來源", CONFIG.debug && state.source ? `${originText}｜${state.source}` : originText])

    detailsEl.innerHTML = rows.map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join("")
  }

  // ---------------------------------------------------------------------------
  // 六、順手的預設值
  //     (1) 進站直接選降雨圖層
  //     (2) 「此地點的天氣預報」打開時直接切到 Meteogram
  // ---------------------------------------------------------------------------
  let overlayDone = false
  let overlayTries = 0

  function applyDefaultOverlay() {
    const want = CONFIG.defaultOverlay
    if (!want || overlayDone) return

    // 網址已經指定別的圖層（例如 https://www.windy.com/?wind,25.0,121.5,8）就尊重使用者
    const fromUrl = /^\?([a-z0-9]+)[,&]/i.exec(location.search)
    if (fromUrl && fromUrl[1].toLowerCase() !== want.toLowerCase()) {
      overlayDone = true
      log("網址已指定圖層，不覆蓋", fromUrl[1])
      return
    }

    if (overlayTries++ > 20) return // Windy 一直沒載起來就放棄，不要一直戳

    const store = window.W?.store
    try {
      if (store?.get?.("overlay") === want) {
        overlayDone = true
        return
      }
      if (typeof store?.set === "function") {
        store.set("overlay", want)
        log("已切換圖層", want)
        return // 下一輪用 store.get 確認
      }
    } catch (err) {
      log("切換圖層失敗", err)
    }

    // 後備：直接點畫面上的圖層按鈕
    const btn = document.querySelector(`[data-overlay="${want}"], #overlay-${want}`)
    if (btn) {
      btn.click()
      overlayDone = true
      log("已用 DOM 切換圖層", want)
    }
  }

  // 面板關掉再打開時要能再切一次，所以用「頁籤還在不在」來決定要不要重置
  const tabDone = new Map()
  let lastPath = normalizedPath()

  // 面板裡可能有同名的標題，所以把所有候選評分排序，挑「最像頁籤」的那一個來點
  function collectTabs(label) {
    const wanted = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    const found = []

    for (const node of document.querySelectorAll("a, button, li, span, div")) {
      if (node.children.length > 1) continue // 只看最裡層的文字節點
      const text = (node.textContent || "").trim()
      if (text.length > 20 || !wanted.test(text)) continue
      if (!node.offsetParent && node.offsetWidth === 0) continue // 沒顯示出來

      const hint = `${node.className || ""} ${node.id || ""} ${node.getAttribute?.("role") || ""}`
      let score = 0
      if (node.tagName === "A" || node.tagName === "BUTTON") score += 3
      if (/tab|btn|button|switch|menu/i.test(hint)) score += 2
      if (node.getAttribute?.("data-do") || node.getAttribute?.("data-ref")) score += 1
      found.push({ node, text, tag: node.tagName, className: node.className || "", score })
    }

    return found.sort((a, b) => b.score - a.score)
  }

  const findTab = label => collectTabs(label)[0]?.node || null

  function isActive(node) {
    for (let n = node; n && n !== document.body; n = n.parentElement) {
      if (/(^|\s)(active|selected|on)(\s|$)/.test(n.className || "")) return true
    }
    return false
  }

  // Windy 是單頁應用，切到「比較不同預報模式」只會改 path，所以每次都重新比對規則
  function currentTabRule() {
    const rules = CONFIG.autoTabs || []
    const path = normalizedPath()
    return rules.find(r => r.path && path.startsWith(r.path))
      || rules.find(r => !r.path)
      || null
  }

  function applyAutoTab() {
    if (normalizedPath() !== lastPath) {
      lastPath = normalizedPath()
      tabDone.clear() // 換頁了，每條規則都可以再點一次
    }

    const rule = currentTabRule()
    if (!rule?.label) return

    const tab = findTab(rule.label)
    if (!tab) {
      tabDone.delete(rule.label) // 面板關了，下次打開再切一次
      return
    }
    if (tabDone.get(rule.label)) return

    tabDone.set(rule.label, true)
    if (!isActive(tab)) {
      tab.click()
      log("已切換頁籤", rule.label)
    }
  }

  function watchDetailPanel() {
    let scheduled = false
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      setTimeout(() => {
        scheduled = false
        try {
          applyAutoTab()
        } catch (err) {
          log("切換頁籤失敗", err)
        }
      }, 120) // 等面板畫完再動作
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  // ---------------------------------------------------------------------------
  // 啟動
  // ---------------------------------------------------------------------------
  installNetworkSniffer()

  function tick() {
    // 資訊頁只要開著就現讀，順便校準
    const text = document.body?.innerText
    if (looksLikeInfoPage(text)) {
      const parsed = parseInfoPage(text)
      if (parsed) applyInfoPage(parsed)
    }
    probeWindyInternals()
    recompute()
    applyDefaultOverlay()
  }

  function boot() {
    if (isInfoPage && (calibrateRequested() || /wub=calibrate/.test(location.search))) {
      runCalibrationTab() // 這個分頁只負責讀數字然後自己關掉
      return
    }
    createBadge()
    restoreSnapshot()
    watchDetailPanel()
    tick()
    setInterval(tick, CONFIG.probeIntervalMs)
    setInterval(render, 1000) // 倒數每秒重畫
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true })
  } else {
    boot()
  }

  // 方便在主控台檢查
  window.__windyUpdateBadge = {
    state,
    config: CONFIG,
    tick,
    render,
    calibrate: startCalibration,
    calibration: () => readJSON(KEY.calib, {}),
    parseInfoPage: () => parseInfoPage(document.body?.innerText),
    setOverlay: (name = CONFIG.defaultOverlay) => {
      overlayDone = false
      overlayTries = 0
      CONFIG.defaultOverlay = name
      applyDefaultOverlay()
    },
    openTab: (label) => {
      const target = label || currentTabRule()?.label
      if (!target) return null
      tabDone.delete(target)
      const tab = findTab(target)
      if (tab) tab.click()
      return tab
    },
    tabRule: currentTabRule,
    reset: () => Object.values(KEY).forEach(k => localStorage.removeItem(k)),

    // 一行把所有需要的資訊印出來，方便回報問題
    dump: () => {
      const W = window.W
      const safe = (fn) => {
        try {
          return fn()
        } catch (err) {
          return `error: ${err.message}`
        }
      }
      const rule = currentTabRule()

      // 掃 window.W，把任何能解析成「最近的時間」的欄位連路徑一起列出來，
      // 用來找出 Windy 到底把跑批時間放在哪裡
      const scanTimes = () => {
        const hits = []
        const seen = new Set()
        const walk = (node, path, depth) => {
          if (!node || depth > 3 || hits.length >= 40 || seen.has(node)) return
          seen.add(node)
          let keys = []
          try {
            keys = Object.keys(node)
          } catch {
            return
          }
          for (const k of keys.slice(0, 60)) {
            let v
            try {
              v = node[k]
            } catch {
              continue
            }
            if (typeof v === "function") continue
            if (typeof v === "string" || typeof v === "number") {
              const ms = toMs(v)
              if (isSaneTime(ms)) hits.push({ 路徑: `${path}.${k}`, 值: v, 時間: new Date(ms).toISOString() })
            } else if (v && typeof v === "object") {
              walk(v, `${path}.${k}`, depth + 1)
            }
          }
        }
        walk(W, "W", 0)
        return hits
      }

      const storeKeys = ["product", "overlay", "path", "refTime", "calendar", "acTime", "level", "pathBase", "product2"]
      const report = {
        版本: "2.4.0",
        網址: location.pathname + location.search,
        徽章存在: !!document.getElementById("windy-update-badge"),
        狀態: {
          ...state,
          參考時間: state.refTime ? new Date(state.refTime).toISOString() : null,
          發布於: state.lastUpdate ? new Date(state.lastUpdate).toISOString() : null,
          下次: state.nextUpdate ? new Date(state.nextUpdate).toISOString() : null,
        },
        校準表: readJSON(KEY.calib, {}),
        windowW: {
          存在: typeof W,
          product: safe(() => W?.store?.get?.("product")),
          overlay: safe(() => W?.store?.get?.("overlay")),
          有products: safe(() => Object.keys(W?.products || {}).length),
        },
        路徑: { 原始: location.pathname, 去掉語言前綴: normalizedPath() },
        store各鍵: Object.fromEntries(storeKeys.map(k => [k, safe(() => JSON.stringify(W?.store?.get?.(k))?.slice(0, 120))])),
        W裡的時間欄位: safe(scanTimes),
        頁籤規則: rule,
        頁籤候選: rule?.label
          ? collectTabs(rule.label).map(({ text, tag, className, score }) => ({ text, tag, className, score }))
          : [],
        資訊頁解析: safe(() => parseInfoPage(document.body?.innerText)),
      }
      console.log(JSON.stringify(report, null, 2))
      return report
    },
  }
})()
