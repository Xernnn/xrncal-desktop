import { describe, it, expect } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, MIGRATION_007_SQL, SCHEMA_VERSION } from '../src/main/db/database'

/**
 * A migration and the row recording it land together or not at all.
 *
 * Each migration ran statement by statement with nothing around it. Closing the
 * app (or a crash, or a power cut) halfway through one - 007 adds three columns -
 * left the first columns added and no version recorded, so the next start ran
 * 007 again, failed on the column that was already there, and the app never
 * opened again.
 */

const versionOf = (db: ISqliteDatabase): number =>
  db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get<{ v: number }>()!.v

const columnsOf = (db: ISqliteDatabase, table: string): string[] =>
  db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>().map((c) => c.name)

describe('a migration cut off halfway', () => {
  it('leaves nothing of itself behind, so the next start applies it whole', () => {
    const db = createSqliteDriver(':memory:')
    // The same database, stopping dead after the first of 007's statements.
    const cutOff: ISqliteDatabase = {
      ...db,
      exec(sql: string): void {
        if (sql !== MIGRATION_007_SQL) return db.exec(sql)
        db.exec(sql.split(';')[0])
        throw new Error('power cut')
      }
    }

    expect(() => runMigrations(cutOff)).toThrow('power cut')
    expect(versionOf(db)).toBe(6)
    expect(columnsOf(db, 'event_exceptions')).not.toContain('dirty')

    // The next start.
    runMigrations(db)
    expect(versionOf(db)).toBe(SCHEMA_VERSION)
    expect(columnsOf(db, 'event_exceptions')).toEqual(expect.arrayContaining(['dirty', 'etag', 'provider_instance_id']))
  })

  it('does not record a version whose migration failed', () => {
    const db = createSqliteDriver(':memory:')
    // The migration ran, but the row recording it never made it.
    const cutOff: ISqliteDatabase = {
      ...db,
      prepare(sql: string) {
        const stmt = db.prepare(sql)
        if (!sql.startsWith('INSERT INTO schema_migrations')) return stmt
        return {
          ...stmt,
          run: (...params) => {
            if (params[0] === 7) throw new Error('power cut')
            return stmt.run(...params)
          }
        }
      }
    }

    expect(() => runMigrations(cutOff)).toThrow('power cut')
    expect(versionOf(db)).toBe(6)

    runMigrations(db)
    expect(versionOf(db)).toBe(SCHEMA_VERSION)
  })
})
