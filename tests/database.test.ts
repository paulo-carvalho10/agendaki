import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type postgres from 'postgres';
import { conectar } from '../src/db/client.js';
import { seedDemo, DEMO_ID } from '../src/db/seed.js';
import { obterPaginaPublica } from '../src/agenda/pagina-publica.js';
import { limparBancoTemporario } from '../scripts/limpar-banco-temporario.js';

let cluster: EmbeddedPostgres;
let connection: ReturnType<typeof conectar>;
let negocioId: string;
let servicoId: string;
const raizTemporaria = resolve(process.env.TEST_WORK_DIR ?? '.test-postgres');
const diretorioTemporario = resolve(raizTemporaria, randomUUID());

async function portaLivre() {
  const server = createServer();
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta indisponível');
  await new Promise<void>((ok, fail) => server.close((err) => err ? fail(err) : ok()));
  return address.port;
}

beforeAll(async () => {
  const port = await portaLivre();
  const password = randomBytes(24).toString('hex');
  cluster = new EmbeddedPostgres({
    databaseDir: diretorioTemporario,
    port, user: 'postgres', password, persistent: true,
    initdbFlags: ['--encoding=UTF8'],
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {}, onError: () => {},
  });
  await cluster.initialise();
  await cluster.start();
  connection = conectar(`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`);
  await migrate(connection.db, { migrationsFolder: './drizzle' });
});

afterAll(async () => {
  await connection?.client.end();
  await cluster?.stop();
  await limparBancoTemporario(diretorioTemporario, raizTemporaria);
});

beforeEach(async () => {
  const [n] = await connection.client`insert into negocio (nome, slug, telefone) values ('Teste', ${randomUUID()}, '00000000000') returning id`;
  negocioId = n.id;
  const [s] = await connection.client`insert into servico (negocio_id, nome, duracao_min, preco_centavos) values (${negocioId}, 'Corte', 30, 4000) returning id`;
  servicoId = s.id;
});

type Executor = postgres.Sql | postgres.TransactionSql;
function reservar(client: Executor, inicio = '2030-01-07T12:00:00Z', fim = '2030-01-07T13:00:00Z', status = 'confirmado') {
  return client`insert into agendamento (negocio_id, servico_id, cliente_nome, cliente_telefone, inicio, fim, status, token_cancelamento_hash)
    values (${negocioId}, ${servicoId}, 'Cliente exemplo', '00000000000', ${inicio}, ${fim}, ${status}, ${randomBytes(32).toString('hex')}) returning id`;
}
function bloquear(client: Executor, inicio = '2030-01-07T12:30:00Z', fim = '2030-01-07T13:30:00Z') {
  return client`insert into bloqueio (negocio_id, inicio, fim, motivo) values (${negocioId}, ${inicio}, ${fim}, 'Teste') returning id`;
}

test('migrações podem rodar novamente sem recriar tabelas', async () => {
  await expect(migrate(connection.db, { migrationsFolder: './drizzle' })).resolves.toBeUndefined();
});

test('rejeita sobreposição parcial, mesmo com inícios diferentes', async () => {
  await reservar(connection.client);
  await expect(reservar(connection.client, '2030-01-07T12:30Z', '2030-01-07T13:30Z')).rejects.toMatchObject({ code: '23P01' });
});

test('permite horários adjacentes', async () => {
  await reservar(connection.client);
  await expect(reservar(connection.client, '2030-01-07T13:00Z', '2030-01-07T13:30Z')).resolves.toHaveLength(1);
});

test('cancelamento libera o intervalo e reativação conflitante falha', async () => {
  const [antigo] = await reservar(connection.client);
  await connection.client`update agendamento set status = 'cancelado' where id = ${antigo.id}`;
  await reservar(connection.client);
  await expect(connection.client`update agendamento set status = 'confirmado' where id = ${antigo.id}`).rejects.toMatchObject({ code: '23P01' });
});

test('rejeita serviço de outro negócio', async () => {
  const [outro] = await connection.client`insert into negocio (nome, slug, telefone) values ('Outro', ${randomUUID()}, '00000000000') returning id`;
  negocioId = outro.id;
  await expect(reservar(connection.client)).rejects.toMatchObject({ code: '23503' });
});

test('permite o mesmo horário em negócios diferentes', async () => {
  await reservar(connection.client);
  const [outro] = await connection.client`insert into negocio (nome, slug, telefone) values ('Outro', ${randomUUID()}, '00000000000') returning id`;
  negocioId = outro.id;
  const [s] = await connection.client`insert into servico (negocio_id, nome, duracao_min, preco_centavos) values (${negocioId}, 'Corte', 30, 4000) returning id`;
  servicoId = s.id;
  await expect(reservar(connection.client)).resolves.toHaveLength(1);
});

test('rejeita intervalo vazio', async () => {
  await expect(reservar(connection.client, '2030-01-07T12:00Z', '2030-01-07T12:00Z')).rejects.toMatchObject({ code: '23514' });
});

test('rejeita duração zero e preço negativo', async () => {
  await expect(connection.client`update servico set duracao_min = 0 where id = ${servicoId}`).rejects.toMatchObject({ code: '23514' });
  await expect(connection.client`update servico set preco_centavos = -1 where id = ${servicoId}`).rejects.toMatchObject({ code: '23514' });
});

test('valida fuso e expediente que atravessa meia-noite', async () => {
  await expect(connection.client`update negocio set fuso = 'Fuso/Inexistente' where id = ${negocioId}`).rejects.toMatchObject({ code: '23514' });
  await expect(connection.client`insert into horario_funcionamento (negocio_id, dia_semana, abre, fecha, termina_dia_seguinte) values (${negocioId}, 1, '22:00', '02:00', true)`).resolves.toBeDefined();
  await expect(connection.client`insert into horario_funcionamento (negocio_id, dia_semana, abre, fecha) values (${negocioId}, 1, '18:00', '09:00')`).rejects.toMatchObject({ code: '23514' });
});

test('guarda o mesmo instante ao receber offset local', async () => {
  const [a] = await reservar(connection.client, '2030-01-07T09:00:00-03:00', '2030-01-07T10:00:00-03:00');
  const [registro] = await connection.client`select inicio from agendamento where id = ${a.id}`;
  expect(new Date(registro.inicio).toISOString()).toBe('2030-01-07T12:00:00.000Z');
});

test('rejeita reserva em bloqueio e bloqueio em reserva', async () => {
  const [b] = await bloquear(connection.client);
  await expect(reservar(connection.client)).rejects.toMatchObject({ code: '23P01' });
  await connection.client`delete from bloqueio where id = ${b.id}`;
  await reservar(connection.client);
  await expect(bloquear(connection.client)).rejects.toMatchObject({ code: '23P01' });
});

// A primeira transação só é liberada quando o PostgreSQL informa que a
// segunda está esperando um lock. Não depende de sleep com tempo arbitrário.
async function disputar(primeira: (tx: postgres.TransactionSql) => PromiseLike<unknown>, segunda: (tx: postgres.TransactionSql) => PromiseLike<unknown>) {
  let liberar!: () => void;
  let pronta!: () => void;
  const trava = new Promise<void>((resolve) => { liberar = resolve; });
  const iniciou = new Promise<void>((resolve) => { pronta = resolve; });
  const a = connection.client.begin(async (tx) => {
    await primeira(tx);
    pronta();
    await trava;
  });
  await Promise.race([iniciou, a.then(() => { throw new Error('Transação terminou antes da trava'); })]);
  const b = connection.client.begin(async (tx) => {
    await tx`set local application_name = 'agendaki-disputa'`;
    await segunda(tx);
  });
  const resultados = Promise.allSettled([a, b]);
  try {
    await expect.poll(async () => {
      const [r] = await connection.client`select count(*)::int as total from pg_stat_activity where application_name = 'agendaki-disputa' and wait_event_type = 'Lock'`;
      return r.total;
    }, { timeout: 5000 }).toBe(1);
  } finally {
    liberar();
  }
  const final = await resultados;
  expect(final[0].status).toBe('fulfilled');
  expect(final[1]).toMatchObject({ status: 'rejected', reason: { code: '23P01' } });
}

test('duas reservas simultâneas: somente uma confirma', async () => {
  await disputar((tx) => reservar(tx), (tx) => reservar(tx));
});

test('reserva simultânea com bloqueio: bloqueio aguarda e falha', async () => {
  await disputar((tx) => reservar(tx), (tx) => bloquear(tx));
});

test('bloqueio simultâneo com reserva: reserva aguarda e falha', async () => {
  await disputar((tx) => bloquear(tx), (tx) => reservar(tx));
});

test('seed repetível mantém 3 serviços, 6 reservas futuras e outros negócios', async () => {
  await reservar(connection.client);
  await seedDemo(connection.db, 'senha-apenas-de-teste');
  const resultado = await seedDemo(connection.db, 'senha-apenas-de-teste');
  expect(resultado.agendamentos).toBe(6);
  expect(resultado.linksCancelamento).toHaveLength(6);
  const [contagem] = await connection.client`select count(*)::int as total from agendamento where negocio_id = ${DEMO_ID}`;
  const [servicos] = await connection.client`select count(*)::int as total from servico where negocio_id = ${DEMO_ID}`;
  const [outros] = await connection.client`select count(*)::int as total from agendamento where negocio_id = ${negocioId}`;
  const [passados] = await connection.client`select count(*)::int as total from agendamento where negocio_id = ${DEMO_ID} and inicio < now()`;
  const [dono] = await connection.client`select senha_hash from usuario where negocio_id = ${DEMO_ID}`;
  expect([contagem.total, servicos.total, outros.total, passados.total]).toEqual([6, 3, 1, 0]);
  expect(dono.senha_hash).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
});

test('página pública não expõe clientes e busca ocupação iniciada antes da janela', async () => {
  await connection.client`insert into horario_funcionamento (negocio_id, dia_semana, abre, fecha) values (${negocioId}, 1, '09:00', '11:00')`;
  await reservar(connection.client, '2030-01-01T00:00Z', '2030-01-07T12:30Z');
  await reservar(connection.client, '2030-01-07T13:00Z', '2030-01-07T13:30Z', 'cancelado');
  await connection.client`insert into servico (negocio_id, nome, duracao_min, preco_centavos, ativo) values (${negocioId}, 'Inativo', 30, 100, false)`;
  const [n] = await connection.client`select slug from negocio where id = ${negocioId}`;
  const pagina = await obterPaginaPublica(connection.db, n.slug, new Date('2030-01-07T11:00Z'));
  expect(pagina?.servicos).toHaveLength(1);
  expect(pagina?.dias).toHaveLength(14);
  expect(pagina?.servicos[0].horarios.filter((h) => h.dataLocal === '2030-01-07').map((h) => h.inicio)).toEqual([
    '2030-01-07T12:30:00Z', '2030-01-07T13:00:00Z', '2030-01-07T13:30:00Z',
  ]);
  const publico = JSON.stringify(pagina);
  expect(publico).not.toMatch(/cliente|telefone|token|senha|Cliente exemplo/);
});

test('página pública isola negócios e representa negócio sem serviços', async () => {
  await connection.client`insert into horario_funcionamento (negocio_id, dia_semana, abre, fecha) values (${negocioId}, 1, '09:00', '11:00')`;
  const [outro] = await connection.client`insert into negocio (nome, slug, telefone) values ('Outro', ${randomUUID()}, '00000000000') returning id, slug`;
  await connection.client`insert into bloqueio (negocio_id, inicio, fim, motivo) values (${outro.id}, '2030-01-07T00:00Z', '2030-01-08T00:00Z', 'Privado')`;
  const [n] = await connection.client`select slug from negocio where id = ${negocioId}`;
  const pagina = await obterPaginaPublica(connection.db, n.slug, new Date('2030-01-07T11:00Z'));
  expect(pagina?.servicos[0].horarios.filter((h) => h.dataLocal === '2030-01-07')).toHaveLength(4);
  expect((await obterPaginaPublica(connection.db, outro.slug))?.servicos).toEqual([]);
  expect(await obterPaginaPublica(connection.db, 'inexistente')).toBeNull();
});
