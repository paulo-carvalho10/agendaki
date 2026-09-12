import { createRoot } from 'react-dom/client';
import { AgendaPublica } from '../app/components/agenda-publica.js';
import { criarDadosDemo } from '../src/agenda/dados-demo.js';

createRoot(document.getElementById('root')!).render(
  <AgendaPublica dados={criarDadosDemo()} homeHref="/agendaki/" />,
);
