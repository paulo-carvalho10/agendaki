import { randomBytes } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { gerarHashSenha } from '../auth/sessao.js';
import { codigoPostgres } from '../agenda/reservar.js';
import { normalizarNome, normalizarTelefone } from '../agenda/pedido-reserva.js';

type Banco = PostgresJsDatabase<typeof schema>;

/** Endereços que já são páginas do sistema e não podem virar nome de negócio. */
export const SLUGS_RESERVADOS = ['painel', 'entrar', 'sair', 'cancelar', 'api', 'admin', 'agendaki', 'favicon', 'robots', 'sitemap'] as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SENHA_MINIMA = 12;

/** "Salão da Ana & Cia." vira "salao-da-ana-cia". */
export function gerarSlug(nome: string) {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

export type NovoNegocio = Readonly<{ nome: string; telefone: string; email: string; slug?: string; senha?: string; fuso?: string }>;
export type ResultadoNovoNegocio =
  | { ok: true; negocioId: string; slug: string; email: string; /** Mostrada uma única vez: o banco guarda só o hash. */ senha: string }
  | { ok: false; mensagem: string };

/**
 * Cadastra um negócio e o acesso do dono. Começa com expediente de segunda a
 * sexta, das 9h às 18h, e sem serviços: o dono ajusta os dois pelo painel.
 */
export async function criarNegocio(db: Banco, dados: NovoNegocio): Promise<ResultadoNovoNegocio> {
  const recusa = (mensagem: string) => ({ ok: false as const, mensagem });
  if (!dados || [dados.nome, dados.telefone, dados.email].some((campo) => typeof campo !== 'string')) return recusa('Informe nome, telefone e email.');
  const nome = normalizarNome(dados.nome);
  if (nome.length < 2 || nome.length > 80) return recusa('O nome do negócio precisa ter de 2 a 80 letras.');
  const telefone = normalizarTelefone(dados.telefone);
  if (!telefone) return recusa('Confira o WhatsApp do negócio, com DDD.');
  const email = dados.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return recusa('Confira o email do dono.');
  const slug = dados.slug === undefined ? gerarSlug(nome) : dados.slug;
  if (!SLUG.test(slug) || slug.length > 60) return recusa('O endereço da página só pode ter letras minúsculas, números e hífens.');
  if ((SLUGS_RESERVADOS as readonly string[]).includes(slug)) return recusa(`O endereço "${slug}" é usado pelo sistema. Escolha outro.`);
  const senha = dados.senha ?? randomBytes(9).toString('base64url');
  if (senha.length < SENHA_MINIMA || senha.length > 200) return recusa(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);

  try {
    return await db.transaction(async (tx) => {
      const [negocio] = await tx.insert(schema.negocio).values({ nome, slug, telefone, ...(dados.fuso ? { fuso: dados.fuso } : {}) }).returning({ id: schema.negocio.id });
      await tx.insert(schema.usuario).values({ negocioId: negocio.id, email, senhaHash: gerarHashSenha(senha) });
      await tx.insert(schema.horarioFuncionamento).values([1, 2, 3, 4, 5].map((diaSemana) => ({ negocioId: negocio.id, diaSemana, abre: '09:00', fecha: '18:00' })));
      return { ok: true as const, negocioId: negocio.id, slug, email, senha };
    });
  } catch (erro) {
    const codigo = codigoPostgres(erro);
    if (codigo === '23505') return recusa('Já existe um negócio com esse endereço ou um dono com esse email.');
    if (codigo === '23514') return recusa('Fuso horário desconhecido.');
    throw erro;
  }
}
