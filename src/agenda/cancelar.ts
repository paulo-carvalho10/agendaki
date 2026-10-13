import { and, eq, gte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { ANTECEDENCIA_CANCELAMENTO_MIN } from './pedido-reserva.js';
import { hashToken } from './reservar.js';

type Banco = PostgresJsDatabase<typeof schema>;
/** randomBytes(32) em base64url: 43 caracteres. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type AgendamentoDoCliente = NonNullable<Awaited<ReturnType<typeof obterAgendamentoPorToken>>>;
export type ResultadoCancelamento =
  | { ok: true }
  | { ok: false; motivo: 'inexistente' | 'ja_cancelado' | 'prazo_encerrado' | 'ja_passou' | 'encerrado' };

/** Último instante em que o cliente ainda pode cancelar pelo link. */
export const limiteCancelamento = (inicio: Date) => new Date(inicio.getTime() - ANTECEDENCIA_CANCELAMENTO_MIN * 60_000);

/**
 * O que o dono do link pode ver: o próprio agendamento. O telefone do cliente
 * não é devolvido, e quem não tem o token não descobre se um agendamento existe.
 */
export async function obterAgendamentoPorToken(db: Banco, token: string) {
  if (!TOKEN.test(token)) return null;
  const [linha] = await db.select({
    status: schema.agendamento.status, inicio: schema.agendamento.inicio, fim: schema.agendamento.fim,
    clienteNome: schema.agendamento.clienteNome,
    servicoNome: schema.servico.nome, duracaoMin: schema.servico.duracaoMin, precoCentavos: schema.servico.precoCentavos,
    negocioNome: schema.negocio.nome, negocioSlug: schema.negocio.slug, negocioTelefone: schema.negocio.telefone,
    fuso: schema.negocio.fuso, demonstracao: schema.negocio.demonstracao,
  }).from(schema.agendamento)
    .innerJoin(schema.servico, eq(schema.servico.id, schema.agendamento.servicoId))
    .innerJoin(schema.negocio, eq(schema.negocio.id, schema.agendamento.negocioId))
    .where(eq(schema.agendamento.tokenCancelamentoHash, hashToken(token))).limit(1);
  return linha ?? null;
}

/**
 * Cancela um agendamento confirmado, desde que falte pelo menos a antecedência
 * mínima para o início. Assim o negócio ainda tem tempo de ocupar a vaga.
 */
export async function cancelarPorToken(db: Banco, token: string, agora = new Date()): Promise<ResultadoCancelamento> {
  if (!TOKEN.test(token)) return { ok: false, motivo: 'inexistente' };
  const hash = hashToken(token);
  const prazo = new Date(agora.getTime() + ANTECEDENCIA_CANCELAMENTO_MIN * 60_000);
  const cancelados = await db.update(schema.agendamento).set({ status: 'cancelado' })
    .where(and(eq(schema.agendamento.tokenCancelamentoHash, hash), eq(schema.agendamento.status, 'confirmado'),
      gte(schema.agendamento.inicio, prazo)))
    .returning({ id: schema.agendamento.id });
  if (cancelados.length) return { ok: true };

  const [atual] = await db.select({ status: schema.agendamento.status, inicio: schema.agendamento.inicio })
    .from(schema.agendamento).where(eq(schema.agendamento.tokenCancelamentoHash, hash)).limit(1);
  if (!atual) return { ok: false, motivo: 'inexistente' };
  if (atual.status === 'cancelado') return { ok: false, motivo: 'ja_cancelado' };
  // Atendido ou falta: o histórico não é reescrito pelo cliente.
  if (atual.status !== 'confirmado') return { ok: false, motivo: 'encerrado' };
  return { ok: false, motivo: atual.inicio.getTime() > agora.getTime() ? 'prazo_encerrado' : 'ja_passou' };
}
