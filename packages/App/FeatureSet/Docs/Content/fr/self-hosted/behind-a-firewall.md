# Derrière un VPN ou un pare-feu

Un OneUptime auto-hébergé peut rester à l'écart de l'Internet public : il envoie chaque alerte par des connexions sortantes. Quelques échanges arrivent toutefois de l'extérieur. Un intervenant touche **Acknowledge** dans un message, Twilio signale une touche pressée pendant un appel, Slack signale un clic sur un bouton. Cette page les passe en revue un par un, en indiquant qui se connecte à votre serveur pour chacun et par quel chemin, pour que vous ne publiiez que ce dont vous vous servez, voire rien du tout.

:::cards
- [Qui se connecte à votre serveur](#qui-se-connecte-à-votre-serveur): Les téléphones des intervenants, et les fournisseurs qui rappellent votre serveur.
- [Tout garder privé](#tout-garder-privé): Mettre les téléphones des intervenants sur votre VPN.
- [Ne publier que les pages d'acquittement](#ne-publier-que-les-pages-dacquittement): Une entrée étroite pour les liens d'acquittement.
- [Callbacks des fournisseurs](#callbacks-des-fournisseurs): Telegram, Twilio, WhatsApp, Slack et Microsoft Teams.
:::

## Qui se connecte à votre serveur

L'envoi ne demande jamais d'accès entrant : OneUptime se connecte vers l'extérieur à votre serveur de messagerie, à Twilio, à Telegram, à Meta, à Slack, à Microsoft et au relais push. Ce qui entre relève de l'un des cas suivants :

| Ce qui se passe | Qui se connecte à votre serveur | Une liste d'autorisation d'adresses sources peut-elle le couvrir ? |
| --- | --- | --- |
| Un intervenant touche **Acknowledge** dans un e-mail, un SMS ou un message WhatsApp ou Telegram | Le téléphone ou l'ordinateur de l'intervenant | Non : il se connecte depuis l'endroit où se trouve l'intervenant |
| Un intervenant acquitte l'alerte dans l'application OneUptime On-Call | Le téléphone de l'intervenant | Non : pour la même raison |
| Un intervenant appuie sur 1 pendant un appel d'astreinte | Twilio | Seulement avec Static Proxy for Webhooks de Twilio |
| Quelqu'un lie son compte Telegram | Telegram | Oui, ou interrogez Telegram périodiquement et n'autorisez rien |
| Quelqu'un clique sur un bouton d'un message Slack ou Microsoft Teams | Slack ou Microsoft | Non : aucun des deux ne publie d'adresses fixes |
| WhatsApp signale qu'un message a été livré ou lu | Meta | Non : Meta ne publie aucune adresse fixe |

Un serveur auto-hébergé communique directement avec ces fournisseurs, jamais via les serveurs de OneUptime : il n'existe donc aucune liste d'adresses OneUptime à autoriser.

## Tout garder privé

Mettez les téléphones des intervenants sur votre VPN : toujours actif, ou à la demande pour le nom d'hôte de votre OneUptime, pour que personne n'ait à le connecter avant d'acquitter une alerte à 3 h du matin. Sans rien publier :

- Les liens d'acquittement des e-mails, des SMS et des messages WhatsApp et Telegram s'ouvrent, car le téléphone joint votre serveur.
- L'application OneUptime On-Call fonctionne : indiquez-lui l'adresse de votre serveur. Les notifications push n'ont besoin d'aucun accès entrant, car le serveur les envoie via le relais push.
- Les personnes lient leur compte Telegram dès que vous activez l'interrogation périodique (voir [Telegram](#telegram)).

Un lien dans une application de messagerie s'ouvre dans le navigateur intégré de cette application ou dans le navigateur par défaut du téléphone, jamais dans l'application OneUptime. Un VPN par application doit donc couvrir les applications de messagerie et le navigateur, pas seulement l'application OneUptime.

Appuyer sur 1 pendant un appel, les boutons des messages Slack et Microsoft Teams et les accusés de livraison de WhatsApp exigent toujours que leur fournisseur joigne votre serveur.

## Ne publier que les pages d'acquittement

Si les téléphones des intervenants ne peuvent pas utiliser votre VPN, publiez les pages qu'ouvre un lien d'acquittement, et rien d'autre. Placez devant OneUptime un proxy inverse, ou un tunnel sortant comme Cloudflare Tunnel, qui ne demande aucune règle de pare-feu entrante, et ne laissez passer que ces chemins :

| Méthode | Chemin | Ce qu'il fournit |
| --- | --- | --- |
| GET | `/l/*` | Les liens courts des SMS et des messages WhatsApp et Telegram |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | La page qui présente l'objet de l'alerte, avec son bouton **Acknowledge** |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | Le bouton **Acknowledge** |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | Facultatif : la page qui transmet l'alerte à la personne suivante |
| POST | `/api/user-notification-log-timeline/pass-on/*` | Facultatif : son bouton |
| GET | `/oneuptime-assets/*` | Les polices, les styles et le logo de ces pages |

:::steps
### Faire pointer un nom public vers le proxy
Les liens des messages sont construits à partir de votre paramètre `HOST` : ce nom doit donc se résoudre publiquement vers le proxy, avec un certificat reconnu publiquement. Avec un DNS scindé, les personnes de votre réseau continuent de le résoudre vers l'adresse privée et utilisent tout le reste comme avant.

### Transmettre les chemins tels quels
Envoyez ces chemins à l'ingress de OneUptime avec leur méthode, leur chemin et leur chaîne de requête, et répondez 404 à tout le reste.

### Limiter leur débit
Chaque lien porte un identifiant aléatoire, et un lien court fait huit lettres. Limitez les requêtes que chaque adresse peut envoyer, pour que personne ne puisse essayer des identifiants en rafale.
:::

Une fois qu'un intervenant a acquitté l'alerte, la page l'ouvre dans le tableau de bord, qui ne se charge que sur votre réseau. L'acquittement est déjà enregistré à ce stade.

## Callbacks des fournisseurs

### Telegram

L'envoi des alertes ne demande qu'un accès HTTPS sortant vers `api.telegram.org`. Lier un compte suppose que votre serveur reçoive le message `/start` qu'une personne envoie à votre bot, de l'une de ces deux façons :

- **Par interrogation périodique** : activez **Poll Telegram for Messages** dans **Admin Dashboard > Paramètres > Telegram**. OneUptime récupère les messages du bot auprès de Telegram à quelques secondes d'intervalle, en HTTPS sortant : rien n'a donc besoin de joindre votre serveur.
- **Par webhook** : Telegram envoie chaque message à `POST /api/notification/telegram/webhook`. Telegram [envoie ses webhooks](https://core.telegram.org/bots/webhooks) depuis `149.154.160.0/20` et `91.108.4.0/22` : vous pouvez donc n'autoriser que ces adresses.

### Twilio

Quand un intervenant appuie sur 1 pendant un appel pour acquitter l'alerte, Twilio envoie la touche à `POST /api/user-notification-log-timeline/call/gather-input/*`. Les adresses des webhooks de Twilio changent, sauf si votre édition de Twilio inclut [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Les mises à jour de livraison des SMS et les appels entrants sont décrits dans [Intégration Twilio](/docs/self-hosted/twilio-integration).

### WhatsApp

Les alertes et les acquittements n'ont besoin d'aucun accès entrant. Meta envoie les accusés de livraison et de lecture à `/api/notification/whatsapp/webhook` ; sans eux, le journal WhatsApp de OneUptime ne peut pas indiquer si un message a été livré, lu ou a échoué une fois accepté par Meta. Meta signe chaque requête, et ne publie aucune adresse fixe.

### Slack et Microsoft Teams

Les boutons, menus et commandes de leurs messages appellent votre serveur, depuis des adresses qu'aucun des deux ne publie. Les chemins, et la façon de les publier, sont décrits dans [Intégration Slack](/docs/self-hosted/slack-integration) et [Intégration Microsoft Teams](/docs/self-hosted/microsoft-teams-integration).

## Étapes suivantes

:::cards
- [Intégration Twilio](/docs/self-hosted/twilio-integration): Les SMS et les appels via votre propre compte Twilio.
- [Notifications push](/docs/self-hosted/push-notifications): Le relais push, et ce que joignent votre serveur et les téléphones.
- [Vue d'ensemble des applications](/docs/mobile-desktop-apps/index): Connecter l'application OneUptime On-Call à votre serveur.
- [Accès au réseau privé](/docs/self-hosted/private-network-access): Dans l'autre sens : laisser OneUptime joindre vos outils internes.
:::
