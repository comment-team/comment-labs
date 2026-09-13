import postgres from 'postgres'
import { bench, describe } from 'vitest'
import { Localdrive } from '../src/index'


const controller = new Localdrive({ bindings: { DB: {} } })

await controller.initialize()

const databases = await controller.createTestDatabases()
const db = databases.DB

if (db === undefined) {
  throw new Error('Missing DB binding')
}

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

const sql = postgres(db.connectionString, { max: 1 })

describe('localdrive throughput', () => {
  bench('direct pg lite', async () => {
    await db.testQuery(`
      INSERT INTO flag_configurations (id, project_id, target_type, name, options, version)
      VALUES ($1, $2, $3, $4, $5, 1)
    `, [ 'd', 'p', 't', 'flag', '[]' ])
    await db.testQuery(`
      SELECT id, project_id, target_type, name, options, version
      FROM flag_configurations WHERE project_id = $1 AND target_type = $2
    `, [ 'p', 't' ])
    await db.testQuery('DELETE FROM flag_configurations WHERE id = $1', [ 'd' ])
  })

  bench('socket server', async () => {
    await sql`
      INSERT INTO flag_configurations (id, project_id, target_type, name, options, version)
      VALUES ('d', 'p', 't', 'flag', '[]', 1)
    `
    await sql`
      SELECT id, project_id, target_type, name, options, version
      FROM flag_configurations WHERE project_id = 'p' AND target_type = 't'
    `
    await sql`DELETE FROM flag_configurations WHERE id = 'd'`
  }, {
    teardown: async (_task, mode) => {
      if (mode === 'run') {
        await sql.end()
        await db.close()
        await controller.close()
      }
    }
  })
})
