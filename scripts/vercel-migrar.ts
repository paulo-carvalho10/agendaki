import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { conectar } from '../src/db/client.js';

// Roda antes do `next build` na Vercel. Só a publicação de produção mexe no
// banco: uma prévia de pull request não pode aplicar migração em dados reais.
if (process.env.VERCEL_ENV !== 'production') {
  console.log(`Ambiente "${process.env.VERCEL_ENV ?? 'local'}": migrações não são aplicadas.`);
} else {
  // Migração usa conexão direta; o endereço com pool fica para a aplicação.
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Configure DATABASE_URL (e, se houver, DATABASE_URL_UNPOOLED) no projeto da Vercel.');
  const { client, db } = conectar(url);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrações aplicadas no banco de produção.');
  } finally {
    await client.end();
  }
}
