import { Temporal } from '@js-temporal/polyfill';
import { horariosLivresPorProfissional, type Ocupacao } from './disponibilidade.js';
import type { PaginaPublica } from './pagina-publica.js';

/** Same availability engine as PostgreSQL version; all inputs are fictitious. */
export function criarDadosDemo(agora = new Date()): PaginaPublica {
  const fuso = 'America/Sao_Paulo';
  const hoje = Temporal.Instant.from(agora.toISOString()).toZonedDateTimeISO(fuso).toPlainDate();
  const datas = Array.from({ length: 14 }, (_, i) => hoje.add({ days: i }));
  const funcionamento = [1, 2, 3, 4, 5, 6].map(diaSemana => ({
    diaSemana, abre: '09:00', fecha: '18:00', terminaDiaSeguinte: false,
  }));
  const intervalo = (data: Temporal.PlainDate, inicio: string, fim: string) => ({
    inicio: data.toPlainDateTime(inicio).toZonedDateTime(fuso).toInstant().toString(),
    fim: data.toPlainDateTime(fim).toZonedDateTime(fuso).toInstant().toString(),
  });
  // Dois barbeiros: o almoço fecha a agenda dos dois; os clientes marcados são de cada um.
  const profissionais = [{ id: 'demo-caio', nome: 'Caio' }, { id: 'demo-diego', nome: 'Diego' }];
  const ocupacao: Ocupacao = {
    profissionais, funcionamento,
    bloqueios: datas.map(d => ({ ...intervalo(d, '12:00', '13:00'), profissionalId: null })),
    ocupados: datas.filter(d => d.dayOfWeek !== 7).slice(0, 3).flatMap(d => [
      { ...intervalo(d, '10:00', '10:30'), profissionalId: 'demo-caio' },
      { ...intervalo(d, '15:00', '16:00'), profissionalId: 'demo-caio' },
      { ...intervalo(d, '10:00', '11:00'), profissionalId: 'demo-diego' },
      { ...intervalo(d, '16:30', '17:00'), profissionalId: 'demo-diego' },
    ]),
  };
  const servicos = [
    { id: 'demo-corte', nome: 'Corte', duracaoMin: 30, precoCentavos: 4000 },
    { id: 'demo-barba', nome: 'Barba', duracaoMin: 30, precoCentavos: 3000 },
    { id: 'demo-combo', nome: 'Corte + barba', duracaoMin: 60, precoCentavos: 6500 },
  ];
  return {
    negocio: { id: 'demo-horizonte', slug: 'barbearia-demo', nome: 'Barbearia Horizonte', fuso, demonstracao: true },
    funcionamento, dias: datas.map(d => d.toString()), atualizadoEm: agora.toISOString(), profissionais,
    servicos: servicos.map(s => ({ ...s, horarios: horariosLivresPorProfissional(ocupacao, {
      fuso, dataInicialLocal: hoje.toString(), quantidadeDias: 14, duracaoMin: s.duracaoMin, agora,
    }).map(h => ({ ...h, dataLocal: Temporal.Instant.from(h.inicio).toZonedDateTimeISO(fuso).toPlainDate().toString() })) })),
  };
}
