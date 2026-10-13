'use client';

export type LinksPainel = { agenda: string; configuracoes: string | null; paginaPublica: string | null; inicio: string };

/** Topo e abas comuns às telas do painel. Sem dependência do Next.js, para servir também à demonstração estática. */
export function CabecalhoPainel({ nomeNegocio, demonstracao, email, aba, links, aoSair }: {
  nomeNegocio: string; demonstracao: boolean; email: string; aba: 'agenda' | 'configuracoes'; links: LinksPainel; aoSair: () => Promise<void> | void;
}) {
  return <>
    <header className="topo">
      <a className="marca" href={links.inicio}>agendaki<span aria-hidden="true">✳</span></a>
      <span className="topo-texto">{nomeNegocio}</span>
      {demonstracao && <span className="selo">Demonstração</span>}
      <form className="topo-links" action={aoSair}><button type="submit" title={email}>Sair</button></form>
    </header>
    <nav className="painel-abas" aria-label="Painel">
      <a href={links.agenda} aria-current={aba === 'agenda' ? 'page' : undefined}>Agenda</a>
      {links.configuracoes && <a href={links.configuracoes} aria-current={aba === 'configuracoes' ? 'page' : undefined}>Configurações</a>}
      {links.paginaPublica && <a className="externo" href={links.paginaPublica} target="_blank" rel="noopener noreferrer">Ver página de agendamento ↗</a>}
    </nav>
  </>;
}
