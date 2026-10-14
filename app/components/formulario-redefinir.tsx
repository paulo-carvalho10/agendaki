'use client';
import { useActionState } from 'react';
import type { EstadoRedefinicao } from '../painel/acoes';

export function FormularioRedefinir({ acao, email }: { acao: (anterior: EstadoRedefinicao, formulario: FormData) => Promise<EstadoRedefinicao>; email: string }) {
  const [estado, enviar, enviando] = useActionState(acao, { erro: null });
  return <form className="dados entrar" action={enviar}>
    {/* Ajuda o gerenciador de senhas do navegador a saber de quem é a senha. */}
    <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
    <label className="campo"><span>Senha nova</span><input name="nova" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /></label>
    <label className="campo"><span>Repita a senha nova</span><input name="repetir" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /></label>
    <p className="consulta">Pelo menos 12 caracteres. Uma frase curta funciona bem e é fácil de lembrar.</p>
    {estado.erro && <p className="erro" role="alert">{estado.erro}</p>}
    <button className="botao confirmar" type="submit" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar senha nova'}</button>
  </form>;
}
