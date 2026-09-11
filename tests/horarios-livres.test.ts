import { describe, expect, test } from 'vitest';
import { calcularHorariosLivres as calcular, type EntradaHorariosLivres, type Expediente } from '../src/agenda/horarios-livres.js';

const expediente: Expediente = { diaSemana: 1, abre: '09:00', fecha: '11:00', terminaDiaSeguinte: false };
const base: EntradaHorariosLivres = {
  fuso: 'America/Sao_Paulo', dataInicialLocal: '2030-01-07', quantidadeDias: 1,
  duracaoServicoMin: 30, passoMin: 30, funcionamento: [expediente],
  bloqueios: [], agendamentosOcupados: [], agoraUTC: '2030-01-01T00:00:00Z',
};
const utc = (hora: string) => `2030-01-07T${hora}:00Z`;
const faixa = (inicio: string, fim: string) => ({ inicio: utc(inicio), fim: utc(fim) });
const inicios = (entrada: EntradaHorariosLivres) => calcular(entrada).map((x) => x.inicio);

test('dia vazio devolve todos os intervalos exatos em UTC', () => {
  expect(calcular(base)).toEqual([faixa('12:00', '12:30'), faixa('12:30', '13:00'), faixa('13:00', '13:30'), faixa('13:30', '14:00')]);
});
test('dia cheio não oferece encaixes', () => {
  expect(calcular({ ...base, agendamentosOcupados: [faixa('12:00', '14:00')] })).toEqual([]);
});
test('bloqueio no meio remove somente os intervalos afetados', () => {
  expect(calcular({ ...base, bloqueios: [faixa('12:30', '13:30')] })).toEqual([faixa('12:00', '12:30'), faixa('13:30', '14:00')]);
});
test('serviço maior que o restante não cabe', () => {
  expect(calcular({ ...base, duracaoServicoMin: 45, bloqueios: [faixa('12:30', '14:00')] })).toEqual([]);
});
test('serviço que termina exatamente no fechamento cabe', () => {
  expect(calcular({ ...base, duracaoServicoMin: 120 })).toEqual([faixa('12:00', '14:00')]);
});
test('duração maior que o expediente não cabe', () => {
  expect(calcular({ ...base, duracaoServicoMin: 121 })).toEqual([]);
});
test('passo é independente da duração e não oferece fim fora do expediente', () => {
  expect(calcular({ ...base, duracaoServicoMin: 90, passoMin: 15 })).toEqual([
    faixa('12:00', '13:30'), faixa('12:15', '13:45'), faixa('12:30', '14:00'),
  ]);
});
test('bloqueio fora da grade não desloca os inícios', () => {
  expect(inicios({ ...base, bloqueios: [faixa('12:10', '12:40')] })).toEqual([utc('13:00'), utc('13:30')]);
});
test('ocupações adjacentes não conflitam', () => {
  expect(calcular({ ...base, bloqueios: [faixa('11:00', '12:00'), faixa('14:00', '15:00')] })).toEqual(calcular(base));
});
test('sobreposição de um microssegundo já impede a reserva', () => {
  expect(inicios({ ...base, bloqueios: [{ inicio: '2030-01-07T12:29:59.999999Z', fim: utc('12:30') }] })).not.toContain(utc('12:00'));
});
test('não oferece passado e mantém horário exatamente igual a agora', () => {
  expect(inicios({ ...base, agoraUTC: utc('13:00') })).toEqual([utc('13:00'), utc('13:30')]);
  expect(inicios({ ...base, agoraUTC: '2030-01-07T13:00:00.000001Z' })).toEqual([utc('13:30')]);
});
test('dia sem funcionamento fica vazio', () => {
  expect(calcular({ ...base, dataInicialLocal: '2030-01-08' })).toEqual([]);
});
test('pausa entre dois expedientes impede atendimento atravessando a pausa', () => {
  expect(calcular({ ...base, duracaoServicoMin: 60, funcionamento: [
    { ...expediente, fecha: '10:00' }, { ...expediente, abre: '10:30', fecha: '11:30' },
  ] })).toEqual([faixa('12:00', '13:00'), faixa('13:30', '14:30')]);
});
test('expedientes sobrepostos e duplicados geram uma grade única e ordenada', () => {
  expect(calcular({ ...base, funcionamento: [expediente, { ...expediente, abre: '09:30' }, expediente] })).toEqual(calcular(base));
});
test('faixas adjacentes permitem atendimento contínuo entre elas', () => {
  expect(calcular({ ...base, duracaoServicoMin: 120, funcionamento: [
    { ...expediente, fecha: '10:00' }, { ...expediente, abre: '10:00' },
  ] })).toEqual([faixa('12:00', '14:00')]);
});
test('14 dias incluem duas segundas e excluem a terceira', () => {
  const resultado = calcular({ ...base, quantidadeDias: 14 });
  expect(resultado).toHaveLength(8);
  expect(resultado.at(-1)?.inicio).toBe('2030-01-14T13:30:00Z');
});
test('virada de dia filtra a data local do início, permitindo terminar amanhã', () => {
  const resultado = calcular({ ...base, duracaoServicoMin: 120, passoMin: 60,
    funcionamento: [{ ...expediente, abre: '22:00', fecha: '02:00', terminaDiaSeguinte: true }],
  });
  expect(resultado).toEqual([
    { inicio: '2030-01-08T01:00:00Z', fim: '2030-01-08T03:00:00Z' },
    { inicio: '2030-01-08T02:00:00Z', fim: '2030-01-08T04:00:00Z' },
  ]);
});
test('consulta de terça inclui a madrugada do expediente de segunda', () => {
  expect(calcular({ ...base, dataInicialLocal: '2030-01-08', duracaoServicoMin: 60, passoMin: 60,
    funcionamento: [{ ...expediente, abre: '22:00', fecha: '02:00', terminaDiaSeguinte: true }],
  })).toEqual([
    { inicio: '2030-01-08T03:00:00Z', fim: '2030-01-08T04:00:00Z' },
    { inicio: '2030-01-08T04:00:00Z', fim: '2030-01-08T05:00:00Z' },
  ]);
});
test('bloqueio atravessando meia-noite elimina encaixes nos dois lados', () => {
  expect(calcular({ ...base, quantidadeDias: 2, duracaoServicoMin: 60, passoMin: 60,
    funcionamento: [{ ...expediente, abre: '22:00', fecha: '02:00', terminaDiaSeguinte: true }],
    bloqueios: [{ inicio: '2030-01-08T02:30:00Z', fim: '2030-01-08T03:30:00Z' }],
  })).toEqual([
    { inicio: '2030-01-08T01:00:00Z', fim: '2030-01-08T02:00:00Z' },
    { inicio: '2030-01-08T04:00:00Z', fim: '2030-01-08T05:00:00Z' },
  ]);
});
test('fuso com diferença de 45 minutos não é arredondado', () => {
  expect(inicios({ ...base, fuso: 'Asia/Kathmandu' })[0]).toBe('2030-01-07T03:15:00Z');
});
test('avanço do relógio omite horas inexistentes e conta duração real', () => {
  expect(calcular({ ...base, fuso: 'America/New_York', dataInicialLocal: '2026-03-08',
    agoraUTC: '2026-01-01T00:00:00Z', duracaoServicoMin: 60, passoMin: 60,
    funcionamento: [{ diaSemana: 0, abre: '00:00', fecha: '04:00', terminaDiaSeguinte: false }],
  })).toEqual([
    { inicio: '2026-03-08T05:00:00Z', fim: '2026-03-08T06:00:00Z' },
    { inicio: '2026-03-08T06:00:00Z', fim: '2026-03-08T07:00:00Z' },
    { inicio: '2026-03-08T07:00:00Z', fim: '2026-03-08T08:00:00Z' },
  ]);
});
test('retorno do relógio preserva as duas ocorrências de 01h como instantes distintos', () => {
  expect(inicios({ ...base, fuso: 'America/New_York', dataInicialLocal: '2026-11-01',
    agoraUTC: '2026-01-01T00:00:00Z', duracaoServicoMin: 60, passoMin: 60,
    funcionamento: [{ diaSemana: 0, abre: '00:00', fecha: '03:00', terminaDiaSeguinte: false }],
  })).toEqual(['2026-11-01T04:00:00Z', '2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z', '2026-11-01T07:00:00Z']);
});
test.each([
  ['2026-03-08', '02:30'], ['2026-11-01', '01:30'],
])('abertura ambígua ou inexistente em %s gera erro explícito', (dataInicialLocal, abre) => {
  expect(() => calcular({ ...base, fuso: 'America/New_York', dataInicialLocal,
    funcionamento: [{ diaSemana: 0, abre, fecha: '04:00', terminaDiaSeguinte: false }],
  })).toThrow(RangeError);
});
test('aceita o formato de hora retornado pelo PostgreSQL', () => {
  expect(calcular({ ...base, funcionamento: [{ ...expediente, abre: '09:00:00', fecha: '11:00:00' }] })).toEqual(calcular(base));
});
test('não modifica entradas congeladas, mesmo com ocupações fora de ordem', () => {
  const ocupacoes = Object.freeze([Object.freeze(faixa('13:00', '13:30')), Object.freeze(faixa('12:30', '13:15'))]);
  const entrada = Object.freeze({ ...base, funcionamento: Object.freeze([Object.freeze({ ...expediente })]), bloqueios: ocupacoes });
  expect(calcular(entrada)).toEqual([faixa('12:00', '12:30'), faixa('13:30', '14:00')]);
  expect(ocupacoes[0].inicio).toBe(utc('13:00'));
});

describe('rejeita entradas inválidas', () => {
  test.each<Partial<EntradaHorariosLivres>>([
    { quantidadeDias: 0 }, { quantidadeDias: 15 }, { quantidadeDias: 1.5 },
    { duracaoServicoMin: 0 }, { passoMin: 0 }, { passoMin: NaN },
    { dataInicialLocal: '2030-02-30' }, { dataInicialLocal: '07/01/2030' },
    { fuso: 'Fuso/Inexistente' }, { fuso: '-03:00' }, { agoraUTC: '2030-01-07T12:00:00' },
    { funcionamento: [{ ...expediente, diaSemana: 7 }] },
    { funcionamento: [{ ...expediente, abre: '25:00' }] },
    { funcionamento: [{ ...expediente, fecha: '08:00' }] },
    { funcionamento: [{ ...expediente, terminaDiaSeguinte: true }] },
    { bloqueios: [faixa('13:00', '12:00')] },
    { agendamentosOcupados: [faixa('12:00', '12:00')] },
  ])('%j', (alteracao) => expect(() => calcular({ ...base, ...alteracao })).toThrow(RangeError));
});
