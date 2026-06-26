# Integrazione con Discord

Pubblica gli aggiornamenti degli incidenti in un canale [Discord](https://discord.com). OneUptime ha un componente workflow **Discord** integrato, quindi questa è una delle integrazioni più rapide da configurare.

Questa integrazione è **in uscita**: OneUptime pubblica in un canale Discord tramite un URL webhook in entrata.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Passaggio 1 — Crea un webhook Discord

1. In Discord, apri le impostazioni del canale di destinazione: **Edit Channel → Integrations → Webhooks**.
2. Clicca **New Webhook**, assegnagli un nome (es. `OneUptime`), scegli il canale e **copia l'URL del webhook**.

## Passaggio 2 — Salva l'URL del webhook (opzionale ma consigliato)

1. In OneUptime, vai su **Workflows → Global Variables → Create**.
2. Chiamala `DISCORD_WEBHOOK_URL`, incolla l'URL e attiva **Is Secret**.

Tenerlo in una variabile significa poterlo riutilizzare in più workflow e ruotarlo in un unico posto.

## Passaggio 3 — Crea il workflow

1. Apri **Workflows → Create Workflow**, chiamalo `Incidents → Discord` e apri il **Builder**.
2. Aggiungi un trigger **Incident** impostato su **On Create**. Rinominalo `Incident`.
3. Aggiungi un componente **Discord** collegato al trigger:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (o incollalo direttamente).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Salva**, abilita e crea un incidente di test. Il messaggio appare nel tuo canale.

## Alternativa: il componente API

Se preferisci non usare il componente dedicato, un blocco **API** fa la stessa cosa:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Questo è utile se vuoi usare gli [embed](https://discord.com/developers/docs/resources/webhook#execute-webhook) più ricchi di Discord — aggiungi un array `embeds` al corpo.

## Suggerimenti

- Usa **Conditions** per pubblicare solo per determinate severità — ramifica su `{{Incident.incidentSeverity.name}}` prima del blocco Discord.
- Aggiungi altri workflow su **Incident → On Update** per pubblicare conferme e risoluzioni nello stesso canale.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — il pattern in uscita.
- [Telegram](/docs/integrations/telegram) — la stessa idea per Telegram.
- [Componenti → Discord](/docs/workflows/components#discord) — il riferimento al componente.
