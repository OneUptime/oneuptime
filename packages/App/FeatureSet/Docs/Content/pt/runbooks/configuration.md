# Configuração e segurança de runbooks

## Como Bash e JavaScript realmente rodam

Passos Bash e JavaScript **nunca rodam no Worker do OneUptime**. Eles são despachados como jobs para um [Agente de Runbook](/docs/runbooks/agents) específico — um pequeno processo que você instala em um host dentro da sua própria infraestrutura.

O modelo de dispatch:

1. O autor do passo do runbook escolhe um Agente de Runbook no dropdown ao escrever o passo.
2. Quando o passo roda, o Worker insere uma linha em `RunnerJob` com `targetAgentId` apontando para o ID daquele agente e status `Pending`.
3. Esse agente específico (e apenas ele) reivindica o job atomicamente, roda o script localmente — Bash via `bash -c <script>`, JavaScript dentro de um sandbox `isolated-vm` — e devolve o resultado.
4. O Worker retoma o runbook com o resultado.

Não existe mais a variável `RUNBOOK_BASH_ENABLED`. Se os passos Bash ou JavaScript funcionam em um deploy depende inteiramente de haver pelo menos um Agente de Runbook conectado no projeto.

## Limites de saída e timeouts

- Saída por passo: **50&nbsp;KB**. Saída maior é truncada com um marcador.
- Timeout de execução por passo, padrão: **30 segundos** para JavaScript, Bash e HTTP. Defina por passo na página **Etapas** do runbook — deixe o campo em branco para manter o padrão.
- **Claim timeout** por passo para Bash e JavaScript: **2 minutos** — por quanto tempo o Worker espera o agente selecionado pegar o job antes de falhar. Também definido por passo.
- Os dois timeouts aceitam de **1 segundo a 1 hora**. Um valor fora desse intervalo é ajustado para o limite mais próximo quando o passo roda, então uma config digitada errada não pode nem desligar o timeout nem manter um slot do Worker ocupado indefinidamente.

## Permissões

As permissões de runbook ficam no grupo de permissões `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gerenciar modelos de runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — iniciar, marcar e ler execuções.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gerenciar regras de auto-disparo.
- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — gerenciar Agentes de Runbook que executam passos Bash e JavaScript na sua própria infraestrutura.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (funções) — `RunbookAdmin` constrói runbooks, suas regras e os Runners em que eles rodam, e os executa. `RunbookMember` abre runbooks e suas execuções e os executa — inicia uma execução, conclui ou pula suas etapas e a cancela —, mas não cria, altera nem exclui nenhum runbook ou Runner. `RunbookViewer` lê runbooks e suas execuções e não executa nada. `RunbookAdmin` agrupa todas as permissões granulares acima.

Uma função executa os runbooks que o seu escopo alcança. Uma atribuição de `RunbookMember`, `RunbookAdmin` ou `ProjectMember` limitada a alguns rótulos inicia e faz avançar as execuções dos runbooks que têm esses rótulos, uma limitada aos recursos próprios as dos runbooks que a sua equipe possui, e o bloqueio de uma equipe sobre um rótulo retira esses runbooks. `CreateRunbookExecution` e `EditRunbookExecution` tratam de execuções, que não têm rótulos, e por isso alcançam todos os runbooks do projeto. Aprovar uma sugestão de correção que inicia um runbook é verificado da mesma forma.

## Fila e worker

Execuções de runbook rodam na fila BullMQ `Runbook`. A concorrência do worker é 25 — ajuste no seu deploy se você tiver muitas execuções simultâneas.

Quando um passo manual é marcado via API, a execução é re-enfileirada para continuar do próximo passo. Isso mantém o worker quente para o restante do runbook.

## Notas de hardening

- **JavaScript e Bash** rodam em um host de Agente de Runbook que você controla, não no Worker do OneUptime. JavaScript é envolto em um sandbox `isolated-vm` com o prelúdio usual (quebra cadeias de protótipo, remove `Function`/`eval`, congela protótipos built-in). Bash roda via `bash -c` com aplicação de timeout no agente.
- **Passos HTTP** usam um validador de status permissivo, então uma resposta 4xx ou 5xx é registrada como passo falho em vez de lançada como exceção. Isso faz a saída capturada refletir o que o upstream realmente devolveu.
- **A autenticação do agente** é por ID + chave secreta, definidas no contêiner do agente como variáveis de ambiente. No servidor, a identidade autoritativa do agente vem da linha de DB indexada pelo ID/chave apresentados — clientes não conseguem se passar por outro agente mesmo com uma chave comprometida.

## Tabelas de banco de dados

- `Runbook` — modelo (nome, slug, descrição, isEnabled, JSON dos passos).
- `RunbookExecution` — uma linha por execução, com foreign keys nuláveis `incidentId`, `alertId` e `scheduledMaintenanceId` e um array JSON `stepExecutions` que captura os passos e o estado por passo.
- `RunbookRule` — regras de auto-disparo com um discriminador `triggerEntityType` (Incident, Alert, ScheduledMaintenance) e relação muitos-para-muitos com os runbooks a iniciar.
- `Runner` — uma linha por agente instalado: nome, chave secreta, `lastAlive`, `connectionStatus`, info do host.
- `RunnerJob` — uma linha por passo Bash ou JavaScript despachado: `targetAgentId` (o agente que o autor do passo escolheu), tipo de passo, script, status (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), deadline do claim, lease, saída, código de saída.

## Dicas operacionais

- **Garanta que o agente escolhido em cada passo esteja saudável.** Se precisar de redundância, rode um segundo agente e divida seus passos entre eles, ou mantenha um runbook de backup apontando para o outro agente.
- **Capture URLs, não blobs.** Se um passo gera mais que alguns KB de saída, escreva no S3 ou no seu stack de logs e devolva a URL.
- **Idempotência importa.** Passos automatizados (HTTP, JavaScript, Bash) podem rodar mais de uma vez se o worker reiniciar no meio do passo ou se o lease do agente expirar com o script ainda rodando; projete-os para serem seguros de re-executar.
