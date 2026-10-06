import { HealthTable } from "#/database/health"

export default defineEventHandler(async (event) => {
  const db = useDatabase()
  if (!db) throw createError({ statusCode: 500, message: "資料庫不可用" })

  const health = new HealthTable(db)
  await health.init()

  if (event.method === "GET") {
    const all = await health.getAllDiet()
    return { records: all }
  }

  if (event.method === "POST") {
    const body = await readBody(event)

    // accept array of records or single record
    const records = Array.isArray(body) ? body : [body]

    const saved: string[] = []
    const errors: string[] = []

    for (const r of records) {
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
        errors.push(`無效日期格式: ${r.date}`)
        continue
      }
      try {
        await health.setDiet({
          date: r.date,
          calories: Number(r.calories ?? 0),
          protein: Number(r.protein ?? 0),
          carbs: Number(r.carbs ?? 0),
          fat: Number(r.fat ?? 0),
          sugar: Number(r.sugar ?? 0),
          fiber: Number(r.fiber ?? 0),
          notes: String(r.notes ?? ""),
        })
        saved.push(r.date)
      } catch (e: any) {
        errors.push(`${r.date}: ${e.message}`)
      }
    }

    return { saved, errors }
  }

  throw createError({ statusCode: 405, message: "Method Not Allowed" })
})
