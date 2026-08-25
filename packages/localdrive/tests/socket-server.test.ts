import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { Localdrive } from '../src/index'


describe('socket server', () => {
  it('isolates prepared statements and portals across concurrent connections', async () => {
    const controller = new Localdrive({ bindings: { DB: {} } })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB

      if (db === undefined) {
        throw new Error('Missing DB binding')
      }

      await db.testQuery('CREATE TABLE items (id serial primary key, name text not null)')
      await db.testQuery('INSERT INTO items (name) VALUES ($1), ($2)', [ 'a', 'b' ])

      for (const prepare of [ false, true ]) {
        const sql = postgres(db.connectionString, { max: 4, prepare })
        const errors: unknown[] = []

        await Promise.all(Array.from({ length: 200 }, (_, index) => async () => {
          try {
            const [ row ] = await sql<[ { name: string } ]>`SELECT name FROM items WHERE id = ${(index % 2) + 1}`

            expect(row.name).toBe(index % 2 === 0 ? 'a' : 'b')
          } catch (error) {
            errors.push(error)
          }
        }).map(run => run()))

        await sql.end()

        expect(errors).toStrictEqual([])
      }

      await Promise.all(Object.values(databases).map(async database => await database.close()))
    } finally {
      await controller.close()
    }
  })
})