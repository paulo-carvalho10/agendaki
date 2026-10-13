import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { iniciarBancoTemporario } from './banco-temporario.js';

// A migração 0003 roda sobre bancos que já têm clientes marcados. Este teste
// monta um banco como ele era antes dela, com dados, e só então a aplica.
let banco: Awaited<ReturnType<typeof iniciarBancoTemporario>>;
const pastaAntiga = resolve(process.env.TEST_WORK_DIR ?? '.test-postgres', `migracoes-${randomUUID()}`);
let comAgenda: string;
let vazio: string;

beforeAll(async () => {
  mkdirSync(pastaAntiga, { recursive: true });
  cpSync('./drizzle', pastaAntiga, { recursive: true });
  const diario = JSON.parse(readFileSync(join(pastaAntiga, 'meta', '_journal.json'), 'utf8'));
  diario.entries = diario.entries.filter((entrada: { tag: string }) => entrada.tag < '0003');
  writeFileSync(join(pastaAntiga, 'meta', '_journal.json'), JSON.stringify(diario));
  banco = await iniciarBancoTemporario(pastaAntiga);

  const sql = banco.client;
  const [a] = await sql`insert into negocio (nome, slug, telefone) values ('Com agenda', ${randomUUID()}, '3433334444') returning id`;
  const [b] = await sql`insert into negocio (nome, slug, telefone) values ('Vazio', ${randomUUID()}, '3433335555') returning id`;
  comAgenda = a.id; vazio = b.id;
  const [s] = await sql`insert into servico (negocio_id, nome, duracao_min, preco_centavos) values (${comAgenda}, 'Corte', 30, 4000) returning id`;
  for (const [inicio, fim, status] of [['2030-01-07T12:00Z', '2030-01-07T12:30Z', 'confirmado'], ['2030-01-07T13:00Z', '2030-01-07T13:30Z', 'atendido'],
    ['2030-01-07T13:00Z', '2030-01-07T13:30Z', 'cancelado']]) {
    await sql`insert into agendamento (negocio_id, servico_id, cliente_nome, cliente_telefone, inicio, fim, status, token_cancelamento_hash)
      values (${comAgenda}, ${s.id}, 'Cliente antigo', '34999991234', ${inicio}, ${fim}, ${status}, ${randomBytes(32).toString('hex')})`;
  }
  await sql`insert into bloqueio (negocio_id, inicio, fim, motivo) values (${comAgenda}, '2030-01-07T15:00Z', '2030-01-07T16:00Z', 'Almoço')`;
});

afterAll(async () => {
  await banco?.encerrar();
  rmSync(pastaAntiga, { recursive: true, force: true });
});

test('a migração dá um profissional a cada negócio e entrega a ele a agenda que já existia', async () => {
  const sql = banco.client;
  const [antes] = await sql`select agenda_revisao from negocio where id = ${comAgenda}`;
  await migrate(banco.db, { migrationsFolder: './drizzle' });

  const profissionais = await sql`select negocio_id, nome, ativo from profissional order by negocio_id`;
  expect(profissionais).toHaveLength(2);
  expect(profissionais.every((p) => p.nome === 'Profissional' && p.ativo)).toBe(true);
  expect(profissionais.map((p) => p.negocio_id).sort()).toEqual([comAgenda, vazio].sort());

  const [unico] = await sql`select id from profissional where negocio_id = ${comAgenda}`;
  const agendamentos = await sql`select profissional_id, status, cliente_nome from agendamento where negocio_id = ${comAgenda} order by inicio, status::text`;
  expect(agendamentos.map((a) => [a.profissional_id, a.status, a.cliente_nome])).toEqual([
    [unico.id, 'confirmado', 'Cliente antigo'], [unico.id, 'atendido', 'Cliente antigo'], [unico.id, 'cancelado', 'Cliente antigo']]);
  // O bloqueio antigo continua valendo para todos, e o preenchimento não contou como mudança de agenda.
  expect(await sql`select profissional_id from bloqueio where negocio_id = ${comAgenda}`).toMatchObject([{ profissional_id: null }]);
  expect((await sql`select agenda_revisao from negocio where id = ${comAgenda}`)[0].agenda_revisao).toBe(antes.agenda_revisao);
});

test('depois da migração a proteção da agenda segue ligada, agora por profissional', async () => {
  const sql = banco.client;
  const [trigger] = await sql`select tgenabled from pg_trigger where tgname = 'proteger_agendamento'`;
  expect(trigger.tgenabled).toBe('O');
  const [s] = await sql`select id from servico where negocio_id = ${comAgenda}`;
  const [antigo] = await sql`select id from profissional where negocio_id = ${comAgenda}`;
  const [novo] = await sql`insert into profissional (negocio_id, nome) values (${comAgenda}, 'Diego') returning id`;
  const marcar = (profissional: string, inicio: string, fim: string) => sql`
    insert into agendamento (negocio_id, servico_id, profissional_id, cliente_nome, cliente_telefone, inicio, fim, token_cancelamento_hash)
    values (${comAgenda}, ${s.id}, ${profissional}, 'Cliente novo', '34988887777', ${inicio}, ${fim}, ${randomBytes(32).toString('hex')}) returning id`;
  // O horário das 9h já era do profissional antigo; o novo pode atender nele.
  await expect(marcar(antigo.id, '2030-01-07T12:00Z', '2030-01-07T12:30Z')).rejects.toMatchObject({ code: '23P01' });
  await expect(marcar(novo.id, '2030-01-07T12:00Z', '2030-01-07T12:30Z')).resolves.toHaveLength(1);
  // O bloqueio antigo, sem profissional, fecha a agenda dos dois.
  await expect(marcar(novo.id, '2030-01-07T15:00Z', '2030-01-07T15:30Z')).rejects.toMatchObject({ code: '23P01' });
  await expect(marcar(antigo.id, '2030-01-07T15:30Z', '2030-01-07T16:00Z')).rejects.toMatchObject({ code: '23P01' });
});
