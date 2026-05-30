import process from "node:process"
import { HealthTable } from "#/database/health"
import { getGarminClient, toDateString } from "#/utils/garmin"

const GARMIN_API = "https://connectapi.garmin.com"

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const days = Number(body?.days ?? 30)

  const db = useDatabase()
  if (!db) throw createError({ statusCode: 500, message: "資料庫不可用" })

  const health = new HealthTable(db)
  await health.init()

  const gc = await getGarminClient()

  const now = new Date()
  const synced: string[] = []
  const errors: string[] = []

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = toDateString(d)

    try {
      // fetch daily summary which includes stress data
      const summary: any = await gc.get(
        `${GARMIN_API}/usersummary-service/usersummary/daily/${dateStr}`,
        { params: { calendarDate: dateStr } },
      )

      const avgStress = summary?.averageStressLevel ?? -1
      const maxStress = summary?.maxStressLevel ?? -1
      const restStress = summary?.restingHeartRate ?? -1

      if (avgStress >= 0) {
        await health.setStress({ date: dateStr, avgStress, maxStress, restStress })
        synced.push(dateStr)
      }
    } catch (e: any) {
      errors.push(`${dateStr}: ${e.message}`)
    }

    // avoid rate limiting
    await new Promise(r => setTimeout(r, process.env.NODE_ENV === "production" ? 300 : 100))
  }

  return { synced, errors, total: synced.length }
})
