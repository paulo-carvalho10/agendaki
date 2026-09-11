import Link from 'next/link';
export default function NaoEncontrado() { return <main className="estado"><span className="marca">agendaki<span>✳</span></span><h1>Não encontramos esse negócio.</h1><p>Confira o endereço que você recebeu.</p><Link className="botao" href="/barbearia-demo">Abrir demonstração</Link></main>; }
