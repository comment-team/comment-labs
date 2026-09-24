import { parentPort } from 'node:worker_threads'
import { runDatabaseHostWorker } from './database-host'


// This file is the entry point of the database host worker thread; the
// top-level call is what boots it.
// eslint-disable-next-line vitest/require-hook
runDatabaseHostWorker(parentPort)
