import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, uuid, text, integer, boolean, time, timestamp,
  check, unique, foreignKey, index,
} from 'drizzle-orm/pg-core';

export const statusAgendamento = pgEnum('status_agendamento', [
  'confirmado', 'atendido', 'faltou', 'cancelado',
]);

const instante = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const negocio = pgTable('negocio', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull(),
  slug: text('slug').notNull().unique(),
  telefone: text('telefone').notNull(),
  fuso: text('fuso').notNull().default('America/Sao_Paulo'),
  demonstracao: boolean('demonstracao').notNull().default(false),
  // Atualizado pelo trigger: serializa alterações de reservas e bloqueios.
  agendaRevisao: integer('agenda_revisao').notNull().default(0),
}, (t) => [check('negocio_slug_formato', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)]);

export const usuario = pgTable('usuario', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull().references(() => negocio.id),
  email: text('email').notNull().unique(),
  senhaHash: text('senha_hash').notNull(),
}, (t) => [check('usuario_email_normalizado', sql`${t.email} = lower(trim(${t.email}))`)]);

export const servico = pgTable('servico', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull().references(() => negocio.id),
  nome: text('nome').notNull(),
  duracaoMin: integer('duracao_min').notNull(),
  precoCentavos: integer('preco_centavos').notNull(),
  ativo: boolean('ativo').notNull().default(true),
}, (t) => [
  unique('servico_negocio_id_id_unique').on(t.negocioId, t.id),
  check('servico_duracao_positiva', sql`${t.duracaoMin} > 0`),
  check('servico_preco_nao_negativo', sql`${t.precoCentavos} >= 0`),
]);

export const horarioFuncionamento = pgTable('horario_funcionamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull().references(() => negocio.id),
  diaSemana: integer('dia_semana').notNull(),
  abre: time('abre').notNull(),
  fecha: time('fecha').notNull(),
  terminaDiaSeguinte: boolean('termina_dia_seguinte').notNull().default(false),
}, (t) => [
  check('horario_dia_valido', sql`${t.diaSemana} between 0 and 6`),
  check('horario_intervalo_valido', sql`(${t.terminaDiaSeguinte} and ${t.fecha} <= ${t.abre}) or (not ${t.terminaDiaSeguinte} and ${t.fecha} > ${t.abre})`),
  unique('horario_faixa_unica').on(t.negocioId, t.diaSemana, t.abre),
]);

export const bloqueio = pgTable('bloqueio', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull().references(() => negocio.id),
  inicio: instante('inicio').notNull(),
  fim: instante('fim').notNull(),
  motivo: text('motivo').notNull(),
}, (t) => [
  check('bloqueio_intervalo_valido', sql`${t.fim} > ${t.inicio}`),
  index('bloqueio_negocio_inicio_idx').on(t.negocioId, t.inicio),
]);

export const agendamento = pgTable('agendamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  negocioId: uuid('negocio_id').notNull().references(() => negocio.id),
  servicoId: uuid('servico_id').notNull(),
  clienteNome: text('cliente_nome').notNull(),
  clienteTelefone: text('cliente_telefone').notNull(),
  inicio: instante('inicio').notNull(),
  fim: instante('fim').notNull(),
  status: statusAgendamento('status').notNull().default('confirmado'),
  tokenCancelamentoHash: text('token_cancelamento_hash').notNull().unique(),
}, (t) => [
  foreignKey({ name: 'agendamento_servico_do_negocio_fk', columns: [t.negocioId, t.servicoId], foreignColumns: [servico.negocioId, servico.id] }),
  check('agendamento_intervalo_valido', sql`${t.fim} > ${t.inicio}`),
  check('agendamento_token_sha256', sql`${t.tokenCancelamentoHash} ~ '^[0-9a-f]{64}$'`),
  index('agendamento_negocio_inicio_idx').on(t.negocioId, t.inicio),
]);

// Exclusão GiST e triggers ficam na migração SQL customizada. Não usar db:push.
