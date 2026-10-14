import webpush from 'web-push';
import type { Enviador } from './push.js';

/** Chave pública que o navegador usa para criar a inscrição; null quando os avisos não estão configurados. */
export function chavePublicaDePush() {
  return process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? process.env.VAPID_PUBLIC_KEY : null;
}

/**
 * Envio de verdade, pelo protocolo Web Push. Devolve null quando o ambiente
 * não tem as chaves VAPID: aí o sistema funciona igual, só sem notificação.
 */
export function enviadorDePush(): Enviador | null {
  const publica = process.env.VAPID_PUBLIC_KEY;
  const privada = process.env.VAPID_PRIVATE_KEY;
  // Contato que os serviços de push exigem: um endereço https do próprio site ou um mailto.
  const contato = process.env.VAPID_SUBJECT;
  if (!publica || !privada || !contato) return null;
  return async (inscricao, conteudo) => {
    try {
      const resposta = await webpush.sendNotification(
        { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } }, conteudo,
        { vapidDetails: { subject: contato, publicKey: publica, privateKey: privada }, TTL: 60 * 60 * 12, urgency: 'high', timeout: 8000 });
      return resposta.statusCode;
    } catch (erro) {
      const codigo = (erro as { statusCode?: unknown }).statusCode;
      return typeof codigo === 'number' ? codigo : 0;
    }
  };
}
