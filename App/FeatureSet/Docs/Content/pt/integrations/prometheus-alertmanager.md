# Integração com o Prometheus Alertmanager

Transforme as notificações do [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) em incidentes do OneUptime. O Prometheus avalia as suas regras de alerta, o Alertmanager as roteia, e o OneUptime as registra e escalona.

Esta integração é **de entrada**, e há duas formas de construí-la:

| Abordagem                                                                                    | Use quando                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Monitor de Requisição de Entrada](/docs/monitor/incoming-request-monitor)** (recomendado) | Você quer que os alertas virem incidentes com escalonamento de plantão, um incidente por alerta e resolução automática na recuperação. Sem lógica para manter. |
| **[Workflow](/docs/workflows/index) com um gatilho Webhook**                                 | Você precisa de lógica de roteamento que o OneUptime não faz nativamente — chamar outros sistemas, remodelar payloads, ramificação condicional.                |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Pré-requisitos

- Uma instalação Prometheus + Alertmanager em que você possa editar o `alertmanager.yml`.
- O Alertmanager precisa conseguir alcançar a sua instância do OneUptime por HTTPS.
- Um projeto do OneUptime em que você possa criar monitores (ou workflows).

## Opção 1 — Monitor de Requisição de Entrada

### Passo 1 — Crie o monitor

1. Vá para **Monitores → Criar monitor** e escolha **Requisição de entrada**.
2. Abra o monitor e clique em **Documentation** no menu à esquerda. Copie a URL:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Use o seu próprio host se for auto-hospedado. A chave secreta no caminho é a única credencial.

### Passo 2 — Aponte o Alertmanager para ele

No `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` é obrigatório — é o que informa ao OneUptime que um alerta se recuperou. Recarregue o Alertmanager com `curl -X POST http://localhost:9093/-/reload`, ou reinicie-o.

O Alertmanager envia `Content-Type: application/json`, que é o que o OneUptime precisa para ler campos do payload.

### Passo 3 — Configure os critérios

Abra os **Criteria** do monitor e edite o primeiro critério.

**Filtro**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  As aspas em volta do marcador são necessárias para uma comparação de strings. Um filtro `Request Body` / `Contains` / `"status":"firing"` também funciona se você preferir não usar uma expressão.

**Ações**

- Ative _When filters match, change monitor status_ e defina como **Offline** (ou Degraded).
- Ative _When filters match, declare an incident_. Defina o **Title**, a **Severity** e as **On-Call Policies** que devem ser acionadas.
- Em **Advanced Options** desse incidente, ative **Auto Resolve Incident**. Sem isso, notificações de recuperação são ignoradas e os incidentes ficam abertos para sempre.

**Settings → Group incidents and alerts by a payload field**

Ative isso para que um único endpoint possa sustentar vários incidentes simultâneos — um por alerta — em vez de um único incidente por notificação.

| Campo                              | Valor                               |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` se expande sobre o array `alerts` do Alertmanager, abrindo um incidente por valor extraído **distinto**. Como ambos os caminhos usam `[*]`, a recuperação é julgada por alerta: em um payload em que um alerta foi resolvido e dois ainda estão ativos, apenas o resolvido fecha.

> **Warning:** Agrupe por algo genuinamente único por alerta. O `fingerprint` do Alertmanager é um hash do conjunto completo de labels do alerta, então ele sempre é. Uma label só serve se variar **dentro** de uma notificação — e qualquer label listada no `group_by` da sua rota nunca varia, porque é justamente isso que define o grupo de agregação. Com o `group_by: ["alertname", "instance"]` acima, agrupar por `requestBody.alerts[*].labels.alertname` extrai o mesmo valor de todos os alertas do payload, então todos colapsam em um único incidente. Pior ainda: de valores duplicados apenas a **primeira** ocorrência é mantida, então um payload cujo primeiro alerta seja `resolved` fecha esse incidente enquanto os demais ainda estão ativos.

### Passo 4 — Escreva o título e a descrição do incidente

A chave de agrupamento fica disponível como uma variável com o nome do último segmento do caminho, então `requestBody.alerts[*].fingerprint` te dá `{{fingerprint}}`. Isso é um hash, não algo para mostrar a quem responde — em vez disso, intitule o incidente com as labels compartilhadas por toda a notificação. `commonLabels` carrega todas as labels do `group_by` da sua rota, então com a configuração acima `alertname` e `instance` estão ambos disponíveis:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` e `commonAnnotations` contêm os campos compartilhados por toda a notificação. Um caminho por alerta como `requestBody.alerts[0].annotations.summary` sempre lê o _primeiro_ alerta do payload, não aquele para o qual este incidente específico foi aberto — então mantenha o `group_by` enxuto se quiser que cada incidente carregue o seu próprio texto de anotação. Um caminho que não resolve é impresso literalmente, chaves e tudo, em vez de ficar em branco. Veja [Modelos dinâmicos de incidentes e alertas](/docs/monitor/incident-alert-templating) para a lista completa de variáveis.

### Passo 5 — Devolva o monitor para Operational (opcional)

Critérios só agem quando correspondem, então adicione um segundo critério para que o monitor não fique Offline depois que tudo se resolver:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, e não declare nenhum incidente.

### Passo 6 — Teste

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

Você deve receber dois incidentes — um por `fingerprint`. Reenvie com o `status` de ambos os alertas definido como `resolved` e ambos devem fechar.

Você também pode disparar um alerta real com o `amtool`:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Opção 2 — Workflow

Use isto quando precisar de lógica além de "um alerta vira um incidente".

1. Abra **Fluxos de trabalho → Criar fluxo de trabalho**, nomeie-o `Alertmanager → Incidents` e abra o **Construtor**.
2. Adicione um gatilho **Webhook** e **copie sua URL**. Renomeie o bloco para `Alertmanager`.
3. Adicione um bloco **Condições** conectado ao gatilho:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. A partir de **Sim**, adicione um bloco **Criar incidente**:
   - **Título**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Descrição**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Gravidade**: escolha uma (ou ramifique em `{{Alertmanager.Request Body.commonLabels.severity}}` primeiro).
5. **Salvar**, e depois aponte a URL de `webhook_configs` do Passo 2 acima para a URL do workflow.

Para um incidente por alerta, adicione um bloco [Custom Code](/docs/workflows/components#custom-code) que percorra `Request Body.alerts`. Com `send_resolved: true`, adicione um segundo ramo de **Condições** em `status == resolved` que encontre o incidente correspondente e o mova para o seu estado resolvido com **Update Incident**.

## Interruptor de homem morto

Nenhuma das duas opções avisa quando o próprio Prometheus para de funcionar — nenhum alerta chegando se parece exatamente com nada de errado. A resposta habitual é um alerta sempre ativo roteado para um monitor que o espera em uma programação. O [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) traz um chamado `Watchdog`; em um Prometheus simples, adicione uma regra de alerta com uma expressão sempre verdadeira (`vector(1)`).

Crie um **segundo** Monitor de Requisição de Entrada, roteie o `Watchdog` para ele com um `repeat_interval` curto, e dê a esse monitor um critério **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes**. Esse é o único caso em que um critério de requisição ausente cabe em um receptor de alertas.

Esta é a configuração do Passo 2 com a rota e o receiver do watchdog incorporados — uma sub-rota é avaliada antes do receiver da própria rota pai, então o `Watchdog` vai para o segundo monitor e todo o resto continua indo para o primeiro:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## Solução de problemas

- **Nada chega** — confirme que o Alertmanager consegue alcançar a URL; verifique os logs dele em busca de erros de entrega. O OneUptime responde a toda requisição com um `200` vazio antes de validar qualquer coisa, então um `200` não confirma que o payload foi aceito. Verifique a linha do tempo do monitor em vez disso.
- **Os incidentes abrem mas nunca fecham** — verifique `send_resolved: true` no Alertmanager, o campo e o valor de recuperação no critério (a comparação diferencia maiúsculas de minúsculas) e **Auto Resolve Incident** em **Advanced Options** do incidente. Duas causas mais sutis: um payload com mais chaves distintas do que **Max incidents per request** esconde da recuperação também as que ficam além do limite; e se a notificação `resolved` for justamente a descartada pela unificação na ingestão (abaixo), o incidente fica preso permanentemente, porque o Alertmanager repete as notificações de disparo, mas não as de resolução. Feche essas à mão.
- **Nenhum incidente, status do monitor inalterado** — o caminho de agrupamento precisa começar com o literal `requestBody.`, e apenas o primeiro `[*]` de um caminho é um curinga. Ambos os erros falham em silêncio.
- **O texto do incidente mostra marcadores `{{...}}` crus** — o caminho não resolveu, e o OneUptime deixa marcadores não resolvidos no lugar em vez de esvaziá-los. Regras diferentes definem anotações diferentes, então referencie campos que realmente existam para as suas regras (`commonAnnotations` versus as `annotations` de cada alerta).
- **Apenas um incidente para um payload cheio de alertas** — você agrupou por uma label que não varia dentro de uma notificação, mais frequentemente uma que também está no `group_by` da sua rota. Agrupe por `requestBody.alerts[*].fingerprint` em vez disso.
- **Incidentes demais** — amplie `group_by` / `group_interval` para que o Alertmanager agrupe alertas relacionados. Diminuir **Max incidents per request** os limita, mas também esconde da recuperação as chaves além do limite.
- **Algumas notificações parecem ser puladas em rajadas intensas** — requisições para o mesmo monitor são unificadas na ingestão para que um único emissor não consiga sobrecarregá-lo, o que pode descartar um payload intermediário quando as notificações chegam em sequência. Aumentar `group_wait` e `group_interval` as espaça. A unificação é controlada pela variável de ambiente `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` do contêiner da aplicação, ativada por padrão; quem faz auto-hospedagem e precisa que todo payload seja avaliado pode defini-la como `false` nesse contêiner.

## O que ler em seguida

- [Monitor de Requisição de Entrada](/docs/monitor/incoming-request-monitor) — o tipo de monitor, seus critérios e o agrupamento de incidentes por completo.
- [Visão geral das integrações](/docs/integrations/index) — os padrões de entrada e de saída.
- [Grafana](/docs/integrations/grafana) — a mesma ideia, com os alertas do Grafana.
- [Gatilho Webhook](/docs/workflows/triggers#webhook) — como funciona a URL receptora do workflow.
