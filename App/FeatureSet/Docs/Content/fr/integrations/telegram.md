# Intégration Telegram

Envoyez les mises à jour d'incidents vers un chat ou un groupe [Telegram](https://telegram.org). OneUptime dispose d'un composant de workflow **Telegram** intégré, ce qui rend la configuration rapide.

Cette intégration est **sortante** : OneUptime envoie des messages via un bot Telegram.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## Étape 1 — Créer un bot et obtenir son jeton

1. Dans Telegram, envoyez un message à [@BotFather](https://t.me/BotFather) et tapez `/newbot`.
2. Suivez les instructions. BotFather vous donne un **jeton de bot** comme `123456789:AA...`.

## Étape 2 — Trouver votre ID de chat

1. Ajoutez le bot au groupe (ou démarrez une conversation directe avec lui) et envoyez-lui n'importe quel message.
2. Ouvrez `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` dans un navigateur.
3. Trouvez `"chat":{"id":...}` dans la réponse — ce nombre est votre **ID de chat** (les IDs de groupe sont négatifs).

## Étape 3 — Stocker les secrets

1. Dans OneUptime, allez dans **Workflows → Global Variables → Create**.
2. Créez `TELEGRAM_BOT_TOKEN` (secret) et `TELEGRAM_CHAT_ID`.

## Étape 4 — Créer le workflow

1. Ouvrez **Workflows → Create Workflow**, nommez-le `Incidents → Telegram`, et ouvrez le **Builder**.
2. Ajoutez un déclencheur **Incident** sur **On Create**. Renommez-le `Incident`.
3. Ajoutez un composant **Telegram** connecté au déclencheur :
   - **Bot token** : `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID** : `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message** : `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Enregistrez**, activez, et créez un incident de test. Le message arrive dans votre chat.

## Alternative : le composant API

Un bloc **API** fonctionne également :

- **Method** : `POST`
- **URL** : `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers** : `Content-Type: application/json`
- **Body** : `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## Conseils

- Le bot ne voit les messages qu'après avoir été ajouté à un groupe et que le **mode confidentialité** le permet — si `getUpdates` est vide, envoyez d'abord un message au bot, ou désactivez le mode confidentialité via BotFather.
- Utilisez **Conditions** pour filtrer par gravité avant d'envoyer.
- Ajoutez `"parse_mode": "Markdown"` au corps API (ou utilisez le formatage du composant) pour le gras et les liens.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) — le schéma sortant.
- [Discord](/docs/integrations/discord) — la même idée pour Discord.
- [Composants → Telegram](/docs/workflows/components#telegram) — la référence du composant.
