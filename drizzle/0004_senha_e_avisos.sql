CREATE TABLE "inscricao_push" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inscricao_push_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "redefinicao_senha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usada_em" timestamp with time zone,
	CONSTRAINT "redefinicao_senha_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "redefinicao_token_sha256" CHECK ("redefinicao_senha"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "agendamento" ADD COLUMN "criado_em" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agendamento" ADD COLUMN "pelo_dono" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agendamento" ADD COLUMN "cancelado_pelo_cliente_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "novidades_vistas_em" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "inscricao_push" ADD CONSTRAINT "inscricao_push_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redefinicao_senha" ADD CONSTRAINT "redefinicao_senha_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inscricao_push_usuario_idx" ON "inscricao_push" USING btree ("usuario_id");