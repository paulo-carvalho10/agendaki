import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { BLOQUEIO_MIN, MAXIMO_FALHAS, contarSessoes, entrar, gerarHashSenha, obterSessao, sair, senhaConfere } from '../src/auth/sessao.js';
import { obterAgendaDoDia } from '../src/painel/agenda.js';
import { agendarPeloDono, criarBloqueio, mudarStatus, registrarLembrete, removerBloqueio } from '../src/painel/acoes.js';
import { reservarHorario } from '../src/agenda/reservar.js';
import { obterPaginaPublica } from '../src/agenda/pagina-publica.js';
import type { ReservaConfirmada } from '../src/agenda/pedido-reserva.js';
import { iniciarBancoTemporario } from './banco-temporario.js';

let banco: Awaited<ReturnType<typeof iniciarBancoTemporario>>;
type Negocio = { id: string; slug: string; servicoId: string; email: string; usuarioId: string; profissionalId: string };
let meu: Negocio;
let vizinho: Negocio;

// Segunda-feira, 8h em São Paulo. Os negócios de teste abrem todos os dias, 9h–18h.
const AGORA = new Date('2030-01-07T11:00:00Z');
const SENHA = 'senha-boa-de-teste';
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000);

async function criarNegocio(nome: string): Promise<Negocio> {
  const slug = `teste-${randomUUID()}`;
  const email = `dono-${randomUUID()}@teste.example`;
  const [n] = await banco.client`insert into negocio (nome, slug, telefone) values (${nome}, ${slug}, '3433334444') returning id`;
  const [s] = await banco.client`insert into servico (negocio_id, nome, duracao_min, preco_centavos) values (${n.id}, 'Corte', 30, 4000) returning id`;
  for (let dia = 0; dia <= 6; dia++) {
    await banco.client`insert into horario_funcionamento (negocio_id, dia_semana, abre, fecha) values (${n.id}, ${dia}, '09:00', '18:00')`;
  }
  const [u] = await banco.client`insert into usuario (negocio_id, email, senha_hash) values (${n.id}, ${email}, ${gerarHashSenha(SENHA)}) returning id`;
  return { id: n.id, slug, servicoId: s.id, email, usuarioId: u.id, profissionalId: await novoProfissional(n.id, 'Caio') };
}
async function novoProfissional(negocioId: string, nome: string) {
  const [p] = await banco.client`insert into profissional (negocio_id, nome) values (${negocioId}, ${nome}) returning id`;
  return p.id as string;
}
const reservar = (negocio: Negocio, inicio: string, nome = 'Ana Souza', telefone = '(34) 99999-1234') =>
  reservarHorario(banco.db, { slug: negocio.slug, servicoId: negocio.servicoId, inicio, nome, telefone }, AGORA) as Promise<ReservaConfirmada>;
const linhas = (negocio: Negocio) => banco.client`select * from agendamento where negocio_id = ${negocio.id} order by inicio`;

beforeAll(async () => { banco = await iniciarBancoTemporario(); });
afterAll(async () => { await banco?.encerrar(); });
beforeEach(async () => { meu = await criarNegocio('Barbearia Teste'); vizinho = await criarNegocio('Salão Vizinho'); });

// ---------- Login e sessão ----------

test('a senha certa abre uma sessão ligada ao negócio do dono', async () => {
  const r = await entrar(banco.db, `  ${meu.email.toUpperCase()} `, SENHA, AGORA);
  if (!r.ok) throw new Error('deveria entrar');
  expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(r.expiraEm.toISOString()).toBe('2030-02-06T11:00:00.000Z');
  expect(await obterSessao(banco.db, r.token, AGORA)).toEqual({ usuarioId: meu.usuarioId, email: meu.email, negocioId: meu.id });
  const [guardada] = await banco.client`select token_hash from sessao where usuario_id = ${meu.usuarioId}`;
  expect(guardada.token_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(guardada.token_hash).not.toBe(r.token);
});

test('senha errada e email inexistente recebem a mesma resposta e não abrem sessão', async () => {
  const errada = await entrar(banco.db, meu.email, 'outra-senha', AGORA);
  const inexistente = await entrar(banco.db, 'ninguem@teste.example', SENHA, AGORA);
  expect(errada).toEqual({ ok: false, motivo: 'credenciais' });
  expect(inexistente).toEqual(errada);
  expect(await entrar(banco.db, '', SENHA, AGORA)).toEqual(errada);
  expect(await entrar(banco.db, meu.email, 'x'.repeat(201), AGORA)).toEqual(errada);
  expect(await contarSessoes(banco.db, meu.usuarioId)).toBe(0);
});

test('erros seguidos travam o login por um tempo, e a senha certa zera a contagem', async () => {
  for (let i = 1; i < MAXIMO_FALHAS; i++) expect(await entrar(banco.db, meu.email, 'errada', AGORA)).toEqual({ ok: false, motivo: 'credenciais' });
  // A senha certa antes do limite zera a contagem.
  expect((await entrar(banco.db, meu.email, SENHA, AGORA)).ok).toBe(true);
  for (let i = 1; i < MAXIMO_FALHAS; i++) await entrar(banco.db, meu.email, 'errada', AGORA);
  const travou = await entrar(banco.db, meu.email, 'errada', AGORA);
  expect(travou).toMatchObject({ ok: false, motivo: 'bloqueado' });
  // Travado, nem a senha certa entra.
  expect(await entrar(banco.db, meu.email, SENHA, minutos(BLOQUEIO_MIN - 1))).toMatchObject({ ok: false, motivo: 'bloqueado' });
  expect((await entrar(banco.db, meu.email, SENHA, minutos(BLOQUEIO_MIN + 1))).ok).toBe(true);
  // O bloqueio de um dono não afeta o outro.
  expect((await entrar(banco.db, vizinho.email, SENHA, AGORA)).ok).toBe(true);
});

test('a sessão expira, pode ser encerrada e não aceita token fora do formato', async () => {
  const r = await entrar(banco.db, meu.email, SENHA, AGORA);
  if (!r.ok) throw new Error('deveria entrar');
  expect(await obterSessao(banco.db, r.token, new Date('2030-02-06T10:59:59Z'))).not.toBeNull();
  expect(await obterSessao(banco.db, r.token, new Date('2030-02-06T11:00:00Z'))).toBeNull();
  expect(await obterSessao(banco.db, 'x'.repeat(43), AGORA)).toBeNull();
  expect(await obterSessao(banco.db, 'curto', AGORA)).toBeNull();
  expect(await obterSessao(banco.db, undefined, AGORA)).toBeNull();
  await sair(banco.db, r.token);
  expect(await obterSessao(banco.db, r.token, AGORA)).toBeNull();
});

test('a conferência de senha recusa formatos desconhecidos', () => {
  const hash = gerarHashSenha(SENHA);
  expect(senhaConfere(SENHA, hash)).toBe(true);
  expect(senhaConfere('outra', hash)).toBe(false);
  expect(senhaConfere(SENHA, 'texto-puro')).toBe(false);
  expect(senhaConfere(SENHA, 'md5:abc:def')).toBe(false);
  expect(senhaConfere(SENHA, 'scrypt:salt:curto')).toBe(false);
});

// ---------- Agenda do dia ----------

test('mostra os agendamentos do dia com os dados do cliente, só do próprio negócio', async () => {
  await reservar(meu, '2030-01-07T13:00:00Z', 'Bruno Lima', '(34) 98888-0001');
  await reservar(meu, '2030-01-07T12:00:00Z');
  await reservar(meu, '2030-01-08T12:00:00Z', 'Carla Dias', '(34) 97777-0001');
  await reservar(vizinho, '2030-01-07T12:00:00Z', 'Cliente do Vizinho', '(34) 96666-0001');

  const agenda = await obterAgendaDoDia(banco.db, meu.id, undefined, AGORA);
  expect(agenda).toMatchObject({ hoje: '2030-01-07', dia: '2030-01-07', diaAnterior: '2030-01-06', diaSeguinte: '2030-01-08', podeAgendar: true });
  expect(agenda!.agendamentos.map((a) => [a.clienteNome, a.clienteTelefone, a.servicoNome, a.status, a.inicio])).toEqual([
    ['Ana Souza', '34999991234', 'Corte', 'confirmado', '2030-01-07T12:00:00.000Z'],
    ['Bruno Lima', '34988880001', 'Corte', 'confirmado', '2030-01-07T13:00:00.000Z'],
  ]);
  expect(agenda!.resumo).toEqual({ confirmados: 2, atendidos: 0, faltas: 0, cancelados: 0, previstoCentavos: 8000, realizadoCentavos: 0 });
  expect(agenda!.profissionais).toEqual([{ id: meu.profissionalId, nome: 'Caio' }]);
  expect(agenda!.agendamentos.every((a) => a.profissionalId === meu.profissionalId && a.profissionalNome === 'Caio')).toBe(true);
  expect(JSON.stringify(agenda)).not.toMatch(/Cliente do Vizinho|Salão Vizinho/);
  // Os horários já marcados não aparecem como livres para o agendamento manual.
  const livres = agenda!.servicos[0].horarios.map((h) => h.inicio);
  expect(livres).not.toContain('2030-01-07T12:00:00Z');
  expect(livres).toContain('2030-01-07T12:30:00Z');

  expect((await obterAgendaDoDia(banco.db, meu.id, '2030-01-08', AGORA))!.agendamentos.map((a) => a.clienteNome)).toEqual(['Carla Dias']);
  expect(await obterAgendaDoDia(banco.db, randomUUID(), undefined, AGORA)).toBeNull();
});

test('data inválida ou distante demais volta para hoje, e só agenda dentro dos 14 dias', async () => {
  for (const dia of ['ontem', '2030-02-30', '2031-01-07', '2029-01-07']) {
    expect((await obterAgendaDoDia(banco.db, meu.id, dia, AGORA))!.dia).toBe('2030-01-07');
  }
  const passado = await obterAgendaDoDia(banco.db, meu.id, '2030-01-06', AGORA);
  expect(passado).toMatchObject({ dia: '2030-01-06', podeAgendar: false });
  expect(passado!.servicos[0].horarios).toEqual([]);
  expect((await obterAgendaDoDia(banco.db, meu.id, '2030-01-20', AGORA))!.podeAgendar).toBe(true);
  expect((await obterAgendaDoDia(banco.db, meu.id, '2030-01-21', AGORA))!.podeAgendar).toBe(false);
});

test('os lembretes são do próximo dia com clientes confirmados', async () => {
  expect((await obterAgendaDoDia(banco.db, meu.id, undefined, AGORA))!.lembretes).toEqual({ dia: null, agendamentos: [] });
  // Hoje não entra; amanhã está vazio; quarta tem dois, um deles cancelado; quinta tem um.
  await reservar(meu, '2030-01-07T15:00:00Z', 'Hoje', '(34) 91111-0001');
  const cancelada = await reservar(meu, '2030-01-09T12:00:00Z', 'Cancelada', '(34) 92222-0001');
  await reservar(meu, '2030-01-09T13:00:00Z', 'Quarta', '(34) 93333-0001');
  await reservar(meu, '2030-01-10T12:00:00Z', 'Quinta', '(34) 94444-0001');
  await banco.client`update agendamento set status = 'cancelado' where cliente_nome = 'Cancelada' and negocio_id = ${meu.id}`;
  expect(cancelada.ok).toBe(true);

  const { lembretes } = (await obterAgendaDoDia(banco.db, meu.id, undefined, AGORA))!;
  expect(lembretes.dia).toBe('2030-01-09');
  expect(lembretes.agendamentos.map((a) => a.clienteNome)).toEqual(['Quarta']);
  // Além de quatro dias à frente não entra.
  const longe = await criarNegocio('Longe');
  await reservar(longe, '2030-01-12T12:00:00Z');
  expect((await obterAgendaDoDia(banco.db, longe.id, undefined, AGORA))!.lembretes.dia).toBeNull();
});

// ---------- Ações do dono ----------

test('atendido e falta só depois que o horário começa, e dá para desfazer', async () => {
  await reservar(meu, '2030-01-07T12:00:00Z');
  const [{ id }] = await linhas(meu);
  expect(await mudarStatus(banco.db, meu.id, id, 'atendido', AGORA)).toMatchObject({ ok: false });
  expect(await mudarStatus(banco.db, meu.id, id, 'faltou', minutos(59))).toMatchObject({ ok: false });
  expect((await linhas(meu))[0].status).toBe('confirmado');

  expect(await mudarStatus(banco.db, meu.id, id, 'atendido', minutos(60))).toEqual({ ok: true });
  expect(await mudarStatus(banco.db, meu.id, id, 'cancelado', minutos(61))).toMatchObject({ ok: false });
  expect(await mudarStatus(banco.db, meu.id, id, 'confirmado', minutos(61))).toEqual({ ok: true });
  expect(await mudarStatus(banco.db, meu.id, id, 'faltou', minutos(62))).toEqual({ ok: true });
  expect((await linhas(meu))[0].status).toBe('faltou');
  expect(await mudarStatus(banco.db, meu.id, id, 'talvez' as never, minutos(62))).toMatchObject({ ok: false });
});

test('o dono cancela um horário confirmado e a vaga volta para a página pública', async () => {
  await reservar(meu, '2030-01-07T12:00:00Z');
  const [{ id }] = await linhas(meu);
  expect(await mudarStatus(banco.db, meu.id, id, 'cancelado', AGORA)).toEqual({ ok: true });
  const publica = await obterPaginaPublica(banco.db, meu.slug, AGORA);
  expect(publica!.servicos[0].horarios.some((h) => h.inicio === '2030-01-07T12:00:00Z')).toBe(true);
  // Cancelado não volta por aqui.
  expect(await mudarStatus(banco.db, meu.id, id, 'confirmado', AGORA)).toMatchObject({ ok: false });
  expect((await obterAgendaDoDia(banco.db, meu.id, undefined, AGORA))!.resumo).toMatchObject({ confirmados: 0, cancelados: 1, previstoCentavos: 0 });
});

test('um dono não altera nem vê a agenda de outro negócio', async () => {
  await reservar(vizinho, '2030-01-07T12:00:00Z');
  const [{ id }] = await linhas(vizinho);
  expect(await mudarStatus(banco.db, meu.id, id, 'cancelado', AGORA)).toEqual({ ok: false, mensagem: 'Agendamento não encontrado.' });
  expect(await registrarLembrete(banco.db, meu.id, id, AGORA)).toMatchObject({ ok: false });
  expect(await mudarStatus(banco.db, meu.id, 'nao-e-uuid', 'cancelado', AGORA)).toEqual({ ok: false, mensagem: 'Agendamento não encontrado.' });
  expect((await linhas(vizinho))[0]).toMatchObject({ status: 'confirmado', lembrete_em: null });

  await criarBloqueio(banco.db, vizinho.id, { dia: '2030-01-07', das: '14:00', ate: '15:00', motivo: 'Folga' });
  const [bloqueio] = await banco.client`select id from bloqueio where negocio_id = ${vizinho.id}`;
  expect(await removerBloqueio(banco.db, meu.id, bloqueio.id)).toMatchObject({ ok: false });
  expect(await removerBloqueio(banco.db, meu.id, 'nao-e-uuid')).toMatchObject({ ok: false });
  expect(await banco.client`select id from bloqueio where negocio_id = ${vizinho.id}`).toHaveLength(1);
});

test('registra quando o lembrete foi aberto', async () => {
  await reservar(meu, '2030-01-08T12:00:00Z');
  const [{ id }] = await linhas(meu);
  expect(await registrarLembrete(banco.db, meu.id, id, AGORA)).toEqual({ ok: true });
  // O driver devolve timestamptz como texto nas consultas diretas.
  expect(new Date((await linhas(meu))[0].lembrete_em).toISOString()).toBe('2030-01-07T11:00:00.000Z');
  expect((await obterAgendaDoDia(banco.db, meu.id, undefined, AGORA))!.lembretes.agendamentos[0].lembreteEm).toBe('2030-01-07T11:00:00.000Z');
});

test('bloqueia um intervalo no fuso do negócio, recusa o que conflita e desfaz', async () => {
  await reservar(meu, '2030-01-07T15:00:00Z'); // 12h em São Paulo
  expect(await criarBloqueio(banco.db, meu.id, { dia: '2030-01-07', das: '11:30', ate: '12:30', motivo: 'Almoço' })).toMatchObject({ ok: false });
  expect(await criarBloqueio(banco.db, meu.id, { dia: '2030-01-07', das: '14:00', ate: '13:00', motivo: '' })).toMatchObject({ ok: false });
  expect(await criarBloqueio(banco.db, meu.id, { dia: '2030-02-30', das: '13:00', ate: '14:00', motivo: '' })).toMatchObject({ ok: false });
  expect(await criarBloqueio(banco.db, meu.id, { dia: '2030-01-07', das: '25:00', ate: '26:00', motivo: '' })).toMatchObject({ ok: false });
  expect(await banco.client`select id from bloqueio where negocio_id = ${meu.id}`).toHaveLength(0);

  expect(await criarBloqueio(banco.db, meu.id, { dia: '2030-01-07', das: '13:00', ate: '14:00', motivo: '  Dentista  ' })).toEqual({ ok: true });
  const agenda = (await obterAgendaDoDia(banco.db, meu.id, undefined, AGORA))!;
  expect(agenda.bloqueios).toMatchObject([{ inicio: '2030-01-07T16:00:00.000Z', fim: '2030-01-07T17:00:00.000Z', motivo: 'Dentista', profissionalId: null, profissionalNome: null }]);
  expect(agenda.servicos[0].horarios.map((h) => h.inicio)).not.toContain('2030-01-07T16:00:00Z');
  // Com o bloqueio, a página pública também para de oferecer o intervalo.
  expect(await reservar(meu, '2030-01-07T16:30:00Z', 'Davi', '(34) 95555-0001')).toMatchObject({ ok: false, motivo: 'horario_indisponivel' });

  expect(await removerBloqueio(banco.db, meu.id, agenda.bloqueios[0].id)).toEqual({ ok: true });
  expect(await reservar(meu, '2030-01-07T16:30:00Z', 'Davi', '(34) 95555-0001')).toMatchObject({ ok: true });
});

test('o dono agenda sem limite por telefone e sem telefone, mas não em horário ocupado', async () => {
  const pedido = (inicio: string, telefone = '(34) 99999-1234', nome = 'Cliente do balcão') => agendarPeloDono(banco.db, meu.id, { servicoId: meu.servicoId, inicio, nome, telefone }, AGORA);
  for (const inicio of ['2030-01-07T12:00:00Z', '2030-01-07T12:30:00Z', '2030-01-07T13:00:00Z']) expect(await pedido(inicio)).toMatchObject({ ok: true });
  expect(await pedido('2030-01-07T13:30:00Z', '')).toMatchObject({ ok: true });
  expect((await linhas(meu)).map((a) => a.cliente_telefone)).toEqual(['34999991234', '34999991234', '34999991234', '']);
  expect(await pedido('2030-01-07T12:00:00Z', '')).toMatchObject({ ok: false, motivo: 'horario_indisponivel' });
  expect(await pedido('2030-01-07T14:00:00Z', '123')).toMatchObject({ ok: false, motivo: 'dados_invalidos' });
  // Serviço de outro negócio não entra na minha agenda.
  expect(await agendarPeloDono(banco.db, meu.id, { servicoId: vizinho.servicoId, inicio: '2030-01-07T14:00:00Z', nome: 'Eva', telefone: '' }, AGORA)).toMatchObject({ ok: false, motivo: 'servico_indisponivel' });
  // Na página pública, telefone vazio continua recusado.
  expect(await reservarHorario(banco.db, { slug: meu.slug, servicoId: meu.servicoId, inicio: '2030-01-07T14:00:00Z', nome: 'Eva', telefone: '' }, AGORA)).toMatchObject({ ok: false, motivo: 'dados_invalidos' });
});

// ---------- Vários profissionais ----------

test('com dois profissionais, a agenda diz quem atende e quem está livre em cada horário', async () => {
  const diego = await novoProfissional(meu.id, 'Diego');
  const pedido = (inicio: string, nome: string, profissionalId?: string) =>
    agendarPeloDono(banco.db, meu.id, { servicoId: meu.servicoId, inicio, nome, telefone: '', profissionalId }, AGORA);
  expect(await pedido('2030-01-07T12:00:00Z', 'Ana', diego)).toMatchObject({ ok: true, profissional: { id: diego, nome: 'Diego' }, variosProfissionais: true });
  expect(await pedido('2030-01-07T12:00:00Z', 'Bruno', '')).toMatchObject({ ok: true, profissional: { nome: 'Caio' } });
  expect(await pedido('2030-01-07T12:00:00Z', 'Carla')).toMatchObject({ ok: false, motivo: 'horario_indisponivel' });
  expect(await pedido('2030-01-07T12:30:00Z', 'Davi', diego)).toMatchObject({ ok: true });
  // Profissional de outro negócio não atende aqui.
  expect(await pedido('2030-01-07T13:00:00Z', 'Eva', vizinho.profissionalId)).toMatchObject({ ok: false, motivo: 'profissional_indisponivel' });

  const agenda = (await obterAgendaDoDia(banco.db, meu.id, undefined, AGORA))!;
  expect(agenda.profissionais).toEqual([{ id: meu.profissionalId, nome: 'Caio' }, { id: diego, nome: 'Diego' }]);
  expect(agenda.agendamentos.map((a) => [a.clienteNome, a.profissionalNome])).toEqual([['Bruno', 'Caio'], ['Ana', 'Diego'], ['Davi', 'Diego']]);
  const livres = agenda.servicos[0].horarios;
  expect(livres.some((h) => h.inicio === '2030-01-07T12:00:00Z')).toBe(false);
  expect(livres.find((h) => h.inicio === '2030-01-07T12:30:00Z')!.profissionais).toEqual([meu.profissionalId]);
  expect(livres.find((h) => h.inicio === '2030-01-07T13:00:00Z')!.profissionais).toEqual([meu.profissionalId, diego]);
  expect(JSON.stringify(agenda)).not.toContain(vizinho.profissionalId);
});

test('o bloqueio pode fechar a agenda de um profissional só', async () => {
  const diego = await novoProfissional(meu.id, 'Diego');
  const bloqueio = (profissionalId?: string | null, das = '09:00', ate = '10:00') =>
    criarBloqueio(banco.db, meu.id, { dia: '2030-01-07', das, ate, motivo: 'Folga', profissionalId });
  await agendarPeloDono(banco.db, meu.id, { servicoId: meu.servicoId, inicio: '2030-01-07T12:00:00Z', nome: 'Ana', telefone: '', profissionalId: meu.profissionalId }, AGORA);
  // Caio tem cliente às 9h: a agenda dele e a de todos não fecham; a do Diego, sim.
  expect(await bloqueio(meu.profissionalId)).toMatchObject({ ok: false });
  expect(await bloqueio()).toMatchObject({ ok: false });
  expect(await bloqueio(diego)).toEqual({ ok: true });
  expect(await bloqueio(vizinho.profissionalId, '14:00', '15:00')).toEqual({ ok: false, mensagem: 'Profissional não encontrado.' });
  expect(await bloqueio('nao-e-uuid', '14:00', '15:00')).toEqual({ ok: false, mensagem: 'Profissional não encontrado.' });
  expect(await bloqueio(null, '14:00', '15:00')).toEqual({ ok: true });

  const agenda = (await obterAgendaDoDia(banco.db, meu.id, undefined, AGORA))!;
  expect(agenda.bloqueios.map((b) => [b.profissionalNome, b.inicio])).toEqual([['Diego', '2030-01-07T12:00:00.000Z'], [null, '2030-01-07T17:00:00.000Z']]);
  const livres = agenda.servicos[0].horarios;
  expect(livres.find((h) => h.inicio === '2030-01-07T12:30:00Z')!.profissionais).toEqual([meu.profissionalId]);
  expect(livres.some((h) => h.inicio === '2030-01-07T17:00:00Z')).toBe(false);
  expect(await reservar(meu, '2030-01-07T12:30:00Z', 'Bruno', '(34) 98888-0001')).toMatchObject({ ok: true, profissional: { nome: 'Caio' } });
});
