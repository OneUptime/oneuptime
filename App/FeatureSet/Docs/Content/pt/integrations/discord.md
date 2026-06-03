# Integração com o Discord

Poste atualizações de incidentes em um canal do [Discord](https://discord.com). O OneUptime tem um componente de workflow **Discord** integrado, por isso esta é uma das integrações mais rápidas de configurar.

Esta integração é de **saída**: o OneUptime posta em um canal do Discord por meio de uma URL de webhook de entrada.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Passo 1 — Crie um webhook no Discord

1. No Discord, abra as configurações do canal desejado em **Edit Channel → Integrations → Webhooks**.
2. Clique em **New Webhook**, dê um nome (ex.: `OneUptime`), escolha o canal e **copie a Webhook URL**.

## Passo 2 — Armazene a URL do webhook (opcional, mas recomendado)

1. No OneUptime, vá em **Workflows → Global Variables → Create**.
2. Nomeie como `DISCORD_WEBHOOK_URL`, cole a URL e ative **Is Secret**.

Manter em uma variável permite reutilizá-la em workflows e rotacioná-la em um único lugar.

## Passo 3 — Construa o workflow

1. Abra **Workflows → Create Workflow**, nomeie-o `Incidents → Discord` e abra o **Builder**.
2. Adicione um gatilho **Incident** definido como **On Create**. Renomeie-o para `Incident`.
3. Adicione um componente **Discord** conectado ao gatilho:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (ou cole diretamente).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Salve**, ative e crie um incidente de teste. A mensagem aparece no seu canal.

## Alternativa: o componente API

Se preferir não usar o componente dedicado, um bloco **API** faz a mesma coisa:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Isso é útil se você quiser os [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) mais ricos do Discord — adicione um array `embeds` ao corpo.

## Dicas

- Use **Conditions** para postar apenas para certas severidades — ramifique em `{{Incident.incidentSeverity.name}}` antes do bloco Discord.
- Adicione mais workflows em **Incident → On Update** para postar confirmações e resoluções no mesmo canal.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — o padrão de saída.
- [Telegram](/docs/integrations/telegram) — a mesma ideia para o Telegram.
- [Componentes → Discord](/docs/workflows/components#discord) — a referência do componente.
