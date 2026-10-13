/**
 * Regras do pedido de reserva que não dependem de banco: valem no servidor
 * e na demonstração estática, que não tem servidor.
 */

/** Passo da grade de horários oferecida ao cliente, em minutos. */
export const PASSO_GRADE_MIN = 30;
/** Reservas futuras que um mesmo telefone pode manter no mesmo negócio. */
export const LIMITE_RESERVAS_POR_TELEFONE = 2;
/**
 * O cliente cancela pelo link até esta antecedência do início. Depois disso
 * o negócio já não teria tempo de ocupar a vaga.
 */
export const ANTECEDENCIA_CANCELAMENTO_MIN = 60;
/** "1 hora", "2 horas" ou "45 minutos", para os textos da tela. */
export const antecedenciaCancelamentoTexto = ANTECEDENCIA_CANCELAMENTO_MIN % 60 === 0
  ? `${ANTECEDENCIA_CANCELAMENTO_MIN / 60} hora${ANTECEDENCIA_CANCELAMENTO_MIN === 60 ? '' : 's'}`
  : `${ANTECEDENCIA_CANCELAMENTO_MIN} minutos`;

export type PedidoReserva = Readonly<{
  slug: string;
  servicoId: string;
  /** Início escolhido, em ISO UTC, exatamente como veio da página pública. */
  inicio: string;
  nome: string;
  telefone: string;
  /** Campo-isca: pessoas não veem; robôs preenchem. Deve chegar vazio. */
  site?: string;
}>;

export type MotivoRecusa =
  | 'dados_invalidos' | 'negocio_inexistente' | 'servico_indisponivel'
  | 'horario_indisponivel' | 'limite_reservas';

export type ReservaConfirmada = Readonly<{
  ok: true;
  /** Só é devolvido aqui; o banco guarda apenas o SHA-256. */
  tokenCancelamento: string;
  inicio: string;
  fim: string;
  cliente: { nome: string };
  servico: { nome: string; duracaoMin: number; precoCentavos: number };
  negocio: { nome: string; telefone: string; fuso: string; demonstracao: boolean };
}>;
export type ReservaRecusada = Readonly<{ ok: false; motivo: MotivoRecusa; mensagem: string }>;
export type ResultadoReserva = ReservaConfirmada | ReservaRecusada;

export const mensagensRecusa: Record<MotivoRecusa, string> = {
  dados_invalidos: 'Confira seu nome e o número de WhatsApp com DDD.',
  negocio_inexistente: 'Não encontramos esta agenda.',
  servico_indisponivel: 'Este serviço não está mais disponível. Atualize a página.',
  horario_indisponivel: 'Esse horário acabou de ser ocupado. Escolha outro.',
  limite_reservas: `Este WhatsApp já tem ${LIMITE_RESERVAS_POR_TELEFONE} horários marcados aqui. Cancele um deles para marcar outro.`,
};
export const recusar = (motivo: MotivoRecusa): ReservaRecusada => ({ ok: false, motivo, mensagem: mensagensRecusa[motivo] });

/** Nome sem espaços repetidos nas pontas ou no meio. */
export function normalizarNome(nome: string) {
  return nome.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Telefone brasileiro só com dígitos, com DDD e sem o 55: 10 dígitos (fixo)
 * ou 11 (celular começando em 9). Devolve null quando não for um número válido.
 */
export function normalizarTelefone(telefone: string) {
  let digitos = telefone.replace(/\D/g, '');
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) digitos = digitos.slice(2);
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  const ddd = Number(digitos.slice(0, 2));
  if (ddd < 11) return null;
  if (digitos.length === 11 && digitos[2] !== '9') return null;
  if (/^(\d)\1+$/.test(digitos)) return null;
  return digitos;
}

/** (34) 99999-9999 ou (34) 3333-3333. */
export function formatarTelefone(digitos: string) {
  const corte = digitos.length === 11 ? 7 : 6;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, corte)}-${digitos.slice(corte)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const INSTANTE_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?Z$/;

export type PedidoValido = { slug: string; servicoId: string; inicio: Date; nome: string; telefone: string };

/**
 * Confere o formato de cada campo. `servicoIdLivre` existe para a
 * demonstração estática, cujos serviços não têm UUID. `telefoneOpcional`
 * vale para o dono, que agenda quem veio ao balcão sem deixar telefone.
 */
export function validarPedido(pedido: PedidoReserva, { servicoIdLivre = false, telefoneOpcional = false } = {}): PedidoValido | null {
  if (!pedido || typeof pedido !== 'object') return null;
  const { slug, servicoId, inicio, nome, telefone, site } = pedido;
  if ([slug, servicoId, inicio, nome, telefone].some((campo) => typeof campo !== 'string')) return null;
  if (site) return null;
  if (!SLUG.test(slug) || slug.length > 120) return null;
  if (servicoIdLivre ? !servicoId || servicoId.length > 80 : !UUID.test(servicoId)) return null;
  if (!INSTANTE_UTC.test(inicio)) return null;
  const instante = new Date(inicio);
  if (Number.isNaN(instante.getTime())) return null;
  const nomeLimpo = normalizarNome(nome);
  if (nomeLimpo.length < 2 || nomeLimpo.length > 80 || !/\p{L}/u.test(nomeLimpo)) return null;
  const telefoneLimpo = telefoneOpcional && !telefone.trim() ? '' : normalizarTelefone(telefone);
  if (telefoneLimpo === null) return null;
  return { slug, servicoId, inicio: instante, nome: nomeLimpo, telefone: telefoneLimpo };
}
