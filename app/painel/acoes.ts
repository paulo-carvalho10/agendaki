'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { bancoServidor } from '../../src/db/server.js';
import { COOKIE_SESSAO, entrar, sair } from '../../src/auth/sessao.js';
import { agendarPeloDono, criarBloqueio, mudarStatus, registrarLembrete, removerBloqueio,
  type PedidoBloqueio, type PedidoDoDono, type ResultadoPainel } from '../../src/painel/acoes.js';
import type { StatusAgendamento } from '../../src/painel/agenda.js';
import { definirProfissionalAtivo, definirServicoAtivo, salvarFuncionamento, salvarNegocio, salvarProfissional, salvarServico,
  type DadosProfissional, type DadosServico, type DiaAberto } from '../../src/painel/configuracao.js';
import type { ResultadoReserva } from '../../src/agenda/pedido-reserva.js';
import { exigirSessao } from './sessao';

export type EstadoLogin = { erro: string | null };

export async function entrarNoPainel(_anterior: EstadoLogin, formulario: FormData): Promise<EstadoLogin> {
  const resultado = await entrar(bancoServidor(), String(formulario.get('email') ?? ''), String(formulario.get('senha') ?? ''));
  if (!resultado.ok) {
    return { erro: resultado.motivo === 'bloqueado'
      ? 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.'
      : 'Email ou senha não conferem.' };
  }
  (await cookies()).set(COOKIE_SESSAO, resultado.token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires: resultado.expiraEm,
  });
  redirect('/painel');
}

export async function sairDoPainel() {
  const jarra = await cookies();
  await sair(bancoServidor(), jarra.get(COOKIE_SESSAO)?.value);
  jarra.delete(COOKIE_SESSAO);
  redirect('/entrar');
}

// Cada ação confere a sessão de novo e só mexe no negócio de quem está logado.

export async function mudarStatusAcao(agendamentoId: string, para: StatusAgendamento): Promise<ResultadoPainel> {
  const sessao = await exigirSessao();
  const resultado = await mudarStatus(bancoServidor(), sessao.negocioId, agendamentoId, para);
  revalidatePath('/painel');
  return resultado;
}

export async function registrarLembreteAcao(agendamentoId: string): Promise<ResultadoPainel> {
  const sessao = await exigirSessao();
  const resultado = await registrarLembrete(bancoServidor(), sessao.negocioId, agendamentoId);
  revalidatePath('/painel');
  return resultado;
}

export async function agendarAcao(pedido: PedidoDoDono): Promise<ResultadoReserva> {
  const sessao = await exigirSessao();
  const resultado = await agendarPeloDono(bancoServidor(), sessao.negocioId, pedido);
  revalidatePath('/painel');
  return resultado;
}

export async function bloquearAcao(pedido: PedidoBloqueio): Promise<ResultadoPainel> {
  const sessao = await exigirSessao();
  const resultado = await criarBloqueio(bancoServidor(), sessao.negocioId, pedido);
  revalidatePath('/painel');
  return resultado;
}

export async function desbloquearAcao(bloqueioId: string): Promise<ResultadoPainel> {
  const sessao = await exigirSessao();
  const resultado = await removerBloqueio(bancoServidor(), sessao.negocioId, bloqueioId);
  revalidatePath('/painel');
  return resultado;
}

// Configurações: mudam também o que a página pública oferece.

export async function salvarNegocioAcao(dados: { nome: string; telefone: string }): Promise<ResultadoPainel> {
  const sessao = await exigirSessao();
  const resultado = await salvarNegocio(bancoServidor(), sessao.negocioId, dados);
  revalidatePath('/painel', 'layout');
  return resultado;
}

export async function salvarServicoAcao(dados: DadosServico): Promise<ResultadoPainel> {
  const sessao = await exigirSessao();
  const resultado = await salvarServico(bancoServidor(), sessao.negocioId, dados);
  revalidatePath('/painel', 'layout');
  return resultado;
}

export async function definirServicoAtivoAcao(servicoId: string, ativo: boolean): Promise<ResultadoPainel> {
  const sessao = await exigirSessao();
  const resultado = await definirServicoAtivo(bancoServidor(), sessao.negocioId, servicoId, ativo);
  revalidatePath('/painel', 'layout');
  return resultado;
}

export async function salvarProfissionalAcao(dados: DadosProfissional): Promise<ResultadoPainel> {
  const sessao = await exigirSessao();
  const resultado = await salvarProfissional(bancoServidor(), sessao.negocioId, dados);
  revalidatePath('/painel', 'layout');
  return resultado;
}

export async function definirProfissionalAtivoAcao(profissionalId: string, ativo: boolean): Promise<ResultadoPainel> {
  const sessao = await exigirSessao();
  const resultado = await definirProfissionalAtivo(bancoServidor(), sessao.negocioId, profissionalId, ativo);
  revalidatePath('/painel', 'layout');
  return resultado;
}

export async function salvarFuncionamentoAcao(dias: DiaAberto[]): Promise<ResultadoPainel> {
  const sessao = await exigirSessao();
  const resultado = await salvarFuncionamento(bancoServidor(), sessao.negocioId, dias);
  revalidatePath('/painel', 'layout');
  return resultado;
}
