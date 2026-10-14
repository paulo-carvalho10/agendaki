import type { Metadata } from 'next';
import { bancoServidor } from '../../../src/db/server.js';
import { obterRedefinicao } from '../../../src/auth/senha.js';
import { FormularioRedefinir } from '../../components/formulario-redefinir';
import { redefinirSenhaAcao } from '../../painel/acoes';

export const dynamic = 'force-dynamic';
// O endereço carrega o token: ele não deve vazar no cabeçalho Referer de nenhum link.
export const metadata: Metadata = { title: 'Agendaki · Nova senha', referrer: 'no-referrer' };

export default async function Pagina({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pedido = await obterRedefinicao(bancoServidor(), token);
  const topo = <header className="topo"><a className="marca" href="/entrar">agendaki<span aria-hidden="true">✳</span></a><span className="topo-texto">Painel do negócio</span></header>;
  if (!pedido) {
    return <div className="site">{topo}<main className="estado">
      <p className="sobretitulo">LINK SEM VALIDADE</p>
      <h1>Este link não vale mais.</h1>
      <p className="descricao">O link de redefinição vale por uma hora e só pode ser usado uma vez. Peça um novo em “Esqueci minha senha”, na tela de entrada.</p>
      <a className="botao" href="/esqueci">Pedir um link novo</a>
    </main></div>;
  }
  const ate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(pedido.expiraEm);
  return <div className="site">{topo}<main className="estado">
    <p className="sobretitulo">NOVA SENHA</p>
    <h1>Escolha uma senha nova.</h1>
    <p className="descricao">Para o painel de {pedido.negocioNome}, acesso de {pedido.email}. Este link vale até as {ate} e só uma vez.</p>
    <FormularioRedefinir acao={redefinirSenhaAcao.bind(null, token)} email={pedido.email} />
  </main></div>;
}
