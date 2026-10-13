import { createHash, timingSafeEqual } from 'node:crypto';
import { bancoServidor } from '../../../src/db/server.js';
import { seedDemo } from '../../../src/db/seed.js';

export const dynamic = 'force-dynamic';

const resumo = (texto: string) => createHash('sha256').update(texto).digest();

/**
 * Renova a barbearia de demonstração: apaga os agendamentos, inclusive o que
 * visitantes digitaram, e recria os de exemplo nos próximos dias. A Vercel
 * chama este endereço uma vez por dia (vercel.json) e envia CRON_SECRET no
 * cabeçalho Authorization. Outros negócios do banco não são tocados.
 */
export async function GET(pedido: Request) {
  const segredo = process.env.CRON_SECRET;
  const senha = process.env.DEMO_OWNER_PASSWORD;
  if (!segredo || !senha) return Response.json({ ok: false, motivo: 'Demonstração não configurada neste ambiente.' }, { status: 503 });
  const recebido = pedido.headers.get('authorization') ?? '';
  if (!timingSafeEqual(resumo(recebido), resumo(`Bearer ${segredo}`))) return Response.json({ ok: false }, { status: 401 });
  const resultado = await seedDemo(bancoServidor(), senha);
  // Os links de cancelamento dos exemplos não saem daqui.
  return Response.json({ ok: true, servicos: resultado.servicos, agendamentos: resultado.agendamentos, bloqueios: resultado.bloqueios });
}
