import type { Database } from "db0"

export interface StressRecord {
  date: string
  avgStress: number
  maxStress: number
  restStress: number
  updated: number
}

export interface DietRecord {
  date: string
  calories: number
  protein: number
  carbs: number
  fat: number
  sugar: number
  fiber: number
  notes: string
  updated: number
}

export class HealthTable {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  async init() {
    await this.db.prepare(`
      CREATE TABLE IF NOT EXISTS garmin_stress (
        date TEXT PRIMARY KEY,
        avg_stress INTEGER,
        max_stress INTEGER,
        rest_stress INTEGER,
        updated INTEGER
      );
    `).run()

    await this.db.prepare(`
      CREATE TABLE IF NOT EXISTS diet_log (
        date TEXT PRIMARY KEY,
        calories REAL,
        protein REAL,
        carbs REAL,
        fat REAL,
        sugar REAL,
        fiber REAL,
        notes TEXT,
        updated INTEGER
      );
    `).run()
    logger.success("init health tables")
  }

  async setStress(record: Omit<StressRecord, "updated">) {
    const now = Date.now()
    await this.db.prepare(`
      INSERT OR REPLACE INTO garmin_stress (date, avg_stress, max_stress, rest_stress, updated)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.date, record.avgStress, record.maxStress, record.restStress, now)
  }

  async getStress(from: string, to: string): Promise<StressRecord[]> {
    const rows: any[] = await this.db.prepare(`
      SELECT date, avg_stress as avgStress, max_stress as maxStress, rest_stress as restStress, updated
      FROM garmin_stress
      WHERE date >= ? AND date <= ?
      ORDER BY date ASC
    `).all(from, to) as any[]
    return rows ?? []
  }

  async setDiet(record: Omit<DietRecord, "updated">) {
    const now = Date.now()
    await this.db.prepare(`
      INSERT OR REPLACE INTO diet_log (date, calories, protein, carbs, fat, sugar, fiber, notes, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.date, record.calories, record.protein, record.carbs, record.fat, record.sugar, record.fiber, record.notes, now)
  }

  async getDiet(from: string, to: string): Promise<DietRecord[]> {
    const rows: any[] = await this.db.prepare(`
      SELECT date, calories, protein, carbs, fat, sugar, fiber, notes, updated
      FROM diet_log
      WHERE date >= ? AND date <= ?
      ORDER BY date ASC
    `).all(from, to) as any[]
    return rows ?? []
  }

  async getAllDiet(): Promise<DietRecord[]> {
    const rows: any[] = await this.db.prepare(`
      SELECT date, calories, protein, carbs, fat, sugar, fiber, notes, updated
      FROM diet_log
      ORDER BY date ASC
    `).all() as any[]
    return rows ?? []
  }

  async getAllStress(): Promise<StressRecord[]> {
    const rows: any[] = await this.db.prepare(`
      SELECT date, avg_stress as avgStress, max_stress as maxStress, rest_stress as restStress, updated
      FROM garmin_stress
      ORDER BY date ASC
    `).all() as any[]
    return rows ?? []
  }
}
