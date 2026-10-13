CREATE TABLE "profissional" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profissional_negocio_id_id_unique" UNIQUE("negocio_id","id"),
	CONSTRAINT "profissional_nome_preenchido" CHECK (length(trim("profissional"."nome")) > 0)
);
--> statement-breakpoint
ALTER TABLE "profissional" ADD CONSTRAINT "profissional_negocio_id_negocio_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocio"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Todo negócio que já existe ganha um profissional, que herda a agenda inteira.
INSERT INTO "profissional" ("negocio_id", "nome") SELECT "id", 'Profissional' FROM "negocio";
--> statement-breakpoint
ALTER TABLE "agendamento" ADD COLUMN "profissional_id" uuid;
--> statement-breakpoint
ALTER TABLE "bloqueio" ADD COLUMN "profissional_id" uuid;
--> statement-breakpoint
-- O preenchimento não é uma mudança de agenda: o trigger fica desligado só aqui.
ALTER TABLE "agendamento" DISABLE TRIGGER proteger_agendamento;
--> statement-breakpoint
UPDATE "agendamento" a SET "profissional_id" = p."id" FROM "profissional" p WHERE p."negocio_id" = a."negocio_id";
--> statement-breakpoint
ALTER TABLE "agendamento" ENABLE TRIGGER proteger_agendamento;
--> statement-breakpoint
ALTER TABLE "agendamento" ALTER COLUMN "profissional_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "agendamento" ADD CONSTRAINT "agendamento_profissional_do_negocio_fk" FOREIGN KEY ("negocio_id","profissional_id") REFERENCES "public"."profissional"("negocio_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_profissional_do_negocio_fk" FOREIGN KEY ("negocio_id","profissional_id") REFERENCES "public"."profissional"("negocio_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- A sobreposição passa a ser proibida por profissional, não mais pelo negócio inteiro:
-- dois profissionais podem atender no mesmo horário.
ALTER TABLE "agendamento" DROP CONSTRAINT agendamento_sem_sobreposicao;
--> statement-breakpoint
ALTER TABLE "agendamento" ADD CONSTRAINT agendamento_sem_sobreposicao
EXCLUDE USING gist (
  profissional_id WITH =,
  tstzrange(inicio, fim, '[)') WITH &&
) WHERE (status <> 'cancelado');
--> statement-breakpoint
-- Bloqueio sem profissional fecha a agenda de todos; com profissional, só a dele.
-- A escrita na linha do negócio continua ordenando as alterações da agenda.
CREATE OR REPLACE FUNCTION proteger_agenda() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  alvo uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.negocio_id <> OLD.negocio_id THEN
    RAISE EXCEPTION 'Não é permitido transferir registros de agenda entre negócios'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN alvo := OLD.negocio_id;
  ELSE alvo := NEW.negocio_id; END IF;

  UPDATE negocio SET agenda_revisao = agenda_revisao + 1 WHERE id = alvo;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF TG_TABLE_NAME = 'agendamento' THEN
    IF NEW.status <> 'cancelado' AND EXISTS (
      SELECT 1 FROM bloqueio b WHERE b.negocio_id = alvo
        AND (b.profissional_id IS NULL OR b.profissional_id = NEW.profissional_id)
        AND b.inicio < NEW.fim AND b.fim > NEW.inicio
    ) THEN
      RAISE EXCEPTION 'Horário bloqueado' USING ERRCODE = '23P01';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM agendamento a WHERE a.negocio_id = alvo
        AND a.status <> 'cancelado'
        AND (NEW.profissional_id IS NULL OR a.profissional_id = NEW.profissional_id)
        AND a.inicio < NEW.fim AND a.fim > NEW.inicio
    ) THEN
      RAISE EXCEPTION 'Bloqueio conflita com agendamento existente'
        USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
