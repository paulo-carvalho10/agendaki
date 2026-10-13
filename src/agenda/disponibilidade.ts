/**
 * Disponibilidade com vários profissionais, sem banco: vale no servidor e na
 * demonstração estática. A leitura do banco fica em `ocupacao.ts`.
 */
import { calcularHorariosLivres, type Expediente } from './horarios-livres.js';
import { PASSO_GRADE_MIN } from './pedido-reserva.js';

export type Ocupacao = Readonly<{
  /** Profissionais ativos, na ordem em que foram cadastrados. */
  profissionais: readonly { id: string; nome: string }[];
  funcionamento: readonly Expediente[];
  /** `profissionalId` nulo fecha a agenda de todos. */
  bloqueios: readonly { inicio: string; fim: string; profissionalId: string | null }[];
  ocupados: readonly { inicio: string; fim: string; profissionalId: string }[];
}>;
/** Um horário e quem está livre nele. */
export type HorarioLivre = { inicio: string; fim: string; profissionais: string[] };

/**
 * Horários livres de um serviço, com a lista de profissionais disponíveis em
 * cada um. Roda o motor uma vez por profissional: o expediente é do negócio,
 * e cada um tem os próprios compromissos e bloqueios. Sem banco nem relógio.
 */
export function horariosLivresPorProfissional(ocupacao: Ocupacao, opcoes: {
  fuso: string; dataInicialLocal: string; quantidadeDias: number; duracaoMin: number; agora: Date;
  /** Restringe a conta a alguns profissionais (por exemplo, o escolhido pelo cliente). */
  somente?: readonly string[];
}): HorarioLivre[] {
  const porInicio = new Map<string, HorarioLivre>();
  for (const profissional of ocupacao.profissionais) {
    if (opcoes.somente && !opcoes.somente.includes(profissional.id)) continue;
    const livres = calcularHorariosLivres({
      fuso: opcoes.fuso, dataInicialLocal: opcoes.dataInicialLocal, quantidadeDias: opcoes.quantidadeDias,
      duracaoServicoMin: opcoes.duracaoMin, passoMin: PASSO_GRADE_MIN, funcionamento: ocupacao.funcionamento,
      bloqueios: ocupacao.bloqueios.filter((b) => b.profissionalId === null || b.profissionalId === profissional.id),
      agendamentosOcupados: ocupacao.ocupados.filter((a) => a.profissionalId === profissional.id),
      agoraUTC: opcoes.agora.toISOString(),
    });
    for (const h of livres) {
      const existente = porInicio.get(h.inicio);
      if (existente) existente.profissionais.push(profissional.id);
      else porInicio.set(h.inicio, { inicio: h.inicio, fim: h.fim, profissionais: [profissional.id] });
    }
  }
  return [...porInicio.values()].sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
}

/**
 * Quando o cliente não escolhe o profissional, fica com quem tem menos
 * atendimentos naquele dia; no empate, com quem foi cadastrado primeiro.
 */
export function escolherProfissional(ocupacao: Ocupacao, livres: readonly string[], diaInicio: Date, diaFim: Date) {
  const carga = (id: string) => ocupacao.ocupados.filter((a) => a.profissionalId === id
    && new Date(a.inicio) < diaFim && new Date(a.fim) > diaInicio).length;
  return ocupacao.profissionais.filter((p) => livres.includes(p.id))
    .map((p, ordem) => ({ id: p.id, carga: carga(p.id), ordem }))
    .sort((a, b) => a.carga - b.carga || a.ordem - b.ordem)[0]?.id;
}
