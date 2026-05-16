# Intégration Microsoft Teams

Pour intégrer Microsoft Teams avec votre instance auto-hébergée OneUptime, vous devez configurer l'enregistrement d'application Azure et définir les variables d'environnement requises.

## Prérequis

- Compte Azure — Vous pouvez en créer un en allant sur [https://azure.com](https://azure.com)
- Accès à la configuration de votre serveur OneUptime

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
   - **ChannelMessage.Send** — Requis pour envoyer des messages aux canaux par programmation

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

1. Allez dans **Paramètres** du projet > **Intégrations** > **Microsoft Teams**
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
