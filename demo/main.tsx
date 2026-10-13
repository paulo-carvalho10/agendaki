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
  const horario = servico.horarios.find((h) => h.inicio === pedido.inicio);
  if (!horario) return recusar('horario_indisponivel');
  await new Promise((ok) => setTimeout(ok, 600));
  return {
    ok: true, tokenCancelamento: 'demonstracao', inicio: horario.inicio, fim: horario.fim,
    cliente: { nome: valido.nome },
    servico: { nome: servico.nome, duracaoMin: servico.duracaoMin, precoCentavos: servico.precoCentavos },
    negocio: { nome: dados.negocio.nome, telefone: '', fuso: dados.negocio.fuso, demonstracao: true },
  };
}

createRoot(document.getElementById('root')!).render(
  <AgendaPublica dados={dados} homeHref="/agendaki/" aoReservar={reservarNaDemo} rotaCancelamento={null} />,
);
