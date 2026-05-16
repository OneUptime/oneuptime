# Intégration GitHub

Pour intégrer GitHub avec votre instance auto-hébergée OneUptime, vous devez créer une application GitHub et configurer les variables d'environnement requises. Cela permet à OneUptime de se connecter à vos dépôts GitHub pour la gestion des dépôts de code.

## Prérequis

- Compte GitHub avec accès administrateur à l'organisation (pour les dépôts d'organisation) ou accès au compte personnel
- Accès à la configuration de votre serveur OneUptime

## Instructions de configuration

### Étape 1 : Créer une application GitHub

1. Allez sur GitHub et accédez aux paramètres de votre organisation ou compte personnel :
   - **Pour les organisations :** Allez sur `https://github.com/organizations/VOTRE_ORG/settings/apps`
   - **Pour le compte personnel :** Allez sur `https://github.com/settings/apps`

2. Cliquez sur **« Nouvelle application GitHub »**

3. Remplissez le formulaire d'inscription :
   - **Nom de l'application GitHub :** OneUptime (ou tout nom unique) - **Notez ce nom, vous en aurez besoin pour la variable d'environnement `GITHUB_APP_NAME`**
   - **URL de la page d'accueil :** `https://votre-domaine-oneuptime.com`
   - **URL de rappel :** `https://votre-domaine-oneuptime.com/api/github/auth/callback`
   - **URL de configuration :** `https://votre-domaine-oneuptime.com/api/github/auth/callback` - **Important : Il s'agit de l'URL vers laquelle GitHub redirige les utilisateurs après l'installation de l'application. Elle doit être définie pour que la redirection fonctionne.**
   - **Rediriger lors de la mise à jour :** Cochez cette option pour rediriger les utilisateurs après la mise à jour de l'installation de l'application
   - **URL du webhook :** `https://votre-domaine-oneuptime.com/api/github/webhook`
   - **Secret du webhook :** Générez une chaîne aléatoire sécurisée (enregistrez-la pour plus tard)

### Étape 2 : Configurer les permissions de l'application

Dans la section « Permissions & événements », configurez les permissions suivantes :

**Permissions de dépôt :**

| Permission | Niveau d'accès | Objectif |
|------------|----------------|---------|
| Contenu | Lecture & Écriture | Lire les fichiers du dépôt, pousser des branches (requis pour l'agent IA) |
| Pull requests | Lecture & Écriture | Créer et gérer les pull requests |
| Issues | Lecture & Écriture | Lire et commenter les issues |
| Statuts de commit | Lecture | Vérifier le statut de build/CI |
| Actions | Lecture | Lire les exécutions et journaux des workflows GitHub Actions |
| Métadonnées | Lecture | Métadonnées de base du dépôt (requis) |

**Permissions d'organisation (si utilisé avec des organisations) :**

| Permission | Niveau d'accès | Objectif |
|------------|----------------|---------|
| Membres | Lecture | Lister les membres de l'organisation |

**Permissions de compte :**

| Permission | Niveau d'accès | Objectif |
|------------|----------------|---------|
| Adresses e-mail | Lecture | Lire l'e-mail de l'utilisateur pour les notifications |

### Étape 3 : S'abonner aux événements de webhook

Événements pour que OneUptime reçoive des mises à jour en temps réel, abonnez-vous à ces événements de webhook :

- **Pull request** — Recevoir des notifications lorsque les PR sont ouvertes, fermées ou fusionnées
- **Push** — Recevoir des notifications lorsque du code est poussé
- **Exécution de workflow** — Recevoir des mises à jour de statut CI/CD

### Étape 4 : Définir l'accès à l'installation

Sous « Où cette application GitHub peut-elle être installée ? », choisissez :
- **Uniquement sur ce compte** — Pour une utilisation privée/interne
- **N'importe quel compte** — Si vous souhaitez que d'autres installent votre application

### Étape 5 : Créer l'application GitHub

1. Cliquez sur **« Créer une application GitHub »**
2. Vous serez redirigé vers la page des paramètres de votre application
3. Notez les valeurs suivantes :
   - **ID de l'application** — Trouvé en haut de la page des paramètres de l'application
   - **ID client** — Trouvé dans la section « À propos »

### Étape 6 : Générer le secret client

1. Dans les paramètres de votre application GitHub, faites défiler jusqu'à « Secrets client »
2. Cliquez sur **« Générer un nouveau secret client »**
3. Copiez le secret immédiatement — vous ne pourrez plus le voir

### Étape 7 : Générer la clé privée

1. Faites défiler jusqu'à la section « Clés privées »
2. Cliquez sur **« Générer une clé privée »**
3. Un fichier `.pem` sera téléchargé automatiquement
4. Gardez ce fichier sécurisé — il est utilisé pour l'authentification en tant qu'application GitHub

### Étape 8 : Configurer les variables d'environnement OneUptime

#### Docker Compose

Si vous utilisez Docker Compose, ajoutez ces variables d'environnement à votre fichier `config.env` :

```bash
# Configuration de l'application GitHub
GITHUB_APP_ID=VOTRE_APP_ID
GITHUB_APP_NAME=VOTRE_APP_NAME  # Le nom exact de votre application GitHub (ex. : « OneUptime »)
GITHUB_APP_CLIENT_ID=VOTRE_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=VOTRE_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<CONTENU_CLÉ_PRIVÉE_ENCODÉE_EN_BASE64>"
GITHUB_APP_WEBHOOK_SECRET=VOTRE_WEBHOOK_SECRET
```

**Remarque :** Pour la clé privée, encodez-la en base64 et collez-la sans saut de ligne si votre environnement ne prend pas en charge les chaînes multi-lignes.

#### Kubernetes avec Helm

Si vous utilisez Kubernetes avec Helm, ajoutez ces éléments à votre fichier `values.yaml` :

```yaml
gitHubApp:
  id: "VOTRE_APP_ID"
  name: "VOTRE_APP_NAME"  # Le nom exact de votre application GitHub
  clientId: "VOTRE_CLIENT_ID"
  clientSecret: "VOTRE_CLIENT_SECRET"
  privateKey: "<CONTENU_CLÉ_PRIVÉE_ENCODÉE_EN_BASE64>"
  webhookSecret: "VOTRE_WEBHOOK_SECRET"
```

**Important :** Redémarrez votre serveur OneUptime après avoir ajouté ces variables d'environnement pour qu'elles prennent effet.

### Étape 9 : Installer l'application GitHub

1. Allez sur la page publique de votre application GitHub : `https://github.com/apps/VOTRE_APP_NAME`
2. Cliquez sur **« Installer »** ou **« Configurer »**
3. Sélectionnez l'organisation ou le compte où vous souhaitez installer l'application
4. Choisissez les dépôts auxquels l'application peut accéder :
   - **Tous les dépôts** — Accès à tous les dépôts actuels et futurs
   - **Uniquement les dépôts sélectionnés** — Choisissez des dépôts spécifiques
5. Cliquez sur **« Installer »**

### Étape 10 : Connecter des dépôts dans OneUptime

1. Connectez-vous à votre tableau de bord OneUptime
2. Accédez à **Plus** > **Dépôts de code**
3. Cliquez sur **« Créer un dépôt »** ou utilisez le flux d'installation de l'application GitHub
4. Si redirigé depuis GitHub, l'ID d'installation sera automatiquement capturé
5. Sélectionnez les dépôts que vous souhaitez connecter dans la liste
6. Cliquez sur **« Connecter »** pour lier le dépôt à votre projet OneUptime

## Référence des variables d'environnement

| Variable | Description | Obligatoire |
|----------|-------------|-------------|
| `GITHUB_APP_ID` | L'ID de l'application depuis vos paramètres d'application GitHub | Oui |
| `GITHUB_APP_NAME` | Le nom exact de votre application GitHub (utilisé pour les URL d'installation) | Oui |
| `GITHUB_APP_CLIENT_ID` | L'ID client depuis vos paramètres d'application GitHub | Oui |
| `GITHUB_APP_CLIENT_SECRET` | Le secret client que vous avez généré | Oui |
| `GITHUB_APP_PRIVATE_KEY` | Le contenu de la clé privée (fichier .pem) | Oui |
| `GITHUB_APP_WEBHOOK_SECRET` | Le secret du webhook pour vérifier les charges utiles des webhooks | Non (mais recommandé) |

## Dépannage

### Problèmes courants

**Non redirigé vers OneUptime après l'installation de l'application GitHub :**
- Assurez-vous que l'**URL de configuration** est configurée dans les paramètres de votre application GitHub vers : `https://votre-domaine-oneuptime.com/api/github/auth/callback`
- Allez dans les paramètres de votre application GitHub > section « Post-installation » et vérifiez que l'URL de configuration est correctement définie
- L'option « Rediriger lors de la mise à jour » doit également être cochée
- Remarque : L'URL de configuration est différente de l'URL de rappel — les deux doivent pointer vers le même point d'accès `/api/github/auth/callback`

**Erreur « L'application GitHub n'est pas configurée » :**
- Assurez-vous que la variable d'environnement `GITHUB_APP_CLIENT_ID` est définie
- Redémarrez votre serveur OneUptime après avoir défini les variables d'environnement

**Erreur « Signature de webhook invalide » :**
- Vérifiez que votre `GITHUB_APP_WEBHOOK_SECRET` correspond au secret configuré dans GitHub
- Assurez-vous que l'URL du webhook est correcte et accessible depuis Internet

**Erreur « Échec de l'obtention du jeton d'accès à l'installation » :**
- Vérifiez que votre `GITHUB_APP_PRIVATE_KEY` est correctement formatée
- Vérifiez que la clé privée inclut les marqueurs BEGIN/END
- Assurez-vous que l'ID de l'application est correct

**Impossible de voir les dépôts après l'installation :**
- Vérifiez que l'application GitHub a accès aux dépôts que vous souhaitez connecter
- Vérifiez les permissions d'installation dans GitHub (Paramètres > Applications > Applications GitHub installées)

**Les événements de webhook ne sont pas reçus :**
- Assurez-vous que votre URL de webhook est publiquement accessible
- Vérifiez les journaux de livraison de webhook de l'application GitHub dans les paramètres de votre application
- Vérifiez que le secret du webhook est correctement configuré

### Vérification des livraisons de webhook

1. Allez dans les paramètres de votre application GitHub
2. Cliquez sur « Avancé » dans la barre latérale
3. Consultez « Livraisons récentes » pour voir les tentatives de webhook et les réponses

## Meilleures pratiques de sécurité

1. **Rotation régulière des secrets** — Générez de nouveaux secrets client et clés privées périodiquement
2. **Utiliser des secrets de webhook** — Configurez toujours un secret de webhook pour vérifier l'authenticité des charges utiles
3. **Limiter l'accès aux dépôts** — N'accordez l'accès qu'aux dépôts qui doivent être connectés
4. **Surveiller les livraisons de webhook** — Vérifiez régulièrement les livraisons échouées ou les activités suspectes
5. **Sécuriser les clés privées** — Ne jamais committer les clés privées dans le contrôle de version

## Support

Si vous rencontrez des problèmes avec l'intégration GitHub, veuillez :

1. Consulter la section de dépannage ci-dessus
2. Examiner les journaux de OneUptime pour les messages d'erreur détaillés
3. Nous contacter à [hello@oneuptime.com](mailto:hello@oneuptime.com)

Nous accueillons favorablement les retours pour améliorer cette intégration !
