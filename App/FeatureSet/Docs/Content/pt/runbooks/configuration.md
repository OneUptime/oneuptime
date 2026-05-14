# Configuração e segurança de runbooks

## Limites de saída

- Saída por passo: **50 KB**. Saídas maiores são truncadas com um marcador.
- Timeout por passo padrão: **30 segundos** para JavaScript, Bash e HTTP. Configurável por passo.
- **Claim timeout** padrão para passos Bash e JavaScript: **2 minutos** — quanto o Worker espera até que um Agente de Runbook pegue o job antes de falhá-lo.

## Permissões

As permissões de runbook vivem no grupo de permissões `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gerenciar modelos de runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — iniciar, marcar e ler execuções.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gerenciar regras de auto-disparo.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gerenciar Agentes de Runbook que executam passos Bash na sua própria infraestrutura.
- `RunbookManager` (papel) — junta tudo acima; atribua a um time para dar capacidade completa de runbooks.

## Fila e worker

As execuções de runbook rodam na fila BullMQ `Runbook`. A concorrência do worker é 25 — ajuste no seu deploy se você tem muitas corridas simultâneas.

Quando um passo manual é marcado via API, a execução volta para a fila para continuar no próximo passo. Isso mantém o worker aquecido para o resto do runbook.

## Notas de hardening

- **Passos Bash e JavaScript** nunca rodam no Worker do OneUptime. Eles são despachados como jobs para um [Agente de Runbook](/docs/runbooks/agents) que você instalou na sua própria infraestrutura. O Worker enfileira o job com o **Agent Tag** e o tipo de passo, um agente reivindica atomicamente, executa-o localmente — Bash via `bash -c <script>`, JavaScript dentro de um sandbox `isolated-vm` com o preâmbulo usual (corta cadeias de prototype, remove `Function` e `eval`, congela prototypes nativos) — e devolve o resultado. O próprio processo Worker não executa scripts de clientes.
- **Passos HTTP** usam um validador de status permissivo, então uma resposta 4xx ou 5xx é registrada como passo falho em vez de lançada. A saída capturada reflete o que a contraparte realmente retornou.

## Tabelas do banco

- `Runbook` — modelo (nome, slug, descrição, isEnabled, JSON dos passos).
- `RunbookExecution` — uma linha por corrida, com chaves estrangeiras nuláveis `incidentId`, `alertId` e `scheduledMaintenanceId` e um array JSON `stepExecutions` com snapshot dos passos e estado por passo.
- `RunbookRule` — regras de auto-disparo com discriminador `triggerEntityType` (Incident, Alert, ScheduledMaintenance) e relação muitos-para-muitos com os runbooks a iniciar.
- `RunbookAgent` — uma linha por agente instalado: nome, tags, chave secreta, `lastAlive`, `connectionStatus`, info do host.
- `RunbookAgentJob` — uma linha por passo Bash ou JavaScript despachado: tag exigido, tipo de passo, script, status (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim deadline, lease, output, exit code.

## Dicas operacionais

- **Rode pelo menos um agente por tag que você usa**, idealmente dois para alta disponibilidade. Com dois agentes carregando o mesmo tag, qualquer um pode reivindicar um job — você pode fazer reinícios rotativos sem quebrar runbooks.
- **Capture URLs, não blobs.** Se um passo gera mais que alguns KB, escreva no S3 ou no seu stack de logs e devolva a URL.
- **Idempotência importa.** Passos automatizados (HTTP, JavaScript, Bash) podem rodar mais de uma vez se o worker reiniciar no meio do passo ou se o lease de um agente expirar enquanto um script ainda está rodando; projete para que o retry seja seguro.
