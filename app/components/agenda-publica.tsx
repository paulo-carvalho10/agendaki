'use client';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { PaginaPublica } from '../../src/agenda/pagina-publica.js';

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const nomesDias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function dataTexto(data: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).format(new Date(`${data}T12:00:00Z`));
}
export function AgendaPublica({ dados, homeHref = '/' }: { dados: PaginaPublica; homeHref?: string }) {
  const inicial = dados.servicos.find((s) => s.nome === 'Corte') ?? dados.servicos[0];
  const [servicoId, setServico] = useState(inicial?.id);
  const [dia, setDia] = useState(inicial?.horarios[0]?.dataLocal ?? dados.dias[0]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  useEffect(() => {
    type Tool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      { name: 'consultar_disponibilidade', description: 'Lista serviços e horários disponíveis nesta consulta; não cria reservas.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ servicos: dados.servicos, atualizadoEm: dados.atualizadoEm }) },
      { name: 'selecionar_horario', description: 'Seleciona serviço e horário no resumo visível. Não confirma nem grava uma reserva.',
        inputSchema: { type: 'object', properties: { servicoId: { type: 'string' }, inicioUTC: { type: 'string' } }, required: ['servicoId', 'inicioUTC'], additionalProperties: false }, annotations: { readOnlyHint: false },
        execute: (input) => {
          if (!input || typeof input !== 'object' || !('servicoId' in input) || !('inicioUTC' in input)) throw new Error('Informe serviço e horário.');
          const s = dados.servicos.find((item) => item.id === input.servicoId);
          const h = s?.horarios.find((item) => item.inicio === input.inicioUTC);
          if (!s || !h) throw new Error('Horário não disponível para esse serviço.');
          flushSync(() => { setServico(s.id); setDia(h.dataLocal); setSelecionado(h.inicio); });
          return { servico: s.nome, inicio: h.inicio, fim: h.fim, reservaConfirmada: false };
        },
      },
    ];
    for (const tool of tools) {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); }
      catch { /* O uso da página não depende do suporte experimental a WebMCP. */ }
    }
    return () => lifecycle.abort();
  }, [dados]);
  const servico = dados.servicos.find((s) => s.id === servicoId);
  const horarios = servico?.horarios.filter((h) => h.dataLocal === dia) ?? [];
  const horario = horarios.find((h) => h.inicio === selecionado);
  const hora = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: dados.negocio.fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const offset = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: dados.negocio.fuso, timeZoneName: 'shortOffset' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value;
  function trocarServico(id: string) {
    setServico(id); setSelecionado(null);
    const novo = dados.servicos.find((s) => s.id === id);
    if (!novo?.horarios.some((h) => h.dataLocal === dia)) setDia(novo?.horarios[0]?.dataLocal ?? dados.dias[0]);
  }
  return <div className="site">
    <header className="topo"><a className="marca" href={homeHref}>agendaki<span aria-hidden="true">✳</span></a><span className="topo-texto">Um tempo só seu.</span>{dados.negocio.demonstracao && <span className="selo">Demonstração</span>}</header>
    <main className="layout">
      <aside className="negocio">
        <div className="monograma" aria-hidden="true">{dados.negocio.demonstracao ? 'H' : dados.negocio.nome.slice(0, 1)}<span>{dados.negocio.demonstracao ? 'BARBEARIA' : 'AGENDA'}</span></div>
        <p className="sobretitulo">SEU PRÓXIMO ATENDIMENTO</p>
        <h1>{dados.negocio.nome.replace(' — demonstração', '')}</h1>
        <p className="descricao">Escolha o serviço e encontre um horário que combina com o seu dia.</p>
        <div className="linha-detalhe"><span aria-hidden="true">◷</span><div><strong>Horário de funcionamento</strong><ul className="expediente">{dados.funcionamento.map((f, i) => <li key={i}>{nomesDias[f.diaSemana]} <span>{f.abre.slice(0, 5)}–{f.fecha.slice(0, 5)}{f.terminaDiaSeguinte ? ' (+1 dia)' : ''}</span></li>)}</ul></div></div>
        <p className="fuso">Horários em {dados.negocio.fuso.replaceAll('_', ' ')}</p>
        {dados.negocio.demonstracao && <div className="nota-demo"><strong>Fique à vontade para explorar.</strong><p>Esta é uma barbearia fictícia. Nenhum atendimento será marcado.</p></div>}
      </aside>
      <div className="agenda">
        <section aria-labelledby="servicos-titulo"><div className="titulo-secao"><span className="numero">01</span><h2 id="servicos-titulo">Qual vai ser o cuidado de hoje?</h2></div>
          {dados.servicos.length === 0 ? <p className="vazio">Os serviços ainda não estão disponíveis para consulta.</p> : <div className="servicos" role="group" aria-label="Serviço">
            {dados.servicos.map((s) => <button key={s.id} className={`servico ${s.id === servicoId ? 'ativo' : ''}`} aria-pressed={s.id === servicoId} onClick={() => trocarServico(s.id)}><span className="servico-topo"><strong>{s.nome}</strong><span className="radio" aria-hidden="true">{s.id === servicoId ? '✓' : ''}</span></span><span className="duracao">{s.duracaoMin} min</span><span className="preco">{reais.format(s.precoCentavos / 100)}</span></button>)}
          </div>}
        </section>
        {servico && <><section aria-labelledby="dias-titulo"><div className="titulo-secao"><span className="numero">02</span><h2 id="dias-titulo">Quando você quer vir?</h2></div>
          <p className="mes">{dataTexto(dia, { month: 'long', year: 'numeric' })}<span>Próximos 14 dias</span></p>
          <div className="dias" role="group" aria-label="Data do atendimento">{dados.dias.map((d) => {
            const tem = servico.horarios.some((h) => h.dataLocal === d);
            return <button key={d} aria-pressed={dia === d} aria-label={`${dataTexto(d, { weekday: 'long', day: 'numeric', month: 'long' })}${tem ? '' : ', sem horários'}`} className={`dia ${dia === d ? 'ativo' : ''} ${tem ? '' : 'sem-horarios'}`} onClick={() => { setDia(d); setSelecionado(null); }}><span>{dataTexto(d, { weekday: 'short' }).replace('.', '')}</span><strong>{d.slice(-2)}</strong><small>{d === dados.dias[0] ? 'Hoje' : dataTexto(d, { month: 'short' }).replace('.', '')}</small></button>;
          })}</div>
          <div className="horarios-topo"><h3>Horários disponíveis</h3><span>{horarios.length} opções</span></div>
          <div role="group" aria-label="Horário do atendimento" className="horarios">{horarios.map((h) => {
            const repetido = horarios.filter((outro) => hora(outro.inicio) === hora(h.inicio)).length > 1;
            return <button key={h.inicio} className={`horario ${selecionado === h.inicio ? 'ativo' : ''}`} aria-pressed={selecionado === h.inicio} onClick={() => setSelecionado(h.inicio)}>{hora(h.inicio)}{repetido && <small>{offset(h.inicio)}</small>}</button>;
          })}</div>
          {horarios.length === 0 && <p className="vazio">Nenhum horário livre nesta data. Escolha outro dia no calendário.</p>}
        </section>
        <section className="resumo" aria-live="polite" aria-label="Sua escolha"><div><span className="sobretitulo">SUA ESCOLHA</span><h3>{servico.nome} <span>· {servico.duracaoMin} min</span></h3><p>{horario ? `${dataTexto(dia, { day: 'numeric', month: 'long' })}, ${hora(horario.inicio)}–${hora(horario.fim)} (${offset(horario.inicio)})` : 'Selecione um horário para conferir os detalhes.'}</p></div><strong className="resumo-preco">{reais.format(servico.precoCentavos / 100)}</strong></section>
        <p className="consulta">Consulta de disponibilidade. A seleção de um horário ainda não confirma uma reserva.</p></>}
        <div className="atualizacao"><span>Consultado às {hora(dados.atualizadoEm)}</span><button onClick={() => window.location.reload()}>Consultar novamente <span aria-hidden="true">↻</span></button></div>
      </div>
    </main>
    <footer><span>Seu horário. Sem complicação.</span><span>Feito com <b>agendaki</b> · v0.3.0</span></footer>
  </div>;
}
