import { and, asc, eq, gt, lt, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import type { Ocupacao } from './disponibilidade.js';

/** Banco ou transação: aqui só se lê. */
type Leitor = Pick<PostgresJsDatabase<typeof schema>, 'select'>;

/**
 * Lê o que define a disponibilidade de um negócio num intervalo: quem atende,
 * o expediente, os bloqueios e os horários ocupados (cancelados não ocupam).
 * O intervalo deve cobrir o dia anterior e o seguinte aos dias consultados,
 * por causa de expedientes e atendimentos que atravessam a meia-noite.
 */
export async function lerOcupacao(tx: Leitor, negocioId: string, desde: Date, ate: Date): Promise<Ocupacao> {
  const profissionais = await tx.select({ id: schema.profissional.id, nome: schema.profissional.nome })
    .from(schema.profissional).where(and(eq(schema.profissional.negocioId, negocioId), eq(schema.profissional.ativo, true)))
    .orderBy(asc(schema.profissional.criadoEm), asc(schema.profissional.id));
  const funcionamento = await tx.select({ diaSemana: schema.horarioFuncionamento.diaSemana,
    abre: schema.horarioFuncionamento.abre, fecha: schema.horarioFuncionamento.fecha,
    terminaDiaSeguinte: schema.horarioFuncionamento.terminaDiaSeguinte,
  }).from(schema.horarioFuncionamento).where(eq(schema.horarioFuncionamento.negocioId, negocioId))
    .orderBy(asc(schema.horarioFuncionamento.diaSemana), asc(schema.horarioFuncionamento.abre));
  const bloqueios = await tx.select({ inicio: schema.bloqueio.inicio, fim: schema.bloqueio.fim, profissionalId: schema.bloqueio.profissionalId })
    .from(schema.bloqueio).where(and(eq(schema.bloqueio.negocioId, negocioId), lt(schema.bloqueio.inicio, ate), gt(schema.bloqueio.fim, desde)));
  const ocupados = await tx.select({ inicio: schema.agendamento.inicio, fim: schema.agendamento.fim, profissionalId: schema.agendamento.profissionalId })
    .from(schema.agendamento).where(and(eq(schema.agendamento.negocioId, negocioId), ne(schema.agendamento.status, 'cancelado'),
      lt(schema.agendamento.inicio, ate), gt(schema.agendamento.fim, desde)));
  const texto = <T extends { inicio: Date; fim: Date }>(f: T) => ({ ...f, inicio: f.inicio.toISOString(), fim: f.fim.toISOString() });
  return { profissionais, funcionamento, bloqueios: bloqueios.map(texto), ocupados: ocupados.map(texto) };
}
