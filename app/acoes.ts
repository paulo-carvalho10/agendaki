'use server';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { bancoServidor } from '../src/db/server.js';
import { reservarHorario } from '../src/agenda/reservar.js';
import { cancelarPorToken } from '../src/agenda/cancelar.js';
import type { PedidoReserva, ResultadoReserva } from '../src/agenda/pedido-reserva.js';
import { avisarCancelamento, avisarReservaNova } from '../src/avisos/reservas.js';
import { enviadorDePush } from '../src/avisos/web-push.js';

/** Chamada pelo formulário da página pública. Toda a validação acontece no servidor. */
export async function reservar(pedido: PedidoReserva): Promise<ResultadoReserva> {
  const resultado = await reservarHorario(bancoServidor(), pedido);
  const enviar = resultado.ok ? enviadorDePush() : null;
  // Depois da resposta: o cliente não espera o aviso chegar ao dono, e uma falha no aviso não desfaz a reserva.
  if (resultado.ok && enviar) after(() => avisarReservaNova(bancoServidor(), pedido.slug, resultado, enviar).catch(() => {}));
  return resultado;
}

/** Cancela e volta para a mesma página, que passa a mostrar a nova situação. */
export async function cancelar(token: string) {
  const resultado = await cancelarPorToken(bancoServidor(), token);
  const enviar = resultado.ok ? enviadorDePush() : null;
  if (enviar) after(() => avisarCancelamento(bancoServidor(), token, enviar).catch(() => {}));
  redirect(/^[A-Za-z0-9_-]{43}$/.test(token) ? `/cancelar/${token}` : '/');
}
