import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import webpush from 'web-push';
import { conectar } from '../src/db/client.js';
import { seedDemo, DEMO_EMAIL } from '../src/db/seed.js';
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
// Senha só desta execução, para entrar no painel da demonstração local.
const senhaDemo = process.env.DEMO_OWNER_PASSWORD ?? `demo-${randomBytes(6).toString('hex')}`;
// Chaves de aviso só desta execução, para testar as notificações sem configurar nada.
const par = webpush.generateVAPIDKeys();
const chavesDeAviso = { VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: par.privateKey, VAPID_SUBJECT: 'https://agendaki.example' };
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
    await seedDemo(db, senhaDemo);
  } finally { await client.end(); }
  // PORT permite rodar ao lado de outro projeto que já use a 3100.
  const porta = /^\d{2,5}$/.test(process.env.PORT ?? '') ? process.env.PORT! : '3100';
  console.log('Barbearia de demonstração pronta. Banco temporário; nenhuma conexão com Neon.');
  console.log(`Página do cliente: http://127.0.0.1:${porta}/barbearia-demo`);
  console.log(`Painel do dono:    http://127.0.0.1:${porta}/entrar  ·  ${DEMO_EMAIL}  ·  senha: ${senhaDemo}`);
  // Para rodar `pnpm negocio:criar` ou `pnpm negocio:link-senha` neste banco temporário.
  console.log(`Banco desta execução: DATABASE_URL=${url}`);
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', porta], {
    stdio: 'inherit', windowsHide: true,
    env: { ...chavesDeAviso, ...process.env, DATABASE_URL: url, NEXT_TELEMETRY_DISABLED: '1' },
  });
  await new Promise<void>((ok, fail) => { child!.once('exit', () => ok()); child!.once('error', fail); });
} finally { await encerrar(); }
