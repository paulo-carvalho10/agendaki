'use client';
export default function Erro({ reset }: { reset: () => void }) {
  return <main className="estado"><span className="marca">agendaki<span>✳</span></span><h1>A agenda não carregou.</h1><p>Não foi possível consultar os horários agora. Tente novamente em instantes.</p><button className="botao" onClick={reset}>Tentar novamente</button></main>;
}
