import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import type { ResultadoPainel } from './acoes.js';

type Banco = PostgresJsDatabase<typeof schema>;
/** Quantas novidades a tela lista; o total continua sendo contado inteiro. */
const LIMITE = 20;

export type Novidade = {
  tipo: 'marcou' | 'cancelou';
  /** Quando o cliente marcou ou cancelou. */
  quando: string;
  agendamentoId: string;
  clienteNome: string; servicoNome: string; profissionalNome: string;
  /** Início do horário, em ISO UTC. */
  inicio: string;
};
export type Novidades = { total: number; itens: Novidade[] };

/**
 * O que os clientes fizeram desde a última vez que o dono conferiu: horários
 * marcados pela página pública e cancelamentos pelo link. O que o próprio dono
 * marca ou cancela no painel não entra.
 */
export async function obterNovidades(db: Banco, usuarioId: string): Promise<Novidades> {
  const [usuario] = await db.select({ negocioId: schema.usuario.negocioId, vistasEm: schema.usuario.novidadesVistasEm })
    .from(schema.usuario).where(eq(schema.usuario.id, usuarioId)).limit(1);
  if (!usuario) return { total: 0, itens: [] };
  const colunas = { agendamentoId: schema.agendamento.id, clienteNome: schema.agendamento.clienteNome, inicio: schema.agendamento.inicio,
    servicoNome: schema.servico.nome, profissionalNome: schema.profissional.nome,
    criadoEm: schema.agendamento.criadoEm, canceladoEm: schema.agendamento.canceladoPeloClienteEm };
  const base = () => db.select(colunas).from(schema.agendamento)
    .innerJoin(schema.servico, eq(schema.servico.id, schema.agendamento.servicoId))
    .innerJoin(schema.profissional, eq(schema.profissional.id, schema.agendamento.profissionalId));
  const doNegocio = eq(schema.agendamento.negocioId, usuario.negocioId);
  const marcados = and(doNegocio, eq(schema.agendamento.peloDono, false), gt(schema.agendamento.criadoEm, usuario.vistasEm));
  const cancelados = and(doNegocio, gt(schema.agendamento.canceladoPeloClienteEm, usuario.vistasEm));
  const [novos, desistencias, [{ total }]] = await Promise.all([
    base().where(marcados).orderBy(desc(schema.agendamento.criadoEm)).limit(LIMITE),
    base().where(cancelados).orderBy(desc(schema.agendamento.canceladoPeloClienteEm)).limit(LIMITE),
    db.select({ total: sql<number>`(count(*) filter (where ${marcados}) + count(*) filter (where ${cancelados}))::int` }).from(schema.agendamento).where(doNegocio),
  ]);
  const item = (tipo: Novidade['tipo'], quando: Date, a: (typeof novos)[number]): Novidade => ({ tipo, quando: quando.toISOString(),
    agendamentoId: a.agendamentoId, clienteNome: a.clienteNome, servicoNome: a.servicoNome, profissionalNome: a.profissionalNome, inicio: a.inicio.toISOString() });
  const itens = [...novos.map((a) => item('marcou', a.criadoEm, a)), ...desistencias.map((a) => item('cancelou', a.canceladoEm!, a))]
    .sort((x, y) => y.quando.localeCompare(x.quando)).slice(0, LIMITE);
  return { total, itens };
}

/** O dono conferiu as novidades: a contagem recomeça a partir de agora. */
export async function marcarNovidadesVistas(db: Banco, usuarioId: string, agora = new Date()): Promise<ResultadoPainel> {
  await db.update(schema.usuario).set({ novidadesVistasEm: agora }).where(eq(schema.usuario.id, usuarioId));
  return { ok: true };
}
