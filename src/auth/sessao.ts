import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';

type Banco = PostgresJsDatabase<typeof schema>;

export const COOKIE_SESSAO = 'agendaki_sessao';
/** O dono usa o painel todo dia no mesmo celular: a sessão dura 30 dias. */
export const DURACAO_SESSAO_DIAS = 30;
/** Erros seguidos antes de travar o login, e por quanto tempo. */
export const MAXIMO_FALHAS = 5;
/** Tamanho mínimo de qualquer senha de dono. */
export const SENHA_MINIMA = 12;
export const BLOQUEIO_MIN = 15;
/** randomBytes(32) em base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function gerarHashSenha(senha: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(senha, salt, 64).toString('hex')}`;
}

/** Compara em tempo constante. Formato desconhecido nunca confere. */
export function senhaConfere(senha: string, guardado: string) {
  const [esquema, salt, hash] = guardado.split(':');
  if (esquema !== 'scrypt' || !salt || !/^[0-9a-f]{128}$/.test(hash ?? '')) return false;
  const esperado = Buffer.from(hash, 'hex');
  return timingSafeEqual(scryptSync(senha, salt, 64), esperado);
}

// Gasto quando o email não existe, para a resposta demorar o mesmo que uma senha errada.
const HASH_FICTICIO = gerarHashSenha(randomBytes(16).toString('hex'));

export type ResultadoLogin =
  | { ok: true; token: string; expiraEm: Date }
  | { ok: false; motivo: 'credenciais' | 'bloqueado'; bloqueadoAte?: Date };

/**
 * Confere email e senha e abre uma sessão. Depois de MAXIMO_FALHAS erros
 * seguidos, o login daquele email fica travado por BLOQUEIO_MIN minutos.
 * Email inexistente e senha errada devolvem a mesma resposta.
 */
export async function entrar(db: Banco, email: string, senha: string, agora = new Date()): Promise<ResultadoLogin> {
  const emailLimpo = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (typeof senha !== 'string' || !emailLimpo || emailLimpo.length > 200 || senha.length > 200) {
    return { ok: false, motivo: 'credenciais' };
  }
  const [usuario] = await db.select().from(schema.usuario).where(eq(schema.usuario.email, emailLimpo)).limit(1);
  if (!usuario) { senhaConfere(senha, HASH_FICTICIO); return { ok: false, motivo: 'credenciais' }; }
  if (usuario.bloqueadoAte && usuario.bloqueadoAte > agora) return { ok: false, motivo: 'bloqueado', bloqueadoAte: usuario.bloqueadoAte };

  if (!senhaConfere(senha, usuario.senhaHash)) {
    // Um bloqueio já vencido recomeça a contagem.
    const falhas = (usuario.bloqueadoAte ? 0 : usuario.falhasLogin) + 1;
    const bloqueadoAte = falhas >= MAXIMO_FALHAS ? new Date(agora.getTime() + BLOQUEIO_MIN * 60_000) : null;
    await db.update(schema.usuario).set({ falhasLogin: bloqueadoAte ? 0 : falhas, bloqueadoAte }).where(eq(schema.usuario.id, usuario.id));
    return bloqueadoAte ? { ok: false, motivo: 'bloqueado', bloqueadoAte } : { ok: false, motivo: 'credenciais' };
  }

  const token = randomBytes(32).toString('base64url');
  const expiraEm = new Date(agora.getTime() + DURACAO_SESSAO_DIAS * 24 * 60 * 60_000);
  await db.transaction(async (tx) => {
    await tx.update(schema.usuario).set({ falhasLogin: 0, bloqueadoAte: null }).where(eq(schema.usuario.id, usuario.id));
    await tx.delete(schema.sessao).where(lt(schema.sessao.expiraEm, agora));
    await tx.insert(schema.sessao).values({ usuarioId: usuario.id, tokenHash: hashToken(token), expiraEm });
  });
  return { ok: true, token, expiraEm };
}

export type Sessao = NonNullable<Awaited<ReturnType<typeof obterSessao>>>;

/** Quem está logado e de qual negócio. Tudo no painel é filtrado por este negocioId. */
export async function obterSessao(db: Banco, token: string | undefined, agora = new Date()) {
  if (!token || !TOKEN.test(token)) return null;
  const [linha] = await db.select({
    usuarioId: schema.usuario.id, email: schema.usuario.email, negocioId: schema.usuario.negocioId,
  }).from(schema.sessao).innerJoin(schema.usuario, eq(schema.usuario.id, schema.sessao.usuarioId))
    .where(and(eq(schema.sessao.tokenHash, hashToken(token)), gt(schema.sessao.expiraEm, agora))).limit(1);
  return linha ?? null;
}

export async function sair(db: Banco, token: string | undefined) {
  if (!token || !TOKEN.test(token)) return;
  await db.delete(schema.sessao).where(eq(schema.sessao.tokenHash, hashToken(token)));
}

/** Para testes e manutenção: quantas sessões abertas um usuário tem. */
export async function contarSessoes(db: Banco, usuarioId: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.sessao).where(eq(schema.sessao.usuarioId, usuarioId));
  return total;
}
