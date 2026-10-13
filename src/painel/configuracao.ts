import { and, asc, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { codigoPostgres } from '../agenda/reservar.js';
import { normalizarNome, normalizarTelefone } from '../agenda/pedido-reserva.js';
import type { ResultadoPainel } from './acoes.js';

type Banco = PostgresJsDatabase<typeof schema>;
const recusa = (mensagem: string): ResultadoPainel => ({ ok: false, mensagem });
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export const LIMITES_SERVICO = { duracaoMinima: 5, duracaoMaxima: 480, precoMaximoCentavos: 1_000_000 } as const;
export type Configuracao = NonNullable<Awaited<ReturnType<typeof obterConfiguracao>>>;

/** O que a tela de configurações mostra: dados do negócio, todos os serviços e o expediente. */
export async function obterConfiguracao(db: Banco, negocioId: string) {
  const [negocio] = await db.select({ nome: schema.negocio.nome, slug: schema.negocio.slug, telefone: schema.negocio.telefone,
    fuso: schema.negocio.fuso, demonstracao: schema.negocio.demonstracao,
  }).from(schema.negocio).where(eq(schema.negocio.id, negocioId)).limit(1);
  if (!negocio) return null;
  const servicos = await db.select({ id: schema.servico.id, nome: schema.servico.nome, duracaoMin: schema.servico.duracaoMin,
    precoCentavos: schema.servico.precoCentavos, ativo: schema.servico.ativo,
  }).from(schema.servico).where(eq(schema.servico.negocioId, negocioId))
    .orderBy(desc(schema.servico.ativo), asc(schema.servico.precoCentavos), asc(schema.servico.id));
  const faixas = await db.select({ diaSemana: schema.horarioFuncionamento.diaSemana, abre: schema.horarioFuncionamento.abre,
    fecha: schema.horarioFuncionamento.fecha, terminaDiaSeguinte: schema.horarioFuncionamento.terminaDiaSeguinte,
  }).from(schema.horarioFuncionamento).where(eq(schema.horarioFuncionamento.negocioId, negocioId))
    .orderBy(asc(schema.horarioFuncionamento.diaSemana), asc(schema.horarioFuncionamento.abre));
  // A tela edita uma faixa por dia, sem virar a noite. Expedientes mais
  // complexos são preservados e ficam só para leitura.
  const simples = faixas.every((f) => !f.terminaDiaSeguinte) && new Set(faixas.map((f) => f.diaSemana)).size === faixas.length;
  return { negocio, servicos, simples,
    funcionamento: faixas.map((f) => ({ ...f, abre: f.abre.slice(0, 5), fecha: f.fecha.slice(0, 5) })) };
}

/** Nome e WhatsApp do negócio. O endereço da página (slug) não muda por aqui, para não quebrar links já divulgados. */
export async function salvarNegocio(db: Banco, negocioId: string, dados: { nome: string; telefone: string }): Promise<ResultadoPainel> {
  if (!dados || typeof dados.nome !== 'string' || typeof dados.telefone !== 'string') return recusa('Preencha o nome e o WhatsApp.');
  const nome = normalizarNome(dados.nome);
  if (nome.length < 2 || nome.length > 80) return recusa('O nome do negócio precisa ter de 2 a 80 letras.');
  const telefone = normalizarTelefone(dados.telefone);
  if (!telefone) return recusa('Confira o WhatsApp do negócio, com DDD.');
  // O negócio de demonstração fica com telefone fictício: nenhuma mensagem pode sair dele de verdade.
  const salvos = await db.update(schema.negocio).set({ nome, telefone })
    .where(and(eq(schema.negocio.id, negocioId), eq(schema.negocio.demonstracao, false))).returning({ id: schema.negocio.id });
  return salvos.length ? { ok: true } : recusa('Negócio não encontrado ou de demonstração.');
}

export type DadosServico = Readonly<{ id?: string; nome: string; duracaoMin: number; precoCentavos: number }>;

/**
 * Cria um serviço ou altera um existente do próprio negócio. Mudar a duração
 * não mexe nos horários já marcados: eles guardam o próprio início e fim.
 */
export async function salvarServico(db: Banco, negocioId: string, dados: DadosServico): Promise<ResultadoPainel> {
  if (!dados || typeof dados.nome !== 'string') return recusa('Preencha o nome do serviço.');
  const nome = normalizarNome(dados.nome);
  if (nome.length < 2 || nome.length > 60) return recusa('O nome do serviço precisa ter de 2 a 60 letras.');
  const { duracaoMin, precoCentavos } = dados;
  if (!Number.isInteger(duracaoMin) || duracaoMin < LIMITES_SERVICO.duracaoMinima || duracaoMin > LIMITES_SERVICO.duracaoMaxima || duracaoMin % 5 !== 0) {
    return recusa('A duração precisa ser em minutos, de 5 em 5, entre 5 minutos e 8 horas.');
  }
  if (!Number.isInteger(precoCentavos) || precoCentavos < 0 || precoCentavos > LIMITES_SERVICO.precoMaximoCentavos) {
    return recusa('Confira o preço. Use 0 para serviço gratuito.');
  }
  if (dados.id === undefined) {
    await db.insert(schema.servico).values({ negocioId, nome, duracaoMin, precoCentavos });
    return { ok: true };
  }
  try {
    const salvos = await db.update(schema.servico).set({ nome, duracaoMin, precoCentavos })
      .where(and(eq(schema.servico.id, dados.id), eq(schema.servico.negocioId, negocioId))).returning({ id: schema.servico.id });
    return salvos.length ? { ok: true } : recusa('Serviço não encontrado.');
  } catch (erro) {
    if (codigoPostgres(erro) === '22P02') return recusa('Serviço não encontrado.');
    throw erro;
  }
}

/** Desativar tira o serviço da página pública sem apagar o histórico dos atendimentos. */
export async function definirServicoAtivo(db: Banco, negocioId: string, servicoId: string, ativo: boolean): Promise<ResultadoPainel> {
  if (typeof ativo !== 'boolean') return recusa('Serviço não encontrado.');
  try {
    const salvos = await db.update(schema.servico).set({ ativo })
      .where(and(eq(schema.servico.id, servicoId), eq(schema.servico.negocioId, negocioId))).returning({ id: schema.servico.id });
    return salvos.length ? { ok: true } : recusa('Serviço não encontrado.');
  } catch (erro) {
    if (codigoPostgres(erro) === '22P02') return recusa('Serviço não encontrado.');
    throw erro;
  }
}

export type DiaAberto = Readonly<{ diaSemana: number; abre: string; fecha: string }>;

/**
 * Troca o expediente inteiro pela lista de dias abertos (os ausentes ficam
 * fechados). Horários já marcados fora do novo expediente continuam valendo.
 */
export async function salvarFuncionamento(db: Banco, negocioId: string, dias: readonly DiaAberto[]): Promise<ResultadoPainel> {
  if (!Array.isArray(dias) || dias.length > 7) return recusa('Confira os dias de funcionamento.');
  const vistos = new Set<number>();
  for (const dia of dias) {
    if (!dia || !Number.isInteger(dia.diaSemana) || dia.diaSemana < 0 || dia.diaSemana > 6 || vistos.has(dia.diaSemana)) return recusa('Confira os dias de funcionamento.');
    if (typeof dia.abre !== 'string' || typeof dia.fecha !== 'string' || !HORA.test(dia.abre) || !HORA.test(dia.fecha)) return recusa('Preencha a hora de abrir e de fechar de cada dia aberto.');
    if (dia.fecha <= dia.abre) return recusa('A hora de fechar precisa ser depois da hora de abrir.');
    vistos.add(dia.diaSemana);
  }
  const atual = await obterConfiguracao(db, negocioId);
  if (!atual) return recusa('Negócio não encontrado.');
  if (!atual.simples) return recusa('Este negócio tem um expediente especial, que não é alterado por esta tela.');
  await db.transaction(async (tx) => {
    await tx.delete(schema.horarioFuncionamento).where(eq(schema.horarioFuncionamento.negocioId, negocioId));
    if (dias.length) {
      await tx.insert(schema.horarioFuncionamento).values(dias.map((d) => ({ negocioId, diaSemana: d.diaSemana, abre: d.abre, fecha: d.fecha })));
    }
  });
  return { ok: true };
}
