import nodemailer from 'nodemailer';
import type { EnviadorEmail } from './senha.js';

/**
 * Envio por SMTP: serve qualquer provedor (Gmail com senha de app, Resend,
 * Zoho, o do domínio próprio). Null quando o ambiente não tem servidor e
 * remetente configurados: aí a tela "Esqueci minha senha" orienta a falar
 * com o suporte.
 */
export function enviadorDeEmail(): EnviadorEmail | null {
  const host = process.env.SMTP_HOST;
  const remetente = process.env.EMAIL_REMETENTE;
  if (!host || !remetente) return null;
  const porta = Number(process.env.SMTP_PORT ?? 587);
  const usuario = process.env.SMTP_USER;
  const transporte = nodemailer.createTransport({
    host, port: porta, secure: porta === 465,
    auth: usuario ? { user: usuario, pass: process.env.SMTP_PASS ?? '' } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  return async (m) => { await transporte.sendMail({ from: remetente, to: m.para, subject: m.assunto, text: m.texto, html: m.html }); };
}

/**
 * Endereço público do site, para montar o link do email. Nunca vem do
 * cabeçalho Host do pedido: um Host forjado mandaria o dono, com o token,
 * para outro site.
 */
export function enderecoDoSite(): string | null {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  return process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
}
