import 'dotenv/config';
import { conectar } from '../src/db/client.js';
import { seedDemo, DEMO_EMAIL } from '../src/db/seed.js';

if (process.env.ALLOW_DEMO_SEED !== 'true') {
  throw new Error('Defina ALLOW_DEMO_SEED=true somente em banco de demonstração. O seed recria os dados da barbearia demo.');
}
if (!process.env.DATABASE_URL || !process.env.DEMO_OWNER_PASSWORD) {
  throw new Error('Configure DATABASE_URL e DEMO_OWNER_PASSWORD no servidor.');
}
const { client, db } = conectar(process.env.DATABASE_URL);
try {
  const result = await seedDemo(db, process.env.DEMO_OWNER_PASSWORD);
  console.log({ ...result, email: DEMO_EMAIL });
} finally {
  await client.end();
}
