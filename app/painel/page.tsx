import type { Metadata } from 'next';
import { bancoServidor } from '../../src/db/server.js';
import { obterAgendaDoDia } from '../../src/painel/agenda.js';
import { obterNovidades } from '../../src/painel/novidades.js';
import { PainelAgenda } from '../components/painel-agenda';
import { agendarAcao, bloquearAcao, desbloquearAcao, marcarNovidadesVistasAcao, mudarStatusAcao, registrarLembreteAcao, sairDoPainel } from './acoes';
import { Atualizador } from './atualizador';
import { exigirSessao } from './sessao';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agendaki · Painel' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ dia?: string | string[] }> }) {
  const sessao = await exigirSessao();
  const { dia } = await searchParams;
  const dados = await obterAgendaDoDia(bancoServidor(), sessao.negocioId, typeof dia === 'string' ? dia : undefined);
  if (!dados) throw new Error('Negócio da sessão não encontrado.');
  const novidades = await obterNovidades(bancoServidor(), sessao.usuarioId);
  return <><Atualizador novidades={novidades.total} /><PainelAgenda dados={dados} email={sessao.email} aoSair={sairDoPainel}
    novidades={novidades} aoVerNovidades={marcarNovidadesVistasAcao}
    acoes={{ mudarStatus: mudarStatusAcao, registrarLembrete: registrarLembreteAcao, agendar: agendarAcao, bloquear: bloquearAcao, desbloquear: desbloquearAcao }} /></>;
}
