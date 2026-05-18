# Configuração e segurança de runbooks

## Como Bash e JavaScript realmente rodam

Passos Bash e JavaScript **nunca rodam no Worker do OneUptime**. Eles são despachados como jobs para um [Agente de Runbook](/docs/runbooks/agents) específico — um pequeno processo que você instala em um host dentro da sua própria infraestrutura.

O modelo de dispatch:

1. O autor do passo do runbook escolhe um Agente de Runbook no dropdown ao escrever o passo.
2. Quando o passo roda, o Worker insere uma linha em `RunbookAgentJob` com `targetAgentId` apontando para o ID daquele agente e status `Pending`.
3. Esse agente específico (e apenas ele) reivindica o job atomicamente, roda o script localmente — Bash via `bash -c <script>`, JavaScript dentro de um sandbox `isolated-vm` — e devolve o resultado.
4. O Worker retoma o runbook com o resultado.

Não existe mais a variável `RUNBOOK_BASH_ENABLED`. Se os passos Bash ou JavaScript funcionam em um deploy depende inteiramente de haver pelo menos um Agente de Runbook conectado no projeto.

## Limites de saída e timeouts

- Saída por passo: **50&nbsp;KB**. Saída maior é truncada com um marcador.
- Timeout de execução por passo, padrão: **30 segundos** para JavaScript, Bash e HTTP. Configurável por passo.
- **Claim timeout** por passo para Bash e JavaScript: **2 minutos** — por quanto tempo o Worker espera o agente selecionado pegar o job antes de falhar.

## Permissões

As permissões de runbook ficam no grupo de permissões `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gerenciar modelos de runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — iniciar, marcar e ler execuções.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gerenciar regras de auto-disparo.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gerenciar Agentes de Runbook que executam passos Bash e JavaScript na sua própria infraestrutura.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (papéis) — atribua a um time para conceder controle total, uso do dia a dia ou acesso somente leitura, respectivamente. `RunbookAdmin` agrupa todas as permissões granulares acima.

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
- `RunbookAgent` — uma linha por agente instalado: nome, chave secreta, `lastAlive`, `connectionStatus`, info do host.
- `RunbookAgentJob` — uma linha por passo Bash ou JavaScript despachado: `targetAgentId` (o agente que o autor do passo escolheu), tipo de passo, script, status (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), deadline do claim, lease, saída, código de saída.

## Dicas operacionais

- **Garanta que o agente escolhido em cada passo esteja saudável.** Se precisar de redundância, rode um segundo agente e divida seus passos entre eles, ou mantenha um runbook de backup apontando para o outro agente.
- **Capture URLs, não blobs.** Se um passo gera mais que alguns KB de saída, escreva no S3 ou no seu stack de logs e devolva a URL.
- **Idempotência importa.** Passos automatizados (HTTP, JavaScript, Bash) podem rodar mais de uma vez se o worker reiniciar no meio do passo ou se o lease do agente expirar com o script ainda rodando; projete-os para serem seguros de re-executar.
