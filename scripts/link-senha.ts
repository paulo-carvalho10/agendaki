import 'dotenv/config';
import { parseArgs } from 'node:util';
import { conectar } from '../src/db/client.js';
import { VALIDADE_REDEFINICAO_MIN, criarLinkRedefinicao } from '../src/auth/senha.js';

// Para o dono que esqueceu a senha. Antes de rodar, confirme que quem pediu é mesmo o dono.
// pnpm negocio:link-senha --email dono@exemplo.com [--site https://agendaki-ten.vercel.app]
const { values } = parseArgs({ options: { email: { type: 'string' }, site: { type: 'string' } } });
if (!values.email) throw new Error('Uso: pnpm negocio:link-senha --email dono@exemplo.com [--site https://endereco-do-agendaki]');
if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no servidor.');
const site = (values.site ?? process.env.SITE_URL ?? '').replace(/\/+$/, '');

const { client, db } = conectar(process.env.DATABASE_URL);
try {
  const resultado = await criarLinkRedefinicao(db, values.email);
  if (!resultado.ok) { console.error(`Link não gerado: ${resultado.mensagem}`); process.exitCode = 1; }
  else {
    console.log(`Link para ${resultado.email} (${resultado.negocioNome}):`);
    console.log(`  ${site}/redefinir/${resultado.token}`);
    if (!site) console.log('  (coloque na frente o endereço do site, ou passe --site)');
    console.log(`Vale por ${VALIDADE_REDEFINICAO_MIN} minutos e uma única vez. Um link novo cancela este.`);
    console.log('Mande só para o dono: quem abrir o link escolhe a senha do painel.');
  }
} finally {
  await client.end();
}
