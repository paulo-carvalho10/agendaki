import { rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';

// No Windows, processos filhos podem soltar os arquivos instantes depois do
// encerramento do PostgreSQL. Retries resolvem EBUSY sem mascarar outras falhas.
export async function limparBancoTemporario(diretorio: string, raiz: string) {
  const destino = resolve(diretorio);
  const dentro = relative(resolve(raiz), destino);
  if (!dentro || dentro.startsWith('..') || isAbsolute(dentro)) throw new Error('Diretório temporário fora da raiz permitida.');
  await rm(destino, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
}
