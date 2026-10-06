import { HealthTable } from "#/database/health"

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null
  const n = xs.length
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let denomX = 0
  let denomY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    num += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }
  const denom = Math.sqrt(denomX * denomY)
  if (denom === 0) return null
  return Math.round((num / denom) * 1000) / 1000
}

const DIET_METRICS = ["calories", "protein", "carbs", "fat", "sugar", "fiber"] as const
const STRESS_METRICS = ["avgStress", "maxStress"] as const

export default defineEventHandler(async (_event) => {
  const db = useDatabase()
  if (!db) throw createError({ statusCode: 500, message: "資料庫不可用" })

  const health = new HealthTable(db)
  await health.init()

  const [allStress, allDiet] = await Promise.all([
    health.getAllStress(),
    health.getAllDiet(),
  ])

  // join on date
  const stressMap = new Map(allStress.map(s => [s.date, s]))
  const joined = allDiet
    .map(d => ({ diet: d, stress: stressMap.get(d.date) }))
    .filter(r => r.stress && r.stress.avgStress >= 0)

  const n = joined.length

  const correlations: Record<string, Record<string, number | null>> = {}

  for (const sm of STRESS_METRICS) {
    correlations[sm] = {}
    for (const dm of DIET_METRICS) {
      const xs = joined.map(r => (r.diet as any)[dm] as number)
      const ys = joined.map(r => (r.stress as any)[sm] as number)
      correlations[sm][dm] = pearson(xs, ys)
    }
  }

  const timeline = joined.map(r => ({
    date: r.diet.date,
    avgStress: r.stress!.avgStress,
    maxStress: r.stress!.maxStress,
    calories: r.diet.calories,
    protein: r.diet.protein,
    carbs: r.diet.carbs,
    fat: r.diet.fat,
    sugar: r.diet.sugar,
    fiber: r.diet.fiber,
  }))

  return { correlations, timeline, n }
})
