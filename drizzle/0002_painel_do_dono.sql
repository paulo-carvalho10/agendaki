CREATE TABLE "sessao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	CONSTRAINT "sessao_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessao_token_sha256" CHECK ("sessao"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "agendamento" ADD COLUMN "lembrete_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "falhas_login" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "bloqueado_ate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessao_expira_idx" ON "sessao" USING btree ("expira_em");