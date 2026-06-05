# Discord-integrasjon

Post hendelsesoppdateringer til en [Discord](https://discord.com)-kanal. OneUptime har en innebygd **Discord**-arbeidsflytkomponent, så dette er en av de raskeste integrasjonene å sette opp.

Denne integrasjonen er **utgående**: OneUptime poster til en Discord-kanal gjennom en innkommende webhook-URL.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Steg 1 — Opprett en Discord-webhook

1. I Discord, åpne målkanalens **Edit Channel → Integrations → Webhooks**.
2. Klikk **New Webhook**, gi den et navn (f.eks. `OneUptime`), velg kanal, og **Copy Webhook URL**.

## Steg 2 — Lagre webhook-URL-en (valgfritt, men anbefalt)

1. I OneUptime, gå til **Workflows → Global Variables → Create**.
2. Gi den navnet `DISCORD_WEBHOOK_URL`, lim inn URL-en, og slå på **Is Secret**.

Å holde den i en variabel betyr at du kan gjenbruke den på tvers av arbeidsflyter og rotere den på ett sted.

## Steg 3 — Bygg arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Incidents → Discord`, og åpne **Builder**.
2. Legg til en **Incident**-trigger satt til **On Create**. Gi den nytt navn `Incident`.
3. Legg til en **Discord**-komponent koblet til triggeren:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (eller lim den inn direkte).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Lagre**, aktiver, og opprett en testhendelse. Meldingen vises i kanalen din.

## Alternativ: API-komponenten

Hvis du heller ikke vil bruke den dedikerte komponenten, gjør en **API**-blokk det samme:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Dette er hendig hvis du ønsker Discords rikere [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) — legg til en `embeds`-matrise i body-en.

## Tips

- Bruk **Conditions** for å bare poste for bestemte alvorlighetsgrader — forgren på `{{Incident.incidentSeverity.name}}` før Discord-blokken.
- Legg til flere arbeidsflyter på **Incident → On Update** for å poste bekreftelser og løsninger til den samme kanalen.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — det utgående mønsteret.
- [Telegram](/docs/integrations/telegram) — det samme for Telegram.
- [Komponenter → Discord](/docs/workflows/components#discord) — komponentreferansen.
