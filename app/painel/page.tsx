import type { Metadata } from 'next';
import { bancoServidor } from '../../src/db/server.js';
import { obterAgendaDoDia } from '../../src/painel/agenda.js';
import { PainelAgenda } from '../components/painel-agenda';
import { agendarAcao, bloquearAcao, desbloquearAcao, mudarStatusAcao, registrarLembreteAcao, sairDoPainel } from './acoes';
import { exigirSessao } from './sessao';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agendaki · Painel' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ dia?: string | string[] }> }) {
  const sessao = await exigirSessao();
  const { dia } = await searchParams;
  const dados = await obterAgendaDoDia(bancoServidor(), sessao.negocioId, typeof dia === 'string' ? dia : undefined);
  if (!dados) throw new Error('Negócio da sessão não encontrado.');
  return <PainelAgenda dados={dados} email={sessao.email} aoSair={sairDoPainel}
    acoes={{ mudarStatus: mudarStatusAcao, registrarLembrete: registrarLembreteAcao, agendar: agendarAcao, bloquear: bloquearAcao, desbloquear: desbloquearAcao }} />;
}
