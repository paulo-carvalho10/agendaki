import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq, gt, gte, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { horariosLivresPorProfissional, type HorarioLivre } from '../agenda/disponibilidade.js';
import { lerOcupacao } from '../agenda/ocupacao.js';

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
 * cliente e de quem atende, bloqueios, horários ainda livres por profissional
 * e os lembretes do próximo dia com clientes marcados. Sempre restrito ao
 * negócio informado.
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
      servicoNome: schema.servico.nome, precoCentavos: schema.servico.precoCentavos,
      profissionalId: schema.agendamento.profissionalId, profissionalNome: schema.profissional.nome };
    const serializar = (a: { id: string; inicio: Date; fim: Date; status: StatusAgendamento; clienteNome: string;
      clienteTelefone: string; lembreteEm: Date | null; servicoNome: string; precoCentavos: number; profissionalId: string; profissionalNome: string }) =>
      ({ ...a, inicio: a.inicio.toISOString(), fim: a.fim.toISOString(), lembreteEm: a.lembreteEm?.toISOString() ?? null });
    const agendamentosEntre = (desde: Date, ate: Date, soConfirmados = false) => tx.select(colunas).from(schema.agendamento)
      .innerJoin(schema.servico, eq(schema.servico.id, schema.agendamento.servicoId))
      .innerJoin(schema.profissional, eq(schema.profissional.id, schema.agendamento.profissionalId))
      .where(and(eq(schema.agendamento.negocioId, negocio.id), gte(schema.agendamento.inicio, desde), lt(schema.agendamento.inicio, ate),
        soConfirmados ? eq(schema.agendamento.status, 'confirmado') : undefined))
      .orderBy(asc(schema.agendamento.inicio), asc(schema.profissional.criadoEm));

    const doDia = await agendamentosEntre(instante(dia), instante(dia.add({ days: 1 })));

    // Bloqueio sem profissional vale para todos; `profissionalNome` nulo indica isso.
    const bloqueios = await tx.select({ id: schema.bloqueio.id, inicio: schema.bloqueio.inicio, fim: schema.bloqueio.fim,
      motivo: schema.bloqueio.motivo, profissionalId: schema.bloqueio.profissionalId, profissionalNome: schema.profissional.nome })
      .from(schema.bloqueio).leftJoin(schema.profissional, eq(schema.profissional.id, schema.bloqueio.profissionalId))
      .where(and(eq(schema.bloqueio.negocioId, negocio.id),
        lt(schema.bloqueio.inicio, instante(dia.add({ days: 1 }))), gt(schema.bloqueio.fim, instante(dia))))
      .orderBy(asc(schema.bloqueio.inicio));

    // Lembretes: o próximo dia, depois de hoje, que tenha clientes confirmados.
    const proximos = await agendamentosEntre(instante(hoje.add({ days: 1 })), instante(hoje.add({ days: 1 + BUSCA_LEMBRETES_DIAS })), true);
    const diaLembretes = proximos.length ? dataLocal(proximos[0].inicio) : null;
    const lembretes = proximos.filter((a) => diaLembretes && dataLocal(a.inicio).equals(diaLembretes));

    // Horários livres do dia, por serviço e por profissional, para agendar quem ligou ou veio ao balcão.
    const servicos = await tx.select({ id: schema.servico.id, nome: schema.servico.nome,
      duracaoMin: schema.servico.duracaoMin, precoCentavos: schema.servico.precoCentavos,
    }).from(schema.servico).where(and(eq(schema.servico.negocioId, negocio.id), eq(schema.servico.ativo, true)))
      .orderBy(asc(schema.servico.precoCentavos), asc(schema.servico.id));
    const distancia = hoje.until(dia).days;
    const podeAgendar = distancia >= 0 && distancia < DIAS_OFERECIDOS;
    const ocupacao = await lerOcupacao(tx, negocio.id, instante(dia.subtract({ days: 1 })), instante(dia.add({ days: 2 })));
    const livres = (duracaoMin: number): HorarioLivre[] => (podeAgendar
      ? horariosLivresPorProfissional(ocupacao, { fuso: negocio.fuso, dataInicialLocal: dia.toString(), quantidadeDias: 1, duracaoMin, agora })
      : []);

    const contar = (status: StatusAgendamento) => doDia.filter((a) => a.status === status).length;
    const somar = (status: StatusAgendamento[]) => doDia.filter((a) => status.includes(a.status)).reduce((total, a) => total + a.precoCentavos, 0);
    return {
      negocio, agora: agora.toISOString(),
      hoje: hoje.toString(), dia: dia.toString(),
      diaAnterior: dia.subtract({ days: 1 }).toString(), diaSeguinte: dia.add({ days: 1 }).toString(),
      /** Profissionais ativos. Com um só, a tela esconde filtros e escolhas. */
      profissionais: ocupacao.profissionais,
      agendamentos: doDia.map(serializar),
      bloqueios: bloqueios.map((b) => ({ ...b, inicio: b.inicio.toISOString(), fim: b.fim.toISOString() })),
      lembretes: { dia: diaLembretes?.toString() ?? null, agendamentos: lembretes.map(serializar) },
      servicos: servicos.map((s) => ({ ...s, horarios: livres(s.duracaoMin) })),
      podeAgendar,
      resumo: { confirmados: contar('confirmado'), atendidos: contar('atendido'), faltas: contar('faltou'), cancelados: contar('cancelado'),
        previstoCentavos: somar(['confirmado', 'atendido']), realizadoCentavos: somar(['atendido']) },
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
