import { notFound } from 'next/navigation';
import { bancoServidor } from '../../src/db/server.js';
import { obterPaginaPublica } from '../../src/agenda/pagina-publica.js';
import { AgendaPublica } from '../components/agenda-publica';
export const dynamic = 'force-dynamic';
export default async function Pagina({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) notFound();
  const dados = await obterPaginaPublica(bancoServidor(), slug);
  if (!dados) notFound();
  return <AgendaPublica dados={dados} />;
}
