import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { horariosLivresPorProfissional } from './disponibilidade.js';
import { lerOcupacao } from './ocupacao.js';

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
    // A ocupação traz só intervalos e de quem são: nome, telefone e tokens dos
    // clientes nunca são consultados ou enviados à página pública.
    const ocupacao = await lerOcupacao(tx, negocio.id, desde, ate);
    const dias = Array.from({ length: 14 }, (_, i) => hoje.add({ days: i }).toString());
    return {
      negocio, funcionamento: ocupacao.funcionamento, dias, atualizadoEm: agora.toISOString(),
      /** Com um só profissional, a página não pergunta "com quem". */
      profissionais: ocupacao.profissionais,
      servicos: servicos.map((servico) => ({ ...servico,
        horarios: horariosLivresPorProfissional(ocupacao, { fuso: negocio.fuso, dataInicialLocal: hoje.toString(), quantidadeDias: 14,
          duracaoMin: servico.duracaoMin, agora })
          .map((h) => ({ ...h, dataLocal: Temporal.Instant.from(h.inicio).toZonedDateTimeISO(negocio.fuso).toPlainDate().toString() })),
      })),
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

export type PaginaPublica = NonNullable<Awaited<ReturnType<typeof obterPaginaPublica>>>;
