# Integração com o Telegram

Envie atualizações de incidentes para um chat ou grupo do [Telegram](https://telegram.org). O OneUptime tem um componente de workflow **Telegram** integrado, por isso a configuração é rápida.

Esta integração é de **saída**: o OneUptime envia mensagens por meio de um bot do Telegram.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Passo 1 — Crie um bot e obtenha seu token

1. No Telegram, envie uma mensagem para [@BotFather](https://t.me/BotFather) e envie `/newbot`.
2. Siga as instruções. O BotFather fornece um **bot token** como `123456789:AA...`.

## Passo 2 — Encontre o seu chat ID

1. Adicione o bot ao grupo (ou inicie uma conversa direta com ele) e envie qualquer mensagem.
2. Abra `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates` em um navegador.
3. Encontre `"chat":{"id":...}` na resposta — esse número é o seu **chat ID** (IDs de grupo são negativos).

## Passo 3 — Armazene os segredos

1. No OneUptime, vá em **Workflows → Global Variables → Create**.
2. Crie `TELEGRAM_BOT_TOKEN` (secreto) e `TELEGRAM_CHAT_ID`.

## Passo 4 — Construa o workflow

1. Abra **Workflows → Create Workflow**, nomeie-o `Incidents → Telegram` e abra o **Builder**.
2. Adicione um gatilho **Incident** definido como **On Create**. Renomeie-o para `Incident`.
3. Adicione um componente **Telegram** conectado ao gatilho:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Salve**, ative e crie um incidente de teste. A mensagem chega no seu chat.

## Alternativa: o componente API

Um bloco **API** também funciona:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Dicas

- O bot só vê mensagens depois de ser adicionado a um grupo e o **privacy mode** permitir — se `getUpdates` estiver vazio, envie uma mensagem ao bot primeiro ou desative o privacy mode pelo BotFather.
- Use **Conditions** para filtrar por severidade antes de enviar.
- Adicione `"parse_mode": "Markdown"` ao corpo da API (ou use a formatação do componente) para negrito e links.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — o padrão de saída.
- [Discord](/docs/integrations/discord) — a mesma ideia para o Discord.
- [Componentes → Telegram](/docs/workflows/components#telegram) — a referência do componente.
