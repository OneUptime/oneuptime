# Integração com o Grafana

Transforme alertas do [Grafana](https://grafana.com) em incidentes do OneUptime. O Grafana avalia as regras de alerta nos seus dashboards; o OneUptime os registra, escalona e acompanha.

Esta integração é de **entrada**: o sistema de alertas do Grafana faz POST para um **[Workflow](/docs/workflows/index)** do OneUptime que começa com um **gatilho Webhook**, usando um **Webhook contact point** do Grafana.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Pré-requisitos

- Grafana 9+ com [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) habilitado (padrão no Grafana moderno).
- O Grafana deve conseguir alcançar sua instância do OneUptime via HTTPS.
- Um projeto no OneUptime onde você possa criar workflows.

## Passo 1 — Construa o workflow do OneUptime

1. Abra **Workflows → Create Workflow**, nomeie-o `Grafana → Incidents` e abra o **Builder**.
2. Adicione um gatilho **Webhook** e **copie sua URL**. Renomeie o bloco para `Grafana`.
3. Adicione um bloco **Conditions** conectado ao gatilho:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. A partir de **Yes**, adicione um bloco **Create Incident**:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: escolha uma (ou ramifique em `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Salve** (deixe desativado até testar).

O payload do webhook do Grafana segue o formato do Alertmanager — inclui `status`, um array `alerts`, `commonLabels` e `commonAnnotations`, além de campos convenientes de nível superior `title` e `message`.

## Passo 2 — Configure o contact point do Grafana

1. No Grafana, vá em **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: cole a URL do webhook do seu workflow. **HTTP Method**: `POST`.
4. Salve o contact point.
5. Vá em **Alerting → Notification policies** e roteie os alertas que deseja (ou a política padrão) para o contact point **OneUptime**.

## Passo 3 — Teste

1. Ative o workflow.
2. Na tela do contact point, use **Test** para enviar uma notificação de amostra ou deixe uma regra de alerta real disparar.
3. Verifique a aba **Logs** do workflow e sua lista de **Incidents**.

## Resolvendo na recuperação (opcional)

Quando o alerta é limpo, o Grafana envia outra notificação com `status: resolved`. Adicione uma segunda ramificação **Conditions** (`status == resolved`), encontre o incidente correspondente e mova-o ao estado resolvido com **Update Incident**.

## Observações

- **Alerting legado (Grafana 8 e anteriores)** envia um payload diferente (`ruleName`, `state`, `evalMatches`). Se você estiver no alerting legado, referencie `{{Grafana.Request Body.ruleName}}` e `{{Grafana.Request Body.state}}` em vez disso, e ramifique em `state == alerting`.
- Você também pode ignorar o sistema de alertas do Grafana completamente e ter o OneUptime monitorando as mesmas métricas diretamente — veja [Monitor de Métricas](/docs/monitor/metrics-monitor).

## Solução de problemas

- **Nenhuma execução aparece** — confirme que o Grafana consegue alcançar a URL (verifique os logs do servidor do Grafana) e que o workflow está **Enabled**.
- **Campos vazios** — inspecione a saída do gatilho na aba **Logs**; referencie campos que existem para a sua versão de alerting.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — o padrão de entrada.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — payload estreitamente relacionado.
- [Monitor de Métricas](/docs/monitor/metrics-monitor) — monitore métricas diretamente no OneUptime.
