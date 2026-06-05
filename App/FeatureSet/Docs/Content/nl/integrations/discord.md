# Discord-integratie

Post incidentupdates naar een [Discord](https://discord.com)-kanaal. OneUptime heeft een ingebouwde **Discord**-workflowcomponent, waardoor dit een van de snelste integraties is om in te stellen.

Deze integratie is **outbound**: OneUptime post naar een Discord-kanaal via een inkomende webhook-URL.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Stap 1 — Maak een Discord-webhook aan

1. Open in Discord het kanaal dat je wilt gebruiken via **Edit Channel → Integrations → Webhooks**.
2. Klik op **New Webhook**, geef het een naam (bijv. `OneUptime`), kies het kanaal, en **Copy Webhook URL**.

## Stap 2 — Sla de webhook-URL op (optioneel maar aanbevolen)

1. Ga in OneUptime naar **Workflows → Global Variables → Create**.
2. Geef het de naam `DISCORD_WEBHOOK_URL`, plak de URL, en zet **Is Secret** aan.

Door hem in een variabele te bewaren kun je hem hergebruiken over workflows en op één plek roteren.

## Stap 3 — Bouw de workflow

1. Open **Workflows → Create Workflow**, geef het de naam `Incidents → Discord`, en open de **Builder**.
2. Voeg een **Incident**-trigger toe ingesteld op **On Create**. Hernoem het naar `Incident`.
3. Voeg een **Discord**-component toe verbonden met de trigger:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (of plak hem direct).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Sla op**, schakel in en maak een testincident aan. Het bericht verschijnt in je kanaal.

## Alternatief: de API-component

Als je de speciale component liever niet gebruikt, doet een **API**-blok hetzelfde:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Dit is handig als je Discord's rijkere [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) wilt — voeg een `embeds`-array toe aan de body.

## Tips

- Gebruik **Conditions** om alleen te posten voor bepaalde severities — vertak op `{{Incident.incidentSeverity.name}}` vóór het Discord-blok.
- Voeg meer workflows toe op **Incident → On Update** om bevestigingen en oplossingen naar hetzelfde kanaal te posten.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — het outbound-patroon.
- [Telegram](/docs/integrations/telegram) — hetzelfde idee voor Telegram.
- [Componenten → Discord](/docs/workflows/components#discord) — de componentreferentie.
