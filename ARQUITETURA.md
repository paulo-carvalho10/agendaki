# Arquitetura e decisões

Este documento reúne como o Agendaki funciona por dentro, por que cada decisão
foi tomada e quais são os limites atuais. Para uma visão geral do produto, veja
o [README](README.md).

- [Visão geral](#visão-geral)
- [Datas e motor de disponibilidade](#datas-e-motor-de-disponibilidade)
- [Garantias do banco](#garantias-do-banco)
- [Reserva e cancelamento](#reserva-e-cancelamento)
- [Vários profissionais](#vários-profissionais)
- [Painel do dono](#painel-do-dono)
- [Senha](#senha)
- [Avisos ao dono](#avisos-ao-dono)
- [Demonstrações](#demonstrações)
- [Testes](#testes)
- [Mapa do código](#mapa-do-código)

## Visão geral

Uma única aplicação Next.js (App Router) atende três públicos:

| Endereço | Quem usa | O que faz |
|---|---|---|
| `/[slug]` | Cliente | Página de agendamento do negócio |
| `/cancelar/[token]` | Cliente | Ver e cancelar o próprio horário |
| `/entrar`, `/esqueci`, `/redefinir/[token]` | Dono | Acesso, recuperação de senha |
| `/painel`, `/painel/configuracoes` | Dono | Agenda do dia e configurações |
| `/api/reiniciar-demo` | Rotina diária | Renova a barbearia de demonstração |

As páginas leem o banco no servidor. As gravações passam por Server Actions,
que chamam funções de domínio em `src/` recebendo o banco como parâmetro. Assim
as regras são testadas diretamente contra um PostgreSQL real, sem subir o
Next.js. Os componentes de tela do cliente e do painel não dependem do Next.js e
são reaproveitados nas demonstrações estáticas.

## Datas e motor de disponibilidade

**Instantes e regras locais.** Reservas e bloqueios são instantes com início e
fim (`timestamptz`). O expediente é uma regra local por dia da semana, com
`termina_dia_seguinte` para horários como 22h–02h. Intervalos têm início
inclusivo e fim exclusivo: 9h–10h permite um novo atendimento às 10h. Os
cálculos usam Temporal, sem depender do fuso do computador ou do servidor.

**Contrato.** `calcularHorariosLivres(entrada)` recebe fuso IANA, data inicial
local, quantidade de dias (1–14), duração do serviço e passo da grade (minutos
inteiros de 1 a 1440), expediente semanal, bloqueios, agendamentos ocupados e
`agoraUTC`. Devolve intervalos `{ inicio, fim }` em ISO UTC, ordenados e sem
duplicatas. Não modifica as entradas; entradas inválidas geram `RangeError`.

- O passo é ancorado na abertura. Um bloqueio de 9h10–9h40 não cria um início às 9h40 numa grade de meia em meia hora.
- O serviço precisa caber inteiro no expediente e não pode tocar o interior de nenhuma ocupação. Terminar exatamente no começo de um bloqueio é permitido.
- Faixas de funcionamento sobrepostas ou adjacentes são unidas, e a grade fica ancorada na primeira abertura do período contínuo.
- A janela filtra a data local do início. Um atendimento pode terminar no dia seguinte, e a consulta inclui a madrugada de um expediente iniciado na véspera.
- Horários anteriores a `agoraUTC` são excluídos.
- Duração e passo são minutos reais. No avanço do horário de verão, horas inexistentes não aparecem; no retorno, as duas ocorrências de uma hora são instantes diferentes, e a tela as distingue pelo offset.
- Se a própria abertura ou o fechamento cair numa hora ambígua ou inexistente, a configuração é rejeitada em vez de o motor escolher um instante em silêncio.
- Quem chama deve fornecer todas as ocupações que **intersectam** os dias consultados, inclusive as que começaram antes da janela. `lerOcupacao` faz essa consulta por interseção.

Exemplo: expediente das 9h às 18h, serviço e passo de 30 minutos, almoço das
12h às 13h e reservas às 10h e às 15h (de uma hora) produzem 13 encaixes.
`pnpm demo:horarios` mostra cada um em horário local e UTC.

**Por profissional.** `horariosLivresPorProfissional` roda o motor uma vez para
cada profissional ativo, com os bloqueios gerais e os dele, e junta o resultado:
cada horário vem com a lista de quem está livre nele. O módulo não acessa o
banco, então serve também às demonstrações estáticas.

## Garantias do banco

**Concorrência.** `UNIQUE(negocio_id, inicio)` não impediria 9h–10h contra
9h30–10h30. Por isso há uma restrição de exclusão GiST sobre o intervalo inteiro
de cada profissional. Reservas canceladas deixam de ocupar a agenda; atendidas e
faltas preservam o histórico.

Uma exclusão entre reservas não protegeria um bloqueio criado na outra tabela.
Um trigger cuida disso: antes de gravar uma reserva ou um bloqueio, ele
incrementa `negocio.agenda_revisao`, o que ordena as operações concorrentes do
mesmo negócio, e depois confere a outra tabela. Bloqueio sem profissional vale
para todos; com profissional, só para ele. Os testes mantêm a primeira transação
aberta, verificam no PostgreSQL que a segunda está esperando e confirmam que ela
falha depois do commit.

`reservarHorario` também trava a linha do negócio no início da transação. As
reservas de um mesmo negócio entram uma por vez, e a escolha de quem atende
sempre vê a agenda atual. Falhas de serialização e deadlocks repetem a transação
inteira; o código `23P01` vira "esse horário acabou de ser ocupado".

**Integridade.** Serviço e profissional precisam pertencer ao negócio da
reserva, por chaves estrangeiras compostas. Preços são centavos inteiros. O fuso
é validado contra o catálogo do PostgreSQL. Registros de agenda não podem ser
transferidos entre negócios. Editar um serviço não altera reservas já gravadas.

**Migrações.** Alterações declarativas são geradas com `pnpm db:generate`;
exclusões e triggers ficam em SQL escrito à mão. `drizzle-kit push` não deve ser
usado, porque as garantias customizadas não estão representadas no schema
TypeScript. Uma migração já aplicada não é editada. Mudanças que afetam dados
existentes têm um teste que monta o banco como ele era antes e aplica a migração
sobre dados reais (`tests/migracao-*.test.ts`).

## Reserva e cancelamento

**Reservar.** `reservarHorario` valida nome e telefone (DDD obrigatório, celular
ou fixo), confere que o serviço está ativo e é do negócio, recalcula os horários
livres do dia com o mesmo motor da página e só então grava. Um horário fora da
grade, no passado, além dos 14 dias ou já ocupado é recusado sem gravar nada. O
telefone é guardado só com dígitos.

**Limites contra abuso.** Cada telefone mantém no máximo duas reservas futuras
por negócio, e um campo-isca invisível barra robôs simples, sem captcha. Não
substitui limite por IP nem verificação do número.

**Avisar o negócio.** A confirmação traz um botão que abre o WhatsApp do negócio
com a mensagem pronta. Não há envio automático de mensagens ao cliente.

**Cancelar.** O cliente cancela pelo link até uma hora antes
(`ANTECEDENCIA_CANCELAMENTO_MIN`), para o negócio ainda ter tempo de ocupar a
vaga. Depois disso, a página explica que o prazo acabou e oferece avisar o
negócio pelo WhatsApp. O token do link tem 256 bits, aparece uma única vez e o
banco guarda só o SHA-256; a página pede ao navegador que não o envie no
cabeçalho Referer.

## Vários profissionais

Cada agendamento pertence a um profissional. Com mais de um profissional ativo,
a página pergunta "Com quem você prefere?". Quem escolhe "tanto faz" vê todos os
horários em que alguém está livre, e a reserva vai para quem tem menos
atendimentos naquele dia (no empate, para quem foi cadastrado primeiro). Quem
escolhe um nome só vê e só disputa a agenda dele. Com um único profissional,
nenhuma tela muda.

No painel, a agenda mostra com quem é cada horário e pode ser filtrada, com o
resumo do dia acompanhando o filtro. Desativar um profissional preserva o
histórico e é recusado para o último que atende e para quem ainda tem cliente
confirmado.

Quando a migração 0003 foi aplicada, cada negócio existente ganhou um
profissional chamado "Profissional", que herdou toda a agenda.

**Limite.** Todos os profissionais fazem todos os serviços e seguem o
expediente do negócio; a folga de um deles é um bloqueio.

## Painel do dono

**Login.** Para um único tipo de acesso, sessões próprias ficaram menores e mais
fáceis de testar do que uma biblioteca de autenticação. O token nasce de
`randomBytes(32)`, o banco guarda o SHA-256 e o navegador recebe um cookie
`httpOnly`, `SameSite=Lax` e `Secure` em produção, válido por 30 dias. A senha é
conferida com scrypt em tempo constante. Email inexistente e senha errada têm a
mesma resposta, e cinco erros seguidos travam aquele email por 15 minutos.

**Isolamento.** Toda consulta e ação do painel recebe o `negocioId` da sessão e
filtra por ele. Um identificador de outro negócio recebe a mesma resposta de um
que não existe.

**Agenda.** Atendido e falta só depois que o horário começa, e dá para desfazer.
O dono cancela um horário confirmado a qualquer momento. O agendamento manual
usa a mesma função da página pública, sem o limite por telefone e com telefone
opcional. Bloqueios fecham um intervalo no fuso do negócio, e o banco recusa um
bloqueio sobre um horário marcado.

**Lembretes.** O painel lista os clientes do próximo dia que tiver horários
(até quatro dias à frente, o que cobre o domingo fechado) e abre o WhatsApp de
cada um com a mensagem pronta. O momento em que o lembrete foi aberto fica
registrado.

**Configurações.** Serviços são criados, editados e desativados, nunca
apagados. A duração vai de 5 minutos a 8 horas, de 5 em 5. A tela de expediente
edita uma faixa por dia; expedientes com dois turnos ou que viram a noite são
aceitos pelo motor, mostrados só para leitura e preservados. O endereço da
página não muda pelo painel, para não quebrar links já divulgados.

## Senha

**Trocar.** Em Configurações, o dono informa a atual e a nova (12 caracteres ou
mais). As sessões dos outros aparelhos são encerradas; a do aparelho em uso
continua.

**Esqueci minha senha.** Em `/esqueci`, o dono digita o email e recebe um link
de uso único, válido por 60 minutos. A resposta da tela é a mesma para qualquer
email, e o envio acontece depois da resposta (`after`), para nem o texto nem o
tempo revelarem quem tem acesso. Pedidos seguidos enviam no máximo um email a
cada 2 minutos. O link é montado com `SITE_URL` (na Vercel, o domínio de
produção), nunca com o cabeçalho Host do pedido, que poderia ser forjado.

Sem SMTP configurado, a tela orienta o dono a pedir o link ao suporte, que o
gera com `pnpm negocio:link-senha`. Pelos dois caminhos, ao usar o link todas as
sessões são encerradas e um bloqueio de login é desfeito. O banco guarda só o
SHA-256 do token, e um link novo invalida o anterior. A senha da demonstração
não muda por nenhum desses caminhos.

## Avisos ao dono

**Notificação.** Em Configurações, o dono ativa os avisos em cada aparelho. O
navegador cria uma inscrição Web Push, guardada em `inscricao_push`. Quando um
cliente marca ou cancela, o servidor envia uma notificação com nome, serviço,
profissional (se houver mais de um), dia e hora, sem telefone, porque ela
aparece na tela de bloqueio. O toque abre a agenda naquele dia.

- O envio acontece depois da resposta ao cliente: a reserva nunca espera o aviso, e uma falha de entrega não a desfaz.
- O servidor só envia para os serviços de notificação dos navegadores (Google, Apple, Mozilla e Microsoft). Sem essa lista, um endereço forjado faria o servidor chamar qualquer site.
- Inscrições que o serviço diz não existirem mais (404 ou 410) são apagadas.
- O service worker (`public/sw.js`) só abre endereços dentro do painel e não guarda páginas em cache.
- No iPhone, os avisos exigem o Agendaki na tela de início; a tela explica o passo. Em janela anônima eles não funcionam.

**Novidades.** O painel lista o que os clientes marcaram e cancelaram desde a
última conferida (`usuario.novidades_vistas_em`). O que o próprio dono faz não
entra (`agendamento.pelo_dono`). A comparação de instantes é feita no PostgreSQL:
levado ao JavaScript, o instante perde os microssegundos. Com o painel aberto, a
agenda é buscada de novo a cada minuto e na chegada de um aviso, sem atrapalhar
quem está digitando.

## Demonstrações

**No servidor.** O negócio marcado com `demonstracao = true` é recriado pelo
seed dentro de uma transação, sem tocar nos outros: dois barbeiros, três
serviços, almoço bloqueado e clientes de exemplo nos próximos dias. O dono da
demonstração é mantido, com a sessão e os aparelhos de aviso. Telefones são
fictícios, o email é de domínio `.example`, e nome e WhatsApp do negócio não
podem ser alterados.

**Estáticas.** `pnpm build:pages` gera `docs/` para o GitHub Pages. A página do
cliente (`demo/main.tsx`) usa o mesmo componente e o mesmo motor, com dados
gerados para os próximos 14 dias. O painel (`demo/painel.tsx`) reaproveita o
componente da agenda, com as mesmas regras e o estado guardado na memória da
página. Nada é gravado nem enviado.

## Testes

`pnpm test` roda 137 testes. Os de integração usam `embedded-postgres`: cada
arquivo sobe um PostgreSQL temporário numa porta livre, aplica as migrações,
testa e apaga tudo no fim. Nenhum teste lê `DATABASE_URL` ou toca num banco
remoto. Os arquivos temporários ficam em `.test-postgres` ou em `TEST_WORK_DIR`.

| Arquivo | Cobre |
|---|---|
| `tests/horarios-livres.test.ts` | Motor: encaixes, grade, fusos, madrugada, horário de verão, entradas inválidas |
| `tests/database.test.ts` | Exclusão, trigger, disputas simultâneas, integridade, seed, página pública |
| `tests/reservas.test.ts` | Reserva, limites, cancelamento, vários profissionais, disputa com dois profissionais |
| `tests/painel.test.ts` | Login, sessão, agenda do dia, ações do dono, isolamento |
| `tests/configuracao.test.ts` | Cadastro de negócio, serviços, profissionais, expediente |
| `tests/senha-e-avisos.test.ts` | Troca e redefinição de senha, email, novidades, inscrições e avisos |
| `tests/migracao-*.test.ts` | Migrações 0003 e 0004 sobre bancos com clientes marcados |
| `tests/pedido-reserva.test.ts`, `tests/dados-demo.test.ts`, `tests/painel-demo.test.ts` | Validação do pedido e demonstrações estáticas |

## Mapa do código

| Caminho | Responsabilidade |
|---|---|
| `src/db/schema.ts` | Tabelas, chaves e validações declarativas |
| `drizzle/` | Migrações: estrutura inicial, proteção da agenda, painel, profissionais, senha e avisos |
| `src/agenda/horarios-livres.ts` | Motor de disponibilidade, sem banco nem relógio global |
| `src/agenda/disponibilidade.ts` | Horários por profissional e escolha de quem atende |
| `src/agenda/ocupacao.ts` | Leitura do que ocupa a agenda num intervalo |
| `src/agenda/pagina-publica.ts` | Dados da página do cliente, sem informação de outros clientes |
| `src/agenda/pedido-reserva.ts` | Validação do pedido, compartilhada com as demonstrações |
| `src/agenda/reservar.ts`, `src/agenda/cancelar.ts` | Gravação e cancelamento |
| `src/auth/sessao.ts` | Senhas, sessões e bloqueio por tentativas |
| `src/auth/senha.ts`, `src/auth/email.ts` | Troca e redefinição de senha, envio por SMTP |
| `src/painel/agenda.ts`, `src/painel/acoes.ts` | Agenda do dia e ações do dono |
| `src/painel/configuracao.ts` | Serviços, profissionais, expediente e dados do negócio |
| `src/painel/novidades.ts` | O que os clientes fizeram desde a última conferida |
| `src/avisos/` | Inscrições, textos e envio dos avisos |
| `src/db/negocios.ts`, `src/db/seed.ts` | Cadastro de negócio e dados de demonstração |
| `app/` | Páginas, Server Actions e componentes de tela |
| `public/sw.js` | Recebe os avisos no navegador |
| `scripts/` | Demonstração local, migrações, seed, cadastro de negócio, link de senha |
| `demo/`, `docs/` | Demonstrações estáticas do GitHub Pages |
