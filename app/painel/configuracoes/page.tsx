import type { Metadata } from 'next';
import { bancoServidor } from '../../../src/db/server.js';
import { obterConfiguracao } from '../../../src/painel/configuracao.js';
import { PainelConfiguracoes } from '../../components/painel-configuracoes';
import { definirServicoAtivoAcao, sairDoPainel, salvarFuncionamentoAcao, salvarNegocioAcao, salvarServicoAcao } from '../acoes';
import { exigirSessao } from '../sessao';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agendaki · Configurações' };

export default async function Pagina() {
  const sessao = await exigirSessao();
  const dados = await obterConfiguracao(bancoServidor(), sessao.negocioId);
  if (!dados) throw new Error('Negócio da sessão não encontrado.');
  return <PainelConfiguracoes dados={dados} email={sessao.email} aoSair={sairDoPainel}
    acoes={{ salvarNegocio: salvarNegocioAcao, salvarServico: salvarServicoAcao, definirServicoAtivo: definirServicoAtivoAcao, salvarFuncionamento: salvarFuncionamentoAcao }} />;
}
