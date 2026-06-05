# Integrazione con Telegram

Invia gli aggiornamenti degli incidenti a una chat o a un gruppo [Telegram](https://telegram.org). OneUptime ha un componente workflow **Telegram** integrato, quindi la configurazione è rapida.

Questa integrazione è **in uscita**: OneUptime invia messaggi tramite un bot Telegram.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Passaggio 1 — Crea un bot e ottieni il suo token

1. In Telegram, scrivi a [@BotFather](https://t.me/BotFather) e invia `/newbot`.
2. Segui le istruzioni. BotFather ti fornisce un **token bot** del tipo `123456789:AA...`.

## Passaggio 2 — Trova il tuo chat ID

1. Aggiungi il bot al gruppo (o avvia una chat diretta con esso) e inviagli qualsiasi messaggio.
2. Apri `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` nel browser.
3. Trova `"chat":{"id":...}` nella risposta — quel numero è il tuo **chat ID** (gli ID dei gruppi sono negativi).

## Passaggio 3 — Salva i segreti

1. In OneUptime, vai su **Workflows → Global Variables → Create**.
2. Crea `TELEGRAM_BOT_TOKEN` (segreto) e `TELEGRAM_CHAT_ID`.

## Passaggio 4 — Crea il workflow

1. Apri **Workflows → Create Workflow**, chiamalo `Incidents → Telegram` e apri il **Builder**.
2. Aggiungi un trigger **Incident** impostato su **On Create**. Rinominalo `Incident`.
3. Aggiungi un componente **Telegram** collegato al trigger:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Salva**, abilita e crea un incidente di test. Il messaggio arriva nella tua chat.

## Alternativa: il componente API

Funziona anche un blocco **API**:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Suggerimenti

- Il bot vede i messaggi solo dopo essere stato aggiunto a un gruppo e con la **modalità privacy** che lo consente — se `getUpdates` è vuoto, invia prima un messaggio al bot, oppure disabilita la modalità privacy tramite BotFather.
- Usa **Conditions** per filtrare per severità prima di inviare.
- Aggiungi `"parse_mode": "Markdown"` al corpo dell'API (o usa la formattazione del componente) per grassetto e link.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — il pattern in uscita.
- [Discord](/docs/integrations/discord) — la stessa idea per Discord.
- [Componenti → Telegram](/docs/workflows/components#telegram) — il riferimento al componente.
