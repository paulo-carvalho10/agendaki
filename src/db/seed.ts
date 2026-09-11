import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export const DEMO_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_EMAIL = 'dono@barbearia.example';

export async function seedDemo(db: PostgresJsDatabase<typeof schema>, senha: string) {
  if (senha.length < 12) throw new Error('DEMO_OWNER_PASSWORD precisa de pelo menos 12 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const senhaHash = `scrypt:${salt}:${scryptSync(senha, salt, 64).toString('hex')}`;
  return db.transaction(async (tx) => {
    // Serializa inclusive a primeira criação do seed.
    await tx.execute(sql`select pg_advisory_xact_lock(20260911)`);
    const existente = await tx.execute(sql`select demonstracao from negocio where id = ${DEMO_ID}::uuid for update`);
    if (existente.length && !existente[0].demonstracao) {
      throw new Error('O ID reservado ao seed pertence a um negócio real. Nenhum dado foi alterado.');
    }
    await tx.insert(schema.negocio).values({
      id: DEMO_ID, nome: 'Barbearia Horizonte — demonstração', slug: 'barbearia-demo',
      telefone: '00000000000', fuso: 'America/Sao_Paulo', demonstracao: true,
    }).onConflictDoNothing({ target: schema.negocio.id });

    // Recria somente o negócio reservado à demo. Nunca trunca tabelas.
    await tx.execute(sql`delete from agendamento where negocio_id = ${DEMO_ID}::uuid`);
    await tx.execute(sql`delete from bloqueio where negocio_id = ${DEMO_ID}::uuid`);
    await tx.execute(sql`delete from horario_funcionamento where negocio_id = ${DEMO_ID}::uuid`);
    await tx.execute(sql`delete from servico where negocio_id = ${DEMO_ID}::uuid`);
    await tx.execute(sql`delete from usuario where negocio_id = ${DEMO_ID}::uuid`);

    await tx.insert(schema.usuario).values({ negocioId: DEMO_ID, email: DEMO_EMAIL, senhaHash });
    const servicos = await tx.insert(schema.servico).values([
      { negocioId: DEMO_ID, nome: 'Corte', duracaoMin: 30, precoCentavos: 4000 },
      { negocioId: DEMO_ID, nome: 'Barba', duracaoMin: 30, precoCentavos: 3000 },
      { negocioId: DEMO_ID, nome: 'Corte + barba', duracaoMin: 60, precoCentavos: 6500 },
    ]).returning();
    await tx.insert(schema.horarioFuncionamento).values(
      [1, 2, 3, 4, 5, 6].map((diaSemana) => ({ negocioId: DEMO_ID, diaSemana, abre: '09:00', fecha: '18:00' })),
    );

    // Calculado no fuso do negócio, independente do fuso do computador/servidor.
    const dias = await tx.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as dia
      from generate_series(
        (current_timestamp at time zone 'America/Sao_Paulo')::date + 1,
        (current_timestamp at time zone 'America/Sao_Paulo')::date + 13,
        interval '1 day'
      ) as d where extract(isodow from d) <= 6 order by d
    `);
    for (const { dia } of dias) {
      await tx.execute(sql`
        insert into bloqueio (negocio_id, inicio, fim, motivo)
        values (${DEMO_ID}::uuid,
          (${String(dia)}::date + time '12:00') at time zone 'America/Sao_Paulo',
          (${String(dia)}::date + time '13:00') at time zone 'America/Sao_Paulo',
          'Almoço — exemplo')
      `);
    }
    const linksCancelamento: string[] = [];
    for (let i = 0; i < 6; i++) {
      const dia = String(dias[Math.floor(i / 2)].dia);
      const hora = i % 2 === 0 ? '09:00' : '14:00';
      const servico = servicos[i % servicos.length];
      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await tx.execute(sql`
        insert into agendamento
          (negocio_id, servico_id, cliente_nome, cliente_telefone, inicio, fim, token_cancelamento_hash)
        values (${DEMO_ID}::uuid, ${servico.id}::uuid, ${`Cliente exemplo ${i + 1}`}, '00000000000',
          (${dia}::date + ${hora}::time) at time zone 'America/Sao_Paulo',
          ((${dia}::date + ${hora}::time) at time zone 'America/Sao_Paulo') + make_interval(mins => ${servico.duracaoMin}),
          ${tokenHash})
      `);
      linksCancelamento.push(`/cancelar/${token}`);
    }
    return { negocioId: DEMO_ID, servicos: 3, agendamentos: 6, bloqueios: dias.length, linksCancelamento };
  });
}
