import { Temporal } from '@js-temporal/polyfill';

export type IntervaloUTC = Readonly<{ inicio: string; fim: string }>;
export type Expediente = Readonly<{
  diaSemana: number; // 0 = domingo
  abre: string; // HH:mm ou HH:mm:00 (retorno do PostgreSQL)
  fecha: string;
  terminaDiaSeguinte: boolean;
}>;
export type EntradaHorariosLivres = Readonly<{
  fuso: string;
  dataInicialLocal: string;
  quantidadeDias: number;
  duracaoServicoMin: number;
  passoMin: number;
  funcionamento: readonly Expediente[];
  bloqueios: readonly IntervaloUTC[];
  agendamentosOcupados: readonly IntervaloUTC[];
  agoraUTC: string;
}>;

type Faixa = { inicio: bigint; fim: bigint };
const MINUTO = 60_000_000_000n;

function inteiro(valor: number, nome: string, maximo: number) {
  if (!Number.isInteger(valor) || valor < 1 || valor > maximo) {
    throw new RangeError(`${nome} deve ser inteiro entre 1 e ${maximo}.`);
  }
}

function instante(valor: string): bigint {
  if (!valor.endsWith('Z')) throw new RangeError('Instantes devem estar em UTC com sufixo Z.');
  return Temporal.Instant.from(valor).epochNanoseconds;
}

function hora(valor: string) {
  if (!/^\d{2}:\d{2}(:00)?$/.test(valor)) throw new RangeError('Horário deve usar HH:mm ou HH:mm:00.');
  return Temporal.PlainTime.from(valor);
}

function unir(faixas: Faixa[]): Faixa[] {
  const ordenadas = faixas.sort((a, b) => a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0);
  const unidas: Faixa[] = [];
  for (const faixa of ordenadas) {
    const ultima = unidas.at(-1);
    if (ultima && faixa.inicio <= ultima.fim) {
      if (faixa.fim > ultima.fim) ultima.fim = faixa.fim;
    } else unidas.push({ ...faixa });
  }
  return unidas;
}

/**
 * Função pura. O resultado é uma consulta de disponibilidade, não uma reserva.
 * O chamador fornece somente ocupações não canceladas e mantém a trava no banco.
 * A janela filtra a data LOCAL de início; o atendimento pode terminar no dia seguinte.
 */
export function calcularHorariosLivres(entrada: EntradaHorariosLivres): IntervaloUTC[] {
  inteiro(entrada.quantidadeDias, 'quantidadeDias', 14);
  inteiro(entrada.duracaoServicoMin, 'duracaoServicoMin', 1440);
  inteiro(entrada.passoMin, 'passoMin', 1440);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.dataInicialLocal)) throw new RangeError('Data deve usar YYYY-MM-DD.');
  const primeiraData = Temporal.PlainDate.from(entrada.dataInicialLocal);
  const limiteData = primeiraData.add({ days: entrada.quantidadeDias });
  const agora = instante(entrada.agoraUTC);
  // Valida inclusive quando não há expediente. Offset fixo não substitui fuso IANA.
  if (/^[+-]/.test(entrada.fuso)) throw new RangeError('Informe um fuso IANA, não um offset fixo.');
  Temporal.Instant.fromEpochNanoseconds(agora).toZonedDateTimeISO(entrada.fuso);

  const regras = entrada.funcionamento.map((regra) => {
    if (!Number.isInteger(regra.diaSemana) || regra.diaSemana < 0 || regra.diaSemana > 6) {
      throw new RangeError('diaSemana deve ser inteiro entre 0 e 6.');
    }
    const abre = hora(regra.abre);
    const fecha = hora(regra.fecha);
    const ordem = Temporal.PlainTime.compare(fecha, abre);
    if (typeof regra.terminaDiaSeguinte !== 'boolean' || (regra.terminaDiaSeguinte ? ordem > 0 : ordem <= 0)) {
      throw new RangeError('Expediente inválido: confira a virada de dia.');
    }
    return { ...regra, abre, fecha };
  });
  const ocupadas = unir([...entrada.bloqueios, ...entrada.agendamentosOcupados].map((faixa) => {
    const inicio = instante(faixa.inicio);
    const fim = instante(faixa.fim);
    if (fim <= inicio) throw new RangeError('Ocupação deve terminar depois do início.');
    return { inicio, fim };
  }));

  const expedientes: Faixa[] = [];
  // Inclui o expediente de ontem que ainda pode estar aberto após meia-noite.
  for (let offset = -1; offset < entrada.quantidadeDias; offset++) {
    const data = primeiraData.add({ days: offset });
    for (const regra of regras) {
      if (regra.diaSemana !== data.dayOfWeek % 7) continue;
      if (offset === -1 && !regra.terminaDiaSeguinte) continue;
      const dataFim = regra.terminaDiaSeguinte ? data.add({ days: 1 }) : data;
      // Não adivinha a intenção do dono se a própria abertura/fechamento for
      // inexistente ou duplicada na transição do relógio: exige ajuste da regra.
      const inicio = data.toPlainDateTime(regra.abre).toZonedDateTime(entrada.fuso, { disambiguation: 'reject' });
      const fim = dataFim.toPlainDateTime(regra.fecha).toZonedDateTime(entrada.fuso, { disambiguation: 'reject' });
      expedientes.push({ inicio: inicio.epochNanoseconds, fim: fim.epochNanoseconds });
    }
  }

  const duracao = BigInt(entrada.duracaoServicoMin) * MINUTO;
  const passo = BigInt(entrada.passoMin) * MINUTO;
  const resultado: IntervaloUTC[] = [];
  for (const faixa of unir(expedientes)) {
    // Grade ancorada na abertura, não no fim de um bloqueio ou no relógio atual.
    for (let inicio = faixa.inicio; inicio + duracao <= faixa.fim; inicio += passo) {
      if (inicio < agora) continue;
      const inicioInstant = Temporal.Instant.fromEpochNanoseconds(inicio);
      const dataLocal = inicioInstant.toZonedDateTimeISO(entrada.fuso).toPlainDate();
      if (Temporal.PlainDate.compare(dataLocal, primeiraData) < 0 || Temporal.PlainDate.compare(dataLocal, limiteData) >= 0) continue;
      const fim = inicio + duracao;
      if (ocupadas.some((ocupada) => ocupada.inicio < fim && ocupada.fim > inicio)) continue;
      resultado.push({ inicio: inicioInstant.toString(), fim: Temporal.Instant.fromEpochNanoseconds(fim).toString() });
    }
  }
  return resultado;
}
