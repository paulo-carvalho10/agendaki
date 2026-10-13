'use server';
import { redirect } from 'next/navigation';
import { bancoServidor } from '../src/db/server.js';
import { reservarHorario } from '../src/agenda/reservar.js';
import { cancelarPorToken } from '../src/agenda/cancelar.js';
import type { PedidoReserva, ResultadoReserva } from '../src/agenda/pedido-reserva.js';

/** Chamada pelo formulário da página pública. Toda a validação acontece no servidor. */
export async function reservar(pedido: PedidoReserva): Promise<ResultadoReserva> {
  return reservarHorario(bancoServidor(), pedido);
}

/** Cancela e volta para a mesma página, que passa a mostrar a nova situação. */
export async function cancelar(token: string) {
  await cancelarPorToken(bancoServidor(), token);
  redirect(/^[A-Za-z0-9_-]{43}$/.test(token) ? `/cancelar/${token}` : '/');
}
