import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { criarNegocio, gerarSlug } from '../src/db/negocios.js';
import { entrar, obterSessao } from '../src/auth/sessao.js';
import { definirProfissionalAtivo, definirServicoAtivo, obterConfiguracao, salvarFuncionamento, salvarNegocio, salvarProfissional, salvarServico } from '../src/painel/configuracao.js';
import { obterPaginaPublica } from '../src/agenda/pagina-publica.js';
import { reservarHorario } from '../src/agenda/reservar.js';
import { iniciarBancoTemporario } from './banco-temporario.js';

let banco: Awaited<ReturnType<typeof iniciarBancoTemporario>>;
let meu: { negocioId: string; slug: string; email: string; senha: string };
let vizinho: typeof meu;

// Segunda-feira, 8h em São Paulo.
const AGORA = new Date('2030-01-07T11:00:00Z');

async function novo(nome: string) {
  const r = await criarNegocio(banco.db, { nome, telefone: '(34) 99999-0000', email: `dono-${randomUUID()}@teste.example`, slug: `teste-${randomUUID()}` });
  if (!r.ok) throw new Error(r.mensagem);
  return r;
}
const servicosDe = (negocioId: string) => banco.client`select * from servico where negocio_id = ${negocioId} order by nome`;

beforeAll(async () => { banco = await iniciarBancoTemporario(); });
afterAll(async () => { await banco?.encerrar(); });
beforeEach(async () => { meu = await novo('Barbearia Teste'); vizinho = await novo('Salão Vizinho'); });

// ---------- Cadastro de negócio ----------

test('gera o endereço da página a partir do nome', () => {
  expect(gerarSlug('Salão da Ana & Cia.')).toBe('salao-da-ana-cia');
  expect(gerarSlug('  Barbearia   do Zé  ')).toBe('barbearia-do-ze');
  expect(gerarSlug('Ótica São João 24h')).toBe('otica-sao-joao-24h');
  expect(gerarSlug('!!!')).toBe('');
  expect(gerarSlug('a'.repeat(80)).length).toBe(60);
});

test('um negócio novo já entra no painel, com um profissional, expediente padrão e sem serviços', async () => {
  const r = await criarNegocio(banco.db, { nome: '  Barbearia   do Zé ', telefone: '+55 (34) 98888-7777', email: ' ZE@Exemplo.COM ' });
  if (!r.ok) throw new Error(r.mensagem);
  expect(r).toMatchObject({ slug: 'barbearia-do-ze', email: 'ze@exemplo.com' });
  expect(r.senha).toMatch(/^[A-Za-z0-9_-]{12}$/);
  const [linha] = await banco.client`select n.nome, n.telefone, n.fuso, n.demonstracao, u.senha_hash from negocio n join usuario u on u.negocio_id = n.id where n.id = ${r.negocioId}`;
  expect(linha).toMatchObject({ nome: 'Barbearia do Zé', telefone: '34988887777', fuso: 'America/Sao_Paulo', demonstracao: false });
  expect(linha.senha_hash).not.toContain(r.senha);

  const login = await entrar(banco.db, 'ze@exemplo.com', r.senha, AGORA);
  if (!login.ok) throw new Error('deveria entrar');
  expect(await obterSessao(banco.db, login.token, AGORA)).toMatchObject({ negocioId: r.negocioId });

  const config = await obterConfiguracao(banco.db, r.negocioId);
  expect(config).toMatchObject({ simples: true, servicos: [], negocio: { nome: 'Barbearia do Zé', slug: 'barbearia-do-ze' } });
  expect(config!.funcionamento.map((f) => [f.diaSemana, f.abre, f.fecha])).toEqual([1, 2, 3, 4, 5].map((d) => [d, '09:00', '18:00']));
  expect(config!.profissionais).toMatchObject([{ nome: 'Profissional', ativo: true }]);

  const comNome = await criarNegocio(banco.db, { nome: 'Studio da Bia', telefone: '(34) 98888-7777', email: `bia-${randomUUID()}@teste.example`,
    slug: `studio-${randomUUID()}`, profissional: '  Bia   Alves ' });
  if (!comNome.ok) throw new Error(comNome.mensagem);
  expect((await obterConfiguracao(banco.db, comNome.negocioId))!.profissionais).toMatchObject([{ nome: 'Bia Alves', ativo: true }]);
});

test('recusa dados ruins, endereço do sistema e duplicados, sem deixar nada pela metade', async () => {
  const base = { nome: 'Outro Negócio', telefone: '(34) 99999-0000', email: `novo-${randomUUID()}@teste.example`, slug: `novo-${randomUUID()}` };
  const antes = (await banco.client`select count(*)::int as total from negocio`)[0].total;
  for (const extra of [{ nome: 'A' }, { telefone: '123' }, { email: 'sem-arroba' }, { slug: 'Com Espaço' }, { slug: 'painel' }, { slug: 'entrar' },
    { senha: 'curta' }, { fuso: 'Marte/Olympus' }, { slug: meu.slug }, { email: meu.email }, { profissional: 'B' }]) {
    expect(await criarNegocio(banco.db, { ...base, ...extra }), JSON.stringify(extra)).toMatchObject({ ok: false });
  }
  expect(await criarNegocio(banco.db, { ...base, nome: '!!!', slug: undefined })).toMatchObject({ ok: false });
  expect((await banco.client`select count(*)::int as total from negocio`)[0].total).toBe(antes);
  expect(await criarNegocio(banco.db, { ...base, senha: 'uma-senha-bem-comprida' })).toMatchObject({ ok: true, senha: 'uma-senha-bem-comprida' });
});

// ---------- Serviços ----------

test('cria, altera e desativa serviços, e a página pública acompanha', async () => {
  expect(await salvarServico(banco.db, meu.negocioId, { nome: '  Corte   social ', duracaoMin: 30, precoCentavos: 4000 })).toEqual({ ok: true });
  expect(await salvarServico(banco.db, meu.negocioId, { nome: 'Barba', duracaoMin: 20, precoCentavos: 0 })).toEqual({ ok: true });
  const [barba, corte] = await servicosDe(meu.negocioId);
  expect(corte).toMatchObject({ nome: 'Corte social', duracao_min: 30, preco_centavos: 4000, ativo: true });

  expect(await salvarServico(banco.db, meu.negocioId, { id: corte.id, nome: 'Corte', duracaoMin: 45, precoCentavos: 5000 })).toEqual({ ok: true });
  let publica = await obterPaginaPublica(banco.db, meu.slug, AGORA);
  expect(publica!.servicos.map((s) => [s.nome, s.duracaoMin, s.precoCentavos])).toEqual([['Barba', 20, 0], ['Corte', 45, 5000]]);

  expect(await definirServicoAtivo(banco.db, meu.negocioId, barba.id, false)).toEqual({ ok: true });
  publica = await obterPaginaPublica(banco.db, meu.slug, AGORA);
  expect(publica!.servicos.map((s) => s.nome)).toEqual(['Corte']);
  // A tela de configurações continua mostrando o desativado, depois dos ativos.
  expect((await obterConfiguracao(banco.db, meu.negocioId))!.servicos.map((s) => [s.nome, s.ativo])).toEqual([['Corte', true], ['Barba', false]]);
  expect(await reservarHorario(banco.db, { slug: meu.slug, servicoId: barba.id, inicio: '2030-01-07T12:00:00Z', nome: 'Ana', telefone: '(34) 99999-1234' }, AGORA))
    .toMatchObject({ ok: false, motivo: 'servico_indisponivel' });
  expect(await definirServicoAtivo(banco.db, meu.negocioId, barba.id, true)).toEqual({ ok: true });
});

test('mudar a duração não mexe em horário já marcado', async () => {
  await salvarServico(banco.db, meu.negocioId, { nome: 'Corte', duracaoMin: 30, precoCentavos: 4000 });
  const [corte] = await servicosDe(meu.negocioId);
  await reservarHorario(banco.db, { slug: meu.slug, servicoId: corte.id, inicio: '2030-01-07T12:00:00Z', nome: 'Ana', telefone: '(34) 99999-1234' }, AGORA);
  await salvarServico(banco.db, meu.negocioId, { id: corte.id, nome: 'Corte', duracaoMin: 60, precoCentavos: 4000 });
  const [marcado] = await banco.client`select inicio, fim from agendamento where negocio_id = ${meu.negocioId}`;
  expect(new Date(marcado.fim).getTime() - new Date(marcado.inicio).getTime()).toBe(30 * 60_000);
});

test('recusa serviço com nome, duração ou preço fora do aceito', async () => {
  const ok = { nome: 'Corte', duracaoMin: 30, precoCentavos: 4000 };
  for (const extra of [{ nome: 'A' }, { nome: 'x'.repeat(61) }, { duracaoMin: 0 }, { duracaoMin: 32 }, { duracaoMin: 485 }, { duracaoMin: 30.5 },
    { precoCentavos: -1 }, { precoCentavos: 10.5 }, { precoCentavos: 1_000_001 }, { duracaoMin: '30' as never }]) {
    expect(await salvarServico(banco.db, meu.negocioId, { ...ok, ...extra }), JSON.stringify(extra)).toMatchObject({ ok: false });
  }
  expect(await servicosDe(meu.negocioId)).toHaveLength(0);
});

// ---------- Expediente e dados do negócio ----------

test('troca o expediente e a página pública passa a oferecer os novos horários', async () => {
  await salvarServico(banco.db, meu.negocioId, { nome: 'Corte', duracaoMin: 30, precoCentavos: 4000 });
  // Só segunda, das 10h às 12h, e sábado, das 8h às 12h.
  expect(await salvarFuncionamento(banco.db, meu.negocioId, [{ diaSemana: 6, abre: '08:00', fecha: '12:00' }, { diaSemana: 1, abre: '10:00', fecha: '12:00' }])).toEqual({ ok: true });
  expect((await obterConfiguracao(banco.db, meu.negocioId))!.funcionamento).toEqual([
    { diaSemana: 1, abre: '10:00', fecha: '12:00', terminaDiaSeguinte: false },
    { diaSemana: 6, abre: '08:00', fecha: '12:00', terminaDiaSeguinte: false },
  ]);
  const publica = await obterPaginaPublica(banco.db, meu.slug, AGORA);
  const horarios = publica!.servicos[0].horarios;
  expect(horarios.filter((h) => h.dataLocal === '2030-01-07').map((h) => h.inicio)).toEqual(
    ['2030-01-07T13:00:00Z', '2030-01-07T13:30:00Z', '2030-01-07T14:00:00Z', '2030-01-07T14:30:00Z']);
  expect(horarios.some((h) => h.dataLocal === '2030-01-08')).toBe(false);
  expect(horarios.filter((h) => h.dataLocal === '2030-01-12')).toHaveLength(8);
  // Fechar tudo também é aceito.
  expect(await salvarFuncionamento(banco.db, meu.negocioId, [])).toEqual({ ok: true });
  expect((await obterPaginaPublica(banco.db, meu.slug, AGORA))!.servicos[0].horarios).toEqual([]);
});

test('recusa expediente inválido e preserva o que não sabe editar', async () => {
  const dia = { diaSemana: 1, abre: '09:00', fecha: '18:00' };
  for (const dias of [[{ ...dia, diaSemana: 7 }], [{ ...dia, fecha: '09:00' }], [{ ...dia, abre: '9h' }], [dia, dia], 'segunda' as never, Array(8).fill(dia)]) {
    expect(await salvarFuncionamento(banco.db, meu.negocioId, dias), JSON.stringify(dias)).toMatchObject({ ok: false });
  }
  expect((await obterConfiguracao(banco.db, meu.negocioId))!.funcionamento).toHaveLength(5);
  // Um expediente que vira a noite foi configurado fora da tela: ela não o sobrescreve.
  await banco.client`insert into horario_funcionamento (negocio_id, dia_semana, abre, fecha, termina_dia_seguinte) values (${meu.negocioId}, 6, '22:00', '02:00', true)`;
  expect((await obterConfiguracao(banco.db, meu.negocioId))!.simples).toBe(false);
  expect(await salvarFuncionamento(banco.db, meu.negocioId, [dia])).toMatchObject({ ok: false });
  expect((await obterConfiguracao(banco.db, meu.negocioId))!.funcionamento).toHaveLength(6);
});

test('altera nome e WhatsApp do negócio, sem mexer no endereço da página', async () => {
  expect(await salvarNegocio(banco.db, meu.negocioId, { nome: '  Barbearia   Nova ', telefone: '(34) 3333-4444' })).toEqual({ ok: true });
  expect((await obterConfiguracao(banco.db, meu.negocioId))!.negocio).toMatchObject({ nome: 'Barbearia Nova', telefone: '3433334444', slug: meu.slug });
  expect(await salvarNegocio(banco.db, meu.negocioId, { nome: 'A', telefone: '(34) 3333-4444' })).toMatchObject({ ok: false });
  expect(await salvarNegocio(banco.db, meu.negocioId, { nome: 'Barbearia', telefone: '123' })).toMatchObject({ ok: false });
  expect(await salvarNegocio(banco.db, randomUUID(), { nome: 'Fantasma', telefone: '(34) 3333-4444' })).toMatchObject({ ok: false });
});

test('as configurações de um negócio não alcançam as do outro', async () => {
  await salvarServico(banco.db, vizinho.negocioId, { nome: 'Escova', duracaoMin: 40, precoCentavos: 6000 });
  const [escova] = await servicosDe(vizinho.negocioId);
  expect(await salvarServico(banco.db, meu.negocioId, { id: escova.id, nome: 'Minha agora', duracaoMin: 30, precoCentavos: 1 })).toMatchObject({ ok: false });
  expect(await definirServicoAtivo(banco.db, meu.negocioId, escova.id, false)).toMatchObject({ ok: false });
  expect(await salvarServico(banco.db, meu.negocioId, { id: 'nao-e-uuid', nome: 'Corte', duracaoMin: 30, precoCentavos: 1 })).toMatchObject({ ok: false });
  expect(await definirServicoAtivo(banco.db, meu.negocioId, 'nao-e-uuid', false)).toMatchObject({ ok: false });
  await salvarProfissional(banco.db, vizinho.negocioId, { nome: 'Lia' });
  const [alheia] = await banco.client`select id from profissional where negocio_id = ${vizinho.negocioId} and nome = 'Lia'`;
  expect(await salvarProfissional(banco.db, meu.negocioId, { id: alheia.id, nome: 'Minha agora' })).toMatchObject({ ok: false });
  expect(await definirProfissionalAtivo(banco.db, meu.negocioId, alheia.id, false, AGORA)).toMatchObject({ ok: false });
  expect(await salvarProfissional(banco.db, meu.negocioId, { id: 'nao-e-uuid', nome: 'Caio' })).toMatchObject({ ok: false });
  expect(await definirProfissionalAtivo(banco.db, meu.negocioId, 'nao-e-uuid', false, AGORA)).toMatchObject({ ok: false });
  expect(await salvarProfissional(banco.db, randomUUID(), { nome: 'Fantasma' })).toMatchObject({ ok: false });
  await salvarFuncionamento(banco.db, meu.negocioId, []);
  await salvarNegocio(banco.db, meu.negocioId, { nome: 'Só o meu mudou', telefone: '(34) 3333-4444' });

  const config = await obterConfiguracao(banco.db, vizinho.negocioId);
  expect(config!.servicos).toMatchObject([{ nome: 'Escova', duracaoMin: 40, precoCentavos: 6000, ativo: true }]);
  expect(config!.funcionamento).toHaveLength(5);
  expect(config!.negocio.nome).toBe('Salão Vizinho');
  expect(config!.profissionais.map((p) => [p.nome, p.ativo])).toEqual([['Profissional', true], ['Lia', true]]);
  expect(JSON.stringify(await obterConfiguracao(banco.db, meu.negocioId))).not.toMatch(/Escova|Salão Vizinho|Lia/);
});

// ---------- Profissionais ----------

const profissionaisDe = (negocioId: string) => banco.client`select * from profissional where negocio_id = ${negocioId} order by criado_em`;

test('cadastra, renomeia e desativa profissionais, e a página pública acompanha', async () => {
  await salvarServico(banco.db, meu.negocioId, { nome: 'Corte', duracaoMin: 30, precoCentavos: 4000 });
  const [primeiro] = await profissionaisDe(meu.negocioId);
  expect(await salvarProfissional(banco.db, meu.negocioId, { id: primeiro.id, nome: '  Caio   Lima ' })).toEqual({ ok: true });
  expect(await salvarProfissional(banco.db, meu.negocioId, { nome: 'Diego' })).toEqual({ ok: true });
  for (const nome of ['D', 'x'.repeat(61), '   ', 7 as never]) {
    expect(await salvarProfissional(banco.db, meu.negocioId, { nome }), String(nome)).toMatchObject({ ok: false });
  }
  const [caio, diego] = await profissionaisDe(meu.negocioId);
  expect([caio.nome, diego.nome]).toEqual(['Caio Lima', 'Diego']);

  let publica = await obterPaginaPublica(banco.db, meu.slug, AGORA);
  expect(publica!.profissionais).toEqual([{ id: caio.id, nome: 'Caio Lima' }, { id: diego.id, nome: 'Diego' }]);
  expect(publica!.servicos[0].horarios[0].profissionais).toEqual([caio.id, diego.id]);

  expect(await definirProfissionalAtivo(banco.db, meu.negocioId, caio.id, false, AGORA)).toEqual({ ok: true });
  publica = await obterPaginaPublica(banco.db, meu.slug, AGORA);
  expect(publica!.profissionais).toEqual([{ id: diego.id, nome: 'Diego' }]);
  // A tela de configurações continua mostrando o desativado, depois dos ativos.
  expect((await obterConfiguracao(banco.db, meu.negocioId))!.profissionais.map((p) => [p.nome, p.ativo])).toEqual([['Diego', true], ['Caio Lima', false]]);
  expect(await reservarHorario(banco.db, { slug: meu.slug, servicoId: publica!.servicos[0].id, inicio: '2030-01-07T12:00:00Z', nome: 'Ana',
    telefone: '(34) 99999-1234', profissionalId: caio.id }, AGORA)).toMatchObject({ ok: false, motivo: 'profissional_indisponivel' });
  expect(await definirProfissionalAtivo(banco.db, meu.negocioId, caio.id, true, AGORA)).toEqual({ ok: true });
  expect(await definirProfissionalAtivo(banco.db, meu.negocioId, caio.id, true, AGORA)).toEqual({ ok: true });
});

test('não desativa o último profissional nem quem ainda tem cliente marcado', async () => {
  await salvarServico(banco.db, meu.negocioId, { nome: 'Corte', duracaoMin: 30, precoCentavos: 4000 });
  const [servico] = await servicosDe(meu.negocioId);
  const [caio] = await profissionaisDe(meu.negocioId);
  expect(await definirProfissionalAtivo(banco.db, meu.negocioId, caio.id, false, AGORA)).toEqual({ ok: false, mensagem: 'O negócio precisa de pelo menos um profissional atendendo.' });

  await salvarProfissional(banco.db, meu.negocioId, { nome: 'Diego' });
  const diego = (await profissionaisDe(meu.negocioId))[1];
  const marcar = (inicio: string, telefone: string) => reservarHorario(banco.db, { slug: meu.slug, servicoId: servico.id, inicio, nome: 'Ana', telefone, profissionalId: diego.id }, AGORA);
  expect(await marcar('2030-01-07T12:00:00Z', '(34) 99999-1234')).toMatchObject({ ok: true });
  expect(await marcar('2030-01-08T12:00:00Z', '(34) 99999-5678')).toMatchObject({ ok: true });
  const recusa = await definirProfissionalAtivo(banco.db, meu.negocioId, diego.id, false, AGORA);
  expect(recusa).toEqual({ ok: false, mensagem: 'Diego ainda tem 2 clientes marcados. Cancele ou atenda esses horários antes de desativar.' });
  expect((await profissionaisDe(meu.negocioId)).map((p) => p.ativo)).toEqual([true, true]);

  // Um cancelado e um que já passou: não seguram mais ninguém.
  await banco.client`update agendamento set status = 'cancelado' where profissional_id = ${diego.id} and inicio > '2030-01-08T00:00:00Z'`;
  expect(await definirProfissionalAtivo(banco.db, meu.negocioId, diego.id, false, new Date('2030-01-07T12:00:00Z'))).toEqual({ ok: true });
  // Com o Diego fora, o Caio volta a ser o último.
  expect(await definirProfissionalAtivo(banco.db, meu.negocioId, caio.id, false, AGORA)).toMatchObject({ ok: false });
  // O histórico do Diego continua lá.
  expect(await banco.client`select id from agendamento where profissional_id = ${diego.id}`).toHaveLength(2);
});
