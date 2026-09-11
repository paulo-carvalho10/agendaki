import 'server-only';
import { conectar } from './client.js';

const globalDb = globalThis as typeof globalThis & { agendaki?: ReturnType<typeof conectar> };
export function bancoServidor() {
  if (!process.env.DATABASE_URL) throw new Error('Banco não configurado no servidor.');
  globalDb.agendaki ??= conectar(process.env.DATABASE_URL);
  return globalDb.agendaki.db;
}
