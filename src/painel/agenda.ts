import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq, gt, gte, lt, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { calcularHorariosLivres } from '../agenda/horarios-livres.js';
import { PASSO_GRADE_MIN } from '../agenda/pedido-reserva.js';

type Banco = PostgresJsDatabase<typeof schema>;
/** Até onde o dono navega para trás e para a frente a partir de hoje. */
const ALCANCE_DIAS = 90;
/** Dias que a página pública oferece; fora deles o dono não agenda pelo painel. */
const DIAS_OFERECIDOS = 14;
/** Quantos dias à frente procurar o próximo dia com clientes para lembrar. */
const BUSCA_LEMBRETES_DIAS = 4;

export type StatusAgendamento = (typeof schema.statusAgendamento.enumValues)[number];
export type AgendaDoDia = NonNullable<Awaited<ReturnType<typeof obterAgendaDoDia>>>;
export type ItemAgenda = AgendaDoDia['agendamentos'][number];

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tudo o que a tela do dono mostra para um dia: agendamentos com os dados do
 * cliente, bloqueios, horários ainda livres e os lembretes do próximo dia com
 * clientes marcados. Sempre restrito ao negócio informado.
 */
export async function obterAgendaDoDia(db: Banco, negocioId: string, diaPedido?: string, agora = new Date()) {
  return db.transaction(async (tx) => {
    const [negocio] = await tx.select({ id: schema.negocio.id, nome: schema.negocio.nome, slug: schema.negocio.slug,
      telefone: schema.negocio.telefone, fuso: schema.negocio.fuso, demonstracao: schema.negocio.demonstracao,
    }).from(schema.negocio).where(eq(schema.negocio.id, negocioId)).limit(1);
    if (!negocio) return null;

    const hoje = Temporal.Instant.from(agora.toISOString()).toZonedDateTimeISO(negocio.fuso).toPlainDate();
    let dia = hoje;
    if (diaPedido && DIA.test(diaPedido)) {
      try {
        const pedido = Temporal.PlainDate.from(diaPedido, { overflow: 'reject' });
        if (Math.abs(hoje.until(pedido).days) <= ALCANCE_DIAS) dia = pedido;
      } catch { /* Data impossível: fica em hoje. */ }
    }
    const instante = (data: Temporal.PlainDate) => new Date(data.toZonedDateTime(negocio.fuso).epochMilliseconds);
    const dataLocal = (momento: Date) => Temporal.Instant.from(momento.toISOString()).toZonedDateTimeISO(negocio.fuso).toPlainDate();

    const colunas = { id: schema.agendamento.id, inicio: schema.agendamento.inicio, fim: schema.agendamento.fim,
      status: schema.agendamento.status, clienteNome: schema.agendamento.clienteNome,
      clienteTelefone: schema.agendamento.clienteTelefone, lembreteEm: schema.agendamento.lembreteEm,
      servicoNome: schema.servico.nome, precoCentavos: schema.servico.precoCentavos };
    const serializar = (a: { id: string; inicio: Date; fim: Date; status: StatusAgendamento; clienteNome: string;
      clienteTelefone: string; lembreteEm: Date | null; servicoNome: string; precoCentavos: number }) =>
      ({ ...a, inicio: a.inicio.toISOString(), fim: a.fim.toISOString(), lembreteEm: a.lembreteEm?.toISOString() ?? null });

    const doDia = await tx.select(colunas).from(schema.agendamento)
      .innerJoin(schema.servico, eq(schema.servico.id, schema.agendamento.servicoId))
      .where(and(eq(schema.agendamento.negocioId, negocio.id),
        gte(schema.agendamento.inicio, instante(dia)), lt(schema.agendamento.inicio, instante(dia.add({ days: 1 })))))
      .orderBy(asc(schema.agendamento.inicio));

    const bloqueios = await tx.select({ id: schema.bloqueio.id, inicio: schema.bloqueio.inicio, fim: schema.bloqueio.fim, motivo: schema.bloqueio.motivo })
      .from(schema.bloqueio).where(and(eq(schema.bloqueio.negocioId, negocio.id),
        lt(schema.bloqueio.inicio, instante(dia.add({ days: 1 }))), gt(schema.bloqueio.fim, instante(dia))))
      .orderBy(asc(schema.bloqueio.inicio));

    // Lembretes: o próximo dia, depois de hoje, que tenha clientes confirmados.
    const proximos = await tx.select(colunas).from(schema.agendamento)
      .innerJoin(schema.servico, eq(schema.servico.id, schema.agendamento.servicoId))
      .where(and(eq(schema.agendamento.negocioId, negocio.id), eq(schema.agendamento.status, 'confirmado'),
        gte(schema.agendamento.inicio, instante(hoje.add({ days: 1 }))),
        lt(schema.agendamento.inicio, instante(hoje.add({ days: 1 + BUSCA_LEMBRETES_DIAS })))))
      .orderBy(asc(schema.agendamento.inicio));
    const diaLembretes = proximos.length ? dataLocal(proximos[0].inicio) : null;
    const lembretes = proximos.filter((a) => diaLembretes && dataLocal(a.inicio).equals(diaLembretes));

    // Horários livres do dia, por serviço, para agendar quem ligou ou veio ao balcão.
    const servicos = await tx.select({ id: schema.servico.id, nome: schema.servico.nome,
      duracaoMin: schema.servico.duracaoMin, precoCentavos: schema.servico.precoCentavos,
    }).from(schema.servico).where(and(eq(schema.servico.negocioId, negocio.id), eq(schema.servico.ativo, true)))
      .orderBy(asc(schema.servico.precoCentavos), asc(schema.servico.id));
    const distancia = hoje.until(dia).days;
    let livres: Record<string, { inicio: string; fim: string }[]> = {};
    if (distancia >= 0 && distancia < DIAS_OFERECIDOS && servicos.length) {
      const desde = instante(dia.subtract({ days: 1 }));
      const ate = instante(dia.add({ days: 2 }));
      const funcionamento = await tx.select({ diaSemana: schema.horarioFuncionamento.diaSemana,
        abre: schema.horarioFuncionamento.abre, fecha: schema.horarioFuncionamento.fecha,
        terminaDiaSeguinte: schema.horarioFuncionamento.terminaDiaSeguinte,
      }).from(schema.horarioFuncionamento).where(eq(schema.horarioFuncionamento.negocioId, negocio.id));
      const converter = (f: { inicio: Date; fim: Date }) => ({ inicio: f.inicio.toISOString(), fim: f.fim.toISOString() });
      const bloqueiosVizinhos = (await tx.select({ inicio: schema.bloqueio.inicio, fim: schema.bloqueio.fim }).from(schema.bloqueio)
        .where(and(eq(schema.bloqueio.negocioId, negocio.id), lt(schema.bloqueio.inicio, ate), gt(schema.bloqueio.fim, desde)))).map(converter);
      const ocupados = (await tx.select({ inicio: schema.agendamento.inicio, fim: schema.agendamento.fim }).from(schema.agendamento)
        .where(and(eq(schema.agendamento.negocioId, negocio.id), ne(schema.agendamento.status, 'cancelado'),
          lt(schema.agendamento.inicio, ate), gt(schema.agendamento.fim, desde)))).map(converter);
      livres = Object.fromEntries(servicos.map((s) => [s.id, calcularHorariosLivres({ fuso: negocio.fuso,
        dataInicialLocal: dia.toString(), quantidadeDias: 1, duracaoServicoMin: s.duracaoMin, passoMin: PASSO_GRADE_MIN,
        funcionamento, bloqueios: bloqueiosVizinhos, agendamentosOcupados: ocupados, agoraUTC: agora.toISOString() })]));
    }

    const contar = (status: StatusAgendamento) => doDia.filter((a) => a.status === status).length;
    const somar = (status: StatusAgendamento[]) => doDia.filter((a) => status.includes(a.status)).reduce((total, a) => total + a.precoCentavos, 0);
    return {
      negocio, agora: agora.toISOString(),
      hoje: hoje.toString(), dia: dia.toString(),
      diaAnterior: dia.subtract({ days: 1 }).toString(), diaSeguinte: dia.add({ days: 1 }).toString(),
      agendamentos: doDia.map(serializar),
      bloqueios: bloqueios.map((b) => ({ ...b, inicio: b.inicio.toISOString(), fim: b.fim.toISOString() })),
      lembretes: { dia: diaLembretes?.toString() ?? null, agendamentos: lembretes.map(serializar) },
      servicos: servicos.map((s) => ({ ...s, horarios: livres[s.id] ?? [] })),
      podeAgendar: distancia >= 0 && distancia < DIAS_OFERECIDOS,
      resumo: { confirmados: contar('confirmado'), atendidos: contar('atendido'), faltas: contar('faltou'), cancelados: contar('cancelado'),
        previstoCentavos: somar(['confirmado', 'atendido']), realizadoCentavos: somar(['atendido']) },
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
