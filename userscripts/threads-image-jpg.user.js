// ==UserScript==
// @name         Threads 圖片下載轉 JPG (Threads Image to JPG)
// @name:en      Threads Image to JPG
// @namespace    https://github.com/charles0506/newsnow
// @version      1.0.0
// @description  滑鼠移到 Threads 的圖片上會出現「⬇ JPG」按鈕，一鍵把原圖（通常是 WebP）轉成 JPG 下載。Alt + 點圖片也可以直接下載。
// @description:en Hover any image on Threads to get a "⬇ JPG" button that downloads the full-size image converted to JPG.
// @author       charles0506
// @license      MIT
// @homepageURL  https://github.com/charles0506/newsnow/tree/main/userscripts
// @supportURL   https://github.com/charles0506/newsnow/issues
// @downloadURL  https://raw.githubusercontent.com/charles0506/newsnow/main/userscripts/threads-image-jpg.user.js
// @updateURL    https://raw.githubusercontent.com/charles0506/newsnow/main/userscripts/threads-image-jpg.user.js
// @match        https://www.threads.com/*
// @match        https://www.threads.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      cdninstagram.com
// @connect      fbcdn.net
// @noframes
// ==/UserScript==

// 做法：Threads 的圖片放在 Instagram / Facebook 的 CDN，而且多半是 WebP。
// 直接把 <img> 畫到 canvas 會因為跨網域被「污染」而無法匯出，
// 所以改用 GM_xmlhttpRequest 把原檔抓成 Blob（不受 CORS 限制），
// 解碼後鋪一層白底再畫上去（JPG 沒有透明度），最後用 canvas.toBlob 輸出 JPG。

(function () {
  "use strict"

  // ---------------------------------------------------------------------------
  // 設定
  // ---------------------------------------------------------------------------
  const CONFIG = {
    // 小於這個顯示尺寸（px）的圖不出按鈕，避免大頭貼、表情符號
    minSize: 120,
    // JPG 品質選項，透過選單切換
    qualities: [0.92, 0.85, 1],
    // 檔名前綴
    prefix: "threads",
  }

  let quality = GM_getValue("quality", CONFIG.qualities[0])
  let menuId = null

  // ---------------------------------------------------------------------------
  // 選單：切換 JPG 品質
  // ---------------------------------------------------------------------------
  function renderMenu() {
    if (menuId !== null && typeof GM_unregisterMenuCommand === "function") {
      GM_unregisterMenuCommand(menuId)
    }
    menuId = GM_registerMenuCommand(`🖼 JPG 品質：${Math.round(quality * 100)}%（點擊切換）`, () => {
      const i = CONFIG.qualities.indexOf(quality)
      quality = CONFIG.qualities[(i + 1) % CONFIG.qualities.length]
      GM_setValue("quality", quality)
      toast(`JPG 品質改為 ${Math.round(quality * 100)}%`)
      renderMenu()
    })
  }
  renderMenu()

  // ---------------------------------------------------------------------------
  // 浮動按鈕：跟著滑鼠底下的圖片走
  // ---------------------------------------------------------------------------
  const btn = document.createElement("button")
  btn.textContent = "⬇ JPG"
  btn.title = "下載這張圖（轉成 JPG）"
  Object.assign(btn.style, {
    position: "fixed",
    zIndex: 2147483647,
    display: "none",
    padding: "4px 10px",
    border: "none",
    borderRadius: "999px",
    background: "rgba(0,0,0,.72)",
    color: "#fff",
    font: "600 12px/1.4 system-ui, sans-serif",
    cursor: "pointer",
    boxShadow: "0 1px 4px rgba(0,0,0,.4)",
  })
  let currentImg = null

  btn.addEventListener("click", (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (currentImg) download(currentImg)
  })

  function mount() {
    if (!btn.isConnected) document.body.appendChild(btn)
  }

  // Threads 常在圖片上蓋一層透明的 div，mouseover 不一定落在 <img> 上，
  // 所以用 elementsFromPoint 把游標底下的每一層都翻出來找 <img>
  function findImgAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === btn) return currentImg
      if (el.tagName === "IMG" && isCandidate(el)) return el
    }
    return null
  }

  function isCandidate(img) {
    const r = img.getBoundingClientRect()
    if (r.width < CONFIG.minSize || r.height < CONFIG.minSize) return false
    return /cdninstagram\.com|fbcdn\.net/.test(bestUrl(img))
  }

  function place(img) {
    const r = img.getBoundingClientRect()
    btn.style.top = `${Math.max(r.top, 0) + 8}px`
    btn.style.left = `${r.right - btn.offsetWidth - 8}px`
  }

  let raf = 0
  document.addEventListener(
    "mousemove",
    (e) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        mount()
        const img = findImgAt(e.clientX, e.clientY)
        if (img) {
          currentImg = img
          btn.style.display = "block"
          place(img)
        } else {
          currentImg = null
          btn.style.display = "none"
        }
      })
    },
    { passive: true },
  )
  window.addEventListener("scroll", () => {
    if (currentImg) place(currentImg)
  }, { passive: true })

  // Alt + 點圖片：不用瞄準按鈕，直接下載
  document.addEventListener(
    "click",
    (e) => {
      if (!e.altKey) return
      const img = findImgAt(e.clientX, e.clientY)
      if (!img) return
      e.preventDefault()
      e.stopPropagation()
      download(img)
    },
    true,
  )

  // ---------------------------------------------------------------------------
  // 下載與轉檔
  // ---------------------------------------------------------------------------

  // srcset 裡最大的那張才是原圖，src 常常只是縮圖
  function bestUrl(img) {
    let best = img.currentSrc || img.src
    let bestW = 0
    for (const part of (img.srcset || "").split(",")) {
      const [url, w] = part.trim().split(/\s+/)
      const n = Number.parseInt(w, 10) || 0
      if (url && n > bestW) {
        best = url
        bestW = n
      }
    }
    return best
  }

  function fetchBlob(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "blob",
        onload: (res) => (res.status >= 200 && res.status < 300 ? resolve(res.response) : reject(new Error(`HTTP ${res.status}`))),
        onerror: () => reject(new Error("網路錯誤")),
        ontimeout: () => reject(new Error("逾時")),
      })
    })
  }

  async function toJpg(blob) {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("轉檔失敗"))), "image/jpeg", quality)
    })
  }

  // 檔名：threads_帳號_貼文代碼_日期時間.jpg，抓不到的部分就省略
  function fileName(img) {
    const post = img.closest("[data-pressable-container]") || document
    const user = post.querySelector('a[href^="/@"]')?.getAttribute("href")?.match(/^\/@([^/?#]+)/)?.[1]
    const code = post.querySelector('a[href*="/post/"]')?.getAttribute("href")?.match(/\/post\/([^/?#]+)/)?.[1]
      || location.pathname.match(/\/post\/([^/?#]+)/)?.[1]
    const d = new Date()
    const pad = (n) => String(n).padStart(2, "0")
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    return [CONFIG.prefix, user, code, stamp].filter(Boolean).join("_").replace(/[\\/:*?"<>|]/g, "") + ".jpg"
  }

  async function download(img) {
    const url = bestUrl(img)
    const name = fileName(img)
    toast("下載中…")
    try {
      const jpg = await toJpg(await fetchBlob(url))
      const a = document.createElement("a")
      a.href = URL.createObjectURL(jpg)
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      toast(`已下載 ${name}`)
    } catch (err) {
      console.error("[Threads JPG] 下載失敗", url, err)
      toast(`下載失敗：${err.message}`)
    }
  }

  // ---------------------------------------------------------------------------
  // 提示訊息
  // ---------------------------------------------------------------------------
  let toastEl = null
  let toastTimer = 0
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div")
      Object.assign(toastEl.style, {
        position: "fixed",
        left: "50%",
        bottom: "24px",
        transform: "translateX(-50%)",
        zIndex: 2147483647,
        padding: "8px 14px",
        borderRadius: "8px",
        background: "rgba(0,0,0,.8)",
        color: "#fff",
        font: "13px/1.4 system-ui, sans-serif",
        pointerEvents: "none",
      })
    }
    if (!toastEl.isConnected) document.body.appendChild(toastEl)
    toastEl.textContent = msg
    toastEl.style.display = "block"
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastEl.style.display = "none"), 2500)
  }
})()
