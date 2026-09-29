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
   - **Request user authorization (OAuth) during installation:** **Cochez cette option obligatoire.** OneUptime utilise OAuth pour vérifier la propriété de l’installation et refuse la connexion sans cette option.
   - **URL du webhook :** `https://votre-domaine-oneuptime.com/api/github/webhook`
   - **Secret du webhook :** Générez une chaîne aléatoire sécurisée (enregistrez-la pour plus tard)

### Étape 2 : Configurer les permissions de l'application

Dans la section « Permissions & événements », configurez les permissions suivantes :

**Permissions de dépôt :**

| Permission        | Niveau d'accès     | Objectif                                                                  |
| ----------------- | ------------------ | ------------------------------------------------------------------------- |
| Contenu           | Lecture & Écriture | Lire les fichiers du dépôt, pousser des branches (requis pour l'agent IA) |
| Pull requests     | Lecture & Écriture | Créer et gérer les pull requests, et publier des revues de code           |
| Issues            | Lecture & Écriture | Lire les issues et publier les commentaires de l'application — **y compris sur les pull requests**, dont GitHub fait transiter la conversation par l'API des issues |
| Statuts de commit | Lecture            | Vérifier le statut de build/CI                                            |
| Actions           | Lecture            | Lire les exécutions et journaux des workflows GitHub Actions              |
| Métadonnées       | Lecture            | Métadonnées de base du dépôt (requis)                                     |

**C'est la permission Issues : Lecture & Écriture qui rend l'application interactive.** Sans elle, les mentions sont bien reçues, puis échouent silencieusement au moment où l'application tente de répondre — GitHub sert les commentaires de conversation des pull requests depuis l'API des issues, si bien que cette seule permission conditionne chaque réponse écrite par l'application. Voir [Utiliser OneUptime depuis GitHub](/docs/ai/github-app).

**Permissions d'organisation (si utilisé avec des organisations) :**

| Permission | Niveau d'accès | Objectif                             |
| ---------- | -------------- | ------------------------------------ |
| Membres    | Lecture        | Lister les membres de l'organisation |

**Permissions de compte :**

| Permission      | Niveau d'accès | Objectif                                              |
| --------------- | -------------- | ----------------------------------------------------- |
| Adresses e-mail | Lecture        | Lire l'e-mail de l'utilisateur pour les notifications |

### Étape 3 : S'abonner aux événements de webhook

OneUptime utilise deux ensembles d'événements, qui ne remplissent pas le même rôle.

**Synchronisation des dépôts** — `installation` et `installation_repositories`. Les GitHub Apps les reçoivent automatiquement ; ils maintiennent la liste des dépôts connectés en phase avec les dépôts sur lesquels l'application est installée.

**L'application interactive** — il faut s'abonner explicitement à ces événements, et chacun active une manière précise de confier du travail à l'application :

| Événement                       | Ce qu'il active                                                       |
| ------------------------------- | --------------------------------------------------------------------- |
| **Issue comment**               | les commandes `@mention` sur les issues **et** sur les pull requests   |
| **Issues**                      | l'assignation d'une issue à l'application, et le label déclencheur du dépôt |
| **Pull request**                | la demande de revue adressée à l'application                          |
| **Pull request review**         | une mention écrite dans le corps d'une revue soumise                  |
| **Pull request review comment** | une mention sur un commentaire en ligne dans le diff                  |

Si vous ne vous abonnez à aucun d'entre eux, la GitHub App continue de connecter les dépôts et d'ouvrir des pull requests de correction depuis OneUptime — elle ne répond simplement jamais à ce qui est écrit dans GitHub. C'est la cause la plus fréquente du « le bot m'ignore ». Voir [Utiliser OneUptime depuis GitHub](/docs/ai/github-app) pour savoir quelles sont les commandes et qui a le droit de les émettre.

Les autres événements (**Push**, **Workflow run**) sont acquittés puis ignorés ; s'y abonner n'active ni notifications ni automatisation CI/CD.

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
  name: "VOTRE_APP_NAME" # Le nom exact de votre application GitHub
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
2. Accédez à **Produits** > **Dépôts de code**
3. Cliquez sur **« Créer un dépôt »** ou utilisez le flux d'installation de l'application GitHub
4. Si redirigé depuis GitHub, l'ID d'installation sera automatiquement capturé
5. Sélectionnez les dépôts que vous souhaitez connecter dans la liste
6. Cliquez sur **« Connecter »** pour lier le dépôt à votre projet OneUptime

## Référence des variables d'environnement

| Variable                    | Description                                                                    | Obligatoire           |
| --------------------------- | ------------------------------------------------------------------------------ | --------------------- |
| `GITHUB_APP_ID`             | L'ID de l'application depuis vos paramètres d'application GitHub               | Oui                   |
| `GITHUB_APP_NAME`           | Le nom exact de votre application GitHub (utilisé pour les URL d'installation) | Oui                   |
| `GITHUB_APP_CLIENT_ID`      | L'ID client depuis vos paramètres d'application GitHub                         | Oui                   |
| `GITHUB_APP_CLIENT_SECRET`  | Le secret client que vous avez généré                                          | Oui                   |
| `GITHUB_APP_PRIVATE_KEY`    | Le contenu de la clé privée (fichier .pem)                                     | Oui                   |
| `GITHUB_APP_WEBHOOK_SECRET` | Le secret du webhook pour vérifier les charges utiles des webhooks             | Oui, pour les webhooks |

## Accès réseau pour les déploiements auto-hébergés

### Sens du trafic et points de terminaison

| Trafic | Accès nécessaire |
| --- | --- |
| OneUptime → GitHub | DNS et HTTPS sortant sur TCP 443 vers `api.github.com` pour les jetons d’application et les API de dépôts, et `github.com` pour l’échange OAuth et les opérations Git HTTPS |
| GitHub → OneUptime | HTTPS public sur TCP 443 vers `POST /api/github/webhook` pour synchroniser installation et accès aux dépôts |
| Navigateur de l’utilisateur → OneUptime | Tableau de bord et `GET /api/github/auth/callback` pour les redirections d’installation/autorisation ; accès possible par VPN utilisateur |

Les URL callback/setup servent à une [redirection du navigateur](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url) ; les serveurs GitHub appellent le webhook. Le VPN utilisateur ne leur donne pas accès au webhook. Les domaines cités couvrent les requêtes principales ; outils de dépôt, téléchargements, LFS ou paquets peuvent nécessiter d’autres destinations. Ces paramètres concernent GitHub.com ; modifier le pare-feu ne configure pas la prise en charge d’un nom d’hôte GitHub Enterprise Server.

### Déploiements privés et sécurité des callbacks

Utilisez un DNS public et une passerelle avec un certificat HTTPS publiquement reconnu, une chaîne complète et une route privée vers l’ingress OneUptime. Autorisez TCP 443 entrant et ne publiez que les callbacks POST du fournisseur indiqués ci-dessus. Un `ClusterIP` privé, un DNS interne ou le VPN d’un employé ne suffit pas au fournisseur. Un DNS à vues séparées peut garder le tableau de bord et les routes OAuth du navigateur privés sous le même nom d’hôte.

Définissez `HOST=oneuptime.example.com` et `HTTP_PROTOCOL=https` dans `config.env`, ou `host: oneuptime.example.com` et `httpProtocol: https` dans Helm. Appliquez la configuration et attendez le redémarrage. Ces valeurs génèrent les URL ; elles ne configurent ni DNS, ni TLS, ni pare-feu. Après un changement de nom d’hôte, actualisez les URL webhook, callback, setup et homepage de la GitHub App.

Conservez méthode, chemin original, paramètres de requête, corps, `Content-Type`, `X-Hub-Signature-256`, `X-GitHub-Event` et `X-GitHub-Delivery`. Transmettez l’hôte public et HTTPS via des en-têtes de proxy fiables. Exemptez le webhook du SSO navigateur, des CAPTCHA et des pages de connexion du proxy. Gardez la vérification SSL de GitHub activée et configurez le même `GITHUB_APP_WEBHOOK_SECRET` dans les deux systèmes : OneUptime rejette les requêtes non signées et ne peut valider les webhooks sans ce secret. Consultez la [validation GitHub](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Si vous filtrez aussi les IP sources, utilisez les plages `hooks` actuelles de la Meta API GitHub et actualisez-les régulièrement. Ne les remplacez pas par les plages des runners GitHub Actions et conservez la vérification de signature. GitHub précise que [les adresses changent et la liste n’est pas exhaustive](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).

### Vérifier l’accès et comprendre les limites

Terminez l’installation depuis OneUptime, puis consultez **Advanced > Recent Deliveries** dans la GitHub App. Envoyez ou relivrez un test et vérifiez sa transmission et son acceptation. Ajoutez ou retirez un dépôt de test de l’installation et vérifiez la mise à jour de la liste connectée. GitHub documente le [diagnostic des livraisons](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) et exige [un accusé 2xx sous dix secondes](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks). Un GET navigateur ne teste pas un POST signé.

Sans accès entrant, l’autorisation navigateur et les opérations API/Git sortantes peuvent fonctionner, mais suppressions d’installation et changements d’accès aux dépôts ne se synchronisent pas par webhook. OneUptime traite actuellement `installation` et `installation_repositories` ; accepter d’autres événements n’implique pas d’automatisation supplémentaire. Le [paramètre d’accès au réseau privé](/docs/self-hosted/private-network-access) contrôle les requêtes sortantes vers des destinations privées et ne rend pas le webhook accessible.

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
