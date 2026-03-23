export { db } from './client.js'
export * from './schema.js'
export type { DB } from './client.js'

// Re-export drizzle-orm utilities so all packages use the same instance
export { eq, and, or, desc, asc, count, sql, inArray } from 'drizzle-orm'
export type { SQL } from 'drizzle-orm'
