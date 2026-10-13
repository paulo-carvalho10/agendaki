import { Temporal } from '@js-temporal/polyfill';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { codigoPostgres, reservarHorario } from '../agenda/reservar.js';
import { recusar, type ResultadoReserva } from '../agenda/pedido-reserva.js';
import type { StatusAgendamento } from './agenda.js';

type Banco = PostgresJsDatabase<typeof schema>;

export type ResultadoPainel = { ok: true } | { ok: false; mensagem: string };
const recusa = (mensagem: string): ResultadoPainel => ({ ok: false, mensagem });

/**
 * Muda a situação de um agendamento do próprio negócio.
 * - atendido ou faltou: só depois que o horário começou;
 * - confirmado: desfaz um atendido ou faltou marcado por engano;
 * - cancelado: o dono cancela um confirmado a qualquer momento, e a vaga volta a ficar livre.
 */
export async function mudarStatus(db: Banco, negocioId: string, agendamentoId: string, para: StatusAgendamento, agora = new Date()): Promise<ResultadoPainel> {
  if (!schema.statusAgendamento.enumValues.includes(para)) return recusa('Situação desconhecida.');
  const filtro = and(eq(schema.agendamento.id, agendamentoId), eq(schema.agendamento.negocioId, negocioId));
  let atual: { status: StatusAgendamento; inicio: Date } | undefined;
  try {
    [atual] = await db.select({ status: schema.agendamento.status, inicio: schema.agendamento.inicio }).from(schema.agendamento).where(filtro).limit(1);
  } catch (erro) {
    // 22P02: o identificador não é um UUID.
    if (codigoPostgres(erro) === '22P02') return recusa('Agendamento não encontrado.');
    throw erro;
  }
  if (!atual) return recusa('Agendamento não encontrado.');
  if (atual.status === para) return { ok: true };
  if (atual.status === 'cancelado') return recusa('Este horário foi cancelado. Para atender o cliente, faça um novo agendamento.');
  if (para === 'atendido' || para === 'faltou') {
    if (atual.inicio > agora) return recusa('Só dá para marcar como atendido ou falta depois que o horário começar.');
  } else if (para === 'cancelado') {
    if (atual.status !== 'confirmado') return recusa('Este atendimento já foi encerrado. Desfaça a marcação antes de cancelar.');
  }
  const alterados = await db.update(schema.agendamento).set({ status: para })
    .where(and(filtro, eq(schema.agendamento.status, atual.status))).returning({ id: schema.agendamento.id });
  return alterados.length ? { ok: true } : recusa('A agenda mudou enquanto você olhava. Atualize a página.');
}

/** Registra que o dono abriu o lembrete deste horário no WhatsApp. */
export async function registrarLembrete(db: Banco, negocioId: string, agendamentoId: string, agora = new Date()): Promise<ResultadoPainel> {
  try {
    const alterados = await db.update(schema.agendamento).set({ lembreteEm: agora })
      .where(and(eq(schema.agendamento.id, agendamentoId), eq(schema.agendamento.negocioId, negocioId), eq(schema.agendamento.status, 'confirmado')))
      .returning({ id: schema.agendamento.id });
    return alterados.length ? { ok: true } : recusa('Agendamento não encontrado.');
  } catch (erro) {
    if (codigoPostgres(erro) === '22P02') return recusa('Agendamento não encontrado.');
    throw erro;
  }
}

export type PedidoBloqueio = Readonly<{ dia: string; das: string; ate: string; motivo: string }>;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Fecha um intervalo da agenda (almoço, folga, compromisso). Não pode cobrir um horário já marcado. */
export async function criarBloqueio(db: Banco, negocioId: string, pedido: PedidoBloqueio): Promise<ResultadoPainel> {
  if (!pedido || [pedido.dia, pedido.das, pedido.ate, pedido.motivo].some((campo) => typeof campo !== 'string')) return recusa('Preencha o dia e os horários.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pedido.dia) || !HORA.test(pedido.das) || !HORA.test(pedido.ate)) return recusa('Preencha o dia e os horários.');
  if (pedido.ate <= pedido.das) return recusa('O fim do bloqueio precisa ser depois do início.');
  const motivo = pedido.motivo.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Horário bloqueado';
  const [negocio] = await db.select({ fuso: schema.negocio.fuso }).from(schema.negocio).where(eq(schema.negocio.id, negocioId)).limit(1);
  if (!negocio) return recusa('Negócio não encontrado.');
  let inicio: Date, fim: Date;
  try {
    const instante = (hora: string) => new Date(Temporal.PlainDateTime.from(`${pedido.dia}T${hora}`, { overflow: 'reject' })
      .toZonedDateTime(negocio.fuso, { disambiguation: 'reject' }).epochMilliseconds);
    inicio = instante(pedido.das); fim = instante(pedido.ate);
  } catch { return recusa('Esse dia ou horário não existe no calendário.'); }
  try {
    await db.insert(schema.bloqueio).values({ negocioId, inicio, fim, motivo });
    return { ok: true };
  } catch (erro) {
    if (codigoPostgres(erro) === '23P01') return recusa('Já existe cliente marcado nesse intervalo. Cancele ou remarque o horário antes de bloquear.');
    throw erro;
  }
}

export async function removerBloqueio(db: Banco, negocioId: string, bloqueioId: string): Promise<ResultadoPainel> {
  try {
    const removidos = await db.delete(schema.bloqueio)
      .where(and(eq(schema.bloqueio.id, bloqueioId), eq(schema.bloqueio.negocioId, negocioId))).returning({ id: schema.bloqueio.id });
    return removidos.length ? { ok: true } : recusa('Bloqueio não encontrado.');
  } catch (erro) {
    if (codigoPostgres(erro) === '22P02') return recusa('Bloqueio não encontrado.');
    throw erro;
  }
}

export type PedidoDoDono = Readonly<{ servicoId: string; inicio: string; nome: string; telefone: string }>;

/**
 * Agenda para quem ligou ou veio ao balcão. Passa pelas mesmas conferências
 * da página pública, sem o limite por telefone, e aceita cliente sem telefone.
 */
export async function agendarPeloDono(db: Banco, negocioId: string, pedido: PedidoDoDono, agora = new Date()): Promise<ResultadoReserva> {
  const [negocio] = await db.select({ slug: schema.negocio.slug }).from(schema.negocio).where(eq(schema.negocio.id, negocioId)).limit(1);
  if (!negocio || !pedido || typeof pedido !== 'object') return recusar('negocio_inexistente');
  return reservarHorario(db, { slug: negocio.slug, servicoId: pedido.servicoId, inicio: pedido.inicio, nome: pedido.nome, telefone: pedido.telefone }, agora, { peloDono: true });
}
