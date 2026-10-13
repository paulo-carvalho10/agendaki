/**
 * Painel do dono sem servidor nem banco, para a demonstração estática.
 * Guarda tudo na memória da página e segue as mesmas regras do painel de
 * verdade. Nada aqui importa código de banco em tempo de execução.
 */
import { Temporal } from '@js-temporal/polyfill';
import { calcularHorariosLivres } from '../agenda/horarios-livres.js';
import { PASSO_GRADE_MIN, recusar, validarPedido, type ResultadoReserva } from '../agenda/pedido-reserva.js';
import type { AgendaDoDia, StatusAgendamento } from './agenda.js';
import type { PedidoBloqueio, PedidoDoDono, ResultadoPainel } from './acoes.js';

const FUSO = 'America/Sao_Paulo';
const DIAS_OFERECIDOS = 14;
const ALCANCE_DIAS = 90;
const BUSCA_LEMBRETES_DIAS = 4;

type AgendamentoDemo = { id: string; servicoId: string; inicio: string; fim: string; status: StatusAgendamento; clienteNome: string; clienteTelefone: string; lembreteEm: string | null };
type BloqueioDemo = { id: string; inicio: string; fim: string; motivo: string };
export type EstadoDemo = Readonly<{
  servicos: readonly { id: string; nome: string; duracaoMin: number; precoCentavos: number }[];
  funcionamento: readonly { diaSemana: number; abre: string; fecha: string; terminaDiaSeguinte: boolean }[];
  agendamentos: readonly AgendamentoDemo[];
  bloqueios: readonly BloqueioDemo[];
  proximoId: number;
}>;

const negocio = { id: 'demo-horizonte', nome: 'Barbearia Horizonte', slug: 'barbearia-demo', telefone: '', fuso: FUSO, demonstracao: true };
const iso = (data: Temporal.PlainDate, hora: string) => new Date(data.toPlainDateTime(hora).toZonedDateTime(FUSO).epochMilliseconds).toISOString();
const dataLocal = (instante: string) => Temporal.Instant.from(instante).toZonedDateTimeISO(FUSO).toPlainDate();
const hojeEm = (agora: Date) => Temporal.Instant.from(agora.toISOString()).toZonedDateTimeISO(FUSO).toPlainDate();
const recusa = (mensagem: string): ResultadoPainel => ({ ok: false, mensagem });

/** Uma barbearia fictícia com clientes hoje (alguns já atendidos) e no próximo dia útil. */
export function criarEstadoDemo(agora = new Date()): EstadoDemo {
  const hoje = hojeEm(agora);
  const servicos = [
    { id: 'demo-barba', nome: 'Barba', duracaoMin: 30, precoCentavos: 3000 },
    { id: 'demo-corte', nome: 'Corte', duracaoMin: 30, precoCentavos: 4000 },
    { id: 'demo-combo', nome: 'Corte + barba', duracaoMin: 60, precoCentavos: 6500 },
  ];
  const funcionamento = [1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, abre: '09:00', fecha: '18:00', terminaDiaSeguinte: false }));
  const aberto = (data: Temporal.PlainDate) => data.dayOfWeek !== 7;
  let proximo = hoje.add({ days: 1 });
  while (!aberto(proximo)) proximo = proximo.add({ days: 1 });

  let id = 0;
  const marcar = (data: Temporal.PlainDate, hora: string, servicoId: string, clienteNome: string, final: string): AgendamentoDemo => {
    const servico = servicos.find((s) => s.id === servicoId)!;
    const inicio = iso(data, hora);
    const fim = new Date(new Date(inicio).getTime() + servico.duracaoMin * 60_000).toISOString();
    return { id: `demo-a${++id}`, servicoId, inicio, fim, status: 'confirmado', clienteNome, clienteTelefone: `349000000${final}`, lembreteEm: null };
  };
  const deHoje = aberto(hoje) ? [
    marcar(hoje, '09:00', 'demo-corte', 'Marcos Andrade', '01'),
    marcar(hoje, '10:30', 'demo-barba', 'Rafael Nunes', '02'),
    marcar(hoje, '14:00', 'demo-combo', 'João Pedro Lima', '03'),
    marcar(hoje, '16:30', 'demo-corte', 'Gustavo Reis', '04'),
  ] : [];
  // O primeiro cliente do dia já aparece como atendido, se o horário dele passou.
  const agendamentos = [
    ...deHoje.map((a, i) => (i === 0 && a.fim <= agora.toISOString() ? { ...a, status: 'atendido' as const } : a)),
    marcar(proximo, '09:30', 'demo-corte', 'Lucas Martins', '05'),
    marcar(proximo, '11:00', 'demo-combo', 'André Souza', '06'),
    marcar(proximo, '15:00', 'demo-barba', 'Felipe Castro', '07'),
  ];
  const bloqueios = [hoje, proximo].filter(aberto).map((data, i) => ({ id: `demo-b${i + 1}`, inicio: iso(data, '12:00'), fim: iso(data, '13:00'), motivo: 'Almoço' }));
  return { servicos, funcionamento, agendamentos, bloqueios, proximoId: 100 };
}

const ocupam = (estado: EstadoDemo) => estado.agendamentos.filter((a) => a.status !== 'cancelado').map(({ inicio, fim }) => ({ inicio, fim }));

function horariosLivres(estado: EstadoDemo, dia: Temporal.PlainDate, duracaoMin: number, agora: Date) {
  return calcularHorariosLivres({ fuso: FUSO, dataInicialLocal: dia.toString(), quantidadeDias: 1, duracaoServicoMin: duracaoMin,
    passoMin: PASSO_GRADE_MIN, funcionamento: estado.funcionamento, bloqueios: estado.bloqueios.map(({ inicio, fim }) => ({ inicio, fim })),
    agendamentosOcupados: ocupam(estado), agoraUTC: agora.toISOString() });
}

/** O mesmo formato que o servidor entrega ao painel de verdade. */
export function agendaDoDiaDemo(estado: EstadoDemo, diaPedido: string | undefined, agora = new Date()): AgendaDoDia {
  const hoje = hojeEm(agora);
  let dia = hoje;
  if (diaPedido && /^\d{4}-\d{2}-\d{2}$/.test(diaPedido)) {
    try {
      const pedido = Temporal.PlainDate.from(diaPedido, { overflow: 'reject' });
      if (Math.abs(hoje.until(pedido).days) <= ALCANCE_DIAS) dia = pedido;
    } catch { /* fica em hoje */ }
  }
  const completo = (a: AgendamentoDemo) => {
    const servico = estado.servicos.find((s) => s.id === a.servicoId)!;
    return { id: a.id, inicio: a.inicio, fim: a.fim, status: a.status, clienteNome: a.clienteNome, clienteTelefone: a.clienteTelefone,
      lembreteEm: a.lembreteEm, servicoNome: servico.nome, precoCentavos: servico.precoCentavos };
  };
  const porInicio = (x: { inicio: string }, y: { inicio: string }) => x.inicio.localeCompare(y.inicio);
  const doDia = estado.agendamentos.filter((a) => dataLocal(a.inicio).equals(dia)).sort(porInicio).map(completo);
  const proximos = estado.agendamentos.filter((a) => {
    const distancia = hoje.until(dataLocal(a.inicio)).days;
    return a.status === 'confirmado' && distancia >= 1 && distancia <= BUSCA_LEMBRETES_DIAS;
  }).sort(porInicio);
  const diaLembretes = proximos.length ? dataLocal(proximos[0].inicio) : null;
  const distancia = hoje.until(dia).days;
  const podeAgendar = distancia >= 0 && distancia < DIAS_OFERECIDOS;
  const contar = (status: StatusAgendamento) => doDia.filter((a) => a.status === status).length;
  const somar = (status: StatusAgendamento[]) => doDia.filter((a) => status.includes(a.status)).reduce((total, a) => total + a.precoCentavos, 0);
  return {
    negocio, agora: agora.toISOString(), hoje: hoje.toString(), dia: dia.toString(),
    diaAnterior: dia.subtract({ days: 1 }).toString(), diaSeguinte: dia.add({ days: 1 }).toString(),
    agendamentos: doDia,
    bloqueios: estado.bloqueios.filter((b) => dataLocal(b.inicio).equals(dia)).sort(porInicio).map((b) => ({ ...b })),
    lembretes: { dia: diaLembretes?.toString() ?? null, agendamentos: proximos.filter((a) => diaLembretes && dataLocal(a.inicio).equals(diaLembretes)).map(completo) },
    servicos: [...estado.servicos].sort((a, b) => a.precoCentavos - b.precoCentavos)
      .map((s) => ({ ...s, horarios: podeAgendar ? horariosLivres(estado, dia, s.duracaoMin, agora) : [] })),
    podeAgendar,
    resumo: { confirmados: contar('confirmado'), atendidos: contar('atendido'), faltas: contar('faltou'), cancelados: contar('cancelado'),
      previstoCentavos: somar(['confirmado', 'atendido']), realizadoCentavos: somar(['atendido']) },
  };
}

type Mudanca<R> = { estado: EstadoDemo; resultado: R };
const trocar = (estado: EstadoDemo, id: string, parte: Partial<AgendamentoDemo>): EstadoDemo =>
  ({ ...estado, agendamentos: estado.agendamentos.map((a) => (a.id === id ? { ...a, ...parte } : a)) });

export function mudarStatusDemo(estado: EstadoDemo, id: string, para: StatusAgendamento, agora = new Date()): Mudanca<ResultadoPainel> {
  const atual = estado.agendamentos.find((a) => a.id === id);
  const nao = (mensagem: string) => ({ estado, resultado: recusa(mensagem) });
  if (!atual) return nao('Agendamento não encontrado.');
  if (atual.status === para) return { estado, resultado: { ok: true } };
  if (atual.status === 'cancelado') return nao('Este horário foi cancelado. Para atender o cliente, faça um novo agendamento.');
  if ((para === 'atendido' || para === 'faltou') && atual.inicio > agora.toISOString()) return nao('Só dá para marcar como atendido ou falta depois que o horário começar.');
  if (para === 'cancelado' && atual.status !== 'confirmado') return nao('Este atendimento já foi encerrado. Desfaça a marcação antes de cancelar.');
  return { estado: trocar(estado, id, { status: para }), resultado: { ok: true } };
}

export function registrarLembreteDemo(estado: EstadoDemo, id: string, agora = new Date()): Mudanca<ResultadoPainel> {
  const atual = estado.agendamentos.find((a) => a.id === id && a.status === 'confirmado');
  if (!atual) return { estado, resultado: recusa('Agendamento não encontrado.') };
  return { estado: trocar(estado, id, { lembreteEm: agora.toISOString() }), resultado: { ok: true } };
}

export function agendarDemo(estado: EstadoDemo, pedido: PedidoDoDono, agora = new Date()): Mudanca<ResultadoReserva> {
  const valido = validarPedido({ slug: negocio.slug, ...pedido }, { servicoIdLivre: true, telefoneOpcional: true });
  if (!valido) return { estado, resultado: recusar('dados_invalidos') };
  const servico = estado.servicos.find((s) => s.id === pedido.servicoId);
  if (!servico) return { estado, resultado: recusar('servico_indisponivel') };
  const hoje = hojeEm(agora);
  const dia = dataLocal(valido.inicio.toISOString());
  const distancia = hoje.until(dia).days;
  const livre = distancia >= 0 && distancia < DIAS_OFERECIDOS
    && horariosLivres(estado, dia, servico.duracaoMin, agora).find((h) => new Date(h.inicio).getTime() === valido.inicio.getTime());
  if (!livre) return { estado, resultado: recusar('horario_indisponivel') };
  const inicio = valido.inicio.toISOString();
  const fim = new Date(valido.inicio.getTime() + servico.duracaoMin * 60_000).toISOString();
  const novo: AgendamentoDemo = { id: `demo-a${estado.proximoId}`, servicoId: servico.id, inicio, fim, status: 'confirmado', clienteNome: valido.nome, clienteTelefone: valido.telefone, lembreteEm: null };
  return {
    estado: { ...estado, agendamentos: [...estado.agendamentos, novo], proximoId: estado.proximoId + 1 },
    resultado: { ok: true, tokenCancelamento: 'demonstracao', inicio, fim, cliente: { nome: valido.nome },
      servico: { nome: servico.nome, duracaoMin: servico.duracaoMin, precoCentavos: servico.precoCentavos },
      negocio: { nome: negocio.nome, telefone: '', fuso: FUSO, demonstracao: true } },
  };
}

export function bloquearDemo(estado: EstadoDemo, pedido: PedidoBloqueio): Mudanca<ResultadoPainel> {
  const nao = (mensagem: string) => ({ estado, resultado: recusa(mensagem) });
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!pedido || !/^\d{4}-\d{2}-\d{2}$/.test(pedido.dia) || !hora.test(pedido.das) || !hora.test(pedido.ate)) return nao('Preencha o dia e os horários.');
  if (pedido.ate <= pedido.das) return nao('O fim do bloqueio precisa ser depois do início.');
  let inicio: string, fim: string;
  try {
    const dia = Temporal.PlainDate.from(pedido.dia, { overflow: 'reject' });
    inicio = iso(dia, pedido.das); fim = iso(dia, pedido.ate);
  } catch { return nao('Esse dia ou horário não existe no calendário.'); }
  if (ocupam(estado).some((a) => a.inicio < fim && a.fim > inicio)) return nao('Já existe cliente marcado nesse intervalo. Cancele ou remarque o horário antes de bloquear.');
  const motivo = pedido.motivo.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Horário bloqueado';
  return { estado: { ...estado, bloqueios: [...estado.bloqueios, { id: `demo-b${estado.proximoId}`, inicio, fim, motivo }], proximoId: estado.proximoId + 1 }, resultado: { ok: true } };
}

export function desbloquearDemo(estado: EstadoDemo, id: string): Mudanca<ResultadoPainel> {
  if (!estado.bloqueios.some((b) => b.id === id)) return { estado, resultado: recusa('Bloqueio não encontrado.') };
  return { estado: { ...estado, bloqueios: estado.bloqueios.filter((b) => b.id !== id) }, resultado: { ok: true } };
}
