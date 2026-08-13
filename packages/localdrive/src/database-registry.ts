import type { TestDatabase } from './test-database'


const databases = new Map<string, TestDatabase>()

export function registerTestDatabase(database: TestDatabase): void {
  databases.set(database.connectionString, database)
}

export function unregisterTestDatabase(database: TestDatabase): void {
  databases.delete(database.connectionString)
}

export function getTestDatabaseByConnectionString(connectionString: string): TestDatabase | undefined {
  return databases.get(connectionString)
}
