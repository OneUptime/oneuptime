# Integração com o Grafana

Transforme os alertas do [Grafana](https://grafana.com) em incidentes do OneUptime. O Grafana avalia as regras de alerta dos seus dashboards; o OneUptime as registra, escalona e acompanha.

Esta integração é **de entrada**: um **contact point Webhook** do Grafana faz POST para o OneUptime. Há duas formas de recebê-lo.

| Abordagem                                                                                    | Use quando                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Monitor de Requisição de Entrada](/docs/monitor/incoming-request-monitor)** (recomendado) | Você quer que os alertas virem incidentes com escalonamento de plantão, um incidente por alerta e resolução automática na recuperação.          |
| **[Workflow](/docs/workflows/index) com um gatilho Webhook**                                 | Você precisa de lógica de roteamento que o OneUptime não faz nativamente — chamar outros sistemas, remodelar payloads, ramificação condicional. |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

O payload do webhook do Grafana segue o formato do Alertmanager — `status`, um array `alerts`, `commonLabels` e `commonAnnotations`, além de campos convenientes de nível superior `title` e `message`.

## Pré-requisitos

- Grafana 9+ com [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) habilitado (o padrão no Grafana moderno).
- O Grafana precisa conseguir alcançar a sua instância do OneUptime por HTTPS.
- Um projeto do OneUptime em que você possa criar monitores (ou workflows).

## Opção 1 — Monitor de Requisição de Entrada

1. Vá para **Monitores → Criar monitor** e escolha **Requisição de entrada**. Abra-o e clique em **Documentation** no menu à esquerda para copiar a URL.
2. Abra os **Criteria** do monitor e defina **Filter Type** como `JavaScript Expression` e **Value** como `"{{requestBody.status}}" === "firing"`.
3. Declare um incidente na correspondência, escolha as **On-Call Policies** a acionar e ative **Auto Resolve Incident** em **Advanced Options**.
4. Em **Settings**, ative **Group incidents and alerts by a payload field** e defina:

   | Campo                              | Valor                               |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. Intitule o incidente com `{{requestBody.commonLabels.alertname}}` e descreva-o com `{{requestBody.message}}` ou `{{requestBody.commonAnnotations.summary}}`. (`{{fingerprint}}` contém a própria chave de agrupamento, mas é um hash — não algo para mostrar a quem responde.)
6. Aponte o contact point do Grafana para a URL do monitor (veja os passos do contact point abaixo).

Cada valor de agrupamento **distinto** vira um incidente próprio, e cada um fecha quando o Grafana o reporta como resolvido. O `fingerprint` por alerta do Grafana é único para o conjunto de labels de um alerta, e é por isso que ele é o caminho de agrupamento acima. A página do [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) percorre a mesma configuração com mais detalhes — o formato do payload é o mesmo, então cada passo de lá se aplica aqui.

> **Warning:** Não agrupe por uma label que seja constante em toda uma notificação. A política de notificação padrão do Grafana agrupa por `grafana_folder` e `alertname`, então todos os alertas de um webhook compartilham o mesmo alertname — agrupar por `requestBody.alerts[*].labels.alertname` colapsaria o payload inteiro em um único incidente. Os caminhos de agrupamento também precisam começar com o literal `requestBody.`, e apenas o primeiro `[*]` de um caminho é um curinga. Todos esses erros falham em silêncio.

## Opção 2 — Workflow

Use isto quando precisar de lógica além de "um alerta vira um incidente".

### Passo 1 — Construa o workflow do OneUptime

1. Abra **Fluxos de trabalho → Criar fluxo de trabalho**, nomeie-o `Grafana → Incidents` e abra o **Construtor**.
2. Adicione um gatilho **Webhook** e **copie sua URL**. Renomeie o bloco para `Grafana`.
3. Adicione um bloco **Condições** conectado ao gatilho:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. A partir de **Sim**, adicione um bloco **Criar incidente**:
   - **Título**: `{{Grafana.Request Body.title}}`
   - **Descrição**: `{{Grafana.Request Body.message}}`
   - **Gravidade**: escolha uma (ou ramifique em `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Salvar** (deixe desativado até testar).

## Configure o contact point do Grafana

1. No Grafana, vá para **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: cole a URL do monitor da Opção 1, ou a URL do webhook do workflow da Opção 2. **HTTP Method**: `POST`.
4. Salve o contact point.
5. Vá para **Alerting → Notification policies** e roteie os alertas que quiser (ou a política padrão) para o contact point **OneUptime**.

## Teste

1. Habilite o workflow, se você construiu um.
2. Na tela do contact point, use **Test** para enviar uma notificação de exemplo, ou deixe uma regra de alerta real disparar.
3. Verifique a sua lista de **Incidentes** — e a aba **Logs** do workflow se você usou a Opção 2.

## Resolvendo na recuperação

Quando o alerta se resolve, o Grafana envia outra notificação com `status: resolved`.

Com a **Opção 1**, o campo e o valor de recuperação configurados acima fecham o incidente correspondente automaticamente — desde que **Auto Resolve Incident** esteja ativado.

Com a **Opção 2**, adicione um segundo ramo de **Condições** (`status == resolved`), encontre o incidente correspondente e mova-o para o seu estado resolvido com **Update Incident**.

## Observações

- **O alerting legado (Grafana 8 e anteriores)** envia um payload diferente (`ruleName`, `state`, `evalMatches`). Se você usa o alerting legado, referencie `{{Grafana.Request Body.ruleName}}` e `{{Grafana.Request Body.state}}` no lugar, e ramifique em `state == alerting`.
- Você também pode pular o alerting do Grafana por completo e fazer o OneUptime monitorar as mesmas métricas diretamente — veja o [Monitor de métricas](/docs/monitor/metrics-monitor).

## Solução de problemas

- **Nada chega** — confirme que o Grafana consegue alcançar a URL (verifique os logs do servidor do Grafana) e, na Opção 2, que o workflow está **Habilitado**. O OneUptime responde a toda requisição de entrada com um `200` vazio antes de validá-la, então um `200` nos logs do Grafana não confirma que o payload foi aceito.
- **Os incidentes abrem mas nunca fecham** — verifique o campo e o valor de recuperação no critério, e se **Auto Resolve Incident** está ativado em **Advanced Options** do incidente. A comparação diferencia maiúsculas de minúsculas.
- **Apenas um incidente para um payload cheio de alertas** — você agrupou por uma label que não varia dentro de uma notificação. Agrupe por `requestBody.alerts[*].fingerprint` em vez disso.
- **O texto do incidente mostra marcadores `{{...}}` crus** — o caminho não resolveu, e marcadores não resolvidos ficam no lugar em vez de serem esvaziados. Referencie campos que existam na sua versão de alerting; inspecione a saída do gatilho na aba **Logs** se você usou a Opção 2.

## O que ler em seguida

- [Monitor de Requisição de Entrada](/docs/monitor/incoming-request-monitor) — o tipo de monitor, seus critérios e o agrupamento de incidentes por completo.
- [Visão geral das integrações](/docs/integrations/index) — o padrão de entrada.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — payload muito relacionado.
- [Monitor de métricas](/docs/monitor/metrics-monitor) — monitore métricas diretamente no OneUptime.
