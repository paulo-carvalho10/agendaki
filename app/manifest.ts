import type { MetadataRoute } from 'next';

// Permite pôr o painel na tela de início do celular. No iPhone, é isso que libera os avisos.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Agendaki · Painel', short_name: 'Agendaki', description: 'A agenda do seu negócio.',
    start_url: '/painel', scope: '/', display: 'standalone', lang: 'pt-BR',
    background_color: '#f4f7f6', theme_color: '#192d32',
    icons: [
      { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
