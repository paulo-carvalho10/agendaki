import 'dotenv/config';
import { parseArgs } from 'node:util';
import { conectar } from '../src/db/client.js';
import { criarNegocio } from '../src/db/negocios.js';

// pnpm negocio:criar --nome "Barbearia do Zé" --telefone "(34) 99999-0000" --email dono@exemplo.com
// Opcionais: --slug barbearia-do-ze  --senha "uma senha com 12+ caracteres"  --fuso America/Sao_Paulo
const { values } = parseArgs({ options: {
  nome: { type: 'string' }, telefone: { type: 'string' }, email: { type: 'string' },
  slug: { type: 'string' }, senha: { type: 'string' }, fuso: { type: 'string' },
} });
if (!values.nome || !values.telefone || !values.email) {
  throw new Error('Uso: pnpm negocio:criar --nome "Nome do negócio" --telefone "(DDD) número" --email dono@exemplo.com [--slug endereco] [--senha ...] [--fuso ...]');
}
if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no servidor.');

const { client, db } = conectar(process.env.DATABASE_URL);
try {
  const resultado = await criarNegocio(db, { nome: values.nome, telefone: values.telefone, email: values.email, slug: values.slug, senha: values.senha, fuso: values.fuso });
  if (!resultado.ok) { console.error(`Não criado: ${resultado.mensagem}`); process.exitCode = 1; }
  else {
    console.log('Negócio criado.');
    console.log(`  Página do cliente: /${resultado.slug}`);
    console.log(`  Painel do dono:    /entrar`);
    console.log(`  Email:             ${resultado.email}`);
    console.log(`  Senha:             ${resultado.senha}`);
    console.log('Anote a senha agora: o banco guarda só o hash e ela não aparece de novo.');
    console.log('O expediente começa de segunda a sexta, 9h às 18h, e sem serviços. O dono ajusta os dois em Configurações.');
  }
} finally {
  await client.end();
}
