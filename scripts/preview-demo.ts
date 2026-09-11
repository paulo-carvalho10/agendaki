import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { conectar } from '../src/db/client.js';
import { seedDemo } from '../src/db/seed.js';
import { limparBancoTemporario } from './limpar-banco-temporario.js';

const probe = createServer();
await new Promise<void>((ok, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', ok); });
const address = probe.address();
if (!address || typeof address === 'string') throw new Error('Não foi possível alocar porta do banco.');
const port = address.port;
await new Promise<void>((ok) => probe.close(() => ok()));
const password = randomBytes(24).toString('hex');
const raizTemporaria = resolve(process.env.TEST_WORK_DIR ?? '.test-postgres');
const diretorioTemporario = resolve(raizTemporaria, `preview-${randomUUID()}`);
const cluster = new EmbeddedPostgres({
  databaseDir: diretorioTemporario,
  port, user: 'postgres', password, persistent: true,
  initdbFlags: ['--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {}, onError: () => {},
});
let child: ReturnType<typeof spawn> | undefined;
let encerrando = false;
async function encerrar() {
  if (encerrando) return;
  encerrando = true;
  child?.kill('SIGTERM');
  await cluster.stop();
  await limparBancoTemporario(diretorioTemporario, raizTemporaria);
}
process.once('SIGINT', () => void encerrar());
process.once('SIGTERM', () => void encerrar());
try {
  await cluster.initialise();
  await cluster.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  const { db, client } = conectar(url);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    await seedDemo(db, randomBytes(24).toString('hex'));
  } finally { await client.end(); }
  console.log('Barbearia de demonstração pronta. Banco temporário; nenhuma conexão com Neon.');
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3100'], {
    stdio: 'inherit', windowsHide: true,
    env: { ...process.env, DATABASE_URL: url, NEXT_TELEMETRY_DISABLED: '1' },
  });
  await new Promise<void>((ok, fail) => { child!.once('exit', () => ok()); child!.once('error', fail); });
} finally { await encerrar(); }
