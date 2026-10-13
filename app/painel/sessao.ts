import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { bancoServidor } from '../../src/db/server.js';
import { COOKIE_SESSAO, obterSessao } from '../../src/auth/sessao.js';

/** Sessão do dono a partir do cookie, ou null. */
export async function sessaoAtual() {
  const cookie = (await cookies()).get(COOKIE_SESSAO)?.value;
  return obterSessao(bancoServidor(), cookie);
}

/** Usada por toda página e ação do painel: sem sessão válida, volta para o login. */
export async function exigirSessao() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect('/entrar');
  return sessao;
}
