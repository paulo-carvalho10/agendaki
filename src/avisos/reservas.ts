import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { obterAgendamentoPorToken } from '../agenda/cancelar.js';
import type { ReservaConfirmada } from '../agenda/pedido-reserva.js';
import { avisarNegocio, avisoDeCancelamento, avisoDeReserva, type Enviador } from './push.js';

type Banco = PostgresJsDatabase<typeof schema>;

/** Depois de uma reserva feita pela página pública: avisa os aparelhos do dono. */
export async function avisarReservaNova(db: Banco, slug: string, reserva: ReservaConfirmada, enviar: Enviador) {
  const [negocio] = await db.select({ id: schema.negocio.id }).from(schema.negocio).where(eq(schema.negocio.slug, slug)).limit(1);
  if (!negocio) return { enviados: 0, removidos: 0 };
  return avisarNegocio(db, negocio.id, avisoDeReserva({ clienteNome: reserva.cliente.nome, servicoNome: reserva.servico.nome,
    profissionalNome: reserva.profissional.nome, variosProfissionais: reserva.variosProfissionais, inicio: reserva.inicio, fuso: reserva.negocio.fuso }), enviar);
}

/** Depois de um cancelamento pelo link do cliente. */
export async function avisarCancelamento(db: Banco, token: string, enviar: Enviador) {
  const a = await obterAgendamentoPorToken(db, token);
  if (!a || a.status !== 'cancelado') return { enviados: 0, removidos: 0 };
  return avisarNegocio(db, a.negocioId, avisoDeCancelamento({ clienteNome: a.clienteNome, servicoNome: a.servicoNome,
    profissionalNome: a.profissionalNome, variosProfissionais: a.variosProfissionais, inicio: a.inicio, fuso: a.fuso }), enviar);
}
