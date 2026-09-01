// ==UserScript==
// @name         Windy 更新時間徽章 (Windy Update Badge)
// @name:en      Windy Update Badge
// @namespace    https://github.com/charles0506/newsnow
// @version      1.0.0
// @description  直接在 windy.com 地圖上顯示目前預測模式的「多久前更新」與「下次更新倒數」，不用再打開 /info 資訊頁面。
// @description:en Show model last-update / next-update countdown directly on the windy.com map, without opening the /info page.
// @author       charles0506
// @license      MIT
// @match        https://www.windy.com/*
// @match        https://*.windy.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

// 注意：@grant none 是刻意的。這樣腳本會跑在頁面本身的 context，
// 才能讀到 window.W（Windy 內部模組）並攔截頁面自己發出的 fetch/XHR。

(function () {
  "use strict"

  // ---------------------------------------------------------------------------
  // 設定
  // ---------------------------------------------------------------------------
  const CONFIG = {
    // 開 true 之後，主控台會印出每一個抓到更新時間的來源，方便排查 Windy 改版
    debug: false,
    // 重新探測 window.W 的間隔（毫秒）
    probeIntervalMs: 5000,
    // 徽章位置的 localStorage key
    positionKey: "windy-update-badge:pos",
    collapsedKey: "windy-update-badge:collapsed",
  }

  const log = (...args) => CONFIG.debug && console.log("[windy-update-badge]", ...args)

  // ---------------------------------------------------------------------------
  // 狀態：所有來源（網路攔截 / window.W / DOM）都往這裡寫
  // ---------------------------------------------------------------------------
  const state = {
    product: null, // 模式名稱，例如 ecmwf
    refTime: null, // 參考時間（模式起算時間，ref 12Z 的那個 12Z）
    updateTime: null, // 這份資料實際發布/更新的時間
    nextUpdate: null, // 下次更新時間
    updateIntervalMs: null, // 更新間隔
    source: null, // 資料是從哪裡來的，debug 用
    updatedAt: 0, // 這份 state 是什麼時候被寫進來的
  }

  // 我們在任何 JSON 裡面尋找的欄位名稱（Windy 改版時第一個要調整的地方）
  const FIELDS = {
    refTime: ["refTime", "reftime", "ref_time", "referenceTime"],
    updateTime: ["updateTime", "lastUpdate", "lastUpdated", "updated", "initTime"],
    nextUpdate: ["nextUpdate", "nextUpdateTime", "nextRun"],
    updateInterval: ["updateInterval", "updateIntervalHours", "updateIntervalMinutes"],
    product: ["product", "model", "modelName", "ident"],
  }

  // ---------------------------------------------------------------------------
  // 時間解析：Windy 的時間欄位有好幾種長相
  //   ISO 字串 "2026-08-31T12:00:00Z"、epoch 毫秒、epoch 秒、"2026083112"(YYYYMMDDHH)
  // ---------------------------------------------------------------------------
  function toMs(value) {
    if (value == null) return null

    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null
      // epoch 毫秒
      if (value > 1e12) return value
      // epoch 秒
      if (value > 1e9) return value * 1000
      // YYYYMMDDHH（例如 2026083112）
      if (value > 1e9 / 100 && value < 1e10) return fromYmdh(String(value))
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

  function toIntervalMs(key, value) {
    const n = typeof value === "string" ? Number(value) : value
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null
    if (/minute/i.test(key)) return n * 60_000
    if (n <= 48) return n * 3_600_000 // 小時
    if (n <= 2880) return n * 60_000 // 分鐘
    return n // 已經是毫秒
  }

  // 合理性檢查：只接受最近 30 天到未來 30 天之間的時間，避免抓到不相干的欄位
  function isSaneTime(ms) {
    if (!ms) return false
    const now = Date.now()
    return ms > now - 30 * 864e5 && ms < now + 30 * 864e5
  }

  // ---------------------------------------------------------------------------
  // 深度掃描任意物件，把符合 FIELDS 的欄位挖出來
  // ---------------------------------------------------------------------------
  function harvest(obj, source, maxDepth = 4) {
    const found = {}
    const seen = new Set()

    const walk = (node, depth) => {
      if (!node || depth > maxDepth || typeof node !== "object") return
      if (seen.has(node)) return
      seen.add(node)

      for (const [key, raw] of Object.entries(node)) {
        let value = raw
        // Windy 有些欄位是 getter / 方法，例如 product.getRefTime()
        if (typeof value === "function") {
          if (value.length !== 0) continue
          try {
            value = value.call(node)
          } catch {
            continue
          }
        }

        if (!found.refTime && FIELDS.refTime.includes(key)) {
          const ms = toMs(value)
          if (isSaneTime(ms)) found.refTime = ms
        }
        if (!found.updateTime && FIELDS.updateTime.includes(key)) {
          const ms = toMs(value)
          if (isSaneTime(ms)) found.updateTime = ms
        }
        if (!found.nextUpdate && FIELDS.nextUpdate.includes(key)) {
          const ms = toMs(value)
          if (isSaneTime(ms)) found.nextUpdate = ms
        }
        if (!found.updateIntervalMs && FIELDS.updateInterval.includes(key)) {
          const ms = toIntervalMs(key, value)
          if (ms) found.updateIntervalMs = ms
        }
        if (!found.product && FIELDS.product.includes(key) && typeof value === "string" && value.length < 32) {
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

    return Object.keys(found).length ? { ...found, source } : null
  }

  // authoritative = 來自 window.W（代表使用者現在真的在看這個模式），
  // 網路攔截到的資料則可能是別的模式的，模式對不上就不要蓋掉。
  function apply(found, authoritative = false) {
    if (!found) return false

    if (found.product && state.product && found.product !== state.product) {
      if (!authoritative) return false
      // 換模式了，先清掉舊模式的時間，避免兩個模式的數字混在一起
      state.refTime = null
      state.updateTime = null
      state.nextUpdate = null
      state.updateIntervalMs = null
    }

    let changed = false
    for (const key of ["product", "refTime", "updateTime", "nextUpdate", "updateIntervalMs"]) {
      if (found[key] != null && found[key] !== state[key]) {
        state[key] = found[key]
        changed = true
      }
    }
    if (changed) {
      state.source = found.source
      state.updatedAt = Date.now()
      log("更新狀態", found.source, { ...state })
      render()
    }
    return changed
  }

  // ---------------------------------------------------------------------------
  // 來源 1：攔截頁面的 fetch / XHR，從回應 JSON 裡撈更新時間
  //         （最耐改版：不管 Windy 內部模組怎麼改，資料一定得從網路來）
  // ---------------------------------------------------------------------------
  function sniffText(text, url) {
    if (!text || text.length > 2_000_000) return
    // 先用字串快篩，避免每個回應都 JSON.parse
    if (!/refTime|updateTime|lastUpdate|nextUpdate|updateInterval/i.test(text)) return
    try {
      apply(harvest(JSON.parse(text), `network:${url}`))
    } catch {
      /* 不是 JSON 就算了 */
    }
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
      this.__windyBadgeUrl = url
      return originalOpen.call(this, method, url, ...rest)
    }
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "" || this.responseType === "text" || this.responseType === "json") {
            const body = this.responseType === "json" ? JSON.stringify(this.response) : this.responseText
            sniffText(body, this.__windyBadgeUrl || "")
          }
        } catch { /* 忽略 */ }
      })
      return originalSend.apply(this, args)
    }

    log("網路攔截已安裝")
  }

  // ---------------------------------------------------------------------------
  // 來源 2：window.W —— Windy 把內部模組掛在這個全域變數上
  // ---------------------------------------------------------------------------
  function probeWindyInternals() {
    const W = window.W
    if (!W) return false

    let ident = null
    try {
      ident = W.store?.get?.("product") ?? null
    } catch { /* 忽略 */ }

    const product = ident && W.products ? W.products[ident] : null
    if (product) {
      const found = harvest(product, `W.products.${ident}`, 2)
      if (found) {
        found.product = found.product || ident
        if (apply(found, true)) return true
      }
    }

    // 找不到就退而求其次，掃 store / models
    for (const [name, node] of [["W.store", W.store], ["W.models", W.models], ["W.products", W.products]]) {
      if (!node) continue
      const found = harvest(node, name, 3)
      if (found?.refTime || found?.updateTime) {
        if (ident) found.product = found.product || ident
        if (apply(found, true)) return true
      }
    }

    if (ident && ident !== state.product) {
      state.product = ident
      state.refTime = null
      state.updateTime = null
      state.nextUpdate = null
      state.updateIntervalMs = null
      render()
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // 來源 3：如果使用者剛好開過 /info 頁面，直接從畫面上把 ISO 參考時間撈走
  // ---------------------------------------------------------------------------
  function probeDom() {
    if (state.refTime) return
    const text = document.body?.innerText
    if (!text) return
    const m = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.exec(text)
    if (m) {
      const ms = toMs(m[0])
      if (isSaneTime(ms)) apply({ refTime: ms, source: "dom:/info" })
    }
  }

  // ---------------------------------------------------------------------------
  // 顯示用格式
  // ---------------------------------------------------------------------------
  function fmtAgo(ms) {
    const diff = Date.now() - ms
    if (diff < 0) return "剛剛"
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return "剛剛"
    if (mins < 60) return `${mins} 分鐘前`
    const hours = Math.floor(mins / 60)
    if (hours < 48) return `${hours} 小時前${mins % 60 ? ` ${mins % 60} 分` : ""}`
    return `${Math.floor(hours / 24)} 天前`
  }

  function fmtCountdown(ms) {
    const total = Math.max(0, Math.round(ms / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    return h ? `${h}h ${m}m ${String(s).padStart(2, "0")}s` : `${m}m ${String(s).padStart(2, "0")}s`
  }

  function fmtZ(ms) {
    const d = new Date(ms)
    return `${String(d.getUTCHours()).padStart(2, "0")}Z`
  }

  function fmtLocal(ms) {
    const d = new Date(ms)
    const pad = n => String(n).padStart(2, "0")
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function nextUpdateMs() {
    if (state.nextUpdate) return state.nextUpdate
    const base = state.updateTime || state.refTime
    if (!base || !state.updateIntervalMs) return null
    // 從基準時間往後推，直到落在未來
    let next = base + state.updateIntervalMs
    const guard = Date.now() + 30 * 864e5
    while (next < Date.now() && next < guard) next += state.updateIntervalMs
    return next
  }

  // ---------------------------------------------------------------------------
  // 徽章 UI
  // ---------------------------------------------------------------------------
  let el = null
  let collapsed = localStorage.getItem(CONFIG.collapsedKey) === "1"

  function createBadge() {
    if (el || !document.body) return
    el = document.createElement("div")
    el.id = "windy-update-badge"
    el.innerHTML = `
      <style>
        #windy-update-badge {
          position: fixed; z-index: 2147483000; top: 12px; right: 12px;
          font: 12px/1.45 -apple-system, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif;
          color: #eaeaea; background: rgba(20, 20, 24, .86); backdrop-filter: blur(6px);
          border: 1px solid rgba(255, 255, 255, .14); border-radius: 8px;
          padding: 6px 10px; cursor: move; user-select: none;
          box-shadow: 0 4px 14px rgba(0, 0, 0, .35); min-width: 120px;
        }
        #windy-update-badge .wub-main { display: flex; align-items: center; gap: 6px; font-weight: 600; }
        #windy-update-badge .wub-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; flex: none; }
        #windy-update-badge.wub-stale .wub-dot { background: #fbbf24; }
        #windy-update-badge.wub-unknown .wub-dot { background: #94a3b8; }
        #windy-update-badge .wub-sub { opacity: .75; margin-top: 2px; font-size: 11px; }
        #windy-update-badge .wub-details { margin-top: 6px; padding-top: 6px; font-size: 11px; opacity: .8;
          border-top: 1px solid rgba(255, 255, 255, .12); display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
        #windy-update-badge.wub-collapsed .wub-details, #windy-update-badge.wub-collapsed .wub-sub { display: none; }
        #windy-update-badge .wub-details b { font-weight: 500; opacity: .65; }
      </style>
      <div class="wub-main"><span class="wub-dot"></span><span class="wub-ago">讀取中…</span></div>
      <div class="wub-sub"></div>
      <div class="wub-details"></div>
    `
    document.body.appendChild(el)

    restorePosition()
    makeDraggable(el)

    // 單擊（沒有拖曳）就收合／展開
    el.addEventListener("click", (e) => {
      if (el.__dragged) return
      e.stopPropagation()
      collapsed = !collapsed
      localStorage.setItem(CONFIG.collapsedKey, collapsed ? "1" : "0")
      render()
    })

    render()
  }

  function restorePosition() {
    try {
      const pos = JSON.parse(localStorage.getItem(CONFIG.positionKey) || "null")
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        el.style.left = `${Math.min(pos.left, window.innerWidth - 60)}px`
        el.style.top = `${Math.min(pos.top, window.innerHeight - 40)}px`
        el.style.right = "auto"
      }
    } catch { /* 忽略壞掉的設定 */ }
  }

  function makeDraggable(node) {
    let startX = 0; let startY = 0; let baseLeft = 0; let baseTop = 0; let dragging = false

    node.addEventListener("pointerdown", (e) => {
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
      localStorage.setItem(CONFIG.positionKey, JSON.stringify({ left: rect.left, top: rect.top }))
      // 讓 click 事件先判斷完再清除旗標
      setTimeout(() => { node.__dragged = false }, 0)
    })
  }

  function render() {
    if (!el) return

    const agoEl = el.querySelector(".wub-ago")
    const subEl = el.querySelector(".wub-sub")
    const detailsEl = el.querySelector(".wub-details")

    const last = state.updateTime || state.refTime
    const next = nextUpdateMs()

    el.classList.toggle("wub-collapsed", collapsed)
    el.classList.toggle("wub-unknown", !last)
    el.classList.toggle("wub-stale", !!(next && next < Date.now()))

    if (!last) {
      agoEl.textContent = "更新時間 —"
      subEl.textContent = "等待 Windy 載入資料"
      detailsEl.innerHTML = "<b>提示</b><span>切換一次模式或開一次資訊頁即可抓到</span>"
      return
    }

    agoEl.textContent = fmtAgo(last)
    subEl.textContent = next
      ? (next > Date.now() ? `下次更新 ${fmtCountdown(next - Date.now())}` : "應該隨時會更新")
      : "下次更新時間未知"

    const rows = []
    if (state.product) rows.push(["模式", state.product])
    if (state.refTime) rows.push(["參考時間", `${fmtZ(state.refTime)}（${fmtLocal(state.refTime)}）`])
    if (state.updateTime) rows.push(["發布於", fmtLocal(state.updateTime)])
    if (next) rows.push(["下次", fmtLocal(next)])
    if (state.updateIntervalMs) rows.push(["間隔", `${Math.round(state.updateIntervalMs / 3_600_000)} 小時`])
    if (CONFIG.debug && state.source) rows.push(["來源", state.source])

    detailsEl.innerHTML = rows.map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join("")
  }

  // ---------------------------------------------------------------------------
  // 啟動
  // ---------------------------------------------------------------------------
  installNetworkSniffer()

  function boot() {
    createBadge()
    probeWindyInternals()
    probeDom()
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true })
  } else {
    boot()
  }

  // 定期重新探測（換模式、SPA 換頁都靠這個）
  setInterval(() => {
    createBadge()
    probeWindyInternals()
    probeDom()
  }, CONFIG.probeIntervalMs)

  // 倒數每秒重畫
  setInterval(render, 1000)

  // 方便在主控台檢查目前抓到什麼
  window.__windyUpdateBadge = { state, config: CONFIG, probe: probeWindyInternals, render }
})()
