# Intégration Slack

Connectez votre projet OneUptime auto-hébergé à Slack pour envoyer des notifications et utiliser les actions sur les incidents, les commandes et les événements de messages.

## Configuration

1. Configurez le nom d’hôte OneUptime et HTTPS comme indiqué ci-dessous. Dans **Settings > Slack Integration**, copiez le manifeste généré, également disponible à `https://your-oneuptime-domain.com/api/slack/app-manifest`.
2. [Créez une application Slack](https://api.slack.com/apps) dans votre espace de travail à partir du manifeste de votre propre déploiement afin que les URL correspondent à votre nom d’hôte.
3. Copiez **Client ID**, **Client Secret** et **Signing Secret** depuis **Basic Information** dans `config.env` pour Docker Compose :

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Pour Helm, utilisez ces valeurs :

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. Appliquez la configuration et attendez le redémarrage de OneUptime. Si la vérification de l’URL Events a échoué avant la configuration du secret de signature, réessayez maintenant.
5. Retournez dans **Settings > Slack Integration**, sélectionnez **Connect to Slack** et autorisez l’application. Connectez aussi votre compte Slack personnel dans OneUptime pour les actions nécessitant une identité utilisateur.

## Accès réseau pour les déploiements auto-hébergés

### Sens du trafic et points de terminaison

| Trafic | Accès nécessaire |
| --- | --- |
| OneUptime → Slack | DNS et HTTPS sortant sur TCP 443 vers `slack.com` pour la Web API et l’échange de jetons OAuth ; `hooks.slack.com` pour les réponses aux commandes et les notifications par webhook entrant lorsqu’elles sont utilisées |
| Slack → OneUptime | HTTPS public sur TCP 443 vers les quatre routes POST ci-dessous pour l’intégration complète |
| Navigateur de l’utilisateur → OneUptime | Tableau de bord et redirections OAuth vers `/api/slack/auth/:projectId/:userId` et `/api/slack/auth/:projectId/:userId/user` ; elles peuvent rester accessibles par le VPN de l’utilisateur |

Ces domaines décrivent l’intégration OneUptime, pas une liste exhaustive pour les clients Slack ou toutes les fonctionnalités. Un webhook *entrant* Slack est hébergé par Slack : OneUptime lui envoie des requêtes ; ce n’est pas un point d’entrée sur votre serveur. Consultez le [guide des webhooks entrants](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Transmettez ces callbacks du fournisseur à l’application OneUptime via son ingress :

| Méthode et chemin | Fonction |
| --- | --- |
| `POST /api/slack/events` | Vérification de l’API Events, réactions, mentions et messages |
| `POST /api/slack/interactive` | Boutons, raccourcis, soumissions de fenêtres modales, `/incident` et `/maintenance` |
| `POST /api/slack/options-load` | Demandes d’options de menus interactifs |
| `POST /api/slack/command` | Commande `/oneuptime` |

OAuth utilise une [redirection du navigateur suivie d’un échange de jetons côté serveur](https://docs.slack.dev/authentication/installing-with-oauth/). Le manifeste enregistre `/api/slack/auth` comme préfixe ; OneUptime ajoute les chemins du projet et de l’utilisateur à l’autorisation. L’accès du navigateur seul ne permet pas à Slack de livrer les événements ou les actions.

### Déploiements privés et sécurité des callbacks

Utilisez un DNS public et une passerelle avec un certificat HTTPS publiquement reconnu, une chaîne complète et une route privée vers l’ingress OneUptime. Autorisez TCP 443 entrant et ne publiez que les callbacks POST du fournisseur indiqués ci-dessus. Un `ClusterIP` privé, un DNS interne ou le VPN d’un employé ne suffit pas au fournisseur. Un DNS à vues séparées peut garder le tableau de bord et les routes OAuth du navigateur privés sous le même nom d’hôte.

Définissez `HOST=oneuptime.example.com` et `HTTP_PROTOCOL=https` dans `config.env`, ou `host: oneuptime.example.com` et `httpProtocol: https` dans Helm. Appliquez la configuration et attendez le redémarrage. Ces valeurs génèrent les URL ; elles ne configurent ni DNS, ni TLS, ni pare-feu. Régénérez et mettez à jour le manifeste Slack après tout changement de nom d’hôte.

Conservez méthode, chemin, paramètres de requête, corps original, `Content-Type`, `X-Slack-Signature` et `X-Slack-Request-Timestamp`. Transmettez l’hôte public et le schéma HTTPS via des en-têtes de proxy fiables. Exemptez les callbacks du SSO navigateur, des CAPTCHA et des pages de connexion du proxy, tout en conservant les contrôles de signature et d’horodatage OneUptime. Synchronisez l’horloge du serveur. Le contrôle d’une IP source ne remplace pas la [vérification des signatures Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

### Vérifier l’accès et comprendre les limites

Dans **Event Subscriptions**, vérifiez l’URL Events : Slack envoie un [défi POST et contrôle TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/). Envoyez ensuite une notification de test, exécutez une commande slash, cliquez sur un bouton d’incident et déclenchez un événement abonné. Examinez les journaux de la passerelle et de OneUptime sans y enregistrer de secrets. Slack attend des accusés rapides, notamment [sous trois secondes pour les interactions](https://docs.slack.dev/interactivity/handling-user-interaction/). Un GET navigateur ou un message sortant réussi ne valide pas les callbacks POST.

Sans aucune connexion entrante, une application déjà autorisée peut encore envoyer des messages par HTTPS sortant, mais événements, boutons, raccourcis et commandes ne fonctionnent pas. Le manifeste OneUptime utilise des callbacks HTTP et désactive Socket Mode ; activer ce mode Slack ne constitue pas une solution prise en charge. Le [paramètre d’accès au réseau privé](/docs/self-hosted/private-network-access) contrôle les requêtes sortantes vers des destinations privées et ne publie aucun callback.
