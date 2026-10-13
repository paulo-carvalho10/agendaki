import type { Metadata } from 'next';
import { bancoServidor } from '../../../src/db/server.js';
import { limiteCancelamento, obterAgendamentoPorToken } from '../../../src/agenda/cancelar.js';
import { antecedenciaCancelamentoTexto, formatarTelefone, normalizarTelefone } from '../../../src/agenda/pedido-reserva.js';
import { cancelar } from '../../acoes';

export const dynamic = 'force-dynamic';
// O endereço carrega o token: ele não deve vazar no cabeçalho Referer de nenhum link.
export const metadata: Metadata = { title: 'Agendaki · Seu agendamento', referrer: 'no-referrer' };

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default async function Pagina({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const agendamento = await obterAgendamentoPorToken(bancoServidor(), token);
  const topo = <header className="topo"><a className="marca" href={agendamento ? `/${agendamento.negocioSlug}` : '/'}>agendaki<span aria-hidden="true">✳</span></a><span className="topo-texto">Um tempo só seu.</span></header>;

  if (!agendamento) {
    return <div className="site">{topo}<main className="estado"><p className="sobretitulo">LINK NÃO ENCONTRADO</p><h1>Não achamos um agendamento com este link.</h1><p className="descricao">Confira se o endereço foi copiado inteiro. Se o horário já foi cancelado há muito tempo, o link pode não existir mais.</p></main></div>;
  }

  const agora = Date.now();
  const negocio = agendamento.negocioNome.replace(' — demonstração', '');
  const hora = (data: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: agendamento.fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(data);
  const quando = `${new Intl.DateTimeFormat('pt-BR', { timeZone: agendamento.fuso, weekday: 'long', day: 'numeric', month: 'long' }).format(agendamento.inicio)}, às ${hora(agendamento.inicio)}`;
  const detalhes = <dl className="detalhes">
    <div><dt>Serviço</dt><dd>{agendamento.servicoNome} · {agendamento.duracaoMin} min</dd></div>
    <div><dt>Quando</dt><dd>{quando}</dd></div>
    <div><dt>Onde</dt><dd>{negocio}</dd></div>
    <div><dt>Valor</dt><dd>{reais.format(agendamento.precoCentavos / 100)} · pago no local</dd></div>
  </dl>;
  const novo = <a className="botao" href={`/${agendamento.negocioSlug}`}>Marcar novo horário</a>;
  const primeiroNome = agendamento.clienteNome.split(' ')[0];

  if (agendamento.status === 'cancelado') {
    return <div className="site">{topo}<main className="estado confirmacao"><p className="sobretitulo">AGENDAMENTO CANCELADO</p><h1>Pronto, {primeiroNome}. O horário foi cancelado.</h1><p className="descricao">Ele já voltou a ficar livre para outra pessoa. Quando quiser, é só marcar de novo.</p>{detalhes}{novo}</main></div>;
  }
  if (agendamento.status !== 'confirmado' || agendamento.inicio.getTime() <= agora) {
    return <div className="site">{topo}<main className="estado confirmacao"><p className="sobretitulo">AGENDAMENTO ENCERRADO</p><h1>Este horário já passou.</h1><p className="descricao">Não há mais o que cancelar. Para um próximo atendimento, escolha um novo horário.</p>{detalhes}{novo}</main></div>;
  }
  if (limiteCancelamento(agendamento.inicio).getTime() < agora) {
    // Falta menos que a antecedência mínima: o negócio não teria tempo de ocupar a vaga.
    const telefone = agendamento.demonstracao ? null : normalizarTelefone(agendamento.negocioTelefone);
    const mensagem = `Olá! Tenho ${agendamento.servicoNome.toLowerCase()} marcado para hoje às ${hora(agendamento.inicio)}, em nome de ${agendamento.clienteNome}, e não vou conseguir ir.`;
    return <div className="site">{topo}<main className="estado confirmacao">
      <p className="sobretitulo">SEU AGENDAMENTO</p>
      <h1>{primeiroNome}, seu horário é daqui a pouco.</h1>
      {detalhes}
      <div className="bloco">
        <h3>O prazo para cancelar por aqui já terminou</h3>
        <p>O cancelamento pelo link vale até {antecedenciaCancelamentoTexto} antes do horário, para dar tempo de outra pessoa ocupar a vaga. Se não puder vir, avise o quanto antes.</p>
        {telefone ? <a className="botao" href={`https://wa.me/55${telefone}?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noopener noreferrer">Avisar {formatarTelefone(telefone)} pelo WhatsApp</a>
          : <p className="mensagem">{mensagem}</p>}
      </div>
    </main></div>;
  }
  return <div className="site">{topo}<main className="estado confirmacao">
    <p className="sobretitulo">SEU AGENDAMENTO</p>
    <h1>{primeiroNome}, seu horário está confirmado.</h1>
    {detalhes}
    <form action={cancelar.bind(null, token)} className="bloco">
      <h3>Não vai poder vir?</h3>
      <p>Você pode cancelar por aqui até as {hora(limiteCancelamento(agendamento.inicio))}, {antecedenciaCancelamentoTexto} antes do horário. A vaga volta a ficar livre na mesma hora. Para remarcar, cancele e escolha um novo horário.</p>
      <button className="botao perigo" type="submit">Cancelar este agendamento</button>
      <a className="botao secundario" href={`/${agendamento.negocioSlug}`}>Manter e voltar</a>
    </form>
  </main></div>;
}
