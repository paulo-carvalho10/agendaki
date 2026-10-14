import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { enderecoDoSite, enviadorDeEmail } from '../../src/auth/email.js';
import { FormularioEsqueci } from '../components/formulario-esqueci';
import { pedirLinkAcao } from '../painel/acoes';
import { sessaoAtual } from '../painel/sessao';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agendaki · Esqueci minha senha' };

export default async function Pagina() {
  if (await sessaoAtual()) redirect('/painel/configuracoes');
  const porEmail = Boolean(enviadorDeEmail() && enderecoDoSite());
  return <div className="site">
    <header className="topo"><a className="marca" href="/entrar">agendaki<span aria-hidden="true">✳</span></a><span className="topo-texto">Painel do negócio</span></header>
    <main className="estado">
      <p className="sobretitulo">ESQUECI MINHA SENHA</p>
      <h1>Vamos criar uma senha nova.</h1>
      {porEmail ? <>
        <p className="descricao">Digite o email que você usa para entrar no painel. Mandamos para ele um link para você escolher a senha nova.</p>
        <FormularioEsqueci acao={pedirLinkAcao} />
      </> : <>
        <p className="descricao">Peça um link de redefinição a quem cuida do seu Agendaki. Com ele você escolhe uma senha nova na hora, sem ninguém ficar sabendo qual é.</p>
        <a className="botao" href="/entrar">Voltar para a tela de entrada</a>
      </>}
    </main>
  </div>;
}
