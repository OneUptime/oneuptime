# Modelos Dinâmicos de Incidentes e Alertas

Você pode usar a mesma sintaxe de espaço reservado `{{variable}}` usada por Expressões JavaScript em critérios de monitor para preencher dinamicamente o Título, Descrição e Notas de Remediação de Incidentes e Alertas quando são criados automaticamente a partir de critérios de monitor.

## Tipos de Monitor e Variáveis Suportados

Os seguintes tipos de monitor suportam modelos dinâmicos com suas respectivas variáveis:

- **Monitores de Site e API**: Dados de resposta, cabeçalhos, códigos de status, temporização
- **Monitores de Requisição de Entrada**: Dados de requisição, cabeçalhos, métodos, temporização
- **Monitores de Ping**: Status de conectividade, tempos de resposta, causas de falha
- **Monitores de Porta**: Conectividade de porta, tempos de resposta, status de timeout
- **Monitores de IP**: Acessibilidade de IP, tempos de ping, informações de falha
- **Monitores de Certificado SSL**: Detalhes do certificado, status de validação, informações de expiração
- **Monitores de Servidor/VM**: Métricas do sistema (CPU, memória, disco), processos, hostname
- **Monitores Sintéticos**: Resultados de execução de script, capturas de tela, detalhes do navegador
- **Monitores de Código JavaScript Personalizado**: Resultados de execução, temporização, mensagens de erro
- **Monitores SNMP**: Status do dispositivo, tempos de resposta, valores de OID

> **Nota**: Os monitores de Logs, Rastreamentos e Métricas atualmente não suportam modelos de incidente/alerta, pois usam mecanismos de gatilho diferentes.

## Tipos de Monitor e Variáveis Suportados

### Monitores de Site e API

| Variável             | Descrição                                                                             | Tipo                 |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------- |
| `responseBody`       | O objeto do corpo de resposta. Se HTML/XML, então string. Se JSON, então objeto JSON. | `string` ou `JSON`   |
| `responseHeaders`    | O objeto de cabeçalhos de resposta (chaves em minúsculas).                            | `Dictionary<string>` |
| `responseStatusCode` | O código de status de resposta HTTP.                                                  | `number`             |
| `responseTimeInMs`   | O tempo de resposta em milissegundos.                                                 | `number`             |
| `isOnline`           | Se o monitor é considerado online.                                                    | `boolean`            |

### Monitores de Requisição de Entrada

| Variável                    | Descrição                                                    | Tipo                 |
| --------------------------- | ------------------------------------------------------------ | -------------------- |
| `requestBody`               | O objeto do corpo de requisição.                             | `string` ou `JSON`   |
| `requestHeaders`            | O objeto de cabeçalhos de requisição (chaves em minúsculas). | `Dictionary<string>` |
| `requestMethod`             | O método HTTP da requisição de entrada (GET, POST, etc.).    | `string`             |
| `incomingRequestReceivedAt` | A data e hora em que a requisição de entrada foi recebida.   | `Date`               |

### Monitores de Ping

| Variável           | Descrição                                     | Tipo      |
| ------------------ | --------------------------------------------- | --------- |
| `isOnline`         | Se o alvo de ping é considerado online.       | `boolean` |
| `responseTimeInMs` | O tempo de resposta de ping em milissegundos. | `number`  |
| `failureCause`     | O motivo da falha se o ping falhou.           | `string`  |
| `isTimeout`        | Se a requisição de ping expirou.              | `boolean` |

### Monitores de Porta

| Variável           | Descrição                                           | Tipo      |
| ------------------ | --------------------------------------------------- | --------- |
| `isOnline`         | Se a porta é considerada online/acessível.          | `boolean` |
| `responseTimeInMs` | O tempo de resposta de conexão em milissegundos.    | `number`  |
| `failureCause`     | O motivo da falha se a verificação de porta falhou. | `string`  |
| `isTimeout`        | Se a conexão de porta expirou.                      | `boolean` |

### Monitores de IP

| Variável           | Descrição                                        | Tipo      |
| ------------------ | ------------------------------------------------ | --------- |
| `isOnline`         | Se o endereço IP é considerado online.           | `boolean` |
| `responseTimeInMs` | O tempo de resposta de ping em milissegundos.    | `number`  |
| `failureCause`     | O motivo da falha se a verificação de IP falhou. | `string`  |
| `isTimeout`        | Se a requisição de ping de IP expirou.           | `boolean` |

### Monitores de Certificado SSL

| Variável             | Descrição                                             | Tipo      |
| -------------------- | ----------------------------------------------------- | --------- |
| `isOnline`           | Se a verificação de certificado SSL foi bem-sucedida. | `boolean` |
| `isSelfSigned`       | Se o certificado SSL é autoassinado.                  | `boolean` |
| `createdAt`          | A data de criação do certificado SSL.                 | `Date`    |
| `expiresAt`          | A data de expiração do certificado SSL.               | `Date`    |
| `commonName`         | O nome comum (CN) do certificado.                     | `string`  |
| `organizationalUnit` | A unidade organizacional (OU) do certificado.         | `string`  |
| `organization`       | A organização (O) do certificado.                     | `string`  |
| `locality`           | A localidade (L) do certificado.                      | `string`  |
| `state`              | O estado/província (ST) do certificado.               | `string`  |
| `country`            | O país (C) do certificado.                            | `string`  |
| `serialNumber`       | O número de série do certificado.                     | `string`  |
| `fingerprint`        | A impressão digital SHA-1 do certificado.             | `string`  |
| `fingerprint256`     | A impressão digital SHA-256 do certificado.           | `string`  |
| `failureCause`       | O motivo da falha se a verificação SSL falhou.        | `string`  |

### Monitores de Servidor/VM

| Variável                     | Descrição                                                              | Tipo            |
| ---------------------------- | ---------------------------------------------------------------------- | --------------- |
| `hostname`                   | O hostname do servidor monitorado.                                     | `string`        |
| `requestReceivedAt`          | A data e hora em que a requisição do monitor de servidor foi recebida. | `Date`          |
| `cpuUsagePercent`            | O percentual de uso de CPU.                                            | `number`        |
| `cpuCores`                   | O número de núcleos de CPU.                                            | `number`        |
| `memoryUsagePercent`         | O percentual de uso de memória.                                        | `number`        |
| `memoryFreePercent`          | O percentual de memória livre.                                         | `number`        |
| `memoryTotalBytes`           | A memória total em bytes.                                              | `number`        |
| `diskMetrics`                | Array de métricas de disco para todos os discos montados.              | `Array<Object>` |
| `diskMetrics[].diskPath`     | O caminho do ponto de montagem do disco.                               | `string`        |
| `diskMetrics[].usagePercent` | O percentual de uso do disco para este ponto de montagem.              | `number`        |
| `diskMetrics[].freePercent`  | O percentual livre do disco para este ponto de montagem.               | `number`        |
| `diskMetrics[].totalBytes`   | O espaço total em disco em bytes para este ponto de montagem.          | `number`        |
| `processes`                  | Array de processos em execução no servidor.                            | `Array<Object>` |
| `processes[].pid`            | O ID do processo.                                                      | `number`        |
| `processes[].name`           | O nome do processo.                                                    | `string`        |
| `processes[].command`        | O comando usado para iniciar o processo.                               | `string`        |
| `failureCause`               | O motivo da falha se a verificação do servidor falhou.                 | `string`        |

### Monitores Sintéticos

Os monitores sintéticos executam o mesmo script em múltiplos navegadores (Chromium, Firefox, Webkit) e tamanhos de tela (mobile, tablet, desktop), produzindo uma resposta por configuração. Cada execução é exposta através do array `syntheticResponses` — acesse uma execução específica por índice (`{{syntheticResponses[0].browserType}}`) ou itere com `{{#each syntheticResponses}}`.

| Variável                                 | Descrição                                                                                             | Tipo                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `failureCause`                           | O motivo da falha se a verificação sintética falhou.                                                  | `string`                                |
| `syntheticResponses`                     | Array contendo uma entrada por combinação de navegador/tamanho de tela em que o script foi executado. | `Array<Object>`                         |
| `syntheticResponses[].executionTimeInMs` | Tempo de execução em milissegundos para esta execução.                                                | `number`                                |
| `syntheticResponses[].result`            | O resultado retornado por esta execução.                                                              | `string`, `number`, `boolean` ou `JSON` |
| `syntheticResponses[].scriptError`       | Qualquer erro que ocorreu durante esta execução.                                                      | `string`                                |
| `syntheticResponses[].logMessages`       | Mensagens de log geradas durante esta execução.                                                       | `Array<string>`                         |
| `syntheticResponses[].screenshots`       | Capturas de tela tiradas durante esta execução.                                                       | `Object`                                |
| `syntheticResponses[].browserType`       | Navegador usado para esta execução.                                                                   | `string`                                |
| `syntheticResponses[].screenSizeType`    | Tamanho de tela usado para esta execução.                                                             | `string`                                |

### Monitores de Código JavaScript Personalizado

| Variável            | Descrição                                                            | Tipo                                    |
| ------------------- | -------------------------------------------------------------------- | --------------------------------------- |
| `executionTimeInMs` | O tempo gasto para executar o código personalizado em milissegundos. | `number`                                |
| `result`            | O resultado retornado pelo código personalizado.                     | `string`, `number`, `boolean` ou `JSON` |
| `scriptError`       | Qualquer erro que ocorreu durante a execução do código.              | `string`                                |
| `logMessages`       | Array de mensagens de log geradas durante a execução.                | `Array<string>`                         |

### Monitores SNMP

| Variável               | Descrição                                                      | Tipo                 |
| ---------------------- | -------------------------------------------------------------- | -------------------- |
| `isOnline`             | Se o dispositivo SNMP está online e respondendo.               | `boolean`            |
| `responseTimeInMs`     | O tempo de resposta da consulta SNMP em milissegundos.         | `number`             |
| `failureCause`         | O motivo da falha se a consulta SNMP falhou.                   | `string`             |
| `isTimeout`            | Se a consulta SNMP expirou.                                    | `boolean`            |
| `oidResponses`         | Array de objetos de resposta OID com oid, nome, valor e tipo.  | `Array<Object>`      |
| `oidResponses[].oid`   | O OID que foi consultado.                                      | `string`             |
| `oidResponses[].name`  | O nome amigável do OID (se fornecido).                         | `string`             |
| `oidResponses[].value` | O valor retornado pelo OID.                                    | `string` ou `number` |
| `oidResponses[].type`  | O tipo de dados SNMP do valor.                                 | `string`             |
| `{{OID_NAME}}`         | Acesso direto ao valor do OID por nome (ex.: `{{sysUpTime}}`). | `string` ou `number` |

## Uso Básico

No formulário de Incidente/Alerta dentro de uma instância de Critério de Monitor, você pode escrever:

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

Se o código de status de resposta do monitor for `502` e o tempo for `842`, o título armazenado se torna:

```
API returned 502 in 842ms
```

O acesso a JSON aninhado funciona da mesma forma que as Expressões JavaScript:

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

A indexação de arrays é suportada:

```
First User: {{responseBody.users[0].name}}
```

Se um caminho não existir, resolverá para uma string vazia por padrão.

## Uso Avançado

### Acessando Elementos de Array

```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### Acesso a Objeto Aninhado

```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### Iterando sobre Arrays com `{{#each}}`

Você pode iterar sobre arrays usando a sintaxe de bloco `{{#each path}}...{{/each}}`. Isso é útil quando os dados contêm uma lista de itens e você quer incluir cada um na descrição do incidente ou alerta.

**Sintaxe:**

```
{{#each arrayPath}}
  ...corpo usando {{property}} de cada elemento...
{{/each}}
```

Dentro do corpo do loop:

- `{{propertyName}}` resolve relativo ao elemento do array atual
- `{{nested.property}}` acesso com notação de ponto funciona no elemento atual
- `{{@index}}` resolve para o índice de base 0 da iteração atual
- `{{this}}` resolve para o valor do elemento atual (útil para arrays de strings/números)
- Variáveis não encontradas no elemento atual recorrem ao mapa de armazenamento pai

**Exemplo — Requisição de Entrada com array de alertas (ex.: webhooks do Grafana):**

Se o corpo da sua requisição de entrada se parece com:

```json
{
  "status": "firing",
  "alerts": [
    { "status": "firing", "labels": { "label": "Coralpay" } },
    { "status": "firing", "labels": { "label": "capitecpay" } },
    { "status": "resolved", "labels": { "label": "capricorn" } }
  ]
}
```

Você pode escrever um modelo como:

```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

Que produz:

```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**Exemplo — Métricas de disco do servidor:**

```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**Exemplo — Usando `{{@index}}`:**

```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**Exemplo — Array primitivo com `{{this}}`:**

```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**Exemplo — Loops aninhados:**

Você pode aninhar blocos `{{#each}}` para arrays de múltiplos níveis:

```
{{#each requestBody.groups}}
Group: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **Nota**: Se o caminho não resolver para um array, o bloco `{{#each}}...{{/each}}` inteiro é removido da saída. Arrays vazios não produzem saída para o bloco.

## Exemplos

### Título de Incidente do Monitor de Site/API

```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### Descrição de Incidente do Monitor de Site/API

```
### API Error
Status: **{{responseStatusCode}}**
Latency: **{{responseTimeInMs}}ms**
Body Snippet: `{{responseBody.error.message}}`
```

### Título de Alerta do Monitor de Requisição de Entrada

```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### Título de Alerta do Monitor de Certificado SSL

```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### Descrição de Alerta do Monitor de Servidor

```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**
Memory Usage: **{{memoryUsagePercent}}%**
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**
Last Check: {{requestReceivedAt}}
```

### Título de Alerta do Monitor de Ping

```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Descrição de Alerta do Monitor de Porta

```
Port connectivity issue
Target port status: {{isOnline}}
Response time: {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### Alerta do Monitor Sintético

Acesse uma execução específica de navegador/tamanho de tela por índice:

```
First run: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Result: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

Itere sobre cada combinação de navegador/tamanho de tela com `{{#each}}`:

```
### Synthetic Monitor Results
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Script error: {{scriptError}}
  - First log: {{logMessages[0]}}
{{/each}}
```

### Alerta do Monitor de Código Personalizado

```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### Título de Alerta do Monitor SNMP

```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Descrição de Alerta do Monitor SNMP

```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```

### Requisição de Entrada com Loop de Array (Webhook do Grafana)

Título:

```
[{{requestBody.status}}] {{requestBody.receiver}}
```

Descrição:

```
### Alerts from {{requestBody.receiver}}

{{#each requestBody.alerts}}
**Alert {{@index}}**: {{labels.alertname}}
- Label: {{labels.label}}
- Status: {{status}}
- Values: {{valueString}}
- Source: {{generatorURL}}
{{/each}}
```

### Monitor de Servidor com Loop de Disco

Descrição:

```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**
Memory Usage: **{{memoryUsagePercent}}%**

**Disk Usage:**
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used ({{freePercent}}% free)
{{/each}}

**Running Processes:**
{{#each processes}}
- [{{pid}}] {{name}}: {{command}}
{{/each}}
```

### Monitor SNMP com Loop de OID

Descrição:

```
### SNMP Device Status
Online: {{isOnline}}
Response: {{responseTimeInMs}}ms

**OID Values:**
{{#each oidResponses}}
- {{name}} ({{oid}}): {{value}}
{{/each}}
```
