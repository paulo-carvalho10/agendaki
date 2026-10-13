import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PainelAgenda, type AcoesPainel } from '../app/components/painel-agenda.js';
import {
  agendaDoDiaDemo, agendarDemo, bloquearDemo, criarEstadoDemo, desbloquearDemo, mudarStatusDemo, registrarLembreteDemo, type EstadoDemo,
} from '../src/painel/demo.js';

/** O painel de verdade, com as mesmas telas e regras, guardando tudo na memória da página. */
function PainelDemo() {
  const [estado, setEstado] = useState<EstadoDemo>(() => criarEstadoDemo());
  const [dia, setDia] = useState<string | undefined>(undefined);
  // As ações leem sempre o estado mais recente, mesmo que duas terminem em sequência.
  const atual = useRef(estado);
  const acoes = useMemo<AcoesPainel>(() => {
    async function aplicar<R>(mudanca: (estado: EstadoDemo) => { estado: EstadoDemo; resultado: R }) {
      await new Promise((ok) => setTimeout(ok, 250));
      const { estado: novo, resultado } = mudanca(atual.current);
      atual.current = novo;
      setEstado(novo);
      return resultado;
    }
    return {
      mudarStatus: (id, para) => aplicar((e) => mudarStatusDemo(e, id, para)),
      registrarLembrete: (id) => aplicar((e) => registrarLembreteDemo(e, id)),
      agendar: (pedido) => aplicar((e) => agendarDemo(e, pedido)),
      bloquear: (pedido) => aplicar((e) => bloquearDemo(e, pedido)),
      desbloquear: (id) => aplicar((e) => desbloquearDemo(e, id)),
    };
  }, []);
  return <>
    <p className="faixa-demo">Este é o painel do dono, com uma barbearia fictícia. Mexa à vontade: nada é gravado nem enviado, e ao recarregar tudo volta ao início. <a href="/agendaki/">Ver a página do cliente</a></p>
    <PainelAgenda dados={agendaDoDiaDemo(estado, dia)} email="dono@barbearia.example" acoes={acoes} aoMudarDia={setDia}
      aoSair={async () => { window.location.href = '/agendaki/'; }}
      links={{ inicio: '/agendaki/painel/', agenda: '/agendaki/painel/', configuracoes: null, paginaPublica: '/agendaki/' }} />
  </>;
}

createRoot(document.getElementById('root')!).render(<PainelDemo />);
