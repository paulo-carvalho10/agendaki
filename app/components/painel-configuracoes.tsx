'use client';
import { useEffect, useState, useTransition } from 'react';
import type { Configuracao, DadosProfissional, DadosServico, DiaAberto } from '../../src/painel/configuracao.js';
import type { ResultadoPainel } from '../../src/painel/acoes.js';
import { formatarTelefone, normalizarTelefone } from '../../src/agenda/pedido-reserva.js';
import { CabecalhoPainel, type LinksPainel } from './painel-cabecalho';

export type AcoesConfiguracao = {
  salvarNegocio: (dados: { nome: string; telefone: string }) => Promise<ResultadoPainel>;
  salvarServico: (dados: DadosServico) => Promise<ResultadoPainel>;
  definirServicoAtivo: (servicoId: string, ativo: boolean) => Promise<ResultadoPainel>;
  salvarProfissional: (dados: DadosProfissional) => Promise<ResultadoPainel>;
  definirProfissionalAtivo: (profissionalId: string, ativo: boolean) => Promise<ResultadoPainel>;
  salvarFuncionamento: (dias: DiaAberto[]) => Promise<ResultadoPainel>;
};
type Aviso = { tipo: 'erro' | 'ok'; texto: string } | null;

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const nomesDias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
// A semana do comerciante começa na segunda.
const ordemDias = [1, 2, 3, 4, 5, 6, 0];

/** "40", "40,5", "R$ 40,00" e "1.250,00" viram centavos. Devolve null quando não é um valor. */
export function lerPreco(texto: string) {
  const limpo = texto.replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  return Math.round(Number(limpo) * 100);
}
const precoTexto = (centavos: number) => (centavos / 100).toFixed(2).replace('.', ',');

export function PainelConfiguracoes({ dados, email, acoes, aoSair, links }: {
  dados: Configuracao; email: string; acoes: AcoesConfiguracao; aoSair: () => Promise<void>; links?: LinksPainel;
}) {
  const [aviso, setAviso] = useState<Aviso>(null);
  const [ocupado, iniciar] = useTransition();
  const nomeNegocio = dados.negocio.nome.replace(' — demonstração', '');
  function executar(acao: () => Promise<ResultadoPainel>, sucesso: string, depois?: () => void) {
    setAviso(null);
    iniciar(async () => {
      try {
        const resultado = await acao();
        if (resultado.ok) { setAviso({ tipo: 'ok', texto: sucesso }); depois?.(); }
        else setAviso({ tipo: 'erro', texto: resultado.mensagem });
      } catch { setAviso({ tipo: 'erro', texto: 'Não foi possível salvar agora. Confira a conexão e tente de novo.' }); }
    });
  }
  return <div className="site painel">
    <CabecalhoPainel nomeNegocio={nomeNegocio} demonstracao={dados.negocio.demonstracao} email={email} aba="configuracoes" aoSair={aoSair}
      links={links ?? { inicio: '/painel', agenda: '/painel', configuracoes: '/painel/configuracoes', paginaPublica: `/${dados.negocio.slug}` }} />
    <main className="config-layout">
      <div className="config-topo">
        <p className="sobretitulo">CONFIGURAÇÕES</p>
        <h1>O que você oferece, quem atende e quando.</h1>
        {aviso && <p className={aviso.tipo === 'erro' ? 'erro' : 'sucesso'} role="status">{aviso.texto}</p>}
      </div>
      <div className="config-coluna">
        <Servicos dados={dados} ocupado={ocupado} executar={executar} acoes={acoes} aoAvisar={setAviso} />
        <Profissionais dados={dados} ocupado={ocupado} executar={executar} acoes={acoes} aoAvisar={setAviso} />
      </div>
      <div className="config-coluna">
        <Funcionamento key={JSON.stringify(dados.funcionamento)} dados={dados} ocupado={ocupado}
          aoSalvar={(dias) => executar(() => acoes.salvarFuncionamento(dias), 'Horário de funcionamento salvo.')} />
        <Negocio key={`${dados.negocio.nome}|${dados.negocio.telefone}`} dados={dados} ocupado={ocupado}
          aoSalvar={(n) => executar(() => acoes.salvarNegocio(n), 'Dados do negócio salvos.')} />
      </div>
    </main>
    <footer><span>Painel de {nomeNegocio}</span><span>Feito com <b>agendaki</b> · v0.7.0</span></footer>
  </div>;
}

type Executar = (acao: () => Promise<ResultadoPainel>, sucesso: string, depois?: () => void) => void;

function Servicos({ dados, ocupado, executar, acoes, aoAvisar }: {
  dados: Configuracao; ocupado: boolean; executar: Executar; acoes: AcoesConfiguracao; aoAvisar: (aviso: Aviso) => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [versaoNovo, setVersaoNovo] = useState(0);
  function salvar(id: string | undefined, campos: { nome: string; duracao: string; preco: string }, depois: () => void) {
    const precoCentavos = lerPreco(campos.preco);
    const duracaoMin = Number(campos.duracao);
    if (precoCentavos === null) { aoAvisar({ tipo: 'erro', texto: 'Confira o preço. Exemplos: 40 ou 40,00.' }); return; }
    executar(() => acoes.salvarServico({ id, nome: campos.nome, duracaoMin, precoCentavos }), id ? 'Serviço alterado.' : 'Serviço criado.', depois);
  }
  return <section className="cartao" aria-labelledby="servicos-config-titulo">
    <h2 id="servicos-config-titulo">Serviços</h2>
    <p className="consulta">É o que o cliente escolhe na página de agendamento. A duração define de quanto em quanto tempo cabe um atendimento.</p>
    {dados.servicos.length === 0 && <p className="vazio">Nenhum serviço ainda. Crie o primeiro abaixo para a página começar a oferecer horários.</p>}
    <ul className="lista-servicos">{dados.servicos.map((s) => <li key={s.id} className={s.ativo ? '' : 'inativo'}>
      {editando === s.id
        ? <FormularioServico inicial={{ nome: s.nome, duracao: String(s.duracaoMin), preco: precoTexto(s.precoCentavos) }} rotulo="Salvar" ocupado={ocupado}
            aoCancelar={() => setEditando(null)} aoSalvar={(campos) => salvar(s.id, campos, () => setEditando(null))} />
        : <>
          <div className="servico-linha"><strong>{s.nome}</strong><span>{s.duracaoMin} min · {reais.format(s.precoCentavos / 100)}{s.ativo ? '' : ' · desativado'}</span></div>
          <div className="item-acoes">
            <button type="button" disabled={ocupado} onClick={() => { aoAvisar(null); setEditando(s.id); }}>Editar</button>
            <button type="button" disabled={ocupado} onClick={() => executar(() => acoes.definirServicoAtivo(s.id, !s.ativo), s.ativo ? `${s.nome} saiu da página de agendamento.` : `${s.nome} voltou para a página de agendamento.`)}>{s.ativo ? 'Desativar' : 'Ativar'}</button>
          </div>
        </>}
    </li>)}</ul>
    <h3 className="subtitulo">Novo serviço</h3>
    <FormularioServico key={versaoNovo} inicial={{ nome: '', duracao: '30', preco: '' }} rotulo="Criar serviço" ocupado={ocupado}
      aoSalvar={(campos) => salvar(undefined, campos, () => setVersaoNovo((v) => v + 1))} />
  </section>;
}

function FormularioServico({ inicial, rotulo, ocupado, aoSalvar, aoCancelar }: {
  inicial: { nome: string; duracao: string; preco: string }; rotulo: string; ocupado: boolean;
  aoSalvar: (campos: { nome: string; duracao: string; preco: string }) => void; aoCancelar?: () => void;
}) {
  const [campos, setCampos] = useState(inicial);
  const mudar = (campo: keyof typeof campos) => (e: React.ChangeEvent<HTMLInputElement>) => setCampos({ ...campos, [campo]: e.target.value });
  return <form className="formulario" onSubmit={(e) => { e.preventDefault(); aoSalvar(campos); }}>
    <label className="campo"><span>Nome do serviço</span><input value={campos.nome} onChange={mudar('nome')} maxLength={60} placeholder="Corte" required /></label>
    <div className="dupla">
      <label className="campo"><span>Duração (min)</span><input type="number" inputMode="numeric" min={5} max={480} step={5} value={campos.duracao} onChange={mudar('duracao')} required /></label>
      <label className="campo"><span>Preço (R$)</span><input inputMode="decimal" value={campos.preco} onChange={mudar('preco')} placeholder="40,00" required /></label>
    </div>
    <div className="dupla">
      <button className="botao" type="submit" disabled={ocupado}>{rotulo}</button>
      {aoCancelar && <button className="botao secundario" type="button" onClick={aoCancelar}>Cancelar</button>}
    </div>
  </form>;
}

function Profissionais({ dados, ocupado, executar, acoes, aoAvisar }: {
  dados: Configuracao; ocupado: boolean; executar: Executar; acoes: AcoesConfiguracao; aoAvisar: (aviso: Aviso) => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [versaoNovo, setVersaoNovo] = useState(0);
  const atendendo = dados.profissionais.filter((p) => p.ativo).length;
  return <section className="cartao" aria-labelledby="profissionais-titulo">
    <h2 id="profissionais-titulo">Profissionais</h2>
    <p className="consulta">Quem atende. Com mais de um, o cliente escolhe com quem quer marcar e cada um tem a própria agenda. Todos fazem todos os serviços, no horário de funcionamento do negócio. Para a folga de um deles, use o bloqueio na agenda.</p>
    <ul className="lista-servicos">{dados.profissionais.map((p) => <li key={p.id} className={p.ativo ? '' : 'inativo'}>
      {editando === p.id
        ? <FormularioProfissional inicial={p.nome} rotulo="Salvar" ocupado={ocupado} aoCancelar={() => setEditando(null)}
            aoSalvar={(nome) => executar(() => acoes.salvarProfissional({ id: p.id, nome }), 'Nome alterado.', () => setEditando(null))} />
        : <>
          <div className="servico-linha"><strong>{p.nome}</strong><span>{p.ativo ? 'Atendendo' : 'Desativado'}</span></div>
          <div className="item-acoes">
            <button type="button" disabled={ocupado} onClick={() => { aoAvisar(null); setEditando(p.id); }}>Renomear</button>
            {/* O último que atende não pode sair: a página ficaria sem horários. */}
            {(!p.ativo || atendendo > 1) && <button type="button" disabled={ocupado} onClick={() => executar(() => acoes.definirProfissionalAtivo(p.id, !p.ativo), p.ativo ? `${p.nome} saiu da página de agendamento.` : `${p.nome} voltou a atender.`)}>{p.ativo ? 'Desativar' : 'Ativar'}</button>}
          </div>
        </>}
    </li>)}</ul>
    <h3 className="subtitulo">Novo profissional</h3>
    <FormularioProfissional key={versaoNovo} inicial="" rotulo="Adicionar profissional" ocupado={ocupado}
      aoSalvar={(nome) => executar(() => acoes.salvarProfissional({ nome }), 'Profissional adicionado. Ele já aparece na página de agendamento.', () => setVersaoNovo((v) => v + 1))} />
  </section>;
}

function FormularioProfissional({ inicial, rotulo, ocupado, aoSalvar, aoCancelar }: {
  inicial: string; rotulo: string; ocupado: boolean; aoSalvar: (nome: string) => void; aoCancelar?: () => void;
}) {
  const [nome, setNome] = useState(inicial);
  return <form className="formulario" onSubmit={(e) => { e.preventDefault(); aoSalvar(nome); }}>
    <label className="campo"><span>Nome do profissional</span><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Como o cliente conhece" required /></label>
    <div className="dupla">
      <button className="botao" type="submit" disabled={ocupado}>{rotulo}</button>
      {aoCancelar && <button className="botao secundario" type="button" onClick={aoCancelar}>Cancelar</button>}
    </div>
  </form>;
}

function Funcionamento({ dados, ocupado, aoSalvar }: { dados: Configuracao; ocupado: boolean; aoSalvar: (dias: DiaAberto[]) => void }) {
  const [dias, setDias] = useState(() => ordemDias.map((diaSemana) => {
    const faixa = dados.funcionamento.find((f) => f.diaSemana === diaSemana);
    return { diaSemana, aberto: Boolean(faixa), abre: faixa?.abre ?? '09:00', fecha: faixa?.fecha ?? '18:00' };
  }));
  const mudar = (diaSemana: number, parte: Partial<(typeof dias)[number]>) => setDias(dias.map((d) => d.diaSemana === diaSemana ? { ...d, ...parte } : d));
  if (!dados.simples) {
    return <section className="cartao" aria-labelledby="funcionamento-titulo"><h2 id="funcionamento-titulo">Horário de funcionamento</h2>
      <p className="consulta">Este negócio tem um expediente especial (mais de um turno no dia ou atendimento que vira a noite), configurado pelo suporte. Para mudar, fale com a gente.</p>
      <ul className="expediente">{dados.funcionamento.map((f, i) => <li key={i}>{nomesDias[f.diaSemana]} <span>{f.abre}–{f.fecha}{f.terminaDiaSeguinte ? ' (+1 dia)' : ''}</span></li>)}</ul>
    </section>;
  }
  return <section className="cartao" aria-labelledby="funcionamento-titulo">
    <h2 id="funcionamento-titulo">Horário de funcionamento</h2>
    <p className="consulta">Os dias desmarcados ficam fechados. Para o almoço ou uma folga, use o bloqueio na agenda. Horários já marcados continuam valendo.</p>
    <form className="formulario" onSubmit={(e) => { e.preventDefault(); aoSalvar(dias.filter((d) => d.aberto).map(({ diaSemana, abre, fecha }) => ({ diaSemana, abre, fecha }))); }}>
      <div className="semana">{dias.map((d) => <div key={d.diaSemana} className={`dia-semana ${d.aberto ? '' : 'fechado'}`}>
        <label className="marcar"><input type="checkbox" checked={d.aberto} onChange={(e) => mudar(d.diaSemana, { aberto: e.target.checked })} /><span>{nomesDias[d.diaSemana]}</span></label>
        {d.aberto ? <>
          <input type="time" aria-label={`${nomesDias[d.diaSemana]}: abre às`} value={d.abre} onChange={(e) => mudar(d.diaSemana, { abre: e.target.value })} required />
          <span aria-hidden="true">às</span>
          <input type="time" aria-label={`${nomesDias[d.diaSemana]}: fecha às`} value={d.fecha} onChange={(e) => mudar(d.diaSemana, { fecha: e.target.value })} required />
        </> : <span className="fechado-texto">Fechado</span>}
      </div>)}</div>
      <button className="botao" type="submit" disabled={ocupado}>Salvar horário</button>
    </form>
  </section>;
}

function Negocio({ dados, ocupado, aoSalvar }: { dados: Configuracao; ocupado: boolean; aoSalvar: (negocio: { nome: string; telefone: string }) => void }) {
  const telefoneAtual = normalizarTelefone(dados.negocio.telefone);
  const [nome, setNome] = useState(dados.negocio.nome.replace(' — demonstração', ''));
  const [telefone, setTelefone] = useState(telefoneAtual ? formatarTelefone(telefoneAtual) : '');
  const [copiado, setCopiado] = useState(false);
  // O endereço completo só existe no navegador; no servidor fica o caminho.
  const [origem, setOrigem] = useState('');
  useEffect(() => { setOrigem(window.location.origin); }, []);
  const endereco = `${origem}/${dados.negocio.slug}`;
  return <section className="cartao" aria-labelledby="negocio-titulo">
    <h2 id="negocio-titulo">Dados do negócio</h2>
    <p className="consulta">O WhatsApp é para onde o cliente manda a confirmação depois de agendar.</p>
    <form className="formulario" onSubmit={(e) => { e.preventDefault(); aoSalvar({ nome, telefone }); }}>
      <label className="campo"><span>Nome do negócio</span><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} required disabled={dados.negocio.demonstracao} /></label>
      <label className="campo"><span>WhatsApp com DDD</span><input value={telefone} onChange={(e) => setTelefone(e.target.value)} type="tel" inputMode="tel" placeholder="(34) 99999-9999" maxLength={20} required disabled={dados.negocio.demonstracao} /></label>
      {dados.negocio.demonstracao
        ? <p className="consulta">Na demonstração o nome e o WhatsApp ficam fixos, para nenhuma mensagem sair de verdade.</p>
        : <button className="botao" type="submit" disabled={ocupado}>Salvar dados</button>}
    </form>
    <h3 className="subtitulo">Endereço da sua página</h3>
    <p className="consulta">É o link que você divulga no Instagram e no WhatsApp.</p>
    <p className="link-cancelar"><a href={`/${dados.negocio.slug}`} target="_blank" rel="noopener noreferrer">{endereco}</a></p>
    <button className="botao secundario" type="button" onClick={async () => { try { await navigator.clipboard.writeText(endereco); setCopiado(true); } catch { /* o link segue visível */ } }}>{copiado ? 'Link copiado ✓' : 'Copiar link'}</button>
  </section>;
}
