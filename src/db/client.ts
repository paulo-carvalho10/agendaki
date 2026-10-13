import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function conectar(url: string) {
  // Conexões ociosas são devolvidas logo: em hospedagem serverless cada instância abre as suas.
  const client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 15, prepare: false, connection: { TimeZone: 'UTC' } });
  return { client, db: drizzle(client, { schema }) };
}
