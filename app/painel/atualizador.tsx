'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** De quanto em quanto tempo o painel aberto busca a agenda de novo. */
const INTERVALO_MS = 60_000;

/**
 * Mantém a agenda em dia enquanto o painel fica aberto no balcão: busca de
 * novo a cada minuto, ao voltar para a aba e quando chega um aviso. Não
 * interrompe quem está digitando num formulário.
 */
export function Atualizador({ novidades }: { novidades: number }) {
  const router = useRouter();
  useEffect(() => {
    const atualizar = () => {
      if (document.visibilityState !== 'visible') return;
      const foco = document.activeElement;
      if (foco && ['INPUT', 'SELECT', 'TEXTAREA'].includes(foco.tagName)) return;
      router.refresh();
    };
    const aoAviso = (evento: MessageEvent) => { if (evento.data?.tipo === 'agenda-mudou') atualizar(); };
    const relogio = setInterval(atualizar, INTERVALO_MS);
    document.addEventListener('visibilitychange', atualizar);
    navigator.serviceWorker?.addEventListener('message', aoAviso);
    return () => {
      clearInterval(relogio);
      document.removeEventListener('visibilitychange', atualizar);
      navigator.serviceWorker?.removeEventListener('message', aoAviso);
    };
  }, [router]);
  // A contagem aparece também na aba do navegador.
  useEffect(() => { document.title = novidades ? `(${novidades}) Agendaki · Painel` : 'Agendaki · Painel'; }, [novidades]);
  return null;
}
