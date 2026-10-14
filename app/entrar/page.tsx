import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FormularioEntrar } from '../components/formulario-entrar';
import { entrarNoPainel } from '../painel/acoes';
import { sessaoAtual } from '../painel/sessao';
import { normalizarTelefone } from '../../src/agenda/pedido-reserva.js';
import { enderecoDoSite, enviadorDeEmail } from '../../src/auth/email.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agendaki · Entrar' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ senha?: string | string[] }> }) {
  if (await sessaoAtual()) redirect('/painel');
  const { senha } = await searchParams;
  // Opcional: WhatsApp de quem dá suporte, para o dono pedir o link de redefinição.
  const suporte = normalizarTelefone(process.env.SUPORTE_WHATSAPP ?? '');
  const pedido = 'Olá! Esqueci a senha do painel do Agendaki e preciso de um link para criar uma nova.';
  // Sem servidor de email configurado, a recuperação continua pelo suporte.
  const porEmail = Boolean(enviadorDeEmail() && enderecoDoSite());
  return <div className="site">
    <header className="topo"><a className="marca" href="/">agendaki<span aria-hidden="true">✳</span></a><span className="topo-texto">Painel do negócio</span></header>
    <main className="estado">
      <p className="sobretitulo">ÁREA DO DONO</p>
      <h1>Entre para ver sua agenda.</h1>
      <p className="descricao">Use o email e a senha que você recebeu ao contratar.</p>
      {senha === 'ok' && <p className="sucesso" role="status">Senha alterada. Entre com a senha nova.</p>}
      <FormularioEntrar acao={entrarNoPainel} />
      <div className="bloco">
        <h3>Esqueceu a senha?</h3>
        {porEmail
          ? <><p>Mandamos para o seu email um link para você escolher uma senha nova.</p><a className="botao secundario" href="/esqueci">Esqueci minha senha</a></>
          : <p>Peça um link de redefinição a quem cuida do seu Agendaki. Com ele você escolhe uma senha nova na hora, sem ninguém ficar sabendo qual é.</p>}
        {suporte && <a className="botao secundario" href={`https://wa.me/55${suporte}?text=${encodeURIComponent(pedido)}`} target="_blank" rel="noopener noreferrer">Pedir pelo WhatsApp</a>}
      </div>
    </main>
  </div>;
}
