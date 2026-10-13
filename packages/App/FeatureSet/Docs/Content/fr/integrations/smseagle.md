# Intégration SMSEagle

Envoyez les notifications d'alerte par SMS ou par appel via [SMSEagle](https://www.smseagle.eu), une passerelle SMS matérielle installée sur site, dans votre propre réseau. OneUptime intègre des composants de flux de travail **SMSEagle**, la mise en place est donc rapide.

Cette intégration est **sortante** : OneUptime envoie les messages via la [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
Alerte OneUptime → On Create  ──►  composant SMSEagle  ──►  SMS ou appel vers un téléphone
```

## Étape 1 : Créer une clé d'API

1. Dans la GUI web de SMSEagle, allez dans **Settings → API → API v2** et cliquez sur **Create API key**.
2. Sous **Permissions**, autorisez **Send SMS** et, si vous voulez des appels, **Make a TTS Advanced Call**.
3. Copiez la clé. OneUptime l'appelle **SMSEagle Access Token**.

## Étape 2 : Permettre à OneUptime d'atteindre l'appareil

1. Autorisez la connexion de votre serveur OneUptime vers l'adresse de l'appareil, par exemple `https://192.168.0.100`, dans les pare-feu et VPN situés entre les deux.
2. Un appareil SMSEagle a généralement une adresse privée, que les flux de travail bloquent par défaut. Sur une instance auto-hébergée, ajoutez l'adresse IP ou le nom d'hôte de l'appareil à `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` sur le serveur d'API, par exemple `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, puis redémarrez-le. Voir [Accès aux réseaux privés](/docs/self-hosted/private-network-access).

## Étape 3 : Enregistrer les secrets

1. Dans OneUptime, allez dans **Flux de travail → Variables globales → Créer**.
2. Créez `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (secrète) et `ONCALL_PHONE`.

## Étape 4 : Construire le flux de travail

1. Ouvrez **Flux de travail → Créer un flux de travail**, nommez-le `Alerts → SMSEagle` et ouvrez le **Constructeur**.
2. Ajoutez un déclencheur **Alert** réglé sur **On Create**. Renommez-le `Alert`.
3. Ajoutez un composant **Send SMS via SMSEagle** relié au déclencheur :
   - **SMSEagle URL** : `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token** : `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number** : `{{variable.ONCALL_PHONE}}`
   - **Message Text** : `New alert: {{Alert.title}}`
4. Cliquez sur **Enregistrer**, activez le flux et créez une alerte de test. Le SMS arrive sur le téléphone.

Le modèle **Text a phone via SMSEagle when an alert fires** construit le même flux de travail.

## Des appels plutôt que des SMS

Utilisez plutôt **Make a Call via SMSEagle**. Il prend les mêmes réglages plus un **Voice ID**, la voix de synthèse vocale de l'appareil, et lit à voix haute le **Text to Read Out**. La clé d'API a besoin de l'autorisation **Make a TTS Advanced Call**.

Le modèle **Call a phone via SMSEagle when an alert fires** construit le même flux de travail avec un appel.

## Alternative : le composant API

Un bloc **API** fonctionne aussi :

- **Method** : `POST`
- **URL** : `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers** : `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body** : `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Conseils

- Si l'appareil refuse le message, la raison se trouve dans la valeur **Error** du composant. Journalisez-la sur la sortie **Erreur**.
- Utilisez **Conditions** pour filtrer par gravité avant l'envoi.
- Pour joindre plusieurs personnes, reliez plusieurs composants SMSEagle, un par numéro.

## Pour aller plus loin

- [Vue d'ensemble des intégrations](/docs/integrations/index) : le modèle sortant.
- [Composants → SMSEagle](/docs/workflows/components#smseagle) : la référence du composant.
