import process from "node:process"
import { GarminConnect } from "garmin-connect"

let client: GarminConnect | null = null
let lastLogin = 0
const SESSION_TTL = 55 * 60 * 1000 // 55 minutes

export async function getGarminClient(): Promise<GarminConnect> {
  const email = process.env.GARMIN_EMAIL
  const password = process.env.GARMIN_PASSWORD

  if (!email || !password) {
    throw new Error("GARMIN_EMAIL 和 GARMIN_PASSWORD 環境變數未設定")
  }

  const now = Date.now()
  if (client && now - lastLogin < SESSION_TTL) {
    return client
  }

  client = new GarminConnect({ username: email, password })
  await client.login(email, password)
  lastLogin = now
  logger.success("Garmin Connect 登入成功")
  return client
}

export function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function dateRange(days: number): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    dates.push(toDateString(d))
  }
  return dates
}
