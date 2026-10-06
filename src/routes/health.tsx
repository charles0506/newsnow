import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import clsx from "clsx"

export const Route = createFileRoute("/health")({
  component: HealthPage,
})

const DIET_LABELS: Record<string, string> = {
  calories: "熱量 (kcal)",
  protein: "蛋白質 (g)",
  carbs: "碳水化合物 (g)",
  fat: "脂肪 (g)",
  sugar: "糖 (g)",
  fiber: "膳食纖維 (g)",
}

const STRESS_LABELS: Record<string, string> = {
  avgStress: "平均壓力",
  maxStress: "最高壓力",
}

function correlationColor(r: number | null): string {
  if (r === null) return "text-gray-400"
  const abs = Math.abs(r)
  if (abs >= 0.5) return r > 0 ? "text-red-500 font-bold" : "text-green-600 font-bold"
  if (abs >= 0.3) return r > 0 ? "text-orange-500" : "text-green-500"
  return "text-gray-500"
}

function correlationInterpret(r: number | null): string {
  if (r === null) return "資料不足"
  const abs = Math.abs(r)
  const dir = r > 0 ? "正相關" : "負相關"
  if (abs >= 0.7) return `強${dir}`
  if (abs >= 0.5) return `中${dir}`
  if (abs >= 0.3) return `弱${dir}`
  return "無顯著相關"
}

function parseCsv(csv: string) {
  const lines = csv.trim().split("\n").filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase())
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map(v => v.trim())
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? ""
    })
    return row
  })
}

function SyncSection() {
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ synced: string[], errors: string[] } | null>(null)

  async function sync() {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch("/api/garmin/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      })
      const data = await res.json()
      setResult(data)
    } catch (e: any) {
      setResult({ synced: [], errors: [e.message] })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="bg-primary/5 rounded-xl p-5 mb-6">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <span className="i-ph:activity-duotone text-primary" />
        同步 Garmin 壓力數據
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        需在環境變數設定
        {" "}
        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">GARMIN_EMAIL</code>
        {" "}
        和
        {" "}
        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">GARMIN_PASSWORD</code>
      </p>
      <div className="flex items-center gap-3">
        <label className="text-sm">同步天數</label>
        <input
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 w-20 text-sm bg-transparent"
        />
        <button
          type="button"
          onClick={sync}
          disabled={loading}
          className={clsx(
            "px-4 py-1.5 rounded-lg text-sm font-medium",
            "bg-primary text-white",
            loading ? "opacity-50 cursor-not-allowed" : "hover:opacity-80",
          )}
        >
          {loading ? "同步中..." : "開始同步"}
        </button>
      </div>
      {result && (
        <div className="mt-3 text-sm">
          {result.synced.length > 0 && (
            <p className="text-green-600">
              成功同步
              {result.synced.length}
              筆：
              {result.synced[0]}
              {" "}
              ~
              {result.synced[result.synced.length - 1]}
            </p>
          )}
          {result.errors.length > 0 && (
            <details className="mt-1">
              <summary className="text-red-500 cursor-pointer">
                {result.errors.length}
                筆錯誤
              </summary>
              <ul className="mt-1 pl-4 text-red-400 text-xs">
                {result.errors.map(e => <li key={e}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

function DietSection({ onSaved }: { onSaved: () => void }) {
  const [csvText, setCsvText] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ saved: string[], errors: string[] } | null>(null)

  async function save() {
    const rows = parseCsv(csvText)
    if (rows.length === 0) return

    setLoading(true)
    setResult(null)
    try {
      const res = await fetch("/api/garmin/diet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rows),
      })
      const data = await res.json()
      setResult(data)
      if (data.saved?.length > 0) onSaved()
    } catch (e: any) {
      setResult({ saved: [], errors: [e.message] })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="bg-primary/5 rounded-xl p-5 mb-6">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <span className="i-ph:fork-knife-duotone text-primary" />
        匯入飲食記錄
      </h2>
      <p className="text-sm text-gray-500 mb-2">貼上 CSV 格式（第一行為標題）：</p>
      <pre className="text-xs bg-gray-100 dark:bg-gray-800 rounded p-2 mb-3 text-gray-600 dark:text-gray-400">
        date,calories,protein,carbs,fat,sugar,fiber
        {"\n"}
        2024-01-15,1800,80,220,60,40,25
      </pre>
      <textarea
        rows={8}
        value={csvText}
        onChange={e => setCsvText(e.target.value)}
        placeholder="date,calories,protein,carbs,fat,sugar,fiber&#10;2024-01-15,1800,80,220,60,40,25"
        className={clsx(
          "w-full text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg p-3",
          "bg-transparent resize-y focus:outline-none focus:ring-2 focus:ring-primary/50",
        )}
      />
      <button
        type="button"
        onClick={save}
        disabled={loading || !csvText.trim()}
        className={clsx(
          "mt-2 px-4 py-1.5 rounded-lg text-sm font-medium",
          "bg-primary text-white",
          (loading || !csvText.trim()) ? "opacity-50 cursor-not-allowed" : "hover:opacity-80",
        )}
      >
        {loading ? "儲存中..." : "儲存飲食資料"}
      </button>
      {result && (
        <div className="mt-2 text-sm">
          {result.saved.length > 0 && (
            <p className="text-green-600">
              儲存
              {result.saved.length}
              筆成功
            </p>
          )}
          {result.errors.length > 0 && (
            <p className="text-red-500">
              {result.errors.join("；")}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function CorrelationSection() {
  const [data, setData] = useState<{
    correlations: Record<string, Record<string, number | null>>
    timeline: any[]
    n: number
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/garmin/correlation")
      if (!res.ok) throw new Error(await res.text())
      setData(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="bg-primary/5 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="i-ph:chart-scatter-duotone text-primary" />
          壓力 × 飲食相關分析
        </h2>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className={clsx(
            "px-3 py-1 rounded-lg text-sm font-medium",
            "bg-primary text-white",
            loading ? "opacity-50 cursor-not-allowed" : "hover:opacity-80",
          )}
        >
          {loading ? "計算中..." : "計算相關係數"}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {data && (
        <>
          <p className="text-sm text-gray-500 mb-4">
            共
            {data.n}
            筆配對資料（壓力 + 飲食同一天）
          </p>

          {data.n < 3
            ? (
                <p className="text-orange-500 text-sm">
                  至少需要 3 天配對資料才能計算相關係數。請先同步 Garmin 並匯入飲食記錄。
                </p>
              )
            : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-2 pr-4 font-medium text-gray-500">飲食指標</th>
                          {Object.keys(STRESS_LABELS).map(sm => (
                            <th key={sm} className="text-center py-2 px-3 font-medium text-gray-500">
                              {STRESS_LABELS[sm]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(DIET_LABELS).map(dm => (
                          <tr key={dm} className="border-b border-gray-100 dark:border-gray-800 hover:bg-primary/5">
                            <td className="py-2 pr-4 font-medium">{DIET_LABELS[dm]}</td>
                            {Object.keys(STRESS_LABELS).map((sm) => {
                              const r = data.correlations[sm]?.[dm] ?? null
                              return (
                                <td key={sm} className="text-center py-2 px-3">
                                  <span className={correlationColor(r)}>
                                    {r === null ? "—" : r.toFixed(3)}
                                  </span>
                                  <br />
                                  <span className="text-xs text-gray-400">{correlationInterpret(r)}</span>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex gap-4 text-xs text-gray-400 flex-wrap">
                    <span>
                      <span className="text-red-500 font-bold">紅色粗體</span>
                      {" "}
                      r ≥ 0.5（強正相關）
                    </span>
                    <span>
                      <span className="text-green-600 font-bold">綠色粗體</span>
                      {" "}
                      r ≤ -0.5（強負相關）
                    </span>
                    <span className="text-gray-400">r 介於 ±0.3 以下為無顯著相關</span>
                  </div>

                  {data.timeline.length > 0 && (
                    <details className="mt-5">
                      <summary className="text-sm cursor-pointer text-primary hover:underline">查看原始數據</summary>
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700">
                              {["日期", "平均壓力", "最高壓力", "熱量", "蛋白質", "碳水", "脂肪", "糖", "纖維"].map(h => (
                                <th key={h} className="text-center py-1.5 px-2 font-medium text-gray-500">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {data.timeline.map(row => (
                              <tr key={row.date} className="border-b border-gray-100 dark:border-gray-800">
                                <td className="py-1 px-2 font-mono">{row.date}</td>
                                <td className="text-center py-1 px-2">{row.avgStress}</td>
                                <td className="text-center py-1 px-2">{row.maxStress}</td>
                                <td className="text-center py-1 px-2">{row.calories}</td>
                                <td className="text-center py-1 px-2">{row.protein}</td>
                                <td className="text-center py-1 px-2">{row.carbs}</td>
                                <td className="text-center py-1 px-2">{row.fat}</td>
                                <td className="text-center py-1 px-2">{row.sugar}</td>
                                <td className="text-center py-1 px-2">{row.fiber}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </>
              )}
        </>
      )}
    </section>
  )
}

function HealthPage() {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <span className="i-ph:heart-pulse-duotone text-primary" />
        健康分析
      </h1>
      <p className="text-gray-500 text-sm mb-6">Garmin 壓力指數 × 飲食關聯分析（Pearson 相關係數）</p>

      <SyncSection />
      <DietSection onSaved={() => setRefreshKey(k => k + 1)} />
      <CorrelationSection key={refreshKey} />
    </div>
  )
}
