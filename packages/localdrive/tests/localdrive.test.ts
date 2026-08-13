import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { Localdrive } from '../src/index'
import { localdrive } from '../src/vitest'


const postgresWithPasswordPattern = /^postgresql:\/\/postgres:secret@/u

async function fixture(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'localdrive-'))
  await Promise.all(Object.entries(files).map(async ([ name, sql ]) => {
    const path = join(directory, name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, sql)
  }))

  return directory
}

async function cleanup(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true })
}

describe('localdrive controller', () => {
  it('applies ordered glob migrations, snapshots, and per-test setup', async () => {
    const cwd = await fixture({
      'migrations/002-data.sql': 'INSERT INTO data (name) VALUES (\'second\');',
      'migrations/001-schema.sql': 'CREATE TABLE data (id serial primary key, name text not null);',
      'snapshot.sql': 'INSERT INTO data (name) VALUES (\'snapshot\');',
      'before.sql': 'INSERT INTO data (name) VALUES (\'before-each\');'
    })
    const controller = new Localdrive({
      bindings: { DB: { migrations: 'migrations/*.sql', snapshot: 'snapshot.sql', beforeEach: 'before.sql' } },
      cwd
    })

    try {
      await controller.initialize()

      const first = await controller.createTestDatabases()
      const firstDb = first.DB
      if (firstDb === undefined) {
        throw new Error('Missing DB')
      }

      await expect(firstDb.testQuery('SELECT name FROM data ORDER BY id')).resolves.toStrictEqual([{ name: 'second' }, { name: 'snapshot' }, { name: 'before-each' }])
      await firstDb.testQuery('INSERT INTO data (name) VALUES ($1)', [ 'changed' ])
      await firstDb.close()

      const second = await controller.createTestDatabases()
      const secondDb = second.DB
      if (secondDb === undefined) {
        throw new Error('Missing DB')
      }

      await expect(secondDb.testQuery('SELECT name FROM data ORDER BY id')).resolves.toStrictEqual([{ name: 'second' }, { name: 'snapshot' }, { name: 'before-each' }])
      await secondDb.close()
    } finally {
      await controller.close()
      await cleanup(cwd)
    }

    expect(true).toBeTruthy()
  })

  it('serves each binding over PostgreSQL and isolates bindings', async () => {
    const cwd = await fixture({
      'one.sql': 'CREATE TABLE data (value text); INSERT INTO data VALUES (\'one\');',
      'two.sql': 'CREATE TABLE data (value text); INSERT INTO data VALUES (\'two\');'
    })
    const controller = new Localdrive({
      bindings: { FIRST: { migrations: 'one.sql' }, SECOND: { migrations: 'two.sql' } },
      cwd
    })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const first = databases.FIRST
      const second = databases.SECOND
      if (first === undefined || second === undefined) {
        throw new Error('Missing binding')
      }

      const sql = postgres(first.connectionString)
      const [ row ] = await sql<[ { value: string } ]>`SELECT value FROM data`

      expect(row).toStrictEqual({ value: 'one' })
      await expect(second.testQuery('SELECT value FROM data')).resolves.toStrictEqual([{ value: 'two' }])
      await sql.end()
      await Promise.all(Object.values(databases).map(async database => await database.close()))
    } finally {
      await controller.close()
      await cleanup(cwd)
    }

    expect(true).toBeTruthy()
  })

  it('enables requested PostgreSQL extensions and PL/pgSQL', async () => {
    const controller = new Localdrive({ bindings: { DB: {} } })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB
      if (db === undefined) {
        throw new Error('Missing DB')
      }

      await expect(db.testQuery('SELECT similarity(\'local\', \'locale\') AS score')).resolves.toHaveLength(1)
      await expect(db.testQuery('SELECT unaccent(\'Hôtel\') AS value')).resolves.toStrictEqual([{ value: 'Hotel' }])
      await expect(db.testQuery('SELECT * FROM pg_stat_statements')).resolves.toBeInstanceOf(Array)
      await db.testQuery('CREATE FUNCTION increment(value integer) RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RETURN value + 1; END; $$;')
      await expect(db.testQuery('SELECT increment(4) AS value')).resolves.toStrictEqual([{ value: 5 }])
      await db.close()
    } finally {
      await controller.close()
    }

    expect(true).toBeTruthy()
  })

  it('rejects empty configuration, unmatched globs, and use before initialization', async () => {
    expect(() => new Localdrive({ bindings: {} })).toThrow('Localdrive requires at least one binding')

    const controller = new Localdrive({ bindings: { DB: {} } })

    try {
      await expect(controller.createTestDatabases()).rejects.toThrow('Call initialize() before creating test databases')
    } finally {
      await controller.close()
    }

    const cwd = await fixture({})
    const invalid = new Localdrive({ bindings: { DB: { migrations: '*.sql' } }, cwd })

    try {
      await expect(invalid.initialize()).rejects.toThrow('SQL glob matched no files: *.sql')
    } finally {
      await invalid.close()
      await cleanup(cwd)
    }

    expect(true).toBeTruthy()
  })

  it('supports explicit SQL source arrays and idempotent lifecycle methods', async () => {
    const cwd = await fixture({
      'schema.sql': 'CREATE TABLE data (value text);',
      'snapshot.sql': 'INSERT INTO data VALUES (\'snapshot\');',
      'before.sql': 'INSERT INTO data VALUES (\'before\');'
    })
    const controller = localdrive({
      bindings: { DB: { migrations: [ join(cwd, 'schema.sql') ], snapshot: [ 'snapshot.sql' ], beforeEach: [ 'before.sql' ] } },
      cwd
    })

    try {
      await controller.initialize()
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB
      if (db === undefined) {
        throw new Error('Missing DB')
      }

      await expect(db.testQuery('SELECT value FROM data ORDER BY value')).resolves.toStrictEqual([{ value: 'before' }, { value: 'snapshot' }])
      await db.close()
      await controller.close()
      await controller.close()
    } finally {
      await cleanup(cwd)
    }

    expect(true).toBeTruthy()
  })

  it('builds connection strings with optional credentials', async () => {
    const controller = new Localdrive({ bindings: { DB: { connectionString: { password: 'secret' } } } })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB
      if (db === undefined) {
        throw new Error('Missing DB')
      }

      expect(db.connectionString).toMatch(postgresWithPasswordPattern)
      await db.close()
    } finally {
      await controller.close()
    }

    expect(true).toBeTruthy()
  })

  it('closes already-created databases when a later binding setup fails', async () => {
    const cwd = await fixture({
      'schema.sql': 'CREATE TABLE data (value text);',
      'invalid.sql': 'SELECT missing_column FROM data;'
    })
    const controller = new Localdrive({
      bindings: { FIRST: { migrations: 'schema.sql' }, SECOND: { migrations: 'schema.sql', beforeEach: 'invalid.sql' } },
      cwd
    })

    try {
      await controller.initialize()
      await expect(controller.createTestDatabases()).rejects.toThrow('missing_column')
    } finally {
      await controller.close()
      await cleanup(cwd)
    }

    expect(true).toBeTruthy()
  })

  it('reset restores the clone to the migration, snapshot and beforeEach baseline', async () => {
    const cwd = await fixture({
      'schema.sql': 'CREATE TABLE data (id serial primary key, name text not null);',
      'snapshot.sql': 'INSERT INTO data (name) VALUES (\'snapshot\');',
      'before.sql': 'INSERT INTO data (name) VALUES (\'before-each\');'
    })
    const controller = new Localdrive({
      bindings: { DB: { migrations: 'schema.sql', snapshot: 'snapshot.sql', beforeEach: 'before.sql' } },
      cwd
    })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB
      if (db === undefined) {
        throw new Error('Missing DB')
      }

      const baselineConnectionString = db.connectionString

      await db.testQuery('INSERT INTO data (name) VALUES ($1)', [ 'test' ])
      await expect(db.testQuery('SELECT name FROM data ORDER BY id')).resolves.toStrictEqual([
        { name: 'snapshot' },
        { name: 'before-each' },
        { name: 'test' }
      ])

      await db.reset()

      expect(db.connectionString).toBe(baselineConnectionString)
      await expect(db.testQuery('SELECT name FROM data ORDER BY id')).resolves.toStrictEqual([
        { name: 'snapshot' },
        { name: 'before-each' }
      ])

      await db.testQuery('INSERT INTO data (name) VALUES ($1)', [ 'another' ])
      await db.reset()
      await expect(db.testQuery('SELECT name FROM data ORDER BY id')).resolves.toStrictEqual([
        { name: 'snapshot' },
        { name: 'before-each' }
      ])

      await db.close()
    } finally {
      await controller.close()
      await cleanup(cwd)
    }

    expect(true).toBeTruthy()
  })

  it('reset restores sequence state', async () => {
    const cwd = await fixture({
      'schema.sql': 'CREATE TABLE data (id serial primary key);',
      'before.sql': 'INSERT INTO data DEFAULT VALUES;'
    })
    const controller = new Localdrive({
      bindings: { DB: { migrations: 'schema.sql', beforeEach: 'before.sql' } },
      cwd
    })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB
      if (db === undefined) {
        throw new Error('Missing DB')
      }

      await db.testQuery('INSERT INTO data DEFAULT VALUES')

      const [ firstInserted ] = await db.testQuery<{ id: number }>('SELECT id FROM data ORDER BY id DESC LIMIT 1')
      const firstId = firstInserted?.id

      await db.reset()

      await db.testQuery('INSERT INTO data DEFAULT VALUES')

      const [ secondInserted ] = await db.testQuery<{ id: number }>('SELECT id FROM data ORDER BY id DESC LIMIT 1')

      expect(secondInserted?.id).toBe(firstId)
      await db.close()
    } finally {
      await controller.close()
      await cleanup(cwd)
    }

    expect(true).toBeTruthy()
  })

  it('reset rejects when the database is already closed', async () => {
    const controller = new Localdrive({ bindings: { DB: {} } })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB
      if (db === undefined) {
        throw new Error('Missing DB')
      }

      await db.close()
      await expect(db.reset()).rejects.toThrow('already closed')
    } finally {
      await controller.close()
    }
  })
})
