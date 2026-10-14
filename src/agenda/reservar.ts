import { createHash, randomBytes } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { escolherProfissional, horariosLivresPorProfissional } from './disponibilidade.js';
import { lerOcupacao } from './ocupacao.js';
import {
  LIMITE_RESERVAS_POR_TELEFONE, recusar, validarPedido,
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
 * Grava uma reserva. A linha do negócio é travada logo no início, então as
 * reservas de um mesmo negócio entram uma por vez: quem atende e quem está
 * livre são lidos já na ordem certa. O horário é recalculado com o mesmo motor
 * da página pública, e a exclusão e o trigger do PostgreSQL continuam valendo
 * para qualquer gravação que não passe por aqui.
 *
 * Sem `profissionalId`, o cliente não tem preferência: a reserva vai para
 * quem estiver livre e com menos atendimentos no dia. Com `peloDono`, vale
 * para o painel: sem limite por telefone e com telefone opcional.
 */
export async function reservarHorario(db: Banco, pedido: PedidoReserva, agora = new Date(), { peloDono = false } = {}): Promise<ResultadoReserva> {
  const valido = validarPedido(pedido, { telefoneOpcional: peloDono });
  if (!valido) return recusar('dados_invalidos');

  for (let tentativa = 1; ; tentativa++) {
    try {
      return await db.transaction(async (tx) => {
        const [negocio] = await tx.select({ id: schema.negocio.id, nome: schema.negocio.nome,
          telefone: schema.negocio.telefone, fuso: schema.negocio.fuso, demonstracao: schema.negocio.demonstracao,
        }).from(schema.negocio).where(eq(schema.negocio.slug, valido.slug)).limit(1).for('update');
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
        const instante = (data: Temporal.PlainDate) => new Date(data.toZonedDateTime(negocio.fuso).epochMilliseconds);
        const ocupacao = await lerOcupacao(tx, negocio.id, instante(diaLocal.subtract({ days: 1 })), instante(diaLocal.add({ days: 2 })));
        // O profissional pedido precisa estar ativo neste negócio.
        if (valido.profissionalId && !ocupacao.profissionais.some((p) => p.id === valido.profissionalId)) return recusar('profissional_indisponivel');

        const horario = horariosLivresPorProfissional(ocupacao, { fuso: negocio.fuso, dataInicialLocal: diaLocal.toString(), quantidadeDias: 1,
          duracaoMin: servico.duracaoMin, agora, somente: valido.profissionalId ? [valido.profissionalId] : undefined,
        }).find((h) => new Date(h.inicio).getTime() === inicio.getTime());
        const profissionalId = horario && (valido.profissionalId
          ?? escolherProfissional(ocupacao, horario.profissionais, instante(diaLocal), instante(diaLocal.add({ days: 1 }))));
        if (!profissionalId) return recusar('horario_indisponivel');

        // O limite protege a página pública; o dono agenda quantos quiser.
        if (!peloDono) {
          const [{ futuras }] = await tx.select({ futuras: sql<number>`count(*)::int` }).from(schema.agendamento)
            .where(and(eq(schema.agendamento.negocioId, negocio.id), eq(schema.agendamento.clienteTelefone, valido.telefone),
              eq(schema.agendamento.status, 'confirmado'), gt(schema.agendamento.inicio, agora)));
          if (futuras >= LIMITE_RESERVAS_POR_TELEFONE) return recusar('limite_reservas');
        }

        const tokenCancelamento = randomBytes(32).toString('base64url');
        await tx.insert(schema.agendamento).values({ negocioId: negocio.id, servicoId: servico.id, profissionalId,
          clienteNome: valido.nome, clienteTelefone: valido.telefone, inicio, fim,
          tokenCancelamentoHash: hashToken(tokenCancelamento), criadoEm: agora, peloDono });
        return { ok: true as const, tokenCancelamento, inicio: inicio.toISOString(), fim: fim.toISOString(),
          cliente: { nome: valido.nome },
          servico: { nome: servico.nome, duracaoMin: servico.duracaoMin, precoCentavos: servico.precoCentavos },
          profissional: { id: profissionalId, nome: ocupacao.profissionais.find((p) => p.id === profissionalId)!.nome },
          variosProfissionais: ocupacao.profissionais.length > 1,
          negocio: { nome: negocio.nome, telefone: negocio.telefone, fuso: negocio.fuso, demonstracao: negocio.demonstracao } };
      });
    } catch (erro) {
      const codigo = codigoPostgres(erro);
      const repetir = tentativa < TENTATIVAS;
      // 23P01: outro pedido ocupou o intervalo entre a conferência e a gravação.
      // Sem preferência de profissional, vale tentar de novo: outro pode estar livre.
      if (codigo === '23P01') { if (!valido.profissionalId && repetir) continue; return recusar('horario_indisponivel'); }
      // Falha de serialização ou deadlock: a transação inteira é repetida.
      if ((codigo === '40001' || codigo === '40P01') && repetir) continue;
      throw erro;
    }
  }
}
