CREATE TYPE "public"."status_agendamento" AS ENUM('confirmado', 'atendido', 'faltou', 'cancelado');--> statement-breakpoint
CREATE TABLE "agendamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"servico_id" uuid NOT NULL,
	"cliente_nome" text NOT NULL,
	"cliente_telefone" text NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone NOT NULL,
	"status" "status_agendamento" DEFAULT 'confirmado' NOT NULL,
	"token_cancelamento_hash" text NOT NULL,
	CONSTRAINT "agendamento_token_cancelamento_hash_unique" UNIQUE("token_cancelamento_hash"),
	CONSTRAINT "agendamento_intervalo_valido" CHECK ("agendamento"."fim" > "agendamento"."inicio"),
	CONSTRAINT "agendamento_token_sha256" CHECK ("agendamento"."token_cancelamento_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "bloqueio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone NOT NULL,
	"motivo" text NOT NULL,
	CONSTRAINT "bloqueio_intervalo_valido" CHECK ("bloqueio"."fim" > "bloqueio"."inicio")
);
--> statement-breakpoint
CREATE TABLE "horario_funcionamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"dia_semana" integer NOT NULL,
	"abre" time NOT NULL,
	"fecha" time NOT NULL,
	"termina_dia_seguinte" boolean DEFAULT false NOT NULL,
	CONSTRAINT "horario_faixa_unica" UNIQUE("negocio_id","dia_semana","abre"),
	CONSTRAINT "horario_dia_valido" CHECK ("horario_funcionamento"."dia_semana" between 0 and 6),
	CONSTRAINT "horario_intervalo_valido" CHECK (("horario_funcionamento"."termina_dia_seguinte" and "horario_funcionamento"."fecha" <= "horario_funcionamento"."abre") or (not "horario_funcionamento"."termina_dia_seguinte" and "horario_funcionamento"."fecha" > "horario_funcionamento"."abre"))
);
--> statement-breakpoint
CREATE TABLE "negocio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"telefone" text NOT NULL,
	"fuso" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"demonstracao" boolean DEFAULT false NOT NULL,
	"agenda_revisao" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "negocio_slug_unique" UNIQUE("slug"),
	CONSTRAINT "negocio_slug_formato" CHECK ("negocio"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "servico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"duracao_min" integer NOT NULL,
	"preco_centavos" integer NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "servico_negocio_id_id_unique" UNIQUE("negocio_id","id"),
	CONSTRAINT "servico_duracao_positiva" CHECK ("servico"."duracao_min" > 0),
	CONSTRAINT "servico_preco_nao_negativo" CHECK ("servico"."preco_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	CONSTRAINT "usuario_email_unique" UNIQUE("email"),
	CONSTRAINT "usuario_email_normalizado" CHECK ("usuario"."email" = lower(trim("usuario"."email")))
);
--> statement-breakpoint
ALTER TABLE "agendamento" ADD CONSTRAINT "agendamento_negocio_id_negocio_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agendamento" ADD CONSTRAINT "agendamento_servico_do_negocio_fk" FOREIGN KEY ("negocio_id","servico_id") REFERENCES "public"."servico"("negocio_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_negocio_id_negocio_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horario_funcionamento" ADD CONSTRAINT "horario_funcionamento_negocio_id_negocio_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servico" ADD CONSTRAINT "servico_negocio_id_negocio_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_negocio_id_negocio_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agendamento_negocio_inicio_idx" ON "agendamento" USING btree ("negocio_id","inicio");--> statement-breakpoint
CREATE INDEX "bloqueio_negocio_inicio_idx" ON "bloqueio" USING btree ("negocio_id","inicio");