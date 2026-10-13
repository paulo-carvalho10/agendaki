import { createRoot } from 'react-dom/client';
import { AgendaPublica } from '../app/components/agenda-publica.js';
import { criarDadosDemo } from '../src/agenda/dados-demo.js';
import { recusar, validarPedido, type PedidoReserva, type ResultadoReserva } from '../src/agenda/pedido-reserva.js';

const dados = criarDadosDemo();

/** Sem servidor nem banco: confere o pedido com as mesmas regras e devolve uma confirmação fictícia. */
async function reservarNaDemo(pedido: PedidoReserva): Promise<ResultadoReserva> {
  const valido = validarPedido(pedido, { servicoIdLivre: true });
  if (!valido) return recusar('dados_invalidos');
  const servico = dados.servicos.find((s) => s.id === pedido.servicoId);
  if (!servico) return recusar('servico_indisponivel');
  if (valido.profissionalId && !dados.profissionais.some((p) => p.id === valido.profissionalId)) return recusar('profissional_indisponivel');
  const horario = servico.horarios.find((h) => h.inicio === pedido.inicio && (!valido.profissionalId || h.profissionais.includes(valido.profissionalId)));
  if (!horario) return recusar('horario_indisponivel');
  // Sem preferência, fica com o primeiro que estiver livre.
  const profissional = dados.profissionais.find((p) => p.id === (valido.profissionalId ?? horario.profissionais[0]))!;
  await new Promise((ok) => setTimeout(ok, 600));
  return {
    ok: true, tokenCancelamento: 'demonstracao', inicio: horario.inicio, fim: horario.fim,
    cliente: { nome: valido.nome },
    servico: { nome: servico.nome, duracaoMin: servico.duracaoMin, precoCentavos: servico.precoCentavos },
    profissional, variosProfissionais: dados.profissionais.length > 1,
    negocio: { nome: dados.negocio.nome, telefone: '', fuso: dados.negocio.fuso, demonstracao: true },
  };
}

createRoot(document.getElementById('root')!).render(
  <AgendaPublica dados={dados} homeHref="/agendaki/" aoReservar={reservarNaDemo} rotaCancelamento={null} hrefPainelDemo="/agendaki/painel/" />,
);
