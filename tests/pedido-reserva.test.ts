import { expect, test } from 'vitest';
import { formatarTelefone, normalizarNome, normalizarTelefone, reais, validarPedido } from '../src/agenda/pedido-reserva.js';

const base = { slug: 'barbearia-demo', servicoId: '0b1f6c1e-6a52-4a0e-9a54-2f2d1c7d9e10', inicio: '2030-01-07T12:00:00.000Z', nome: 'Ana', telefone: '34999991234' };

test('normaliza telefones brasileiros com DDD', () => {
  expect(normalizarTelefone('(34) 99999-1234')).toBe('34999991234');
  expect(normalizarTelefone('+55 34 99999 1234')).toBe('34999991234');
  expect(normalizarTelefone('5534999991234')).toBe('34999991234');
  expect(normalizarTelefone('(34) 3333-4444')).toBe('3433334444');
  expect(normalizarTelefone('55 34 3333-4444')).toBe('3433334444');
});

test('recusa telefones sem DDD, com dígitos a mais ou a menos e sequências repetidas', () => {
  for (const ruim of ['99999-1234', '349999912345', '(34) 89999-1234', '(09) 99999-1234', '11111111111', '', 'abc']) {
    expect(normalizarTelefone(ruim), ruim).toBeNull();
  }
  // Dez dígitos é um fixo válido; onze precisa começar com 9 depois do DDD.
  expect(normalizarTelefone('3499999123')).toBe('3499999123');
});

test('formata para leitura', () => {
  expect(formatarTelefone('34999991234')).toBe('(34) 99999-1234');
  expect(formatarTelefone('3433334444')).toBe('(34) 3333-4444');
});

test('limpa o nome e valida o pedido inteiro', () => {
  expect(normalizarNome('  Ana   Maria\tSouza ')).toBe('Ana Maria Souza');
  const valido = validarPedido({ ...base, nome: ' José  da Silva ', telefone: '(34) 99999-1234' });
  expect(valido).toEqual({ slug: base.slug, servicoId: base.servicoId, inicio: new Date(base.inicio), nome: 'José da Silva', telefone: '34999991234' });
});

test('recusa cada campo fora do formato', () => {
  for (const extra of [{ nome: 'A' }, { nome: 'x'.repeat(81) }, { nome: '!!!' }, { telefone: '123' }, { inicio: '2030-01-07 09:00' },
    { inicio: '2030-01-07T09:00:00-03:00' }, { inicio: '2030-13-40T12:00:00Z' }, { servicoId: 'demo-corte' }, { slug: 'Com Espaço' }, { site: 'robô' }]) {
    expect(validarPedido({ ...base, ...extra }), JSON.stringify(extra)).toBeNull();
  }
  expect(validarPedido(null as never)).toBeNull();
  expect(validarPedido({ ...base, nome: 42 } as never)).toBeNull();
});

test('a demonstração estática aceita identificadores de serviço que não são UUID', () => {
  expect(validarPedido({ ...base, servicoId: 'demo-corte' }, { servicoIdLivre: true })).not.toBeNull();
  expect(validarPedido({ ...base, servicoId: '' }, { servicoIdLivre: true })).toBeNull();
});

test('mostra o preço sem centavos quando é redondo e com dois dígitos quando não é', () => {
  const texto = (valor: number) => reais.format(valor).replace(/\s/g, ' ');
  expect(texto(40)).toBe('R$ 40');
  expect(texto(25.5)).toBe('R$ 25,50');
  expect(texto(0)).toBe('R$ 0');
  expect(texto(1250)).toBe('R$ 1.250');
  expect(texto(1250.9)).toBe('R$ 1.250,90');
});
