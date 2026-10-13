import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { conectar } from '../src/db/client.js';
import { limparBancoTemporario } from '../scripts/limpar-banco-temporario.js';

async function portaLivre() {
  const server = createServer();
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta indisponível');
  await new Promise<void>((ok, fail) => server.close((err) => err ? fail(err) : ok()));
  return address.port;
}

/** PostgreSQL real e descartável, com as migrações aplicadas. Outra pasta de migrações serve para testar a passagem de uma versão a outra. */
export async function iniciarBancoTemporario(migrationsFolder = './drizzle') {
  const raiz = resolve(process.env.TEST_WORK_DIR ?? '.test-postgres');
  const diretorio = resolve(raiz, randomUUID());
  const password = randomBytes(24).toString('hex');
  const port = await portaLivre();
  const cluster = new EmbeddedPostgres({
    databaseDir: diretorio, port, user: 'postgres', password, persistent: true,
    initdbFlags: ['--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {}, onError: () => {},
  });
  await cluster.initialise();
  await cluster.start();
  const conexao = conectar(`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`);
  await migrate(conexao.db, { migrationsFolder });
  return {
    ...conexao,
    async encerrar() {
      await conexao.client.end();
      await cluster.stop();
      await limparBancoTemporario(diretorio, raiz);
    },
  };
}
