import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { obterNovidades } from '../src/painel/novidades.js';
import { iniciarBancoTemporario } from './banco-temporario.js';

// A migração 0004 roda sobre bancos que já têm clientes marcados: eles não podem virar "novidade".
let banco: Awaited<ReturnType<typeof iniciarBancoTemporario>>;
const pastaAntiga = resolve(process.env.TEST_WORK_DIR ?? '.test-postgres', `migracoes-${randomUUID()}`);
let usuarioId: string;

beforeAll(async () => {
  mkdirSync(pastaAntiga, { recursive: true });
  cpSync('./drizzle', pastaAntiga, { recursive: true });
  const diario = JSON.parse(readFileSync(join(pastaAntiga, 'meta', '_journal.json'), 'utf8'));
  diario.entries = diario.entries.filter((entrada: { tag: string }) => entrada.tag < '0004');
  writeFileSync(join(pastaAntiga, 'meta', '_journal.json'), JSON.stringify(diario));
  banco = await iniciarBancoTemporario(pastaAntiga);
  const sql = banco.client;
  const [n] = await sql`insert into negocio (nome, slug, telefone) values ('Antigo', ${randomUUID()}, '3433334444') returning id`;
  const [u] = await sql`insert into usuario (negocio_id, email, senha_hash) values (${n.id}, ${`dono-${randomUUID()}@teste.example`}, 'scrypt:x:y') returning id`;
  usuarioId = u.id;
  const [s] = await sql`insert into servico (negocio_id, nome, duracao_min, preco_centavos) values (${n.id}, 'Corte', 30, 4000) returning id`;
  const [p] = await sql`insert into profissional (negocio_id, nome) values (${n.id}, 'Caio') returning id`;
  await sql`insert into agendamento (negocio_id, servico_id, profissional_id, cliente_nome, cliente_telefone, inicio, fim, token_cancelamento_hash)
    values (${n.id}, ${s.id}, ${p.id}, 'Cliente antigo', '34999991234', '2030-01-07T12:00Z', '2030-01-07T12:30Z', ${randomBytes(32).toString('hex')})`;
});

afterAll(async () => {
  await banco?.encerrar();
  rmSync(pastaAntiga, { recursive: true, force: true });
});

test('depois da migração 0004, os agendamentos que já existiam não aparecem como novidade', async () => {
  await migrate(banco.db, { migrationsFolder: './drizzle' });
  expect(await obterNovidades(banco.db, usuarioId)).toEqual({ total: 0, itens: [] });
});
