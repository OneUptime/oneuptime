# Intégration Discord

Publiez les mises à jour d'incidents dans un canal [Discord](https://discord.com). OneUptime dispose d'un composant de workflow **Discord** intégré, ce qui en fait l'une des intégrations les plus rapides à configurer.

Cette intégration est **sortante** : OneUptime publie dans un canal Discord via une URL de webhook entrant.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## Étape 1 — Créer un webhook Discord

1. Dans Discord, ouvrez les paramètres du canal cible via **Edit Channel → Integrations → Webhooks**.
2. Cliquez sur **New Webhook**, donnez-lui un nom (par ex. `OneUptime`), choisissez le canal, et **copiez l'URL du webhook**.

## Étape 2 — Stocker l'URL du webhook (optionnel mais recommandé)

1. Dans OneUptime, allez dans **Workflows → Global Variables → Create**.
2. Nommez-la `DISCORD_WEBHOOK_URL`, collez l'URL, et activez **Is Secret**.

La stocker dans une variable vous permet de la réutiliser dans plusieurs workflows et de la faire tourner en un seul endroit.

## Étape 3 — Créer le workflow

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Incidents → Discord`, et ouvrez le **Builder**.
2. Ajoutez un déclencheur **Incident** sur **On Create**. Renommez-le `Incident`.
3. Ajoutez un composant **Discord** connecté au déclencheur :
   - **Webhook URL** : `{{variable.DISCORD_WEBHOOK_URL}}` (ou collez-la directement).
   - **Message** : `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Enregistrez**, activez, et créez un incident de test. Le message apparaît dans votre canal.

## Alternative : le composant API

Si vous préférez ne pas utiliser le composant dédié, un bloc **API** fait la même chose :

- **Method** : `POST`
- **URL** : `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers** : `Content-Type: application/json`
- **Body** : `{ "content": "New incident: {{Incident.title}}" }`

C'est pratique si vous souhaitez utiliser les [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) plus riches de Discord — ajoutez un tableau `embeds` au corps.

## Conseils

- Utilisez **Conditions** pour ne publier que pour certaines gravités — branchez sur `{{Incident.incidentSeverity.name}}` avant le bloc Discord.
- Ajoutez d'autres workflows sur **Incident → On Update** pour publier les acquittements et les résolutions dans le même canal.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — le schéma sortant.
- [Telegram](/docs/integrations/telegram) — la même idée pour Telegram.
- [Composants → Discord](/docs/workflows/components#discord) — la référence du composant.
