import { describe, expect, it } from 'vitest';
import { criarDadosDemo } from '../src/agenda/dados-demo.js';

describe('demonstração pública sempre atualizada', () => {
  it('renova as datas, preserva o fuso e não oferece horários passados', () => {
    for (const agora of ['2026-09-12T23:00:00Z', '2030-12-31T02:00:00Z']) {
      const dados = criarDadosDemo(new Date(agora));
      expect(dados.dias).toHaveLength(14);
      expect(dados.servicos).toHaveLength(3);
      for (const servico of dados.servicos) {
        expect(servico.horarios.length).toBeGreaterThan(0);
        expect(servico.horarios.every(h => Date.parse(h.inicio) >= Date.parse(agora))).toBe(true);
      }
    }
    expect(criarDadosDemo(new Date('2030-12-31T02:00:00Z')).dias[0]).toBe('2030-12-30');
  });
  it('mantém domingos e almoço indisponíveis', () => {
    const dados = criarDadosDemo(new Date('2026-09-12T08:00:00Z'));
    for (const s of dados.servicos) {
      expect(s.horarios.some(h => h.dataLocal === '2026-09-13')).toBe(false);
      expect(s.horarios.some(h => h.inicio.includes('T15:00:00'))).toBe(false);
    }
  });
});
