'use client';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { PaginaPublica } from '../../src/agenda/pagina-publica.js';
import { ANTECEDENCIA_CANCELAMENTO_MIN, antecedenciaCancelamentoTexto, formatarTelefone, mensagensRecusa, normalizarTelefone, reais, validarPedido,
  type PedidoReserva, type ReservaConfirmada, type ResultadoReserva } from '../../src/agenda/pedido-reserva.js';

const nomesDias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function dataTexto(data: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).format(new Date(`${data}T12:00:00Z`));
}
type Servico = PaginaPublica['servicos'][number];
type Horario = Servico['horarios'][number];
type Props = {
  dados: PaginaPublica;
  homeHref?: string;
  /** Sem esta função a página só consulta horários, como na versão 0.3. */
  aoReservar?: (pedido: PedidoReserva) => Promise<ResultadoReserva>;
  /** Caminho da página de cancelamento; null onde ela não existe (demonstração estática). */
  rotaCancelamento?: string | null;
  /** Na demonstração, leva ao painel do dono com os mesmos dados fictícios. */
  hrefPainelDemo?: string;
};
export function AgendaPublica({ dados, homeHref = '/', aoReservar, rotaCancelamento = '/cancelar/', hrefPainelDemo }: Props) {
  const inicial = dados.servicos.find((s) => s.nome === 'Corte') ?? dados.servicos[0];
  const [servicoId, setServico] = useState(inicial?.id);
  const [dia, setDia] = useState(inicial?.horarios[0]?.dataLocal ?? dados.dias[0]);
  /** Vazio: o cliente não tem preferência de profissional. */
  const [profissionalId, setProfissional] = useState('');
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [isca, setIsca] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** Horários que esta página já viu serem recusados; `profissionalId` vazio vale para todos. */
  const [ocupados, setOcupados] = useState<{ inicio: string; profissionalId: string }[]>([]);
  const [confirmada, setConfirmada] = useState<ReservaConfirmada | null>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    type Tool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      { name: 'consultar_disponibilidade', description: 'Lista serviços e horários disponíveis nesta consulta; não cria reservas.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ profissionais: dados.profissionais, servicos: dados.servicos, atualizadoEm: dados.atualizadoEm }) },
      { name: 'selecionar_horario', description: 'Seleciona serviço e horário no resumo visível. Não confirma nem grava uma reserva.',
        inputSchema: { type: 'object', properties: { servicoId: { type: 'string' }, inicioUTC: { type: 'string' } }, required: ['servicoId', 'inicioUTC'], additionalProperties: false }, annotations: { readOnlyHint: false },
        execute: (input) => {
          if (!input || typeof input !== 'object' || !('servicoId' in input) || !('inicioUTC' in input)) throw new Error('Informe serviço e horário.');
          const s = dados.servicos.find((item) => item.id === input.servicoId);
          const h = s?.horarios.find((item) => item.inicio === input.inicioUTC);
          if (!s || !h) throw new Error('Horário não disponível para esse serviço.');
          flushSync(() => { setServico(s.id); setDia(h.dataLocal); setSelecionado(h.inicio); setProfissional((atual) => (h.profissionais.includes(atual) ? atual : '')); });
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
  // Com um só profissional a página não pergunta "com quem" e fica como sempre foi.
  const varios = dados.profissionais.length > 1;
  const escolhido = dados.profissionais.find((p) => p.id === profissionalId);
  const livresEm = (h: Horario) => h.profissionais.filter((p) => !ocupados.some((o) => o.inicio === h.inicio && (!o.profissionalId || o.profissionalId === p)));
  /** Horários de um serviço que ainda valem para quem o cliente escolheu. */
  const oferecidos = (s: Servico | undefined, quem = profissionalId) => s?.horarios.filter((h) => (quem ? livresEm(h).includes(quem) : livresEm(h).length > 0)) ?? [];
  const servico = dados.servicos.find((s) => s.id === servicoId);
  const doServico = oferecidos(servico);
  const horarios = doServico.filter((h) => h.dataLocal === dia);
  const passo = (n: number) => String(n + (varios ? 1 : 0)).padStart(2, '0');
  const horario = horarios.find((h) => h.inicio === selecionado);
  const hora = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: dados.negocio.fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const offset = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: dados.negocio.fuso, timeZoneName: 'shortOffset' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value;
  const dataHora = (iso: string) => `${new Intl.DateTimeFormat('pt-BR', { timeZone: dados.negocio.fuso, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))}, às ${hora(iso)}`;
  async function confirmar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!aoReservar || !servico || !horario || enviando) return;
    const pedido: PedidoReserva = { slug: dados.negocio.slug, servicoId: servico.id, inicio: horario.inicio, nome, telefone, site: isca,
      ...(profissionalId ? { profissionalId } : {}) };
    if (!validarPedido(pedido, { servicoIdLivre: true })) { setErro(mensagensRecusa.dados_invalidos); return; }
    setEnviando(true); setErro(null);
    try {
      const resultado = await aoReservar(pedido);
      if (resultado.ok) { setConfirmada(resultado); window.scrollTo({ top: 0 }); }
      else {
        setErro(resultado.mensagem);
        if (resultado.motivo === 'horario_indisponivel') { setOcupados((lista) => [...lista, { inicio: horario.inicio, profissionalId }]); setSelecionado(null); }
      }
    } catch { setErro('Não foi possível confirmar agora. Confira sua conexão e tente de novo.'); }
    finally { setEnviando(false); }
  }
  function trocarServico(id: string) {
    setServico(id); setSelecionado(null); setErro(null);
    const lista = oferecidos(dados.servicos.find((s) => s.id === id));
    if (!lista.some((h) => h.dataLocal === dia)) setDia(lista[0]?.dataLocal ?? dados.dias[0]);
  }
  function trocarProfissional(id: string) {
    setProfissional(id); setSelecionado(null); setErro(null);
    const lista = oferecidos(servico, id);
    if (!lista.some((h) => h.dataLocal === dia) && lista.length) setDia(lista[0].dataLocal);
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
        {dados.negocio.demonstracao && <div className="nota-demo"><strong>Fique à vontade para explorar.</strong><p>{aoReservar ? 'Esta é uma barbearia fictícia. Marque um horário para ver como funciona: nenhuma mensagem é enviada.' : 'Esta é uma barbearia fictícia. Nenhum atendimento será marcado.'}</p>{hrefPainelDemo && <p><a className="link-demo" href={hrefPainelDemo}>Ver o painel do dono →</a></p>}</div>}
      </aside>
      {confirmada ? <Confirmacao reserva={confirmada} dataHora={dataHora} rotaCancelamento={rotaCancelamento} copiado={copiado} aoCopiar={() => setCopiado(true)} /> : <div className="agenda">
        <section aria-labelledby="servicos-titulo"><div className="titulo-secao"><span className="numero">01</span><h2 id="servicos-titulo">Qual vai ser o cuidado de hoje?</h2></div>
          {dados.servicos.length === 0 ? <p className="vazio">Os serviços ainda não estão disponíveis para consulta.</p> : <div className="servicos" role="group" aria-label="Serviço">
            {dados.servicos.map((s) => <button key={s.id} className={`servico ${s.id === servicoId ? 'ativo' : ''}`} aria-pressed={s.id === servicoId} onClick={() => trocarServico(s.id)}><span className="servico-topo"><strong>{s.nome}</strong><span className="radio" aria-hidden="true">{s.id === servicoId ? '✓' : ''}</span></span><span className="duracao">{s.duracaoMin} min</span><span className="preco">{reais.format(s.precoCentavos / 100)}</span></button>)}
          </div>}
        </section>
        {servico && <>{varios && <section aria-labelledby="profissional-titulo"><div className="titulo-secao"><span className="numero">02</span><h2 id="profissional-titulo">Com quem você prefere?</h2></div>
          <div className="profissionais" role="group" aria-label="Profissional">
            <button className={`profissional ${profissionalId === '' ? 'ativo' : ''}`} aria-pressed={profissionalId === ''} onClick={() => trocarProfissional('')}>Tanto faz<small>Quem estiver livre</small></button>
            {dados.profissionais.map((p) => <button key={p.id} className={`profissional ${p.id === profissionalId ? 'ativo' : ''}`} aria-pressed={p.id === profissionalId} onClick={() => trocarProfissional(p.id)}>{p.nome}<small>{oferecidos(servico, p.id).length ? 'Tem horário' : 'Sem horário livre'}</small></button>)}
          </div>
        </section>}
        <section aria-labelledby="dias-titulo"><div className="titulo-secao"><span className="numero">{passo(2)}</span><h2 id="dias-titulo">Quando você quer vir?</h2></div>
          <p className="mes">{dataTexto(dia, { month: 'long', year: 'numeric' })}<span>Próximos 14 dias</span></p>
          <div className="dias" role="group" aria-label="Data do atendimento">{dados.dias.map((d) => {
            const tem = doServico.some((h) => h.dataLocal === d);
            return <button key={d} aria-pressed={dia === d} aria-label={`${dataTexto(d, { weekday: 'long', day: 'numeric', month: 'long' })}${tem ? '' : ', sem horários'}`} className={`dia ${dia === d ? 'ativo' : ''} ${tem ? '' : 'sem-horarios'}`} onClick={() => { setDia(d); setSelecionado(null); setErro(null); }}><span>{dataTexto(d, { weekday: 'short' }).replace('.', '')}</span><strong>{d.slice(-2)}</strong><small>{d === dados.dias[0] ? 'Hoje' : dataTexto(d, { month: 'short' }).replace('.', '')}</small></button>;
          })}</div>
          <div className="horarios-topo"><h3>Horários disponíveis</h3><span>{horarios.length} opções</span></div>
          <div role="group" aria-label="Horário do atendimento" className="horarios">{horarios.map((h) => {
            const repetido = horarios.filter((outro) => hora(outro.inicio) === hora(h.inicio)).length > 1;
            return <button key={h.inicio} className={`horario ${selecionado === h.inicio ? 'ativo' : ''}`} aria-pressed={selecionado === h.inicio} onClick={() => { setSelecionado(h.inicio); setErro(null); }}>{hora(h.inicio)}{repetido && <small>{offset(h.inicio)}</small>}</button>;
          })}</div>
          {horarios.length === 0 && <p className="vazio">{escolhido ? `${escolhido.nome} não tem horário livre nesta data. Escolha outro dia ou outro profissional.` : 'Nenhum horário livre nesta data. Escolha outro dia no calendário.'}</p>}
        </section>
        <section className="resumo" aria-live="polite" aria-label="Sua escolha"><div><span className="sobretitulo">SUA ESCOLHA</span><h3>{servico.nome} <span>· {servico.duracaoMin} min{varios ? ` · com ${escolhido ? escolhido.nome : 'quem estiver livre'}` : ''}</span></h3><p>{horario ? `${dataTexto(dia, { day: 'numeric', month: 'long' })}, ${hora(horario.inicio)}–${hora(horario.fim)} (${offset(horario.inicio)})` : 'Selecione um horário para conferir os detalhes.'}</p></div><strong className="resumo-preco">{reais.format(servico.precoCentavos / 100)}</strong></section>
        {!aoReservar ? <p className="consulta">Consulta de disponibilidade. A seleção de um horário ainda não confirma uma reserva.</p>
        : horario ? <section aria-labelledby="dados-titulo"><div className="titulo-secao"><span className="numero">{passo(3)}</span><h2 id="dados-titulo">Para quem é o horário?</h2></div>
          <form className="dados" onSubmit={confirmar} noValidate>
            <label className="campo"><span>Seu nome</span><input name="nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" maxLength={80} required /></label>
            <label className="campo"><span>WhatsApp com DDD</span><input name="telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(34) 99999-9999" maxLength={20} required /></label>
            <label className="isca" aria-hidden="true">Site<input name="site" value={isca} onChange={(e) => setIsca(e.target.value)} tabIndex={-1} autoComplete="off" /></label>
            {erro && <p className="erro" role="alert">{erro}</p>}
            <button className="botao confirmar" type="submit" disabled={enviando}>{enviando ? 'Confirmando…' : `Confirmar ${servico.nome.toLowerCase()} às ${hora(horario.inicio)}`}</button>
            <p className="consulta">Usamos seu nome e seu WhatsApp só para este agendamento. O pagamento é feito no local.</p>
          </form></section>
        : <>{erro && <p className="erro" role="alert">{erro}</p>}<p className="consulta">Escolha um horário para confirmar com seu nome e WhatsApp.</p></>}</>}
        <div className="atualizacao"><span>Consultado às {hora(dados.atualizadoEm)}</span><button onClick={() => window.location.reload()}>Consultar novamente <span aria-hidden="true">↻</span></button></div>
      </div>}
    </main>
    <footer><span>Seu horário. Sem complicação.</span><span>Feito com <b>agendaki</b> · v0.7.0</span></footer>
  </div>;
}

function Confirmacao({ reserva, dataHora, rotaCancelamento, copiado, aoCopiar }: {
  reserva: ReservaConfirmada; dataHora: (iso: string) => string; rotaCancelamento: string | null; copiado: boolean; aoCopiar: () => void;
}) {
  const primeiroNome = reserva.cliente.nome.split(' ')[0];
  const comQuem = reserva.variosProfissionais ? ` com ${reserva.profissional.nome}` : '';
  const mensagem = `Olá! Agendei ${reserva.servico.nome.toLowerCase()}${comQuem} para ${dataHora(reserva.inicio)}, pelo Agendaki. Meu nome é ${reserva.cliente.nome}.`;
  const telefoneNegocio = normalizarTelefone(reserva.negocio.telefone);
  const link = rotaCancelamento && typeof window !== 'undefined' ? `${window.location.origin}${rotaCancelamento}${reserva.tokenCancelamento}` : null;
  // Reserva feita em cima da hora já nasce fora do prazo de cancelamento.
  const [noPrazo] = useState(() => new Date(reserva.inicio).getTime() - Date.now() >= ANTECEDENCIA_CANCELAMENTO_MIN * 60_000);
  async function copiar() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); aoCopiar(); } catch { /* O link continua visível para copiar à mão. */ }
  }
  return <div className="agenda confirmacao" role="status">
    <span className="sobretitulo">AGENDAMENTO CONFIRMADO</span>
    <h2>Tudo certo, {primeiroNome}. Seu horário está reservado.</h2>
    <dl className="detalhes">
      <div><dt>Serviço</dt><dd>{reserva.servico.nome} · {reserva.servico.duracaoMin} min</dd></div>
      {reserva.variosProfissionais && <div><dt>Com</dt><dd>{reserva.profissional.nome}</dd></div>}
      <div><dt>Quando</dt><dd>{dataHora(reserva.inicio)}</dd></div>
      <div><dt>Onde</dt><dd>{reserva.negocio.nome.replace(' — demonstração', '')}</dd></div>
      <div><dt>Valor</dt><dd>{reais.format(reserva.servico.precoCentavos / 100)} · pago no local</dd></div>
    </dl>
    {reserva.negocio.demonstracao ? <div className="bloco"><h3>Aviso pelo WhatsApp</h3><p>Na versão de verdade, um toque abre o WhatsApp do negócio com esta mensagem pronta. Na demonstração nada é enviado.</p><p className="mensagem">{mensagem}</p></div>
    : telefoneNegocio && <div className="bloco"><h3>Avise pelo WhatsApp</h3><p>Um toque abre a conversa com {formatarTelefone(telefoneNegocio)} e a mensagem já vai pronta. Assim o combinado fica registrado para os dois.</p><a className="botao" href={`https://wa.me/55${telefoneNegocio}?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noopener noreferrer">Enviar confirmação no WhatsApp</a></div>}
    <div className="bloco"><h3>Precisa cancelar?</h3>
      {!noPrazo ? <p>O cancelamento pelo link vale até {antecedenciaCancelamentoTexto} antes do horário. Como o seu é daqui a pouco, se não puder vir avise o negócio direto.</p>
      : link ? <><p>Guarde este link. Com ele você cancela até {antecedenciaCancelamentoTexto} antes do horário, e a vaga volta a ficar livre para outra pessoa.</p><p className="link-cancelar"><a href={link}>{link}</a></p><button className="botao secundario" type="button" onClick={copiar}>{copiado ? 'Link copiado ✓' : 'Copiar link'}</button></>
      : <p>Na versão de verdade, você recebe aqui um link pessoal para cancelar até {antecedenciaCancelamentoTexto} antes do horário. A vaga volta a ficar livre na mesma hora.</p>}
    </div>
    <div className="atualizacao"><span>Seus dados são usados só para este agendamento.</span><button onClick={() => window.location.reload()}>Marcar outro horário <span aria-hidden="true">↻</span></button></div>
  </div>;
}
