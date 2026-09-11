import { calcularHorariosLivres } from '../src/agenda/horarios-livres.js';

// Exemplo fixo e reproduzível, sem depender de banco ou relógio do computador.
const horarios = calcularHorariosLivres({
  fuso: 'America/Sao_Paulo', dataInicialLocal: '2030-01-07', quantidadeDias: 1,
  duracaoServicoMin: 30, passoMin: 30, agoraUTC: '2030-01-07T11:00:00Z',
  funcionamento: [{ diaSemana: 1, abre: '09:00', fecha: '18:00', terminaDiaSeguinte: false }],
  bloqueios: [{ inicio: '2030-01-07T15:00:00Z', fim: '2030-01-07T16:00:00Z' }],
  agendamentosOcupados: [
    { inicio: '2030-01-07T13:00:00Z', fim: '2030-01-07T13:30:00Z' },
    { inicio: '2030-01-07T18:00:00Z', fim: '2030-01-07T19:00:00Z' },
  ],
});
const formatar = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
console.log('7 de janeiro de 2030 · America/Sao_Paulo · serviço de 30 minutos');
console.table(horarios.map(({ inicio, fim }) => ({
  inicioLocal: formatar.format(new Date(inicio)), fimLocal: formatar.format(new Date(fim)), inicioUTC: inicio,
})));
console.log(`${horarios.length} horários livres. Consultar disponibilidade não confirma uma reserva.`);
