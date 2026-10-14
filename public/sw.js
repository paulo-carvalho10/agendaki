// Recebe os avisos de reserva nova e de cancelamento enviados ao dono.
// Não guarda páginas em cache: a agenda é sempre lida do servidor.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()));

const janelas = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });
// O toque só leva para dentro do painel deste site, nunca para um endereço que veio na mensagem.
const destino = (url) => {
  const alvo = new URL(typeof url === 'string' ? url : '/painel', self.location.origin);
  return alvo.origin === self.location.origin && alvo.pathname.startsWith('/painel') ? alvo.href : new URL('/painel', self.location.origin).href;
};

self.addEventListener('push', (evento) => {
  let aviso = { titulo: 'Agendaki', corpo: 'Há novidades na sua agenda.', url: '/painel' };
  try { aviso = { ...aviso, ...evento.data.json() }; } catch { /* sem conteúdo legível: fica o texto padrão */ }
  evento.waitUntil(Promise.all([
    self.registration.showNotification(String(aviso.titulo), { body: String(aviso.corpo), icon: '/icones/icone-192.png', lang: 'pt-BR', data: { url: aviso.url } }),
    // Com o painel aberto, a agenda se atualiza na hora.
    janelas().then((abertas) => abertas.forEach((janela) => janela.postMessage({ tipo: 'agenda-mudou' }))),
  ]));
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const url = destino(evento.notification.data && evento.notification.data.url);
  evento.waitUntil(janelas().then((abertas) => {
    const painel = abertas.find((janela) => new URL(janela.url).pathname.startsWith('/painel'));
    if (!painel) return self.clients.openWindow(url);
    return painel.navigate(url).then((janela) => (janela || painel).focus()).catch(() => self.clients.openWindow(url));
  }));
});
