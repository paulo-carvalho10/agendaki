import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { SENHA_MINIMA, gerarHashSenha, senhaConfere } from './sessao.js';

type Banco = PostgresJsDatabase<typeof schema>;
type Resultado = { ok: true } | { ok: false; mensagem: string };
const recusa = (mensagem: string): Resultado => ({ ok: false, mensagem });

/** O link de redefinição vale por este tempo e uma única vez. */
export const VALIDADE_REDEFINICAO_MIN = 60;
/** randomBytes(32) em base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function conferirNova(nova: unknown): string | null {
  if (typeof nova !== 'string' || nova.length < SENHA_MINIMA) return `A senha nova precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  if (nova.length > 200) return 'A senha nova é longa demais.';
  return null;
}

/**
 * O dono troca a própria senha pelo painel, informando a atual. As outras
 * sessões abertas são encerradas; a deste aparelho continua.
 */
export async function trocarSenha(db: Banco, usuarioId: string, tokenDaSessao: string | undefined, atual: string, nova: string): Promise<Resultado> {
  if (typeof atual !== 'string' || atual.length > 200) return recusa('A senha atual não confere.');
  const problema = conferirNova(nova);
  if (problema) return recusa(problema);
  const [usuario] = await db.select({ senhaHash: schema.usuario.senhaHash, demonstracao: schema.negocio.demonstracao })
    .from(schema.usuario).innerJoin(schema.negocio, eq(schema.negocio.id, schema.usuario.negocioId))
    .where(eq(schema.usuario.id, usuarioId)).limit(1);
  if (!usuario) return recusa('Usuário não encontrado.');
  // A senha da demonstração é a do ambiente e volta a cada renovação.
  if (usuario.demonstracao) return recusa('Na demonstração a senha fica fixa.');
  if (!senhaConfere(atual, usuario.senhaHash)) return recusa('A senha atual não confere.');
  if (atual === nova) return recusa('A senha nova precisa ser diferente da atual.');
  await db.transaction(async (tx) => {
    await tx.update(schema.usuario).set({ senhaHash: gerarHashSenha(nova) }).where(eq(schema.usuario.id, usuarioId));
    const estaSessao = tokenDaSessao && TOKEN.test(tokenDaSessao) ? hashToken(tokenDaSessao) : '';
    await tx.delete(schema.sessao).where(and(eq(schema.sessao.usuarioId, usuarioId), ne(schema.sessao.tokenHash, estaSessao)));
    await tx.delete(schema.redefinicaoSenha).where(eq(schema.redefinicaoSenha.usuarioId, usuarioId));
  });
  return { ok: true };
}

export type LinkRedefinicao =
  | { ok: true; token: string; expiraEm: Date; negocioNome: string; email: string }
  | { ok: false; mensagem: string };

/**
 * Gera o link para o dono que esqueceu a senha. Quem chama é o suporte, pela
 * linha de comando, depois de confirmar com quem está falando. Um link novo
 * invalida os anteriores do mesmo dono.
 */
export async function criarLinkRedefinicao(db: Banco, email: string, agora = new Date()): Promise<LinkRedefinicao> {
  const emailLimpo = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const [usuario] = emailLimpo ? await db.select({ id: schema.usuario.id, email: schema.usuario.email,
    negocioNome: schema.negocio.nome, demonstracao: schema.negocio.demonstracao })
    .from(schema.usuario).innerJoin(schema.negocio, eq(schema.negocio.id, schema.usuario.negocioId))
    .where(eq(schema.usuario.email, emailLimpo)).limit(1) : [];
  if (!usuario) return { ok: false, mensagem: 'Não há dono cadastrado com esse email.' };
  if (usuario.demonstracao) return { ok: false, mensagem: 'A senha da demonstração é a de DEMO_OWNER_PASSWORD e não é redefinida por link.' };
  const token = randomBytes(32).toString('base64url');
  const expiraEm = new Date(agora.getTime() + VALIDADE_REDEFINICAO_MIN * 60_000);
  await db.transaction(async (tx) => {
    await tx.delete(schema.redefinicaoSenha).where(eq(schema.redefinicaoSenha.usuarioId, usuario.id));
    await tx.insert(schema.redefinicaoSenha).values({ usuarioId: usuario.id, tokenHash: hashToken(token), expiraEm });
  });
  return { ok: true, token, expiraEm, negocioNome: usuario.negocioNome, email: usuario.email };
}

const linkValido = (token: string, agora: Date) => and(eq(schema.redefinicaoSenha.tokenHash, hashToken(token)),
  isNull(schema.redefinicaoSenha.usadaEm), gt(schema.redefinicaoSenha.expiraEm, agora));

/** O que a página do link mostra. Null para link inexistente, usado ou vencido, sem dizer qual dos três. */
export async function obterRedefinicao(db: Banco, token: string, agora = new Date()) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const [linha] = await db.select({ email: schema.usuario.email, negocioNome: schema.negocio.nome, expiraEm: schema.redefinicaoSenha.expiraEm })
    .from(schema.redefinicaoSenha)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.redefinicaoSenha.usuarioId))
    .innerJoin(schema.negocio, eq(schema.negocio.id, schema.usuario.negocioId))
    .where(linkValido(token, agora)).limit(1);
  return linha ?? null;
}

/**
 * Grava a senha nova de quem abriu um link válido. O link deixa de valer,
 * todas as sessões são encerradas e um eventual bloqueio de login é desfeito.
 */
export async function redefinirSenha(db: Banco, token: string, nova: string, agora = new Date()): Promise<Resultado> {
  const vencido = recusa('Este link não vale mais. Peça um novo.');
  if (typeof token !== 'string' || !TOKEN.test(token)) return vencido;
  const problema = conferirNova(nova);
  if (problema) return recusa(problema);
  return db.transaction(async (tx) => {
    // Marcar como usado primeiro: de dois envios simultâneos, só um altera a senha.
    const [usado] = await tx.update(schema.redefinicaoSenha).set({ usadaEm: agora }).where(linkValido(token, agora))
      .returning({ usuarioId: schema.redefinicaoSenha.usuarioId });
    if (!usado) return vencido;
    await tx.update(schema.usuario).set({ senhaHash: gerarHashSenha(nova), falhasLogin: 0, bloqueadoAte: null }).where(eq(schema.usuario.id, usado.usuarioId));
    await tx.delete(schema.sessao).where(eq(schema.sessao.usuarioId, usado.usuarioId));
    await tx.execute(sql`delete from redefinicao_senha where usuario_id = ${usado.usuarioId}::uuid and usada_em is null`);
    return { ok: true as const };
  });
}
