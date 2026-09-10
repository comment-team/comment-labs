import postgres from 'postgres'
import { describe, it } from 'vitest'
import { Localdrive } from '../src/index'


async function setup(db: { testQuery: (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]> }): Promise<void> {
  await db.testQuery(`
    CREATE TABLE flag_configurations (
      id text primary key,
      project_id text not null,
      target_type text not null,
      name text not null,
      options jsonb not null,
      version integer not null
    )
  `)
}

async function runPattern(
  run: (index: number) => Promise<void>,
  select: () => Promise<unknown[]>
): Promise<number> {
  const start = Date.now()

  for (let index = 0; index < 500; index++) {
    await select()
    await run(index)
  }

  return Date.now() - start
}

describe('benchmark', () => {
  it('compares direct pglite vs socket server throughput', async () => {
    const controller = new Localdrive({ bindings: { DB: {} } })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB

      if (db === undefined) {
        throw new Error('Missing DB')
      }

      await setup(db)

      const directStart = Date.now()
      const direct = await runPattern(
        async index => await db.testQuery('INSERT INTO flag_configurations (id, project_id, target_type, name, options, version) VALUES ($1, $2, $3, $4, $5, 1)', [ `d-${index}`, 'p', 't', `flag-${index}`, '[]' ]),
        async () => await db.testQuery('SELECT id, project_id, target_type, name, options, version FROM flag_configurations WHERE project_id = $1 AND target_type = $2', [ 'p', 't' ])
      )
      const directTotal = Date.now() - directStart
      await db.testQuery('DROP TABLE flag_configurations')
      await setup(db)

      const sql = postgres(db.connectionString, { max: 1 })
      const socket = await runPattern(
        async index => await sql`INSERT INTO flag_configurations (id, project_id, target_type, name, options, version) VALUES (${'s-' + index}, 'p', 't', ${'flag-' + index}, '[]', 1)`,
        async () => await sql`SELECT id, project_id, target_type, name, options, version FROM flag_configurations WHERE project_id = 'p' AND target_type = 't'`
      )
      await sql.end()

      console.log(`direct pglite (500 iterations): ${direct}ms (${directTotal}ms incl. drop/setup)`)
      console.log(`socket server (500 iterations): ${socket}ms`)
      console.log(`overhead: ${socket - direct}ms (${((socket / Math.max(direct, 1) - 1) * 100).toFixed(0)}%)`)

      await Promise.all(Object.values(databases).map(async database => await database.close()))
    } finally {
      await controller.close()
    }
  }, 120_000)
})