'use client';
import { useState, useTransition } from 'react';
import type { AgendaDoDia, ItemAgenda, StatusAgendamento } from '../../src/painel/agenda.js';
import type { PedidoBloqueio, PedidoDoDono, ResultadoPainel } from '../../src/painel/acoes.js';
import { formatarTelefone, normalizarTelefone, reais, type ResultadoReserva } from '../../src/agenda/pedido-reserva.js';
import { CabecalhoPainel, type LinksPainel } from './painel-cabecalho';

export type AcoesPainel = {
  mudarStatus: (agendamentoId: string, para: StatusAgendamento) => Promise<ResultadoPainel>;
  registrarLembrete: (agendamentoId: string) => Promise<ResultadoPainel>;
  agendar: (pedido: PedidoDoDono) => Promise<ResultadoReserva>;
  bloquear: (pedido: PedidoBloqueio) => Promise<ResultadoPainel>;
  desbloquear: (bloqueioId: string) => Promise<ResultadoPainel>;
};
type Props = {
  dados: AgendaDoDia;
  email: string;
  acoes: AcoesPainel;
  aoSair: () => Promise<void>;
  /** Na demonstração estática não há servidor: a troca de dia acontece na própria página. */
  aoMudarDia?: (dia: string) => void;
  /** Endereços das abas; a demonstração estática troca os padrões. */
  links?: LinksPainel;
};

const rotulos: Record<StatusAgendamento, string> = { confirmado: 'Confirmado', atendido: 'Atendido', faltou: 'Faltou', cancelado: 'Cancelado' };
function dataTexto(dia: string, opcoes: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('pt-BR', { ...opcoes, timeZone: 'UTC' }).format(new Date(`${dia}T12:00:00Z`));
}

export function PainelAgenda({ dados, email, acoes, aoSair, aoMudarDia, links }: Props) {
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState<string | null>(null);
  /** Profissional cuja agenda está à mostra; vazio mostra a de todos. */
  const [filtro, setFiltro] = useState('');
  const { negocio } = dados;
  const nomeNegocio = negocio.nome.replace(' — demonstração', '');
  const hora = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: negocio.fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const ehHoje = dados.dia === dados.hoje;

  /** Roda uma ação do painel e mostra o resultado; a página recarrega os dados sozinha. */
  function executar(acao: () => Promise<ResultadoPainel>, sucesso?: string) {
    setAviso(null);
    iniciar(async () => {
      try {
        const resultado = await acao();
        if (!resultado.ok) setAviso({ tipo: 'erro', texto: resultado.mensagem });
        else if (sucesso) setAviso({ tipo: 'ok', texto: sucesso });
      } catch { setAviso({ tipo: 'erro', texto: 'Não foi possível concluir agora. Confira a conexão e tente de novo.' }); }
    });
  }
  const irPara = (dia: string) => aoMudarDia
    ? { href: '#', onClick: (e: React.MouseEvent) => { e.preventDefault(); setAviso(null); aoMudarDia(dia); } }
    : { href: `/painel?dia=${dia}` };

  // Com um só profissional a tela fica como sempre foi: sem filtro e sem "com quem".
  const varios = dados.profissionais.length > 1;
  const filtrado = varios ? dados.profissionais.find((p) => p.id === filtro) : undefined;
  const visiveis = dados.agendamentos.filter((a) => !filtrado || a.profissionalId === filtrado.id);
  const ativos = visiveis.filter((a) => a.status !== 'cancelado');
  const cancelados = visiveis.filter((a) => a.status === 'cancelado');
  const bloqueios = dados.bloqueios.filter((b) => !filtrado || b.profissionalId === null || b.profissionalId === filtrado.id);
  const linhaDoTempo = [
    ...ativos.map((a) => ({ tipo: 'agendamento' as const, inicio: a.inicio, a })),
    ...bloqueios.map((b) => ({ tipo: 'bloqueio' as const, inicio: b.inicio, b })),
  ].sort((x, y) => x.inicio.localeCompare(y.inicio));
  /** Quem atende, quando isso não é óbvio: há vários, ou o horário é de alguém que já saiu. */
  const comQuem = (a: ItemAgenda) => (varios || !dados.profissionais.some((p) => p.id === a.profissionalId) ? a.profissionalNome : null);
  const contar = (status: StatusAgendamento) => visiveis.filter((a) => a.status === status).length;
  const resumo = filtrado ? { confirmados: contar('confirmado'), atendidos: contar('atendido'), faltas: contar('faltou'),
    previstoCentavos: visiveis.filter((a) => a.status === 'confirmado' || a.status === 'atendido').reduce((total, a) => total + a.precoCentavos, 0) } : dados.resumo;

  return <div className="site painel">
    <CabecalhoPainel nomeNegocio={nomeNegocio} demonstracao={negocio.demonstracao} email={email} aba="agenda" aoSair={aoSair}
      links={links ?? { inicio: '/painel', agenda: '/painel', configuracoes: '/painel/configuracoes', paginaPublica: `/${negocio.slug}` }} />
    <main className="painel-layout">
      <section className="painel-dia" aria-labelledby="dia-titulo">
        <div className="dia-navegacao">
          <a className="seta" aria-label="Dia anterior" {...irPara(dados.diaAnterior)}>←</a>
          <div>
            <p className="sobretitulo">{ehHoje ? 'HOJE' : 'AGENDA DE'}</p>
            <h1 id="dia-titulo">{dataTexto(dados.dia, { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
          </div>
          <a className="seta" aria-label="Dia seguinte" {...irPara(dados.diaSeguinte)}>→</a>
          {!ehHoje && <a className="voltar-hoje" {...irPara(dados.hoje)}>Voltar para hoje</a>}
        </div>
        {varios && <div className="profissionais filtro" role="group" aria-label="Agenda de quem">
          <button type="button" className={`profissional ${filtrado ? '' : 'ativo'}`} aria-pressed={!filtrado} onClick={() => setFiltro('')}>Todos</button>
          {dados.profissionais.map((p) => <button key={p.id} type="button" className={`profissional ${filtrado?.id === p.id ? 'ativo' : ''}`} aria-pressed={filtrado?.id === p.id} onClick={() => setFiltro(p.id)}>{p.nome}</button>)}
        </div>}
        <ul className="resumo-dia" aria-label={filtrado ? `Resumo do dia de ${filtrado.nome}` : 'Resumo do dia'}>
          <li><strong>{resumo.confirmados}</strong> a atender</li>
          <li><strong>{resumo.atendidos}</strong> atendidos</li>
          <li><strong>{resumo.faltas}</strong> {resumo.faltas === 1 ? 'falta' : 'faltas'}</li>
          <li><strong>{reais.format(resumo.previstoCentavos / 100)}</strong> previstos</li>
        </ul>
        {aviso && <p className={aviso.tipo === 'erro' ? 'erro' : 'sucesso'} role="status">{aviso.texto}</p>}

        {linhaDoTempo.length === 0 ? <p className="vazio">{filtrado ? `Nenhum cliente marcado com ${filtrado.nome} neste dia.` : 'Nenhum cliente marcado neste dia.'}</p> : <ol className="linha-do-tempo">
          {linhaDoTempo.map((item) => item.tipo === 'bloqueio'
            ? <li key={item.b.id} className="item bloqueado">
              <div className="item-hora"><strong>{hora(item.b.inicio)}</strong><span>{hora(item.b.fim)}</span></div>
              <div className="item-corpo"><strong>{item.b.motivo}</strong><span>{item.b.profissionalNome ? `Bloqueado para ${item.b.profissionalNome}` : varios ? 'Bloqueado para todos' : 'Horário bloqueado'}</span></div>
              <div className="item-acoes"><button type="button" disabled={ocupado} onClick={() => executar(() => acoes.desbloquear(item.b.id), 'Horário liberado.')}>Liberar</button></div>
            </li>
            : <Agendamento key={item.a.id} a={item.a} profissional={comQuem(item.a)} hora={hora} agora={dados.agora} ocupado={ocupado}
                confirmando={confirmandoCancelamento === item.a.id}
                aoPedirCancelamento={() => setConfirmandoCancelamento(item.a.id)}
                aoDesistir={() => setConfirmandoCancelamento(null)}
                aoMudar={(para, sucesso) => { setConfirmandoCancelamento(null); executar(() => acoes.mudarStatus(item.a.id, para), sucesso); }} />)}
        </ol>}

        {cancelados.length > 0 && <details className="cancelados">
          <summary>{cancelados.length} {cancelados.length === 1 ? 'cancelado' : 'cancelados'} neste dia</summary>
          <ul>{cancelados.map((a) => <li key={a.id}>{hora(a.inicio)} · {a.clienteNome} · {a.servicoNome}{comQuem(a) ? ` · com ${comQuem(a)}` : ''}</li>)}</ul>
        </details>}
      </section>

      <aside className="painel-lateral">
        <Lembretes dados={dados} hora={hora} ocupado={ocupado} aoRegistrar={(id) => executar(() => acoes.registrarLembrete(id))} />
        {dados.podeAgendar && <NovoAgendamento key={`novo-${dados.dia}-${dados.agendamentos.length}-${filtrado?.id ?? ''}`} dados={dados} profissionalInicial={filtrado?.id ?? ''} hora={hora} acoes={acoes} aoAvisar={setAviso} />}
        <NovoBloqueio key={`bloqueio-${dados.dia}-${dados.bloqueios.length}-${filtrado?.id ?? ''}`} dia={dados.dia} ocupado={ocupado}
          profissionais={varios ? dados.profissionais : []} profissionalInicial={filtrado?.id ?? ''}
          aoBloquear={(pedido) => executar(() => acoes.bloquear(pedido), 'Horário bloqueado.')} />
      </aside>
    </main>
    <footer><span>Painel de {nomeNegocio}</span><span>Feito com <b>agendaki</b> · v0.7.0</span></footer>
  </div>;
}

function Agendamento({ a, profissional, hora, agora, ocupado, confirmando, aoPedirCancelamento, aoDesistir, aoMudar }: {
  a: ItemAgenda; profissional: string | null; hora: (iso: string) => string; agora: string; ocupado: boolean; confirmando: boolean;
  aoPedirCancelamento: () => void; aoDesistir: () => void; aoMudar: (para: StatusAgendamento, sucesso?: string) => void;
}) {
  const comecou = a.inicio <= agora;
  const telefone = normalizarTelefone(a.clienteTelefone);
  return <li className={`item ${a.status}`}>
    <div className="item-hora"><strong>{hora(a.inicio)}</strong><span>{hora(a.fim)}</span></div>
    <div className="item-corpo">
      <strong>{a.clienteNome}</strong>
      <span>{a.servicoNome} · {reais.format(a.precoCentavos / 100)}{profissional ? ` · com ${profissional}` : ''}</span>
      <span>{telefone ? formatarTelefone(telefone) : 'Sem telefone'}</span>
    </div>
    <div className="item-acoes">
      {a.status !== 'confirmado' && <span className={`situacao ${a.status}`}>{rotulos[a.status]}</span>}
      {a.status === 'confirmado' && comecou && <>
        <button type="button" className="principal" disabled={ocupado} onClick={() => aoMudar('atendido')}>Atendido</button>
        <button type="button" disabled={ocupado} onClick={() => aoMudar('faltou')}>Faltou</button>
      </>}
      {a.status === 'confirmado' && (confirmando
        ? <><button type="button" className="perigo" disabled={ocupado} onClick={() => aoMudar('cancelado', 'Horário cancelado. A vaga voltou a ficar livre.')}>Confirmar cancelamento</button><button type="button" onClick={aoDesistir}>Manter</button></>
        : <button type="button" disabled={ocupado} onClick={aoPedirCancelamento}>Cancelar</button>)}
      {(a.status === 'atendido' || a.status === 'faltou') && <button type="button" disabled={ocupado} onClick={() => aoMudar('confirmado')}>Desfazer</button>}
    </div>
  </li>;
}

function Lembretes({ dados, hora, ocupado, aoRegistrar }: {
  dados: AgendaDoDia; hora: (iso: string) => string; ocupado: boolean; aoRegistrar: (id: string) => void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const { dia, agendamentos } = dados.lembretes;
  const nomeNegocio = dados.negocio.nome.replace(' — demonstração', '');
  if (!dia) {
    return <section className="cartao" aria-labelledby="lembretes-titulo"><h2 id="lembretes-titulo">Lembretes</h2><p className="consulta">Nenhum cliente marcado para os próximos dias. Quando houver, eles aparecem aqui com a mensagem pronta.</p></section>;
  }
  const quando = dataTexto(dia, { weekday: 'long', day: 'numeric', month: 'long' });
  const varios = dados.profissionais.length > 1;
  const mensagem = (a: ItemAgenda) => `Olá, ${a.clienteNome.split(' ')[0]}! Aqui é da ${nomeNegocio}. Passando para lembrar do seu horário: ${a.servicoNome.toLowerCase()}${varios ? ` com ${a.profissionalNome}` : ''}, ${quando}, às ${hora(a.inicio)}. Se não puder vir, me avise por aqui. Até lá!`;
  const enviados = agendamentos.filter((a) => a.lembreteEm).length;
  return <section className="cartao" aria-labelledby="lembretes-titulo">
    <h2 id="lembretes-titulo">Lembretes de {quando.split(',')[0]}</h2>
    <p className="consulta">{enviados} de {agendamentos.length} enviados. Um toque abre o WhatsApp com a mensagem pronta.</p>
    <ul className="lembretes">{agendamentos.map((a) => {
      const telefone = dados.negocio.demonstracao ? null : normalizarTelefone(a.clienteTelefone);
      return <li key={a.id}>
        <div><strong>{hora(a.inicio)} · {a.clienteNome}</strong><span>{a.lembreteEm ? `Enviado às ${hora(a.lembreteEm)} ✓` : varios ? `${a.servicoNome} · com ${a.profissionalNome}` : a.servicoNome}</span></div>
        {telefone
          ? <a className="botao pequeno" href={`https://wa.me/55${telefone}?text=${encodeURIComponent(mensagem(a))}`} target="_blank" rel="noopener noreferrer" onClick={() => aoRegistrar(a.id)}>{a.lembreteEm ? 'Reenviar' : 'Lembrar'}</a>
          : <button type="button" className="botao pequeno secundario" disabled={ocupado} onClick={() => { setAberta(aberta === a.id ? null : a.id); if (dados.negocio.demonstracao && !a.lembreteEm) aoRegistrar(a.id); }}>{dados.negocio.demonstracao ? 'Ver mensagem' : 'Sem telefone'}</button>}
        {aberta === a.id && <p className="mensagem">{mensagem(a)}</p>}
      </li>;
    })}</ul>
    {dados.negocio.demonstracao && <p className="consulta">Na demonstração a mensagem só é exibida. Com um negócio de verdade, o botão abre o WhatsApp do cliente.</p>}
  </section>;
}

function NovoAgendamento({ dados, profissionalInicial, hora, acoes, aoAvisar }: {
  dados: AgendaDoDia; profissionalInicial: string; hora: (iso: string) => string; acoes: AcoesPainel; aoAvisar: (aviso: { tipo: 'erro' | 'ok'; texto: string } | null) => void;
}) {
  const varios = dados.profissionais.length > 1;
  /** Vazio: fica com quem estiver livre. */
  const [profissionalId, setProfissionalId] = useState(profissionalInicial);
  const [servicoId, setServicoId] = useState(dados.servicos[0]?.id ?? '');
  const [inicio, setInicio] = useState('');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [enviando, iniciar] = useTransition();
  const servico = dados.servicos.find((s) => s.id === servicoId);
  const horarios = (servico?.horarios ?? []).filter((h) => !profissionalId || h.profissionais.includes(profissionalId));
  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!servico || !inicio) { aoAvisar({ tipo: 'erro', texto: 'Escolha o serviço e o horário.' }); return; }
    aoAvisar(null);
    iniciar(async () => {
      try {
        const resultado = await acoes.agendar({ servicoId, inicio, nome, telefone, ...(profissionalId ? { profissionalId } : {}) });
        aoAvisar(resultado.ok
          ? { tipo: 'ok', texto: `Horário de ${resultado.cliente.nome} marcado para as ${hora(resultado.inicio)}${resultado.variosProfissionais ? `, com ${resultado.profissional.nome}` : ''}.` }
          : { tipo: 'erro', texto: resultado.motivo === 'dados_invalidos' ? 'Confira o nome. O telefone é opcional, mas se preencher precisa ter DDD.' : resultado.mensagem });
      } catch { aoAvisar({ tipo: 'erro', texto: 'Não foi possível agendar agora. Tente de novo.' }); }
    });
  }
  return <section className="cartao" aria-labelledby="novo-titulo">
    <h2 id="novo-titulo">Marcar para um cliente</h2>
    <p className="consulta">Para quem ligou ou veio ao balcão, em {dataTexto(dados.dia, { day: 'numeric', month: 'long' })}.</p>
    {dados.servicos.length === 0 ? <p className="consulta">Cadastre um serviço para poder agendar.</p> : <form className="formulario" onSubmit={enviar}>
      <label className="campo"><span>Serviço</span><select value={servicoId} onChange={(e) => { setServicoId(e.target.value); setInicio(''); }}>
        {dados.servicos.map((s) => <option key={s.id} value={s.id}>{s.nome} · {s.duracaoMin} min · {reais.format(s.precoCentavos / 100)}</option>)}
      </select></label>
      {varios && <label className="campo"><span>Profissional</span><select value={profissionalId} onChange={(e) => { setProfissionalId(e.target.value); setInicio(''); }}>
        <option value="">Quem estiver livre</option>
        {dados.profissionais.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select></label>}
      <label className="campo"><span>Horário</span><select value={inicio} onChange={(e) => setInicio(e.target.value)} required>
        <option value="">{horarios.length ? 'Escolha' : 'Sem horário livre'}</option>
        {horarios.map((h) => <option key={h.inicio} value={h.inicio}>{hora(h.inicio)}</option>)}
      </select></label>
      <label className="campo"><span>Nome do cliente</span><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} required /></label>
      <label className="campo"><span>WhatsApp (opcional)</span><input value={telefone} onChange={(e) => setTelefone(e.target.value)} type="tel" inputMode="tel" placeholder="(34) 99999-9999" maxLength={20} /></label>
      <button className="botao" type="submit" disabled={enviando || !horarios.length}>{enviando ? 'Marcando…' : 'Marcar horário'}</button>
    </form>}
  </section>;
}

function NovoBloqueio({ dia, ocupado, profissionais, profissionalInicial, aoBloquear }: {
  dia: string; ocupado: boolean; aoBloquear: (pedido: PedidoBloqueio) => void;
  /** Vazio quando só há um profissional: aí o bloqueio é sempre do negócio inteiro. */
  profissionais: AgendaDoDia['profissionais']; profissionalInicial: string;
}) {
  /** Vazio: o bloqueio vale para todos. */
  const [profissionalId, setProfissionalId] = useState(profissionalInicial);
  const [das, setDas] = useState('12:00');
  const [ate, setAte] = useState('13:00');
  const [motivo, setMotivo] = useState('');
  return <section className="cartao" aria-labelledby="bloqueio-titulo">
    <h2 id="bloqueio-titulo">Bloquear um horário</h2>
    <p className="consulta">Almoço, folga ou compromisso em {dataTexto(dia, { day: 'numeric', month: 'long' })}. {profissionais.length ? 'Vale para todos ou só para um profissional.' : 'Ninguém consegue marcar nesse intervalo.'}</p>
    <form className="formulario" onSubmit={(e) => { e.preventDefault(); aoBloquear({ dia, das, ate, motivo, profissionalId: profissionalId || null }); }}>
      {profissionais.length > 0 && <label className="campo"><span>Para quem</span><select value={profissionalId} onChange={(e) => setProfissionalId(e.target.value)}>
        <option value="">Todos</option>
        {profissionais.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select></label>}
      <div className="dupla">
        <label className="campo"><span>Das</span><input type="time" value={das} onChange={(e) => setDas(e.target.value)} required /></label>
        <label className="campo"><span>Até</span><input type="time" value={ate} onChange={(e) => setAte(e.target.value)} required /></label>
      </div>
      <label className="campo"><span>Motivo (opcional)</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={80} placeholder="Almoço" /></label>
      <button className="botao secundario" type="submit" disabled={ocupado}>Bloquear</button>
    </form>
  </section>;
}
