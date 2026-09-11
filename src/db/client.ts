import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function conectar(url: string) {
  const client = postgres(url, { max: 5, prepare: false, connection: { TimeZone: 'UTC' } });
  return { client, db: drizzle(client, { schema }) };
}
