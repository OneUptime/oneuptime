# Intégration Microsoft Teams

Pour intégrer Microsoft Teams avec votre instance auto-hébergée OneUptime, vous devez configurer l'enregistrement d'application Azure et définir les variables d'environnement requises.

## Prérequis

- Compte Azure — Vous pouvez en créer un en allant sur [https://azure.com](https://azure.com)
- Accès à la configuration de votre serveur OneUptime

## Accès réseau

OneUptime utilise un Azure Bot pour son intégration Teams. Une URL Incoming Webhook ou Teams Workflow ne remplace pas le point de terminaison de messagerie de ce bot. Microsoft exige un [point de terminaison HTTPS accessible publiquement pour un bot auto-hébergé](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). Une adresse IP privée, un nom DNS interne ou la connexion VPN d'un employé ne donne pas à Azure Bot Service accès à OneUptime.

| Fonctionnalité | De OneUptime au fournisseur | Du fournisseur à OneUptime |
| --- | --- | --- |
| Notifications Teams | HTTPS vers les API Microsoft | Requis pour l'intégration complète du bot, notamment la découverte des conversations |
| Commandes Teams, boutons des cartes, événements d'installation dans les conversations | HTTPS | `POST /api/microsoft-bot/messages` |

Les redirections de l'inscription d'application `/api/microsoft-teams/auth` et `/api/microsoft-teams/admin-consent/callback` reviennent par le navigateur de l'utilisateur. Ce navigateur doit pouvoir joindre OneUptime, par exemple via le réseau de votre entreprise ou un VPN. Les messages du bot et les actions des cartes arrivent depuis les serveurs Microsoft et nécessitent leur propre ingress accessible. La livraison d'alertes sortantes ne vérifie pas à elle seule la connectivité entrante.

### Production : publier une passerelle vers le déploiement privé

1. **Choisissez un nom d'hôte**, par exemple `oneuptime.example.com`. Publiez des enregistrements DNS publics pointant vers une passerelle accessible depuis Internet. Les adresses IP privées et les noms DNS exclusivement internes sont inaccessibles aux fournisseurs. Avec un DNS scindé, les employés peuvent résoudre le même nom vers l'ingress privé et continuer à utiliser le tableau de bord via le VPN. L'ingress privé doit également servir HTTPS avec un certificat valide pour ce nom d'hôte.

2. **Connectez la passerelle à OneUptime.** Placez-la dans une DMZ avec une route vers l'ingress privé, ou utilisez une passerelle publique connectée via votre propre VPN site à site ou liaison privée. Autorisez le trafic de la passerelle vers l'ingress sur le port du service en amont. Pour Kubernetes/Portainer, un service privé `ClusterIP` ne suffit pas : la passerelle a besoin d'un ingress/contrôleur ou d'une autre destination accessible. Gardez les bases de données et les autres services internes privés.

3. **Terminez HTTPS sur le port 443** avec un certificat reconnu publiquement et une chaîne intermédiaire complète. Autorisez le trafic TCP entrant sur le port 443 de la passerelle. Installer un certificat ou modifier le DNS ne crée pas à lui seul la route vers la destination privée.

4. Publiez uniquement `/api/microsoft-bot/messages` et définissez le point de terminaison de messagerie Azure Bot de l'étape 4 sur cette URL HTTPS publique complète. L'adaptateur Bot Framework de OneUptime doit recevoir et authentifier les requêtes. Conservez la méthode, le chemin, la chaîne de requête, le corps et les en-têtes d'authentification (`Authorization`). Préservez le `Host` public et définissez des en-têtes de confiance `X-Forwarded-Host` et `X-Forwarded-Proto: https`. N'ajoutez pas de redirections.

5. Exemptez ces routes du SSO par navigateur, des CAPTCHA et des pages de connexion du proxy. Gardez l'authentification OneUptime active. Limitez l'accès à l'origine à la passerelle et aux clients internes autorisés ; masquez les jetons dans les journaux.

6. **Définissez l'URL canonique de OneUptime**:

   Docker Compose, dans `config.env` :

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Valeurs Helm/Portainer :

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Remplacez l'exemple par votre domaine. Ces paramètres génèrent les URL ; ils ne créent ni DNS, ni TLS, ni règles de pare-feu. Appliquez la configuration Compose ou la mise à jour Helm et attendez le redémarrage de l'application. Si le nom d'hôte change, mettez à jour le point de terminaison Azure Bot et les URI de redirection de l'inscription d'application, puis téléchargez et chargez à nouveau le manifeste Teams.

Les [paramètres d'accès aux réseaux privés](/docs/self-hosted/private-network-access) contrôlent les requêtes sortantes de OneUptime vers les services internes. Activer `ALLOW_PRIVATE_NETWORK_WEBHOOKS` ne rend pas OneUptime accessible à Teams.

### Accès sortant et restrictions IP

Autorisez la résolution DNS et le HTTPS (TCP 443) sortant depuis l'application OneUptime. Teams utilise `graph.microsoft.com`, `login.microsoftonline.com`, les points de terminaison d'authentification et de canal Bot Framework, ainsi que l'URL du service de connecteur de la conversation. Utilisez les [recommandations de pare-feu Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) et examinez le trafic bloqué pendant les tests ; ces exemples ne constituent pas une liste exhaustive de domaines. Le connecteur de secours du cloud commercial est `https://smba.trafficmanager.net/teams/` ; l'URL de service d'une conversation peut différer.

Microsoft ne prend pas en charge les listes fixes d'adresses IP entrantes Bot Framework, car elles changent. Les plages média des clients Teams ne sont pas celles des webhooks du bot. Gardez l'authentification Bot Framework active.

### Tests et déploiements sans accès entrant

Depuis un réseau extérieur à votre VPN, vérifiez le DNS public et TLS, puis contrôlez la route Teams :

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

Sur les versions actuelles de OneUptime, attendez-vous à `405 Method Not Allowed` avec `Allow: POST`. Cela confirme que la requête GET a atteint la route, pas qu'une requête POST authentifiée du bot fonctionnera. Les anciennes versions peuvent renvoyer l'erreur JSON 404 de OneUptime ; examinez le corps de la réponse et les journaux du proxy. Des erreurs TLS, des délais d'attente dépassés ou une page d'erreur HTML du proxy indiquent des problèmes de certificat ou de routage.

Connectez Teams, envoyez une notification de test, écrivez au bot et appuyez sur un bouton de carte. Vérifiez l'action dans OneUptime et rapprochez les diagnostics Microsoft des journaux de la passerelle et de l'application. Une notification reçue ne vérifie pas un POST entrant authentifié.

Pour le développement, le [guide de test Teams de Microsoft](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams) décrit l'exposition d'un service local par un tunnel. Transmettez les requêtes vers l'ingress OneUptime et utilisez `/api/microsoft-bot/messages` à la place du chemin d'exemple Microsoft `/api/messages`. Mettez à jour le point de terminaison Azure Bot chaque fois que l'URL publique du tunnel change et utilisez un ingress stable en production. Configurez également le nom d'hôte OneUptime correspondant. Arrêtez le tunnel après les tests : il expose toujours un accès entrant.

Si toute connectivité entrante est interdite, l'intégration complète Teams ne peut pas fonctionner : commandes, actions de cartes et découverte des conversations en dépendent. Une installation entièrement déconnectée ne peut pas utiliser Teams.

Azure Bot Private Endpoint ne remplace pas cet ingress Teams. Les [instructions d'isolation réseau Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) décrivent l'isolation de Direct Line et précisent que désactiver l'accès au réseau public supprime la configuration des canaux Teams.

## Instructions de configuration

### Étape 1 : Créer un enregistrement d'application Azure

1. Allez sur le [Portail Azure](https://portal.azure.com)
2. Accédez à « Enregistrements d'applications » et cliquez sur « Nouvel enregistrement »
3. Remplissez le formulaire d'enregistrement :
   - **Nom :** oneuptime
   - **Types de comptes pris en charge :** Comptes dans n'importe quel annuaire organisationnel (Tout locataire Microsoft Entra ID - Multi-locataire)
   - **URI de redirection :** Web - `https://votre-domaine-oneuptime.com/api/microsoft-teams/auth`
   - Ajoutez également : `https://votre-domaine-oneuptime.com/api/microsoft-teams/admin-consent/callback`
4. Cliquez sur « S'inscrire »
5. Notez l'« ID d'application (client) » — vous en aurez besoin plus tard

### Étape 2 : Configurer les permissions de l'application

1. Dans votre enregistrement d'application, allez dans « Permissions d'API »
2. Cliquez sur « Ajouter une permission » et sélectionnez « Microsoft Graph »

**Ajouter des permissions déléguées** (lors d'actions au nom d'un utilisateur connecté) :

- **User.Read** — Requis pour obtenir les informations de profil de l'utilisateur authentifié (nom d'affichage, e-mail) lors du flux OAuth
- **Team.ReadBasic.All** — Requis pour lister les équipes dont l'utilisateur est membre lors de la sélection de l'équipe à connecter
- **Channel.ReadBasic.All** — Requis pour lire les informations de canal et lister les canaux dans les équipes pour la livraison des notifications
- **ChannelMessage.Send** — Requis pour envoyer des notifications d'alertes et d'incidents aux canaux Teams

**Ajouter des permissions d'application** (lors d'actions en tant qu'application elle-même, sans utilisateur connecté) :

- **Team.ReadBasic.All** — Requis pour lister toutes les équipes de l'organisation après l'octroi du consentement administrateur
- **Channel.ReadBasic.All** — Requis pour vérifier l'existence du canal et récupérer les détails du canal

`ChannelMessage.Send` est uniquement une autorisation déléguée ; elle n'a pas de variante d'autorisation d'application dans la [référence des autorisations Microsoft Graph](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend). Conservez-la dans la liste des autorisations déléguées ci-dessus.

**Remarque :** Le Bot Framework gère la livraison des messages en utilisant les permissions de consentement spécifique aux ressources (RSC) définies dans le manifeste de l'application Teams. Ces permissions sont :

- **ChannelMessage.Send.Group** — Permet au bot d'envoyer des messages aux canaux d'équipe
- **ChannelMessage.Read.Group** — Permet au bot de lire les messages de canal pour les commandes interactives
- **Channel.Create.Group** — Permet au bot de créer des canaux si nécessaire

3. Cliquez sur « Accorder le consentement administrateur » pour votre organisation

### Étape 3 : Créer un secret client

1. Allez dans « Certificats & secrets » dans votre enregistrement d'application
2. Cliquez sur « Nouveau secret client »
3. Ajoutez une description et définissez l'expiration (24 mois recommandés)
4. Cliquez sur « Ajouter » et copiez la valeur du secret immédiatement — vous ne pourrez plus la voir

**Important :** Ne copiez pas l'ID du secret, vous avez besoin de la VALEUR du secret, qui est généralement plus longue et inclut davantage de caractères.

### Étape 4 : Créer un service de bot

1. Dans le Portail Azure, accédez à « Azure Bot » et cliquez sur « Créer »
2. Remplissez le formulaire de création du bot :

   - **Handle du bot :** oneuptime-bot
   - **Abonnement :** Votre abonnement Azure
   - **Groupe de ressources :** Créez-en un nouveau ou utilisez un existant
   - **Emplacement :** Choisissez un emplacement proche de vos utilisateurs
   - **Niveau de tarification :** F0 (Gratuit) est suffisant pour les tests
   - Utilisez l'ID d'application (client) et l'ID de locataire de votre enregistrement d'application créé précédemment

3. Cliquez sur « Vérifier + créer », puis sur « Créer »

4. Une fois déployé, allez dans votre ressource bot et accédez à « Configuration »
5. Définissez l'« Point de terminaison de messagerie » sur `https://votre-domaine-oneuptime.com/api/microsoft-bot/messages`
6. Enregistrez la configuration

### Étape 5 : Ajouter le canal Microsoft Teams au bot

1. Dans votre ressource Azure Bot, accédez à « Canaux »
2. Trouvez et sélectionnez « Microsoft Teams » et cliquez sur « Ouvrir » ou « Ajouter »
3. Vérifiez les paramètres (activez pour Teams, conservez les options de messagerie par défaut sauf si vous avez des besoins spécifiques)
4. Cliquez sur « Enregistrer » (et « Terminé »/« Publier » si demandé) pour activer le canal Teams

### Étape 6 : Configurer les variables d'environnement OneUptime

#### Docker Compose

Si vous utilisez Docker Compose, ajoutez ces variables d'environnement à votre configuration :

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=VOTRE_CLIENT_ID_TEAMS
MICROSOFT_TEAMS_APP_CLIENT_SECRET=VOTRE_CLIENT_SECRET_TEAMS
MICROSOFT_TEAMS_APP_TENANT_ID=VOTRE_TENANT_ID_MICROSOFT
```

#### Kubernetes avec Helm

Si vous utilisez Kubernetes avec Helm, ajoutez ces éléments à votre fichier `values.yaml` :

```yaml
microsoftTeamsApp:
  clientId: VOTRE_CLIENT_ID_TEAMS
  clientSecret: VOTRE_CLIENT_SECRET_TEAMS
  tenantId: VOTRE_TENANT_ID_MICROSOFT
```

**Important :** Redémarrez votre serveur OneUptime après avoir ajouté ces variables d'environnement pour qu'elles prennent effet.

### Étape 7 : Télécharger le manifeste de l'application Teams

1. Allez dans **Paramètres du projet** > **Espace de travail** > **Microsoft Teams**
2. Téléchargez le manifeste de l'application Teams depuis cet endroit
3. Allez dans Microsoft Teams, cliquez sur « Applications » dans la barre latérale
4. En bas, cliquez sur « Gérer vos applications »
5. Cliquez sur « Télécharger une application personnalisée »
6. Sélectionnez « Télécharger pour moi ou mes équipes »
7. Téléchargez le fichier zip du manifeste que vous avez téléchargé précédemment

## Dépannage

Si vous rencontrez des problèmes :

- Assurez-vous que votre application dispose des permissions correctement accordées
- Vérifiez que l'URI de redirection correspond exactement (remplacez `votre-domaine-oneuptime.com` par votre domaine réel)
- Vérifiez que vos variables d'environnement sont correctement définies
- Assurez-vous que le point de terminaison de messagerie du bot est accessible depuis Internet
- Vérifiez que le bot est correctement configuré avec le canal Teams
- Vérifiez que le manifeste de l'application Teams a été téléchargé avec succès

## Support

Nous souhaitons améliorer cette intégration, donc les retours sont plus que bienvenus. Veuillez nous en faire part à [hello@oneuptime.com](mailto:hello@oneuptime.com)
