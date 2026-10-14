import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { criarNegocio } from '../src/db/negocios.js';
import { seedDemo, DEMO_EMAIL, DEMO_ID } from '../src/db/seed.js';
import { BLOQUEIO_MIN, MAXIMO_FALHAS, contarSessoes, entrar, obterSessao } from '../src/auth/sessao.js';
import { VALIDADE_REDEFINICAO_MIN, criarLinkRedefinicao, obterRedefinicao, redefinirSenha, trocarSenha } from '../src/auth/senha.js';
import { salvarProfissional, salvarServico } from '../src/painel/configuracao.js';
import { agendarPeloDono, mudarStatus } from '../src/painel/acoes.js';
import { marcarNovidadesVistas, obterNovidades } from '../src/painel/novidades.js';
import { reservarHorario } from '../src/agenda/reservar.js';
import { cancelarPorToken } from '../src/agenda/cancelar.js';
import type { ReservaConfirmada } from '../src/agenda/pedido-reserva.js';
import { MAXIMO_APARELHOS, avisarNegocio, contarInscricoes, enderecoDePushValido, removerInscricao, salvarInscricao, type Inscricao } from '../src/avisos/push.js';
import { avisarCancelamento, avisarReservaNova } from '../src/avisos/reservas.js';
import { iniciarBancoTemporario } from './banco-temporario.js';

let banco: Awaited<ReturnType<typeof iniciarBancoTemporario>>;
type Dono = { negocioId: string; usuarioId: string; slug: string; email: string; senha: string; servicoId: string };
let meu: Dono;
let vizinho: Dono;

// Segunda-feira, 8h em São Paulo. Os negócios novos abrem de segunda a sexta, 9h–18h.
const AGORA = new Date('2030-01-07T11:00:00Z');
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000);
const NOVA = 'uma-senha-nova-e-boa';

async function novo(nome: string): Promise<Dono> {
  const r = await criarNegocio(banco.db, { nome, telefone: '(34) 99999-0000', email: `dono-${randomUUID()}@teste.example`, slug: `teste-${randomUUID()}`, profissional: 'Caio' });
  if (!r.ok) throw new Error(r.mensagem);
  await salvarServico(banco.db, r.negocioId, { nome: 'Corte', duracaoMin: 30, precoCentavos: 4000 });
  const [u] = await banco.client`select id from usuario where negocio_id = ${r.negocioId}`;
  const [s] = await banco.client`select id from servico where negocio_id = ${r.negocioId}`;
  return { negocioId: r.negocioId, usuarioId: u.id, slug: r.slug, email: r.email, senha: r.senha, servicoId: s.id };
}
async function logar(dono: Dono, senha = dono.senha, agora = AGORA) {
  const r = await entrar(banco.db, dono.email, senha, agora);
  if (!r.ok) throw new Error('deveria entrar');
  return r.token;
}
const reservar = (dono: Dono, inicio: string, nome = 'Ana Souza', telefone = '(34) 99999-1234', agora = AGORA) =>
  reservarHorario(banco.db, { slug: dono.slug, servicoId: dono.servicoId, inicio, nome, telefone }, agora) as Promise<ReservaConfirmada>;

beforeAll(async () => { banco = await iniciarBancoTemporario(); });
afterAll(async () => { await banco?.encerrar(); });
beforeEach(async () => { meu = await novo('Barbearia Teste'); vizinho = await novo('Salão Vizinho'); });

// ---------- Troca de senha pelo painel ----------

test('o dono troca a senha informando a atual, e os outros aparelhos saem', async () => {
  const esteAparelho = await logar(meu);
  const outroAparelho = await logar(meu);
  const trocar = (atual: string, nova: string) => trocarSenha(banco.db, meu.usuarioId, esteAparelho, atual, nova);
  expect(await trocar('senha-errada-qualquer', NOVA)).toEqual({ ok: false, mensagem: 'A senha atual não confere.' });
  expect(await trocar(meu.senha, 'curta')).toMatchObject({ ok: false });
  expect(await trocar(meu.senha, 'x'.repeat(201))).toMatchObject({ ok: false });
  expect(await trocar(meu.senha, meu.senha)).toEqual({ ok: false, mensagem: 'A senha nova precisa ser diferente da atual.' });
  expect(await trocar(meu.senha, undefined as never)).toMatchObject({ ok: false });
  // Nada mudou até aqui.
  expect(await contarSessoes(banco.db, meu.usuarioId)).toBe(2);

  expect(await trocar(meu.senha, NOVA)).toEqual({ ok: true });
  expect(await obterSessao(banco.db, esteAparelho, AGORA)).toMatchObject({ usuarioId: meu.usuarioId });
  expect(await obterSessao(banco.db, outroAparelho, AGORA)).toBeNull();
  expect(await entrar(banco.db, meu.email, meu.senha, AGORA)).toMatchObject({ ok: false, motivo: 'credenciais' });
  expect((await entrar(banco.db, meu.email, NOVA, AGORA)).ok).toBe(true);
  const [guardado] = await banco.client`select senha_hash from usuario where id = ${meu.usuarioId}`;
  expect(guardado.senha_hash).toMatch(/^scrypt:/);
  expect(guardado.senha_hash).not.toContain(NOVA);
  // A senha do vizinho não foi tocada.
  expect((await entrar(banco.db, vizinho.email, vizinho.senha, AGORA)).ok).toBe(true);
});

test('a senha da demonstração não muda pelo painel nem por link', async () => {
  await seedDemo(banco.db, 'senha-apenas-de-teste');
  const [demo] = await banco.client`select id from usuario where email = ${DEMO_EMAIL}`;
  expect(await trocarSenha(banco.db, demo.id, undefined, 'senha-apenas-de-teste', NOVA)).toEqual({ ok: false, mensagem: 'Na demonstração a senha fica fixa.' });
  expect(await criarLinkRedefinicao(banco.db, DEMO_EMAIL, AGORA)).toMatchObject({ ok: false });
  expect((await entrar(banco.db, DEMO_EMAIL, 'senha-apenas-de-teste')).ok).toBe(true);
});

// ---------- Link de redefinição ----------

test('o link de redefinição vale uma vez, encerra as sessões e desfaz o bloqueio do login', async () => {
  const sessaoAntiga = await logar(meu);
  // O dono esqueceu a senha e travou o login de tanto tentar.
  for (let i = 0; i < MAXIMO_FALHAS; i++) await entrar(banco.db, meu.email, 'tentativa-errada', AGORA);
  expect(await entrar(banco.db, meu.email, meu.senha, AGORA)).toMatchObject({ ok: false, motivo: 'bloqueado' });

  const link = await criarLinkRedefinicao(banco.db, `  ${meu.email.toUpperCase()} `, AGORA);
  if (!link.ok) throw new Error(link.mensagem);
  expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(link.expiraEm.toISOString()).toBe(minutos(VALIDADE_REDEFINICAO_MIN).toISOString());
  expect(link).toMatchObject({ negocioNome: 'Barbearia Teste', email: meu.email });
  const [guardado] = await banco.client`select token_hash from redefinicao_senha where usuario_id = ${meu.usuarioId}`;
  expect(guardado.token_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(guardado.token_hash).not.toBe(link.token);

  expect(await obterRedefinicao(banco.db, link.token, AGORA)).toMatchObject({ email: meu.email, negocioNome: 'Barbearia Teste' });
  // Senha fraca não gasta o link.
  expect(await redefinirSenha(banco.db, link.token, 'curta', AGORA)).toMatchObject({ ok: false });
  expect(await obterRedefinicao(banco.db, link.token, AGORA)).not.toBeNull();

  expect(await redefinirSenha(banco.db, link.token, NOVA, minutos(5))).toEqual({ ok: true });
  expect(await obterSessao(banco.db, sessaoAntiga, minutos(5))).toBeNull();
  // Ainda dentro dos minutos de bloqueio, a senha nova já entra.
  expect(BLOQUEIO_MIN).toBeGreaterThan(6);
  expect((await entrar(banco.db, meu.email, NOVA, minutos(6))).ok).toBe(true);
  expect(await entrar(banco.db, meu.email, meu.senha, minutos(6))).toMatchObject({ ok: false, motivo: 'credenciais' });
  // O mesmo link não serve de novo.
  expect(await obterRedefinicao(banco.db, link.token, minutos(7))).toBeNull();
  expect(await redefinirSenha(banco.db, link.token, 'outra-senha-bem-comprida', minutos(7))).toEqual({ ok: false, mensagem: 'Este link não vale mais. Peça um novo.' });
  expect((await entrar(banco.db, meu.email, NOVA, minutos(8))).ok).toBe(true);
});

test('link vencido, substituído, inexistente ou de email desconhecido não redefine nada', async () => {
  const primeiro = await criarLinkRedefinicao(banco.db, meu.email, AGORA);
  const segundo = await criarLinkRedefinicao(banco.db, meu.email, minutos(1));
  if (!primeiro.ok || !segundo.ok) throw new Error('deveria gerar');
  // O link novo invalida o anterior.
  expect(await obterRedefinicao(banco.db, primeiro.token, minutos(2))).toBeNull();
  expect(await redefinirSenha(banco.db, primeiro.token, NOVA, minutos(2))).toMatchObject({ ok: false });
  // No último instante ainda vale; um minuto depois, não.
  expect(await obterRedefinicao(banco.db, segundo.token, minutos(VALIDADE_REDEFINICAO_MIN))).not.toBeNull();
  expect(await obterRedefinicao(banco.db, segundo.token, minutos(VALIDADE_REDEFINICAO_MIN + 1))).toBeNull();
  expect(await redefinirSenha(banco.db, segundo.token, NOVA, minutos(VALIDADE_REDEFINICAO_MIN + 1))).toMatchObject({ ok: false });
  for (const token of ['x'.repeat(43), 'curto', '', undefined as never]) {
    expect(await obterRedefinicao(banco.db, token, AGORA)).toBeNull();
    expect(await redefinirSenha(banco.db, token, NOVA, AGORA)).toMatchObject({ ok: false });
  }
  expect(await criarLinkRedefinicao(banco.db, 'ninguem@teste.example', AGORA)).toMatchObject({ ok: false });
  expect(await criarLinkRedefinicao(banco.db, '', AGORA)).toMatchObject({ ok: false });
  expect((await entrar(banco.db, meu.email, meu.senha, AGORA)).ok).toBe(true);
  // Trocar a senha pelo painel também derruba um link pendente.
  const terceiro = await criarLinkRedefinicao(banco.db, meu.email, AGORA);
  if (!terceiro.ok) throw new Error('deveria gerar');
  expect(await trocarSenha(banco.db, meu.usuarioId, undefined, meu.senha, NOVA)).toEqual({ ok: true });
  expect(await obterRedefinicao(banco.db, terceiro.token, AGORA)).toBeNull();
});

// ---------- Novidades no painel ----------

test('as novidades mostram o que os clientes marcaram e cancelaram, não o que o dono fez', async () => {
  expect(await obterNovidades(banco.db, meu.usuarioId)).toEqual({ total: 0, itens: [] });
  const ana = await reservar(meu, '2030-01-07T13:00:00Z');
  const bruno = await reservar(meu, '2030-01-08T12:00:00Z', 'Bruno Lima', '(34) 98888-0001', minutos(1));
  await agendarPeloDono(banco.db, meu.negocioId, { servicoId: meu.servicoId, inicio: '2030-01-07T14:00:00Z', nome: 'Cliente do balcão', telefone: '' }, minutos(2));
  await reservar(vizinho, '2030-01-07T13:00:00Z', 'Cliente do Vizinho', '(34) 97777-0001');

  let novidades = await obterNovidades(banco.db, meu.usuarioId);
  expect(novidades.total).toBe(2);
  expect(novidades.itens.map((n) => [n.tipo, n.clienteNome, n.servicoNome, n.profissionalNome, n.inicio, n.quando])).toEqual([
    ['marcou', 'Bruno Lima', 'Corte', 'Caio', '2030-01-08T12:00:00.000Z', minutos(1).toISOString()],
    ['marcou', 'Ana Souza', 'Corte', 'Caio', '2030-01-07T13:00:00.000Z', AGORA.toISOString()],
  ]);
  expect(JSON.stringify(novidades)).not.toMatch(/Cliente do balcão|Cliente do Vizinho|34999991234/);

  // O dono conferiu. Depois disso, a Ana cancela pelo link e o dono cancela o Bruno no painel.
  expect(await marcarNovidadesVistas(banco.db, meu.usuarioId, minutos(3))).toEqual({ ok: true });
  expect(await obterNovidades(banco.db, meu.usuarioId)).toEqual({ total: 0, itens: [] });
  expect(await cancelarPorToken(banco.db, ana.tokenCancelamento, minutos(4))).toEqual({ ok: true });
  const [doBruno] = await banco.client`select id from agendamento where cliente_nome = 'Bruno Lima' and negocio_id = ${meu.negocioId}`;
  expect(await mudarStatus(banco.db, meu.negocioId, doBruno.id, 'cancelado', minutos(4))).toEqual({ ok: true });
  expect(bruno.ok).toBe(true);

  novidades = await obterNovidades(banco.db, meu.usuarioId);
  expect(novidades.total).toBe(1);
  expect(novidades.itens).toMatchObject([{ tipo: 'cancelou', clienteNome: 'Ana Souza', quando: minutos(4).toISOString(), inicio: '2030-01-07T13:00:00.000Z' }]);
  // As novidades do vizinho são só dele.
  expect((await obterNovidades(banco.db, vizinho.usuarioId)).itens.map((n) => n.clienteNome)).toEqual(['Cliente do Vizinho']);
  expect(await obterNovidades(banco.db, randomUUID())).toEqual({ total: 0, itens: [] });
});

// ---------- Avisos no celular ----------

const endereco = (id = randomUUID()) => `https://fcm.googleapis.com/fcm/send/${id}`;
const inscricao = (endpoint = endereco()) => ({ endpoint, keys: { p256dh: 'BPchave_publica-do-navegador', auth: 'segredo_auth-123' } });

test('só aceita endereço de aviso dos serviços de notificação dos navegadores', () => {
  for (const ok of [endereco(), 'https://web.push.apple.com/QOabc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://wns2-by3p.notify.windows.com/w/?token=abc']) {
    expect(enderecoDePushValido(ok), ok).toBe(true);
  }
  for (const ruim of ['http://fcm.googleapis.com/fcm/send/x', 'https://exemplo.com/push', 'https://fcm.googleapis.com.exemplo.com/x', 'https://push.apple.com.exemplo.com/x',
    'https://127.0.0.1/x', 'https://fcm.googleapis.com:8443/x', 'https://usuario:senha@fcm.googleapis.com/x', 'nada', '', null, 42, `https://fcm.googleapis.com/${'x'.repeat(1000)}`]) {
    expect(enderecoDePushValido(ruim), String(ruim)).toBe(false);
  }
});

test('guarda os aparelhos do dono, sem repetir, com limite, e cada dono só mexe nos seus', async () => {
  const celular = inscricao();
  expect(await salvarInscricao(banco.db, meu.usuarioId, celular)).toEqual({ ok: true });
  // Ativar de novo no mesmo aparelho só atualiza as chaves.
  expect(await salvarInscricao(banco.db, meu.usuarioId, { ...celular, keys: { p256dh: 'BPoutra_chave', auth: 'outro_auth' } })).toEqual({ ok: true });
  expect(await banco.client`select p256dh from inscricao_push where usuario_id = ${meu.usuarioId}`).toMatchObject([{ p256dh: 'BPoutra_chave' }]);
  for (const ruim of [{ ...celular, endpoint: 'https://exemplo.com/push' }, { endpoint: celular.endpoint, keys: { p256dh: 'com espaço', auth: 'a' } },
    { endpoint: celular.endpoint, keys: { p256dh: 'a', auth: '' } }, { endpoint: celular.endpoint } as never, null as never]) {
    expect(await salvarInscricao(banco.db, meu.usuarioId, ruim), JSON.stringify(ruim)).toMatchObject({ ok: false });
  }
  expect(await contarInscricoes(banco.db, meu.usuarioId)).toBe(1);

  // O vizinho não remove o meu aparelho.
  expect(await removerInscricao(banco.db, vizinho.usuarioId, celular.endpoint)).toEqual({ ok: true });
  expect(await contarInscricoes(banco.db, meu.usuarioId)).toBe(1);
  // Passando do limite, os mais antigos saem.
  for (let i = 0; i < MAXIMO_APARELHOS; i++) await salvarInscricao(banco.db, meu.usuarioId, inscricao());
  expect(await contarInscricoes(banco.db, meu.usuarioId)).toBe(MAXIMO_APARELHOS);
  expect(await banco.client`select id from inscricao_push where endpoint = ${celular.endpoint}`).toHaveLength(0);
  const [qualquer] = await banco.client`select endpoint from inscricao_push where usuario_id = ${meu.usuarioId} limit 1`;
  expect(await removerInscricao(banco.db, meu.usuarioId, qualquer.endpoint)).toEqual({ ok: true });
  expect(await contarInscricoes(banco.db, meu.usuarioId)).toBe(MAXIMO_APARELHOS - 1);
});

test('avisa só os aparelhos do negócio e apaga os que o serviço diz não existirem mais', async () => {
  const [vivo, morto, instavel, doVizinho] = [inscricao(), inscricao(), inscricao(), inscricao()];
  for (const i of [vivo, morto, instavel]) await salvarInscricao(banco.db, meu.usuarioId, i);
  await salvarInscricao(banco.db, vizinho.usuarioId, doVizinho);
  const entregues: { endpoint: string; conteudo: string }[] = [];
  const enviar = async (i: Inscricao, conteudo: string) => {
    entregues.push({ endpoint: i.endpoint, conteudo });
    if (i.endpoint === morto.endpoint) return 410;
    if (i.endpoint === instavel.endpoint) throw new Error('rede fora do ar');
    return 201;
  };
  const aviso = { titulo: 'Novo horário marcado', corpo: 'Ana', url: '/painel' };
  expect(await avisarNegocio(banco.db, meu.negocioId, aviso, enviar)).toEqual({ enviados: 1, removidos: 1 });
  expect(entregues.map((e) => e.endpoint).sort()).toEqual([vivo.endpoint, morto.endpoint, instavel.endpoint].sort());
  expect(JSON.parse(entregues[0].conteudo)).toEqual(aviso);
  // O que falhou por um problema passageiro continua inscrito; o morto saiu; o do vizinho nem foi chamado.
  expect((await banco.client`select endpoint from inscricao_push where usuario_id = ${meu.usuarioId}`).map((l) => l.endpoint).sort()).toEqual([vivo.endpoint, instavel.endpoint].sort());
  expect(await contarInscricoes(banco.db, vizinho.usuarioId)).toBe(1);
  // Negócio sem aparelho inscrito: nada a fazer.
  expect(await avisarNegocio(banco.db, randomUUID(), aviso, enviar)).toEqual({ enviados: 0, removidos: 0 });
});

test('o aviso de reserva e o de cancelamento dizem quem, o quê e quando, e abrem o dia certo', async () => {
  await salvarInscricao(banco.db, meu.usuarioId, inscricao());
  const recebidos: { titulo: string; corpo: string; url: string }[] = [];
  const enviar = async (_: Inscricao, conteudo: string) => { recebidos.push(JSON.parse(conteudo)); return 201; };

  // 22h30 de terça em São Paulo já é quarta em UTC: o dia do link é o do negócio.
  await banco.client`insert into horario_funcionamento (negocio_id, dia_semana, abre, fecha) values (${meu.negocioId}, 2, '19:00', '23:30')`;
  const tarde = await reservar(meu, '2030-01-09T01:30:00Z');
  expect(await avisarReservaNova(banco.db, meu.slug, tarde, enviar)).toEqual({ enviados: 1, removidos: 0 });
  expect(recebidos[0]).toEqual({ titulo: 'Novo horário marcado', corpo: 'Ana Souza · Corte · ter, 08/01 às 22:30', url: '/painel?dia=2030-01-08' });
  expect(JSON.stringify(recebidos)).not.toContain('34999991234');

  // Com dois profissionais, o aviso diz com quem.
  await salvarProfissional(banco.db, meu.negocioId, { nome: 'Diego' });
  const comDois = await reservar(meu, '2030-01-07T13:00:00Z', 'Bruno Lima', '(34) 98888-0001');
  await avisarReservaNova(banco.db, meu.slug, comDois, enviar);
  expect(recebidos[1].corpo).toBe('Bruno Lima · Corte com Caio · seg, 07/01 às 10:00');

  // Cancelamento: só avisa depois que o horário está mesmo cancelado.
  expect(await avisarCancelamento(banco.db, comDois.tokenCancelamento, enviar)).toEqual({ enviados: 0, removidos: 0 });
  await cancelarPorToken(banco.db, comDois.tokenCancelamento, AGORA);
  expect(await avisarCancelamento(banco.db, comDois.tokenCancelamento, enviar)).toEqual({ enviados: 1, removidos: 0 });
  expect(recebidos[2]).toEqual({ titulo: 'Horário cancelado pelo cliente', corpo: 'Bruno Lima · Corte com Caio · seg, 07/01 às 10:00. A vaga voltou a ficar livre.', url: '/painel?dia=2030-01-07' });
  expect(await avisarCancelamento(banco.db, 'x'.repeat(43), enviar)).toEqual({ enviados: 0, removidos: 0 });
  expect(await avisarReservaNova(banco.db, 'nao-existe', comDois, enviar)).toEqual({ enviados: 0, removidos: 0 });
});

test('renovar a demonstração mantém o dono, a sessão e os aparelhos com aviso', async () => {
  await seedDemo(banco.db, 'senha-apenas-de-teste');
  const [antes] = await banco.client`select id from usuario where email = ${DEMO_EMAIL}`;
  const login = await entrar(banco.db, DEMO_EMAIL, 'senha-apenas-de-teste');
  if (!login.ok) throw new Error('deveria entrar');
  await salvarInscricao(banco.db, antes.id, inscricao());
  await seedDemo(banco.db, 'outra-senha-de-teste');
  const [depois] = await banco.client`select id, negocio_id from usuario where email = ${DEMO_EMAIL}`;
  expect(depois).toMatchObject({ id: antes.id, negocio_id: DEMO_ID });
  expect(await obterSessao(banco.db, login.token)).toMatchObject({ usuarioId: antes.id });
  expect(await contarInscricoes(banco.db, antes.id)).toBe(1);
  expect((await entrar(banco.db, DEMO_EMAIL, 'outra-senha-de-teste')).ok).toBe(true);
  // Os clientes de exemplo não aparecem como novidade.
  expect(await obterNovidades(banco.db, antes.id)).toEqual({ total: 0, itens: [] });
});
