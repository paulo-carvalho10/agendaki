import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { conectar } from '../src/db/client.js';

if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no servidor.');
const { client, db } = conectar(process.env.DATABASE_URL);
try {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrações aplicadas.');
} finally {
  await client.end();
}
