import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FormularioEntrar } from '../components/formulario-entrar';
import { entrarNoPainel } from '../painel/acoes';
import { sessaoAtual } from '../painel/sessao';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agendaki · Entrar' };

export default async function Pagina() {
  if (await sessaoAtual()) redirect('/painel');
  return <div className="site">
    <header className="topo"><a className="marca" href="/">agendaki<span aria-hidden="true">✳</span></a><span className="topo-texto">Painel do negócio</span></header>
    <main className="estado">
      <p className="sobretitulo">ÁREA DO DONO</p>
      <h1>Entre para ver sua agenda.</h1>
      <p className="descricao">Use o email e a senha que você recebeu ao contratar.</p>
      <FormularioEntrar acao={entrarNoPainel} />
    </main>
  </div>;
}
