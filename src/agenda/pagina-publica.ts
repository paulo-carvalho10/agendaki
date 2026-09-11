import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq, gt, lt, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { calcularHorariosLivres } from './horarios-livres.js';

export async function obterPaginaPublica(db: PostgresJsDatabase<typeof schema>, slug: string, agora = new Date()) {
  return db.transaction(async (tx) => {
    const [negocio] = await tx.select({ id: schema.negocio.id, nome: schema.negocio.nome,
      slug: schema.negocio.slug, fuso: schema.negocio.fuso, demonstracao: schema.negocio.demonstracao,
    }).from(schema.negocio).where(eq(schema.negocio.slug, slug)).limit(1);
    if (!negocio) return null;
    const hoje = Temporal.Instant.from(agora.toISOString()).toZonedDateTimeISO(negocio.fuso).toPlainDate();
    // Margens cobrem o expediente de ontem e o fim de atendimentos do último dia.
    const desde = new Date(hoje.subtract({ days: 1 }).toZonedDateTime(negocio.fuso).epochMilliseconds);
    const ate = new Date(hoje.add({ days: 15 }).toZonedDateTime(negocio.fuso).epochMilliseconds);
    const servicos = await tx.select({ id: schema.servico.id, nome: schema.servico.nome,
      duracaoMin: schema.servico.duracaoMin, precoCentavos: schema.servico.precoCentavos,
    }).from(schema.servico).where(and(eq(schema.servico.negocioId, negocio.id), eq(schema.servico.ativo, true)))
      .orderBy(asc(schema.servico.precoCentavos), asc(schema.servico.id));
    const funcionamento = await tx.select({ diaSemana: schema.horarioFuncionamento.diaSemana,
      abre: schema.horarioFuncionamento.abre, fecha: schema.horarioFuncionamento.fecha,
      terminaDiaSeguinte: schema.horarioFuncionamento.terminaDiaSeguinte,
    }).from(schema.horarioFuncionamento).where(eq(schema.horarioFuncionamento.negocioId, negocio.id))
      .orderBy(asc(schema.horarioFuncionamento.diaSemana), asc(schema.horarioFuncionamento.abre));
    // Projeções deliberadamente restritas: nome, telefone e tokens dos clientes
    // nunca são consultados ou enviados à página pública.
    const bloqueios = await tx.select({ inicio: schema.bloqueio.inicio, fim: schema.bloqueio.fim })
      .from(schema.bloqueio).where(and(eq(schema.bloqueio.negocioId, negocio.id), lt(schema.bloqueio.inicio, ate), gt(schema.bloqueio.fim, desde)));
    const ocupados = await tx.select({ inicio: schema.agendamento.inicio, fim: schema.agendamento.fim })
      .from(schema.agendamento).where(and(eq(schema.agendamento.negocioId, negocio.id), ne(schema.agendamento.status, 'cancelado'),
        lt(schema.agendamento.inicio, ate), gt(schema.agendamento.fim, desde)));
    const converter = (f: { inicio: Date; fim: Date }) => ({ inicio: f.inicio.toISOString(), fim: f.fim.toISOString() });
    const dias = Array.from({ length: 14 }, (_, i) => hoje.add({ days: i }).toString());
    return {
      negocio, funcionamento, dias, atualizadoEm: agora.toISOString(),
      servicos: servicos.map((servico) => ({ ...servico,
        horarios: calcularHorariosLivres({ fuso: negocio.fuso, dataInicialLocal: hoje.toString(), quantidadeDias: 14,
          duracaoServicoMin: servico.duracaoMin, passoMin: 30, funcionamento,
          bloqueios: bloqueios.map(converter), agendamentosOcupados: ocupados.map(converter), agoraUTC: agora.toISOString(),
        }).map((h) => ({ ...h, dataLocal: Temporal.Instant.from(h.inicio).toZonedDateTimeISO(negocio.fuso).toPlainDate().toString() })),
      })),
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

export type PaginaPublica = NonNullable<Awaited<ReturnType<typeof obterPaginaPublica>>>;
