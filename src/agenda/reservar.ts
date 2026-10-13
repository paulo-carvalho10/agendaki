import { createHash, randomBytes } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq, gt, lt, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { calcularHorariosLivres } from './horarios-livres.js';
import {
  LIMITE_RESERVAS_POR_TELEFONE, PASSO_GRADE_MIN, recusar, validarPedido,
  type PedidoReserva, type ResultadoReserva,
} from './pedido-reserva.js';

type Banco = PostgresJsDatabase<typeof schema>;
/** Dias que a página pública oferece, contando hoje. */
const DIAS_OFERECIDOS = 14;
const TENTATIVAS = 3;

/** Código SQLSTATE do PostgreSQL, mesmo quando o Drizzle embrulha o erro. */
export function codigoPostgres(erro: unknown): string | undefined {
  for (let atual: unknown = erro, i = 0; atual && typeof atual === 'object' && i < 5; i++) {
    const { code, cause } = atual as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    atual = cause;
  }
  return undefined;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Grava uma reserva. O horário é recalculado dentro da transação com o mesmo
 * motor da página pública, e a exclusão e o trigger do PostgreSQL decidem
 * quando dois pedidos disputam o mesmo intervalo. Com `peloDono`, vale para
 * o painel: sem limite por telefone e com telefone opcional.
 */
export async function reservarHorario(db: Banco, pedido: PedidoReserva, agora = new Date(), { peloDono = false } = {}): Promise<ResultadoReserva> {
  const valido = validarPedido(pedido, { telefoneOpcional: peloDono });
  if (!valido) return recusar('dados_invalidos');

  for (let tentativa = 1; ; tentativa++) {
    try {
      return await db.transaction(async (tx) => {
        const [negocio] = await tx.select({ id: schema.negocio.id, nome: schema.negocio.nome,
          telefone: schema.negocio.telefone, fuso: schema.negocio.fuso, demonstracao: schema.negocio.demonstracao,
        }).from(schema.negocio).where(eq(schema.negocio.slug, valido.slug)).limit(1);
        if (!negocio) return recusar('negocio_inexistente');

        const [servico] = await tx.select({ id: schema.servico.id, nome: schema.servico.nome,
          duracaoMin: schema.servico.duracaoMin, precoCentavos: schema.servico.precoCentavos,
        }).from(schema.servico).where(and(eq(schema.servico.id, valido.servicoId),
          eq(schema.servico.negocioId, negocio.id), eq(schema.servico.ativo, true))).limit(1);
        if (!servico) return recusar('servico_indisponivel');

        const inicio = valido.inicio;
        const fim = new Date(inicio.getTime() + servico.duracaoMin * 60_000);
        const hoje = Temporal.Instant.from(agora.toISOString()).toZonedDateTimeISO(negocio.fuso).toPlainDate();
        const diaLocal = Temporal.Instant.from(inicio.toISOString()).toZonedDateTimeISO(negocio.fuso).toPlainDate();
        const distancia = hoje.until(diaLocal).days;
        if (distancia < 0 || distancia >= DIAS_OFERECIDOS) return recusar('horario_indisponivel');

        // Mesmas margens da página pública: expediente de ontem e fim do dia.
        const desde = new Date(diaLocal.subtract({ days: 1 }).toZonedDateTime(negocio.fuso).epochMilliseconds);
        const ate = new Date(diaLocal.add({ days: 2 }).toZonedDateTime(negocio.fuso).epochMilliseconds);
        const funcionamento = await tx.select({ diaSemana: schema.horarioFuncionamento.diaSemana,
          abre: schema.horarioFuncionamento.abre, fecha: schema.horarioFuncionamento.fecha,
          terminaDiaSeguinte: schema.horarioFuncionamento.terminaDiaSeguinte,
        }).from(schema.horarioFuncionamento).where(eq(schema.horarioFuncionamento.negocioId, negocio.id))
          .orderBy(asc(schema.horarioFuncionamento.diaSemana), asc(schema.horarioFuncionamento.abre));
        const bloqueios = await tx.select({ inicio: schema.bloqueio.inicio, fim: schema.bloqueio.fim })
          .from(schema.bloqueio).where(and(eq(schema.bloqueio.negocioId, negocio.id), lt(schema.bloqueio.inicio, ate), gt(schema.bloqueio.fim, desde)));
        const ocupados = await tx.select({ inicio: schema.agendamento.inicio, fim: schema.agendamento.fim })
          .from(schema.agendamento).where(and(eq(schema.agendamento.negocioId, negocio.id), ne(schema.agendamento.status, 'cancelado'),
            lt(schema.agendamento.inicio, ate), gt(schema.agendamento.fim, desde)));
        const converter = (f: { inicio: Date; fim: Date }) => ({ inicio: f.inicio.toISOString(), fim: f.fim.toISOString() });
        const livres = calcularHorariosLivres({ fuso: negocio.fuso, dataInicialLocal: diaLocal.toString(), quantidadeDias: 1,
          duracaoServicoMin: servico.duracaoMin, passoMin: PASSO_GRADE_MIN, funcionamento,
          bloqueios: bloqueios.map(converter), agendamentosOcupados: ocupados.map(converter), agoraUTC: agora.toISOString(),
        });
        if (!livres.some((h) => new Date(h.inicio).getTime() === inicio.getTime())) return recusar('horario_indisponivel');

        // O limite protege a página pública; o dono agenda quantos quiser.
        if (!peloDono) {
          const [{ futuras }] = await tx.select({ futuras: sql<number>`count(*)::int` }).from(schema.agendamento)
            .where(and(eq(schema.agendamento.negocioId, negocio.id), eq(schema.agendamento.clienteTelefone, valido.telefone),
              eq(schema.agendamento.status, 'confirmado'), gt(schema.agendamento.inicio, agora)));
          if (futuras >= LIMITE_RESERVAS_POR_TELEFONE) return recusar('limite_reservas');
        }

        const tokenCancelamento = randomBytes(32).toString('base64url');
        await tx.insert(schema.agendamento).values({ negocioId: negocio.id, servicoId: servico.id,
          clienteNome: valido.nome, clienteTelefone: valido.telefone, inicio, fim,
          tokenCancelamentoHash: hashToken(tokenCancelamento) });
        return { ok: true as const, tokenCancelamento, inicio: inicio.toISOString(), fim: fim.toISOString(),
          cliente: { nome: valido.nome },
          servico: { nome: servico.nome, duracaoMin: servico.duracaoMin, precoCentavos: servico.precoCentavos },
          negocio: { nome: negocio.nome, telefone: negocio.telefone, fuso: negocio.fuso, demonstracao: negocio.demonstracao } };
      });
    } catch (erro) {
      const codigo = codigoPostgres(erro);
      // 23P01: outro pedido ocupou o intervalo entre a conferência e a gravação.
      if (codigo === '23P01') return recusar('horario_indisponivel');
      // Falha de serialização ou deadlock: a transação inteira é repetida.
      if ((codigo === '40001' || codigo === '40P01') && tentativa < TENTATIVAS) continue;
      throw erro;
    }
  }
}
