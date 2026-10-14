import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import type { ResultadoPainel } from '../painel/acoes.js';

type Banco = PostgresJsDatabase<typeof schema>;
const recusa = (mensagem: string): ResultadoPainel => ({ ok: false, mensagem });

/** Aparelhos com aviso ativado por dono. Passando disso, o mais antigo sai. */
export const MAXIMO_APARELHOS = 8;
/**
 * O servidor só envia para os serviços de notificação dos navegadores. Sem
 * esta lista, um endereço digitado à mão faria o servidor chamar qualquer site.
 */
const SERVICOS_DE_PUSH = ['fcm.googleapis.com', '.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com'];
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type InscricaoDoNavegador = Readonly<{ endpoint: string; keys: { p256dh: string; auth: string } }>;
export type Inscricao = { endpoint: string; p256dh: string; auth: string };
/** O que aparece na notificação e para onde ela leva. */
export type Aviso = Readonly<{ titulo: string; corpo: string; url: string }>;
/** Entrega uma notificação. Devolve o código HTTP do serviço de push. */
export type Enviador = (inscricao: Inscricao, conteudo: string) => Promise<number>;

export function enderecoDePushValido(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  return SERVICOS_DE_PUSH.some((s) => (s.startsWith('.') ? url.hostname.endsWith(s) : url.hostname === s));
}

/** Guarda o aparelho em que o dono ativou os avisos. Ativar de novo no mesmo aparelho só atualiza as chaves. */
export async function salvarInscricao(db: Banco, usuarioId: string, inscricao: InscricaoDoNavegador): Promise<ResultadoPainel> {
  const invalida = recusa('Este navegador não entregou um endereço de aviso válido. Tente de novo.');
  if (!inscricao || typeof inscricao !== 'object' || !enderecoDePushValido(inscricao.endpoint)) return invalida;
  const { p256dh, auth } = inscricao.keys ?? {};
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !BASE64URL.test(p256dh) || !BASE64URL.test(auth) || p256dh.length > 200 || auth.length > 100) return invalida;
  await db.transaction(async (tx) => {
    await tx.insert(schema.inscricaoPush).values({ usuarioId, endpoint: inscricao.endpoint, p256dh, auth })
      .onConflictDoUpdate({ target: schema.inscricaoPush.endpoint, set: { usuarioId, p256dh, auth } });
    const todas = await tx.select({ id: schema.inscricaoPush.id }).from(schema.inscricaoPush)
      .where(eq(schema.inscricaoPush.usuarioId, usuarioId)).orderBy(asc(schema.inscricaoPush.criadaEm), asc(schema.inscricaoPush.id));
    const sobrando = todas.slice(0, Math.max(0, todas.length - MAXIMO_APARELHOS)).map((i) => i.id);
    if (sobrando.length) await tx.delete(schema.inscricaoPush).where(inArray(schema.inscricaoPush.id, sobrando));
  });
  return { ok: true };
}

export async function removerInscricao(db: Banco, usuarioId: string, endpoint: string): Promise<ResultadoPainel> {
  if (typeof endpoint !== 'string') return { ok: true };
  await db.delete(schema.inscricaoPush).where(and(eq(schema.inscricaoPush.usuarioId, usuarioId), eq(schema.inscricaoPush.endpoint, endpoint)));
  return { ok: true };
}

/**
 * Avisa todos os aparelhos dos donos de um negócio. Falha de entrega nunca
 * vira erro para quem chamou: a reserva já está gravada. Inscrições que o
 * serviço de push diz não existirem mais (404 ou 410) são apagadas.
 */
export async function avisarNegocio(db: Banco, negocioId: string, aviso: Aviso, enviar: Enviador): Promise<{ enviados: number; removidos: number }> {
  const inscricoes = await db.select({ id: schema.inscricaoPush.id, endpoint: schema.inscricaoPush.endpoint,
    p256dh: schema.inscricaoPush.p256dh, auth: schema.inscricaoPush.auth })
    .from(schema.inscricaoPush).innerJoin(schema.usuario, eq(schema.usuario.id, schema.inscricaoPush.usuarioId))
    .where(eq(schema.usuario.negocioId, negocioId));
  const conteudo = JSON.stringify(aviso);
  const codigos = await Promise.all(inscricoes.map((i) => enviar(i, conteudo).catch(() => 0)));
  const mortas = inscricoes.filter((_, i) => codigos[i] === 404 || codigos[i] === 410).map((i) => i.id);
  if (mortas.length) await db.delete(schema.inscricaoPush).where(inArray(schema.inscricaoPush.id, mortas));
  return { enviados: codigos.filter((c) => c >= 200 && c < 300).length, removidos: mortas.length };
}

/** Quantos aparelhos um dono tem com aviso ativado. */
export async function contarInscricoes(db: Banco, usuarioId: string) {
  const linhas = await db.select({ id: schema.inscricaoPush.id }).from(schema.inscricaoPush).where(eq(schema.inscricaoPush.usuarioId, usuarioId));
  return linhas.length;
}

const quando = (inicio: Date | string, fuso: string) => {
  const data = new Date(inicio);
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'short', day: '2-digit', month: '2-digit' }).format(data).replace('.', '');
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(data);
  return `${dia} às ${hora}`;
};
/** Dia do horário no fuso do negócio, para o toque na notificação abrir a agenda certa. */
const diaLocal = (inicio: Date | string, fuso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(inicio));

type Horario = Readonly<{ clienteNome: string; servicoNome: string; profissionalNome: string; variosProfissionais: boolean; inicio: Date | string; fuso: string }>;

/** Texto do aviso de horário novo. Sem telefone: a notificação aparece na tela de bloqueio. */
export function avisoDeReserva(h: Horario): Aviso {
  const comQuem = h.variosProfissionais ? ` com ${h.profissionalNome}` : '';
  return { titulo: 'Novo horário marcado', corpo: `${h.clienteNome} · ${h.servicoNome}${comQuem} · ${quando(h.inicio, h.fuso)}`,
    url: `/painel?dia=${diaLocal(h.inicio, h.fuso)}` };
}

export function avisoDeCancelamento(h: Horario): Aviso {
  const comQuem = h.variosProfissionais ? ` com ${h.profissionalNome}` : '';
  return { titulo: 'Horário cancelado pelo cliente', corpo: `${h.clienteNome} · ${h.servicoNome}${comQuem} · ${quando(h.inicio, h.fuso)}. A vaga voltou a ficar livre.`,
    url: `/painel?dia=${diaLocal(h.inicio, h.fuso)}` };
}

/** Aviso de teste, só para o aparelho em que o dono tocou no botão. */
export async function testarAparelho(db: Banco, usuarioId: string, endpoint: string, enviar: Enviador): Promise<ResultadoPainel> {
  const [inscricao] = typeof endpoint === 'string' ? await db.select({ id: schema.inscricaoPush.id, endpoint: schema.inscricaoPush.endpoint,
    p256dh: schema.inscricaoPush.p256dh, auth: schema.inscricaoPush.auth }).from(schema.inscricaoPush)
    .where(and(eq(schema.inscricaoPush.usuarioId, usuarioId), eq(schema.inscricaoPush.endpoint, endpoint))).limit(1) : [];
  if (!inscricao) return recusa('Este aparelho não está com os avisos ativados. Ative de novo.');
  const aviso: Aviso = { titulo: 'Aviso de teste', corpo: 'Está funcionando. É assim que você fica sabendo de um horário novo.', url: '/painel' };
  const codigo = await enviar(inscricao, JSON.stringify(aviso)).catch(() => 0);
  if (codigo === 404 || codigo === 410) {
    await db.delete(schema.inscricaoPush).where(eq(schema.inscricaoPush.id, inscricao.id));
    return recusa('O navegador cancelou os avisos deste aparelho. Desative e ative de novo.');
  }
  return codigo >= 200 && codigo < 300 ? { ok: true } : recusa('O aviso não saiu agora. Tente de novo em instantes.');
}
