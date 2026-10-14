'use client';
import { useActionState } from 'react';
import type { EstadoEsqueci } from '../painel/acoes';

export function FormularioEsqueci({ acao }: { acao: (anterior: EstadoEsqueci, formulario: FormData) => Promise<EstadoEsqueci> }) {
  const [estado, enviar, enviando] = useActionState(acao, { email: null, erro: null });
  if (estado.email) {
    return <div className="bloco" role="status">
      <h3>Confira seu email</h3>
      <p>Se <strong>{estado.email}</strong> for o email de acesso de um painel, o link já está a caminho. Ele vale por 1 hora e só uma vez.</p>
      <p>Não chegou em alguns minutos? Olhe também a caixa de spam e as promoções. Se ainda assim não aparecer, peça de novo daqui a 2 minutos ou fale com o suporte.</p>
      <a className="botao secundario" href="/entrar">Voltar para a tela de entrada</a>
    </div>;
  }
  return <form className="dados entrar" action={enviar}>
    <label className="campo"><span>Email de acesso</span><input name="email" type="email" autoComplete="username" inputMode="email" maxLength={200} required /></label>
    {estado.erro && <p className="erro" role="alert">{estado.erro}</p>}
    <button className="botao confirmar" type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Mandar o link'}</button>
    <p className="consulta"><a className="link-demo" href="/entrar">Lembrei a senha</a></p>
  </form>;
}
