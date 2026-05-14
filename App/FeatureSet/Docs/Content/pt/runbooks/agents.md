# Agentes de Runbook

Um **Agente de Runbook** é um pequeno processo auto-hospedado que executa os passos Bash dos seus runbooks **dentro da sua própria infraestrutura**. O Worker do OneUptime nunca executa os seus comandos shell — ele os enfileira, e um Agente de Runbook que você instalou no seu ambiente os recolhe, executa e devolve o resultado.

Esta página explica como instalar um agente, direcionar passos Bash para ele e operá-lo no dia a dia.

## Por que existem agentes

Versões anteriores do OneUptime executavam passos Bash diretamente no Worker. Funcionava em implantações self-hosted single-tenant onde os operadores já tinham shell na máquina, mas traz dois problemas para todos os outros:

- **Fronteira de confiança.** Qualquer pessoa que possa criar um runbook consegue executar shell no Worker, com acesso a todas as variáveis de ambiente e ao filesystem do Worker.
- **Alcance.** A maioria dos passos Bash úteis quer operar sobre a infraestrutura do *cliente* ("reiniciar este serviço", "kubectl no nosso cluster"), não sobre a do OneUptime.

Os Agentes de Runbook invertem isso. Os passos Bash não rodam em nós. Rodam num host que você controla, e você decide o que esse host pode fazer.

## Como funciona

1. Você cria um Agente de Runbook no OneUptime. O OneUptime gera um ID e uma chave secreta.
2. Você executa o contêiner do agente num host dentro da sua infraestrutura com esse ID/chave e a sua URL do OneUptime.
3. O agente pergunta ao OneUptime a cada poucos segundos: "tem trabalho para mim?"
4. Quando um passo Bash é executado, o Worker insere uma linha de job marcada com o **Tag de Agente** do passo e seu status vai para `Pending`.
5. Qualquer agente saudável no mesmo projeto que carregue esse tag reivindica o job (atomicamente — nunca dois agentes executam o mesmo job), executa `bash -c <seu script>` localmente, captura stdout/stderr/exit-code, e envia o resultado.
6. O Worker continua o runbook com o resultado.

O agente precisa apenas de **HTTPS de saída** para a sua instância OneUptime. Ele não aceita nenhuma conexão de entrada.

## Instalar um agente

### 1. Criar o registo do agente

Vá em **Runbooks → Agents → Criar novo**. Preencha:

| Campo | Notas |
| --- | --- |
| **Nome** | Um nome descritivo — normalmente `onde-roda-e-o-que-faz`, ex. `prod-eu-west-1`. |
| **Descrição** | Opcional. Uma frase sobre o que esse host consegue alcançar. Seu eu futuro vai agradecer. |
| **Tags** | Separadas por vírgula. Os passos Bash apontam para um tag; qualquer agente no projeto com esse tag pode executá-los. Padrões comuns: `prod`, `staging`, `eu-west-1`, `db-host`. |

### 2. Copiar o comando de instalação

Após criar o agente, clique em **Mostrar instruções de configuração** na sua linha. Você verá um comando `docker run` pré-preenchido com o ID e a chave deste agente. **Salve a chave agora** — pode resetá-la depois, mas não verá o mesmo valor novamente após fechar o modal.

### 3. Executar num host dentro da sua infraestrutura

Execute o comando Docker em qualquer host do seu ambiente que possa:

- alcançar a sua instância OneUptime por HTTPS, e
- fazer as coisas que você quer que os passos Bash façam (ex. SSH para outros hosts, `kubectl`, falar com um banco de dados).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.seu-dominio.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verificar se o agente está conectado

Volte para **Runbooks → Agents**. Em cerca de 60 segundos a linha do agente deve mudar para `Connected` com um timestamp **Last seen** recente. Se permanecer `Disconnected`:

- Veja os logs do contêiner (`docker logs oneuptime-runbook-agent`) buscando erros de autenticação ou de rede.
- Verifique que o host alcança a URL do OneUptime com `curl`.
- Verifique que o ID e a chave foram copiados sem espaços.

## Tags e roteamento

Tags são como um passo Bash encontra um agente. Alguns padrões:

- **Um tag por ambiente.** Marque o agente de prod com `prod`, o de staging com `staging`. Passos Bash apontando para `prod` só rodam em prod.
- **Um tag por região.** `eu-west-1`, `us-east-1`. Útil quando um passo precisa rodar perto do recurso que toca.
- **Vários agentes, mesmo tag.** Suba dois agentes ambos com `prod`. Qualquer um pode reivindicar um job — você ganha alta disponibilidade e pode fazer reinícios rotativos sem quebrar runbooks.
- **Vários tags por agente.** Um agente no seu cluster prod EU pode carregar `prod`, `eu-west-1` e `kubernetes`. Passos Bash podem apontar para qualquer um.

Um passo Bash **deve** especificar exatamente um tag de agente. O roteamento multi-tag (rodar em qualquer agente que tenha `prod` AND `db`) está no roadmap, não nesta versão.

## Apontar um passo Bash para um agente

No seu runbook, adicione um passo Bash. O formulário pede um **Agent Tag**:

- Escreva o tag correspondente ao(s) agente(s) onde você quer que rode.
- Escreva o seu script no editor abaixo.

Quando o runbook rodar e chegar a este passo, o Worker enfileira um job com esse tag. Se houver pelo menos um agente saudável com esse tag online, o job é reivindicado em poucos segundos e executado.

## Notas operacionais

### Timeouts

Cada passo Bash tem dois timeouts:

| Timeout | Padrão | O que controla |
| --- | --- | --- |
| **Claim timeout** | 2 minutos | Por quanto tempo o Worker espera que *algum* agente reivindique o job. Se ninguém pegar a tempo, o passo falha com `TimedOut` e o runbook segue (ou para, dependendo de **Continuar em caso de falha**). |
| **Execution timeout** | 30 segundos | Por quanto tempo o agente deixa o script rodar antes de mandar `SIGKILL`. Configurável por passo. |

A janela total de espera do Worker é `claim timeout + execution timeout + alguns segundos de folga`. Escolha valores adequados ao passo.

### Lease e heartbeat

Quando um agente reivindica um job, recebe um lease curto (30 segundos por padrão). Enquanto o script roda, o agente renova o lease a cada 10 segundos. Se o agente morrer ou perder a rede no meio do script, o lease expira e o Worker marca o job como `TimedOut` em vez de esperar para sempre.

O processo filho do script **não** é cancelado automaticamente quando o lease expira — mas o Worker para de esperar por ele, e o agente não conseguirá enviar um resultado depois que outro claim assumir. Projete scripts para serem seguros para reexecutar se você se importa com "exactly-once".

### Nenhum agente online

Se nenhum agente saudável com o tag do passo está online no momento da execução, o job fica `Pending` até o claim timeout expirar e então falha com mensagem clara ("no agent claimed the job"). A página Agents é onde você confirma cobertura antes de rodar um runbook a sério.

### Limite de saída

stdout + stderr combinados são limitados a **50 KB** por passo. Saídas maiores são truncadas com um marcador. Se precisa do log completo, escreva no S3 ou no seu sistema de logs a partir do script e dê `echo` na URL.

### Cancelamento

Cancelar uma execução de runbook (via tela de execução ou API) marca imediatamente todos os jobs Bash `Pending`/`Claimed`/`Running` como `Cancelled`. Um agente já no meio do script vai terminar o trabalho, mas o servidor não aceitará o resultado.

### Concorrência

Cada agente roda um job por vez por padrão. Para permitir mais, defina `RUNBOOK_AGENT_CONCURRENCY` no contêiner do agente — mas lembre que o agente compartilha o host com tudo o mais que vive lá.

## Variáveis de ambiente

O agente lê estas na inicialização:

| Variável | Obrigatória | Padrão | Notas |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | sim | — | URL base da sua instância OneUptime, ex. `https://oneuptime.seu-dominio.com`. |
| `RUNBOOK_AGENT_ID` | sim | — | O UUID mostrado no modal de setup do agente. |
| `RUNBOOK_AGENT_KEY` | sim | — | O segredo mostrado no modal de setup do agente. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | não | `5000` | Frequência com que o agente consulta novos jobs. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | não | `60000` | Frequência com que o agente reporta estar vivo. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | não | `10000` | Frequência com que o agente renova o lease de um job em execução. |
| `RUNBOOK_AGENT_CONCURRENCY` | não | `1` | Máximo de jobs simultâneos neste agente. |

## Rotacionar a chave de um agente

Se uma chave vazar, abra o agente no OneUptime e resete a chave. A chave antiga para de funcionar imediatamente. Atualize o contêiner do agente com a nova chave e reinicie.

## Permissões

O gerenciamento de agentes vive no grupo de permissões Runbooks existente:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gerenciar registros de agentes.
- `RunbookManager` (papel) — agrupa todos acima.

Permissões para *disparar* um runbook (e portanto despachar passos Bash) continuam sendo `CreateRunbookExecution` / `EditRunbookExecution`.

## API exposta aos agentes

Para os curiosos — o agente usa esses endpoints, montados sob `/runbook-agent-ingest`. São autenticados pelo ID + chave do agente no corpo JSON (ou cabeçalhos `x-agent-id` / `x-agent-key`).

| Endpoint | Propósito |
| --- | --- |
| `POST /heartbeat` | Vivacidade; atualiza `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Reivindica atomicamente o job `Pending` mais antigo cujo tag bate com um dos tags do agente. Retorna `{ job: null }` quando não há nada para fazer. |
| `POST /job/:jobId/heartbeat` | Renova o lease do job. Retorna 404 quando o lease expirou ou o job é terminal. |
| `POST /job/:jobId/result` | Submete o resultado final. Ignorado se o lease já passou para outro. |

Você não deve precisar chamá-los à mão — o agente incluído faz isso. Estão documentados aqui caso você queira construir seu próprio agente porque o nosso não atende suas restrições.
