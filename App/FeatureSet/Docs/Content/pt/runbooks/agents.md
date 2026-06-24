# Agentes de runbook

Um **Agente de Runbook** é um pequeno processo auto-hospedado que executa os passos Bash _e_ JavaScript dos seus runbooks **dentro da sua própria infraestrutura**. O Worker do OneUptime nunca roda seus scripts — ele os coloca na fila, e o Agente de Runbook que o autor do passo escolheu reivindica, executa e devolve o resultado.

JavaScript continua rodando em um sandbox `isolated-vm`; a diferença é que o sandbox vive no host do seu agente em vez do nosso.

Esta página explica como instalar um agente, apontar passos Bash e JavaScript para ele e operá-lo no dia a dia.

## Por que os agentes existem

Versões anteriores do OneUptime rodavam passos Bash e JavaScript no Worker. JavaScript era em sandbox (via `isolated-vm`), Bash não. Ambos tinham problemas para qualquer instalação além de um auto-hospedado mono-inquilino:

- **Fronteira de confiança.** Qualquer pessoa que pudesse escrever um runbook conseguia executar código no Worker, com acesso às variáveis de ambiente e ao sistema de arquivos do Worker. O sandbox de JavaScript bloqueava o óbvio, mas não conseguia impedir que um usuário determinado sondasse o que era alcançável a partir da nossa rede.
- **Alcance.** A maior parte dos passos úteis quer operar na infraestrutura _do cliente_ ("reinicie esse serviço", "kubectl no nosso cluster", "consulte um registro no nosso DB interno") — não na do OneUptime.

Os Agentes de Runbook viram esse jogo. Passos Bash e JavaScript não rodam em nós. Rodam num host que você controla, e você decide o que esse host pode fazer.

## Como funciona

1. Você cria um Agente de Runbook no OneUptime. O OneUptime gera um ID e uma chave secreta.
2. Você roda o contêiner do agente em um host dentro da sua infraestrutura com esse ID/chave mais a URL do seu OneUptime.
3. O agente faz polling no OneUptime a cada poucos segundos perguntando "tem trabalho pra mim?".
4. Quando você escreve um passo Bash ou JavaScript, escolhe o agente em um dropdown — o passo fica vinculado àquele agente específico.
5. Quando o passo roda, o Worker insere uma linha de job com `targetAgentId` apontando para esse agente. Só esse agente pode reivindicá-lo.
6. O agente roda o script localmente — `bash -c <script>` para Bash, um sandbox `isolated-vm` para JavaScript — captura o resultado e devolve. O Worker retoma o runbook com o resultado.

O agente só precisa de **HTTPS de saída** para sua instância OneUptime. Ele não aceita nenhuma conexão de entrada.

## Instalar um agente

### 1. Criar o registro do agente

Vá em **Runbooks → Configurações → Agentes** e crie um novo agente. Preencha:

| Campo         | Notas                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Nome**      | Um nome amigável — geralmente `onde-roda-e-o-que-pode-fazer`, ex.: `prod-eu-west-1`. É o que aparece no dropdown ao escrever um passo. |
| **Descrição** | Opcional. Uma frase sobre o que esse host alcança. Seu eu futuro vai agradecer.                                                        |

### 2. Copie o comando de instalação

Após criar o agente, clique em **Mostrar instruções de configuração** na linha dele. Você verá um comando `docker run` pré-preenchido com o ID e a chave deste agente. **Salve a chave agora** — você pode regenerá-la depois, mas não pode ver o mesmo valor de chave novamente depois de fechar o modal.

### 3. Rode em um host dentro da sua infraestrutura

Execute o comando Docker em qualquer host do seu ambiente que possa:

- alcançar sua instância OneUptime via HTTPS, e
- fazer o que você quer que seus passos Bash/JavaScript façam (ex.: SSH para outros hosts, `kubectl`, conversar com um banco de dados).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verifique se o agente está conectado

Volte para **Runbooks → Configurações → Agentes**. Em cerca de 60 segundos a linha do agente deve mudar para `Connected` com um timestamp **Last seen** recente. Se permanecer `Disconnected`:

- Verifique os logs do contêiner (`docker logs oneuptime-runbook-agent`) procurando erros de autenticação ou de rede.
- Confirme que o host alcança sua URL OneUptime com `curl`.
- Confirme que o ID e a chave foram copiados sem espaços em branco.

## Apontar um passo para um agente

No seu runbook adicione um passo Bash ou JavaScript. O formulário tem um dropdown **Agente de Runbook** listando todos os agentes do projeto atual (com indicador de conectado/desconectado):

- Escolha o agente que deve rodar este passo.
- Escreva seu script no editor abaixo.

Quando o runbook rodar e chegar no passo, o Worker enfileira um job direcionado ao ID daquele agente. Só ele pode reivindicar. Bash roda via `bash -c`; JavaScript roda dentro de um sandbox `isolated-vm` no agente (sem sistema de arquivos, sem rede, sem `Function`/`eval`).

Precisa de mais de um agente? Crie-os e aponte cada passo para o que melhor encaixar. Se quiser redundância, dá pra escrever dois runbooks (um por agente) ou dividir os passos entre agentes.

## Notas operacionais

### Timeouts

Dois timeouts se aplicam a todo passo Bash ou JavaScript:

| Timeout               | Padrão      | O que controla                                                                                                                                                                                             |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claim timeout**     | 2 minutos   | Por quanto tempo o Worker espera o agente selecionado reivindicar o job. Se ele não pegar a tempo, o passo falha com `TimedOut` e o runbook segue (ou para, dependendo de **Continuar em caso de falha**). |
| **Execution timeout** | 30 segundos | Por quanto tempo o agente deixa o script rodar antes de encerrá-lo. Configurável por passo. (Bash recebe `SIGKILL`; o isolate do JavaScript é destruído.)                                                  |

A janela total de espera do Worker é `claim timeout + execution timeout + alguns segundos`. Escolha valores que combinem com o passo.

### Lease e heartbeat

Quando um agente reivindica um job, recebe um lease curto (30 segundos por padrão). Enquanto o script roda, o agente renova o lease a cada 10 segundos. Se o agente morrer ou perder rede no meio do script, o lease expira e o Worker marca o job como `TimedOut` em vez de esperar para sempre.

Processos filhos do Bash **não** são cancelados automaticamente quando o lease expira (um isolate de JavaScript também é deixado terminar, se chegar a terminar) — mas o Worker para de esperá-los, e o agente não conseguirá enviar resultado depois que outra reivindicação assumir. Projete seus scripts para serem seguros de re-executar se exactly-once importar para você.

### Nenhum agente online

Se o agente selecionado estiver offline no momento em que o passo rodar, o job fica `Pending` até o claim timeout expirar, então falha com mensagem clara "nenhum agente reivindicou o job". A página de agentes é onde você confirma a cobertura antes de rodar um runbook pra valer.

### Limite de saída

A soma de stdout + stderr é limitada a **50&nbsp;KB** por passo. Saída maior é truncada com um marcador. Se precisar do log completo, escreva pra S3 ou seu armazenamento de logs dentro do script e dê `echo` da URL.

### Cancelamento

Cancelar uma execução de runbook (pela visão de execução ou pela API) marca imediatamente como `Cancelled` todos os jobs Bash e JavaScript em `Pending`/`Claimed`/`Running` daquela execução. Um agente que já esteja no meio do script termina seu trabalho, mas seu resultado não será aceito pelo servidor.

### Concorrência

Cada agente roda um job de cada vez por padrão. Para permitir mais, defina `RUNBOOK_AGENT_CONCURRENCY` no contêiner do agente — mas lembre que o agente divide o host com o que mais estiver lá.

## Variáveis de ambiente

O agente lê estas na inicialização:

| Variável                                  | Obrigatória | Padrão  | Notas                                                                         |
| ----------------------------------------- | ----------- | ------- | ----------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                           | sim         | —       | URL base da sua instância OneUptime, ex.: `https://oneuptime.yourdomain.com`. |
| `RUNBOOK_AGENT_ID`                        | sim         | —       | O UUID mostrado no modal de configuração do agente.                           |
| `RUNBOOK_AGENT_KEY`                       | sim         | —       | O segredo mostrado no modal de configuração do agente.                        |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`          | não         | `5000`  | Com que frequência o agente faz polling por jobs novos.                       |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`     | não         | `60000` | Com que frequência o agente reporta que está vivo.                            |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | não         | `10000` | Com que frequência o agente renova o lease de um job em execução.             |
| `RUNBOOK_AGENT_CONCURRENCY`               | não         | `1`     | Máximo de jobs simultâneos neste agente.                                      |

## Rotacionar a chave de um agente

Se uma chave vazar, abra o agente no OneUptime e regenere a chave dele. A antiga para de funcionar imediatamente. Atualize o contêiner do agente com a nova e reinicie.

## Permissões

A gestão de agentes vive sob o grupo de permissões já existente de Runbooks:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gerenciar registros de agentes.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (papéis) — atribua a um time para conceder controle total, uso do dia a dia ou acesso somente leitura, respectivamente. `RunbookAdmin` agrupa todas as permissões granulares acima.

Permissões para _disparar_ um runbook (e portanto fazer com que passos Bash e JavaScript sejam despachados) continuam sendo `CreateRunbookExecution` / `EditRunbookExecution`.

## API exposta ao agente

Para os curiosos — o agente usa estes endpoints, montados sob `/runbook-agent-ingest`. São autenticados pelo ID + chave do agente no corpo JSON (ou cabeçalhos `x-agent-id` / `x-agent-key`).

| Endpoint                     | Propósito                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /heartbeat`            | Liveness; atualiza `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`.                                                          |
| `POST /claim-next-job`       | Reivindicar atomicamente o job `Pending` mais antigo direcionado ao ID deste agente. Retorna `{ job: null }` quando não há nada a fazer. |
| `POST /job/:jobId/heartbeat` | Renovar o lease do job. Retorna 404 quando o lease expira ou o job é terminal.                                                           |
| `POST /job/:jobId/result`    | Enviar o desfecho final. Ignorado se o lease já tiver passado.                                                                           |

Você não deveria precisar chamá-los na mão — o agente empacotado faz isso. Estão documentados aqui caso você precise construir seu próprio agente porque o nosso não encaixa em alguma restrição sua.
