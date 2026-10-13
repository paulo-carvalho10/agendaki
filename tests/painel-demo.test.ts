import { expect, test } from 'vitest';
import { agendaDoDiaDemo, agendarDemo, bloquearDemo, criarEstadoDemo, desbloquearDemo, mudarStatusDemo, registrarLembreteDemo } from '../src/painel/demo.js';

// Quarta-feira, 15h em São Paulo: parte dos clientes de hoje já passou.
const AGORA = new Date('2030-01-09T18:00:00Z');

test('a demonstração nasce com clientes hoje, lembretes do próximo dia útil e nenhum dado real', () => {
  const estado = criarEstadoDemo(AGORA);
  const hoje = agendaDoDiaDemo(estado, undefined, AGORA);
  expect(hoje).toMatchObject({ hoje: '2030-01-09', dia: '2030-01-09', podeAgendar: true, negocio: { demonstracao: true, telefone: '' } });
  expect(hoje.agendamentos.map((a) => [a.clienteNome, a.status])).toEqual([
    ['Marcos Andrade', 'atendido'], ['Rafael Nunes', 'confirmado'], ['João Pedro Lima', 'confirmado'], ['Gustavo Reis', 'confirmado'],
  ]);
  expect(hoje.resumo).toEqual({ confirmados: 3, atendidos: 1, faltas: 0, cancelados: 0, previstoCentavos: 17500, realizadoCentavos: 4000 });
  expect(hoje.bloqueios.map((b) => b.motivo)).toEqual(['Almoço']);
  expect(hoje.lembretes.dia).toBe('2030-01-10');
  expect(hoje.lembretes.agendamentos.map((a) => a.clienteNome)).toEqual(['Lucas Martins', 'André Souza', 'Felipe Castro']);
  // Telefones de exemplo: DDD e prefixo que não pertencem a ninguém.
  expect(estado.agendamentos.every((a) => /^349000000\d\d$/.test(a.clienteTelefone))).toBe(true);
  // O horário das 16h30 está ocupado e o almoço bloqueado: nenhum dos dois aparece como livre.
  const livres = hoje.servicos.find((s) => s.nome === 'Corte')!.horarios.map((h) => h.inicio);
  expect(livres).toEqual(['2030-01-09T18:00:00Z', '2030-01-09T18:30:00Z', '2030-01-09T19:00:00Z', '2030-01-09T20:00:00Z', '2030-01-09T20:30:00Z']);
});

test('no domingo a barbearia está fechada e os lembretes são os de segunda', () => {
  const domingo = new Date('2030-01-06T15:00:00Z');
  const agenda = agendaDoDiaDemo(criarEstadoDemo(domingo), undefined, domingo);
  expect(agenda.agendamentos).toEqual([]);
  expect(agenda.lembretes.dia).toBe('2030-01-07');
  expect(agenda.servicos.every((s) => s.horarios.length === 0)).toBe(true);
});

test('segue as mesmas regras de situação do painel de verdade', () => {
  let estado = criarEstadoDemo(AGORA);
  const id = (nome: string) => estado.agendamentos.find((a) => a.clienteNome === nome)!.id;
  const aplicar = (mudanca: { estado: typeof estado; resultado: { ok: boolean } }) => { estado = mudanca.estado; return mudanca.resultado.ok; };

  // Gustavo é às 16h30 e ainda não começou; Rafael, das 10h30, já.
  expect(aplicar(mudarStatusDemo(estado, id('Gustavo Reis'), 'atendido', AGORA))).toBe(false);
  expect(aplicar(mudarStatusDemo(estado, id('Rafael Nunes'), 'faltou', AGORA))).toBe(true);
  expect(aplicar(mudarStatusDemo(estado, id('Rafael Nunes'), 'cancelado', AGORA))).toBe(false);
  expect(aplicar(mudarStatusDemo(estado, id('Rafael Nunes'), 'confirmado', AGORA))).toBe(true);
  expect(aplicar(mudarStatusDemo(estado, id('Gustavo Reis'), 'cancelado', AGORA))).toBe(true);
  expect(aplicar(mudarStatusDemo(estado, id('Gustavo Reis'), 'confirmado', AGORA))).toBe(false);
  expect(aplicar(mudarStatusDemo(estado, 'nao-existe', 'cancelado', AGORA))).toBe(false);
  const agenda = agendaDoDiaDemo(estado, undefined, AGORA);
  expect(agenda.resumo).toMatchObject({ confirmados: 2, cancelados: 1 });
  // A vaga cancelada das 16h30 volta a aparecer.
  expect(agenda.servicos.find((s) => s.nome === 'Corte')!.horarios.map((h) => h.inicio)).toContain('2030-01-09T19:30:00Z');

  expect(aplicar(registrarLembreteDemo(estado, id('Lucas Martins'), AGORA))).toBe(true);
  expect(aplicar(registrarLembreteDemo(estado, id('Gustavo Reis'), AGORA))).toBe(false);
  expect(agendaDoDiaDemo(estado, undefined, AGORA).lembretes.agendamentos[0].lembreteEm).toBe('2030-01-09T18:00:00.000Z');
});

test('agenda e bloqueia sem deixar dois compromissos no mesmo intervalo', () => {
  let estado = criarEstadoDemo(AGORA);
  const marcar = (inicio: string, nome = 'Cliente novo', telefone = '') => {
    const mudanca = agendarDemo(estado, { servicoId: 'demo-corte', inicio, nome, telefone }, AGORA);
    estado = mudanca.estado; return mudanca.resultado;
  };
  expect(marcar('2030-01-09T18:00:00Z')).toMatchObject({ ok: true, cliente: { nome: 'Cliente novo' } });
  expect(marcar('2030-01-09T18:00:00Z')).toMatchObject({ ok: false, motivo: 'horario_indisponivel' });
  expect(marcar('2030-01-09T19:30:00Z')).toMatchObject({ ok: false, motivo: 'horario_indisponivel' }); // Gustavo
  expect(marcar('2030-01-09T15:00:00Z')).toMatchObject({ ok: false, motivo: 'horario_indisponivel' }); // já passou
  expect(marcar('2030-01-09T18:30:00Z', 'A')).toMatchObject({ ok: false, motivo: 'dados_invalidos' });
  expect(marcar('2030-01-09T18:30:00Z', 'Outro', '123')).toMatchObject({ ok: false, motivo: 'dados_invalidos' });

  const bloquear = (das: string, ate: string, dia = '2030-01-10') => { const m = bloquearDemo(estado, { dia, das, ate, motivo: ' Dentista ' }); estado = m.estado; return m.resultado; };
  expect(bloquear('09:00', '10:00')).toMatchObject({ ok: false }); // Lucas, às 9h30
  expect(bloquear('17:00', '16:00')).toMatchObject({ ok: false });
  expect(bloquear('16:00', '17:00', '2030-02-30')).toMatchObject({ ok: false });
  expect(bloquear('16:00', '17:00')).toEqual({ ok: true });
  const amanha = agendaDoDiaDemo(estado, '2030-01-10', AGORA);
  expect(amanha.bloqueios.map((b) => b.motivo)).toEqual(['Almoço', 'Dentista']);
  expect(amanha.servicos.find((s) => s.nome === 'Corte')!.horarios.map((h) => h.inicio)).not.toContain('2030-01-10T19:00:00Z');

  const dentista = amanha.bloqueios.find((b) => b.motivo === 'Dentista')!;
  const removido = desbloquearDemo(estado, dentista.id); estado = removido.estado;
  expect(removido.resultado).toEqual({ ok: true });
  expect(desbloquearDemo(estado, dentista.id).resultado).toMatchObject({ ok: false });
  expect(agendaDoDiaDemo(estado, '2030-01-10', AGORA).bloqueios.map((b) => b.motivo)).toEqual(['Almoço']);
});
