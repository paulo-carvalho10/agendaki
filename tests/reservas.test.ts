import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { obterPaginaPublica } from '../src/agenda/pagina-publica.js';
import { hashToken, reservarHorario } from '../src/agenda/reservar.js';
import { cancelarPorToken, obterAgendamentoPorToken } from '../src/agenda/cancelar.js';
import type { PedidoReserva, ReservaConfirmada } from '../src/agenda/pedido-reserva.js';
import { iniciarBancoTemporario } from './banco-temporario.js';

let banco: Awaited<ReturnType<typeof iniciarBancoTemporario>>;
let negocioId: string;
let slug: string;
let servicoId: string;
let servicoLongoId: string;

// Segunda-feira, 8h em São Paulo. O negócio de teste abre todos os dias, 9h–18h.
const AGORA = new Date('2030-01-07T11:00:00Z');
const NOVE = '2030-01-07T12:00:00Z';
const NOVE_E_MEIA = '2030-01-07T12:30:00Z';
const DEZ = '2030-01-07T13:00:00Z';

beforeAll(async () => { banco = await iniciarBancoTemporario(); });
afterAll(async () => { await banco?.encerrar(); });

beforeEach(async () => {
  slug = `teste-${randomUUID()}`;
  const [n] = await banco.client`insert into negocio (nome, slug, telefone) values ('Barbearia Teste', ${slug}, '3433334444') returning id`;
  negocioId = n.id;
  const [curto] = await banco.client`insert into servico (negocio_id, nome, duracao_min, preco_centavos) values (${negocioId}, 'Corte', 30, 4000) returning id`;
  const [longo] = await banco.client`insert into servico (negocio_id, nome, duracao_min, preco_centavos) values (${negocioId}, 'Corte + barba', 60, 6500) returning id`;
  servicoId = curto.id; servicoLongoId = longo.id;
  for (let dia = 0; dia <= 6; dia++) {
    await banco.client`insert into horario_funcionamento (negocio_id, dia_semana, abre, fecha) values (${negocioId}, ${dia}, '09:00', '18:00')`;
  }
});

const pedido = (extra: Partial<PedidoReserva> = {}): PedidoReserva =>
  ({ slug, servicoId, inicio: NOVE, nome: 'Ana Souza', telefone: '(34) 99999-1234', ...extra });
const reservar = (extra: Partial<PedidoReserva> = {}, agora = AGORA) => reservarHorario(banco.db, pedido(extra), agora);
const agendamentos = () => banco.client`select * from agendamento where negocio_id = ${negocioId} order by inicio`;

test('grava a reserva confirmada, com fim calculado e só o hash do token', async () => {
  const r = await reservar({ nome: '  Ana   Souza ', telefone: '+55 (34) 99999-1234' }) as ReservaConfirmada;
  expect(r.ok).toBe(true);
  expect(r.inicio).toBe('2030-01-07T12:00:00.000Z');
  expect(r.fim).toBe('2030-01-07T12:30:00.000Z');
  expect(r.servico).toEqual({ nome: 'Corte', duracaoMin: 30, precoCentavos: 4000 });
  expect(r.negocio).toMatchObject({ nome: 'Barbearia Teste', telefone: '3433334444', demonstracao: false });
  expect(r.tokenCancelamento).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const [linha] = await agendamentos();
  expect(linha).toMatchObject({ cliente_nome: 'Ana Souza', cliente_telefone: '34999991234', status: 'confirmado',
    servico_id: servicoId, token_cancelamento_hash: hashToken(r.tokenCancelamento) });
  expect(linha.token_cancelamento_hash).not.toContain(r.tokenCancelamento);
});

test('a página pública deixa de oferecer o horário reservado', async () => {
  const antes = await obterPaginaPublica(banco.db, slug, AGORA);
  expect(antes!.servicos[0].horarios.some((h) => h.inicio === NOVE)).toBe(true);
  await reservar();
  const depois = await obterPaginaPublica(banco.db, slug, AGORA);
  expect(depois!.servicos.every((s) => s.horarios.every((h) => h.inicio !== NOVE))).toBe(true);
  expect(JSON.stringify(depois)).not.toMatch(/Ana Souza|34999991234/);
});

test('recusa dados inválidos sem gravar nada', async () => {
  for (const extra of [{ nome: 'A' }, { nome: '12345' }, { telefone: '99999-1234' }, { telefone: '(34) 89999-1234' },
    { telefone: '(00) 99999-1234' }, { inicio: 'amanhã às 9' }, { servicoId: 'corte' }, { slug: 'Não É Slug' }, { site: 'http://spam.example' }]) {
    expect(await reservar(extra)).toMatchObject({ ok: false, motivo: 'dados_invalidos' });
  }
  expect(await agendamentos()).toHaveLength(0);
});

test('recusa negócio inexistente, serviço inativo e serviço de outro negócio', async () => {
  expect(await reservar({ slug: 'nao-existe' })).toMatchObject({ ok: false, motivo: 'negocio_inexistente' });
  await banco.client`update servico set ativo = false where id = ${servicoId}`;
  expect(await reservar()).toMatchObject({ ok: false, motivo: 'servico_indisponivel' });

  const [outro] = await banco.client`insert into negocio (nome, slug, telefone) values ('Outro', ${`outro-${randomUUID()}`}, '3433335555') returning id`;
  const [alheio] = await banco.client`insert into servico (negocio_id, nome, duracao_min, preco_centavos) values (${outro.id}, 'Corte', 30, 4000) returning id`;
  expect(await reservar({ servicoId: alheio.id })).toMatchObject({ ok: false, motivo: 'servico_indisponivel' });
  expect(await agendamentos()).toHaveLength(0);
});

test('só aceita horários que o motor ofereceria', async () => {
  const fora = { ok: false, motivo: 'horario_indisponivel' };
  // Fora da grade de 30 minutos, antes de abrir, depois de fechar e no passado.
  expect(await reservar({ inicio: '2030-01-07T12:10:00Z' })).toMatchObject(fora);
  expect(await reservar({ inicio: '2030-01-07T11:30:00Z' })).toMatchObject(fora);
  expect(await reservar({ inicio: '2030-01-07T21:00:00Z' })).toMatchObject(fora);
  expect(await reservar({ inicio: NOVE }, new Date('2030-01-07T12:00:01Z'))).toMatchObject(fora);
  // O serviço de 60 minutos não cabe na última meia hora do expediente.
  expect(await reservar({ servicoId: servicoLongoId, inicio: '2030-01-07T20:30:00Z' })).toMatchObject(fora);
  // Além dos 14 dias oferecidos, e antes de hoje.
  expect(await reservar({ inicio: '2030-01-21T12:00:00Z' })).toMatchObject(fora);
  expect(await reservar({ inicio: '2030-01-06T12:00:00Z' })).toMatchObject(fora);
  expect(await agendamentos()).toHaveLength(0);
  // O último dia da janela ainda vale.
  expect(await reservar({ inicio: '2030-01-20T12:00:00Z' })).toMatchObject({ ok: true });
});

test('recusa horário ocupado por reserva, inclusive por sobreposição parcial, e por bloqueio', async () => {
  expect(await reservar({ servicoId: servicoLongoId, inicio: NOVE })).toMatchObject({ ok: true });
  const ocupado = { ok: false, motivo: 'horario_indisponivel' };
  expect(await reservar({ telefone: '(34) 98888-0001', inicio: NOVE })).toMatchObject(ocupado);
  expect(await reservar({ telefone: '(34) 98888-0001', inicio: NOVE_E_MEIA })).toMatchObject(ocupado);
  expect(await reservar({ telefone: '(34) 98888-0001', inicio: DEZ })).toMatchObject({ ok: true });

  await banco.client`insert into bloqueio (negocio_id, inicio, fim, motivo) values (${negocioId}, '2030-01-07T15:00:00Z', '2030-01-07T16:00:00Z', 'Almoço')`;
  expect(await reservar({ telefone: '(34) 98888-0002', inicio: '2030-01-07T15:30:00Z' })).toMatchObject(ocupado);
  expect(await agendamentos()).toHaveLength(2);
});

test('em uma disputa pelo mesmo horário, exatamente um pedido vence', async () => {
  const telefones = ['(34) 97777-0001', '(34) 97777-0002', '(34) 97777-0003', '(34) 97777-0004', '(34) 97777-0005'];
  const resultados = await Promise.all(telefones.map((telefone) => reservar({ telefone })));
  expect(resultados.filter((r) => r.ok)).toHaveLength(1);
  expect(resultados.filter((r) => !r.ok).every((r) => !r.ok && r.motivo === 'horario_indisponivel')).toBe(true);
  expect(await agendamentos()).toHaveLength(1);
});

test('limita as reservas futuras do mesmo telefone, sem contar canceladas nem outro negócio', async () => {
  const primeira = await reservar({ inicio: NOVE }) as ReservaConfirmada;
  expect(await reservar({ inicio: NOVE_E_MEIA })).toMatchObject({ ok: true });
  expect(await reservar({ inicio: DEZ })).toMatchObject({ ok: false, motivo: 'limite_reservas' });
  // Outro telefone não é afetado.
  expect(await reservar({ inicio: DEZ, telefone: '(34) 96666-0001' })).toMatchObject({ ok: true });
  // Cancelar uma libera espaço para marcar outra.
  expect(await cancelarPorToken(banco.db, primeira.tokenCancelamento, AGORA)).toEqual({ ok: true });
  expect(await reservar({ inicio: '2030-01-07T13:30:00Z' })).toMatchObject({ ok: true });
});

test('o link de cancelamento mostra só o agendamento do dono do link', async () => {
  const r = await reservar() as ReservaConfirmada;
  const visto = await obterAgendamentoPorToken(banco.db, r.tokenCancelamento);
  expect(visto).toMatchObject({ status: 'confirmado', clienteNome: 'Ana Souza', servicoNome: 'Corte',
    duracaoMin: 30, precoCentavos: 4000, negocioNome: 'Barbearia Teste', negocioSlug: slug });
  expect(visto!.inicio.toISOString()).toBe('2030-01-07T12:00:00.000Z');
  expect(JSON.stringify(visto)).not.toContain('34999991234');
  expect(await obterAgendamentoPorToken(banco.db, 'x'.repeat(43))).toBeNull();
  expect(await obterAgendamentoPorToken(banco.db, 'curto')).toBeNull();
  // O hash guardado no banco não serve como link.
  expect(await obterAgendamentoPorToken(banco.db, hashToken(r.tokenCancelamento))).toBeNull();
});

test('cancelar libera o horário e não se repete', async () => {
  const r = await reservar() as ReservaConfirmada;
  expect(await cancelarPorToken(banco.db, r.tokenCancelamento, AGORA)).toEqual({ ok: true });
  expect((await agendamentos())[0].status).toBe('cancelado');
  expect(await cancelarPorToken(banco.db, r.tokenCancelamento, AGORA)).toEqual({ ok: false, motivo: 'ja_cancelado' });
  expect(await cancelarPorToken(banco.db, 'y'.repeat(43), AGORA)).toEqual({ ok: false, motivo: 'inexistente' });
  // O mesmo horário volta a ser oferecido e pode ser reservado por outra pessoa.
  const pagina = await obterPaginaPublica(banco.db, slug, AGORA);
  expect(pagina!.servicos[0].horarios.some((h) => h.inicio === NOVE)).toBe(true);
  expect(await reservar({ telefone: '(34) 95555-0001' })).toMatchObject({ ok: true });
});

test('não cancela o que já começou nem o que o dono já encerrou', async () => {
  const passou = await reservar() as ReservaConfirmada;
  expect(await cancelarPorToken(banco.db, passou.tokenCancelamento, new Date('2030-01-07T12:00:00Z')))
    .toEqual({ ok: false, motivo: 'ja_passou' });

  const atendido = await reservar({ inicio: DEZ, telefone: '(34) 94444-0001' }) as ReservaConfirmada;
  await banco.client`update agendamento set status = 'atendido' where token_cancelamento_hash = ${hashToken(atendido.tokenCancelamento)}`;
  expect(await cancelarPorToken(banco.db, atendido.tokenCancelamento, AGORA)).toEqual({ ok: false, motivo: 'encerrado' });
  expect((await agendamentos()).map((a) => a.status)).toEqual(['confirmado', 'atendido']);
});
