'use client';
import { useActionState, useState } from 'react';
import type { EstadoLogin } from '../painel/acoes';

export function FormularioEntrar({ acao }: { acao: (anterior: EstadoLogin, formulario: FormData) => Promise<EstadoLogin> }) {
  const [estado, enviar, enviando] = useActionState(acao, { erro: null });
  // O React limpa o formulário depois de cada envio. O email fica guardado aqui
  // para o dono não ter que digitar de novo quando erra a senha.
  const [email, setEmail] = useState('');
  return <form className="dados entrar" action={enviar}>
    <label className="campo"><span>Email</span><input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" maxLength={200} required /></label>
    <label className="campo"><span>Senha</span><input name="senha" type="password" autoComplete="current-password" maxLength={200} required /></label>
    {estado.erro && <p className="erro" role="alert">{estado.erro}</p>}
    <button className="botao confirmar" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
  </form>;
}
