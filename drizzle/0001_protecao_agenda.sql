CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE agendamento ADD CONSTRAINT agendamento_sem_sobreposicao
EXCLUDE USING gist (
  negocio_id WITH =,
  tstzrange(inicio, fim, '[)') WITH &&
) WHERE (status <> 'cancelado');
--> statement-breakpoint
-- A escrita na linha do negócio ordena as alterações da sua agenda.
-- Em READ COMMITTED, a consulta seguinte enxerga a transação anterior.
-- Em REPEATABLE READ/SERIALIZABLE, disputa da revisão causa erro 40001;
-- o chamador deve repetir a transação completa, jamais só o INSERT.
CREATE FUNCTION proteger_agenda() RETURNS trigger
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
        AND b.inicio < NEW.fim AND b.fim > NEW.inicio
    ) THEN
      RAISE EXCEPTION 'Horário bloqueado' USING ERRCODE = '23P01';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM agendamento a WHERE a.negocio_id = alvo
        AND a.status <> 'cancelado'
        AND a.inicio < NEW.fim AND a.fim > NEW.inicio
    ) THEN
      RAISE EXCEPTION 'Bloqueio conflita com agendamento existente'
        USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER proteger_agendamento
BEFORE INSERT OR UPDATE OR DELETE ON agendamento
FOR EACH ROW EXECUTE FUNCTION proteger_agenda();
--> statement-breakpoint
CREATE TRIGGER proteger_bloqueio
BEFORE INSERT OR UPDATE OR DELETE ON bloqueio
FOR EACH ROW EXECUTE FUNCTION proteger_agenda();
--> statement-breakpoint
CREATE FUNCTION validar_fuso_negocio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.fuso) THEN
    RAISE EXCEPTION 'Fuso horário desconhecido: %', NEW.fuso USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER negocio_fuso_valido
BEFORE INSERT OR UPDATE OF fuso ON negocio
FOR EACH ROW EXECUTE FUNCTION validar_fuso_negocio();
