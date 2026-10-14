'use client';
import { useEffect, useRef, useState } from 'react';
import type { ResultadoPainel } from '../../src/painel/acoes.js';
import type { InscricaoDoNavegador } from '../../src/avisos/push.js';

export type AcoesAvisos = {
  ativar: (inscricao: InscricaoDoNavegador) => Promise<ResultadoPainel>;
  desativar: (endpoint: string) => Promise<ResultadoPainel>;
  testar: (endpoint: string) => Promise<ResultadoPainel>;
};
type Estado = 'conferindo' | 'sem-suporte' | 'iphone-fora-da-tela-de-inicio' | 'bloqueado' | 'desligado' | 'ligado';

/** A chave pública vem em base64url; o navegador pede os bytes. */
function bytesDaChave(chave: string) {
  const base64 = (chave + '='.repeat((4 - (chave.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * Liga e desliga, neste aparelho, a notificação de horário marcado ou cancelado
 * por cliente. Cada celular ou computador do dono é ativado separadamente.
 */
export function AvisosPush({ chavePublica, acoes }: { chavePublica: string | null; acoes: AcoesAvisos }) {
  const [estado, setEstado] = useState<Estado>('conferindo');
  const [endpoint, setEndpoint] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // As ações mudam de identidade a cada atualização da página; a conferência do aparelho roda uma vez só.
  const sincronizar = useRef(acoes.ativar);
  sincronizar.current = acoes.ativar;

  useEffect(() => {
    if (!chavePublica) return;
    let vivo = true;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (vivo) setEstado(iphone ? 'iphone-fora-da-tela-de-inicio' : 'sem-suporte');
        return;
      }
      try {
        const registro = await navigator.serviceWorker.register('/sw.js');
        const inscricao = await registro.pushManager.getSubscription();
        if (!vivo) return;
        if (Notification.permission === 'denied') { setEstado('bloqueado'); return; }
        if (!inscricao) { setEstado('desligado'); return; }
        setEndpoint(inscricao.endpoint); setEstado('ligado');
        // Garante que o servidor conhece este aparelho, mesmo que a inscrição tenha sido apagada lá.
        void sincronizar.current(inscricao.toJSON() as InscricaoDoNavegador).catch(() => {});
      } catch { if (vivo) setEstado('sem-suporte'); }
    })();
    return () => { vivo = false; };
  }, [chavePublica]);

  async function rodar(acao: () => Promise<void>) {
    setAviso(null); setOcupado(true);
    try { await acao(); }
    catch { setAviso({ tipo: 'erro', texto: 'Não foi possível concluir agora. Confira a conexão e tente de novo.' }); }
    finally { setOcupado(false); }
  }
  const ativar = () => rodar(async () => {
    if (await Notification.requestPermission() !== 'granted') { setEstado(Notification.permission === 'denied' ? 'bloqueado' : 'desligado'); return; }
    const registro = await navigator.serviceWorker.ready;
    const opcoes = { userVisibleOnly: true, applicationServerKey: bytesDaChave(chavePublica!) };
    let inscricao: PushSubscription;
    try { inscricao = await registro.pushManager.subscribe(opcoes); }
    catch {
      // Uma inscrição antiga, feita com outra chave, impede a nova: sai a antiga e tenta de novo.
      await (await registro.pushManager.getSubscription())?.unsubscribe();
      try { inscricao = await registro.pushManager.subscribe(opcoes); }
      catch { setAviso({ tipo: 'erro', texto: 'Este navegador não liberou os avisos. Em janela anônima eles não funcionam: abra o painel numa janela normal e tente de novo.' }); return; }
    }
    const resultado = await acoes.ativar(inscricao.toJSON() as InscricaoDoNavegador);
    if (!resultado.ok) { await inscricao.unsubscribe(); setAviso({ tipo: 'erro', texto: resultado.mensagem }); return; }
    setEndpoint(inscricao.endpoint); setEstado('ligado');
    setAviso({ tipo: 'ok', texto: 'Avisos ativados neste aparelho. Envie um aviso de teste para conferir.' });
  });
  const desativar = () => rodar(async () => {
    const registro = await navigator.serviceWorker.ready;
    await (await registro.pushManager.getSubscription())?.unsubscribe();
    await acoes.desativar(endpoint);
    setEndpoint(''); setEstado('desligado');
    setAviso({ tipo: 'ok', texto: 'Este aparelho não recebe mais avisos.' });
  });
  const testar = () => rodar(async () => {
    const resultado = await acoes.testar(endpoint);
    setAviso(resultado.ok ? { tipo: 'ok', texto: 'Aviso de teste enviado. Ele deve aparecer em alguns segundos.' } : { tipo: 'erro', texto: resultado.mensagem });
  });

  return <section className="cartao" id="avisos" aria-labelledby="avisos-titulo">
    <h2 id="avisos-titulo">Avisos de reserva nova</h2>
    <p className="consulta">Uma notificação neste aparelho sempre que um cliente marcar ou cancelar um horário, mesmo com o painel fechado. Ative em cada celular ou computador em que quiser ser avisado.</p>
    {aviso && <p className={aviso.tipo === 'erro' ? 'erro' : 'sucesso'} role="status">{aviso.texto}</p>}
    {!chavePublica ? <p className="consulta">Os avisos ainda não foram ligados neste sistema. Fale com o suporte.</p>
    : estado === 'conferindo' ? <p className="consulta">Conferindo este aparelho…</p>
    : estado === 'sem-suporte' ? <p className="consulta">Este navegador não recebe avisos. Abra o painel pelo Chrome, Edge ou Firefox.</p>
    : estado === 'iphone-fora-da-tela-de-inicio' ? <p className="consulta">No iPhone, os avisos funcionam com o Agendaki na tela de início: no Safari, toque em Compartilhar, depois em “Adicionar à Tela de Início”, abra o Agendaki por lá e volte a esta tela.</p>
    : estado === 'bloqueado' ? <p className="consulta">As notificações deste site estão bloqueadas neste navegador. Libere nas configurações do navegador (no cadeado ao lado do endereço) e recarregue esta página.</p>
    : estado === 'desligado' ? <div className="formulario"><button className="botao" type="button" disabled={ocupado} onClick={ativar}>{ocupado ? 'Ativando…' : 'Ativar avisos neste aparelho'}</button></div>
    : <div className="formulario">
        <p className="estado-aviso">Avisos ativados neste aparelho ✓</p>
        <div className="dupla">
          <button className="botao" type="button" disabled={ocupado} onClick={testar}>Enviar aviso de teste</button>
          <button className="botao secundario" type="button" disabled={ocupado} onClick={desativar}>Desativar</button>
        </div>
      </div>}
  </section>;
}
