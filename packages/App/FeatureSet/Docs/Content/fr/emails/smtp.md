# SMTP

Envoyez les e-mails de OneUptime par votre propre serveur de messagerie. Un projet ajoute des configurations SMTP avec lesquelles ses pages de statut envoient leurs e-mails, et une installation auto-hébergée définit le serveur par lequel OneUptime envoie tout le reste. Les deux prennent en charge trois façons de se connecter :

- **Nom d'utilisateur et mot de passe** : l'authentification SMTP classique.
- **OAuth 2.0** : pour Microsoft 365 et Google Workspace, où l'authentification de base est souvent désactivée.
- **Aucun** : pour les serveurs relais qui n'exigent pas d'authentification.

```mermaid title="Quel serveur de messagerie envoie quoi"
flowchart TB
    SP["E-mail d'une page de statut"] --> Q{"Configuration SMTP personnalisée<br/>choisie pour la page ?"}
    Q -->|"Oui"| P["La configuration SMTP<br/>du projet"]
    Q -->|"Non"| D["Le serveur de messagerie<br/>de OneUptime"]
    E["Tous les autres e-mails<br/>de OneUptime"] --> D
```

Sur une installation auto-hébergée, le serveur de messagerie de OneUptime est celui défini dans l'Admin Dashboard. Une page de statut choisit sa configuration SMTP sur sa page **Paramètres des abonnés**, dans la carte **SMTP personnalisé**.

:::cards
- [Ajouter un serveur de messagerie](#ajouter-un-serveur-smtp): Deux étapes, tout le reste est replié.
- [Microsoft 365](#configuration-de-microsoft-365): OAuth avec un enregistrement d'application Entra.
- [Google Workspace](#configuration-de-google-workspace): OAuth avec un compte de service.
- [Dépannage](#dépannage): Les erreurs courantes et leur signification.
:::

## Ajouter un serveur SMTP

Ajoutez le serveur de messagerie d'un projet dans **Paramètres du projet > Notifications > Paramètres de notification**, dans la carte **Configurations SMTP personnalisées**. Sur une installation auto-hébergée, le serveur par lequel OneUptime envoie lui-même se définit dans **Admin Dashboard > Paramètres > Notifications > E-mails**, dans la carte **Paramètres e-mail et SMTP personnalisés**. Les deux formulaires demandent les mêmes informations, en deux étapes.

:::steps
### Ouvrir le formulaire

:::tabs
@tab Projet
Dans **Paramètres du projet > Notifications > Paramètres de notification**, cliquez sur **Créer : Configuration SMTP** dans la carte **Configurations SMTP personnalisées**.
@tab Instance auto-hébergée
Dans l'Admin Dashboard, ouvrez **Paramètres**, puis **Notifications > E-mails** dans le menu latéral (**Notifications** est replié au départ). Dans la carte **Paramètres du serveur de messagerie**, cliquez sur **Modifier le serveur** et réglez **Type de serveur de messagerie** sur `Custom SMTP`. Cliquez ensuite sur **Modifier la config SMTP** dans la carte **Paramètres e-mail et SMTP personnalisés**, qui apparaît en dessous.
:::

### Remplir l'étape Serveur

À l'étape **Serveur**, saisissez le **Nom** (configurations de projet uniquement), le **Nom d'hôte**, le **Port** (une nouvelle configuration de projet commence avec `587`), le **Nom d'utilisateur** et le **Mot de passe**.

### Vérifier Plus de champs

Tout le reste est replié sous **Plus de champs**, à la fin de l'étape **Serveur**. Tant qu'il est replié, son en-tête indique comment les e-mails sont envoyés, par exemple « Les e-mails sont envoyés par SMTP, avec une connexion par nom d'utilisateur et mot de passe. TLS est obligatoire. » Ne l'ouvrez que si vous devez changer l'un des paramètres du tableau ci-dessous.

### Remplir l'étape Expéditeur

À l'étape **Expéditeur**, saisissez l'**E-mail de l'expéditeur** et le **Nom de l'expéditeur** d'où proviennent vos e-mails. Votre serveur doit autoriser l'envoi depuis cette adresse.

### Enregistrer et envoyer un e-mail de test

Enregistrez la configuration. Une fois une configuration de projet enregistrée, **Envoyer un e-mail de test** sur sa ligne vérifie qu'elle fonctionne. Il faut pour cela l'autorisation d'ajouter des configurations SMTP : **Project Owner**, **Project Admin**, ou **Create SMTP Config** et **Read SMTP Config** dans un rôle personnalisé. Sur OneUptime Cloud, il faut aussi le plan **Growth**, comme pour ajouter une configuration. Pour les autres, le bouton est verrouillé et son info-bulle indique ce qu'il faut.

Le test demande une adresse **E-mail** à laquelle envoyer, la vôtre au départ. Vérifiez que le message arrive.
:::

Voici les paramètres sous **Plus de champs** :

| Champ | Ce qu'il fait |
| --- | --- |
| **Transport** | `SMTP` (par défaut), ou `Microsoft Graph` pour un locataire Microsoft 365 où SMTP AUTH est désactivé. Choisir Microsoft Graph masque le nom d'hôte, le port, le nom d'utilisateur et le mot de passe, et affiche les champs OAuth. |
| **Exiger TLS** | Activé pour une nouvelle configuration de projet. Les e-mails ne sont envoyés que par une connexion chiffrée avec un certificat valide. Lorsque cette option est désactivée, les e-mails ne sont chiffrés que si le serveur le propose, et le certificat n'est pas vérifié. Le port 465 est toujours chiffré. |
| **Type d'authentification** | `Username and Password` (par défaut), `OAuth`, ou `None` pour un relais qui ne demande pas de connexion. |
| **Champs OAuth** | **Type de fournisseur OAuth**, **ID client OAuth**, **Secret client OAuth**, **URL du jeton OAuth** et **Portée OAuth**, affichés dès qu'OAuth ou Microsoft Graph est choisi. |
| **Description** | Une note pour votre équipe (configurations de projet uniquement). |

**Microsoft Graph.** Ouvrez **Plus de champs**, réglez **Transport** sur `Microsoft Graph` et renseignez une application Azure qui a l'autorisation d'application **Mail.Send** : son ID client et son secret client, l'URL de jeton `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` et la portée `https://graph.microsoft.com/.default`. Les e-mails partent de la boîte aux lettres de l'**E-mail de l'expéditeur**, qui doit être une boîte aux lettres sous licence de votre locataire.

> [!NOTE]
> Sur OneUptime Cloud, le serveur de messagerie d'un projet doit être joignable par Internet : un hôte qui se résout en une adresse privée ou interne est refusé. Sur une installation auto-hébergée, les adresses privées sont autorisées sauf si `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` vaut `true` ; les adresses de bouclage et lien-local sont toujours refusées. Le serveur de messagerie propre à l'instance n'est pas vérifié ainsi.

## Authentification OAuth 2.0

OAuth 2.0 permet à OneUptime de se connecter à votre serveur de messagerie sans mot de passe, ce que les services de messagerie d'entreprise exigent de plus en plus. OneUptime prend en charge deux types d'octroi OAuth :

- **Client Credentials** : utilisé par Microsoft 365 et la plupart des fournisseurs OAuth.
- **JWT Bearer** : utilisé par les comptes de service Google Workspace.

```mermaid title="Comment OneUptime se connecte avec OAuth"
sequenceDiagram
    participant O as OneUptime
    participant T as URL du jeton
    participant M as Serveur de messagerie
    O->>T: Demander un jeton d'accès
    T-->>O: Jeton d'accès
    Note over O: Mis en cache et renouvelé<br/>avant son expiration
    O->>M: Se connecter avec le jeton
    O->>M: Envoyer l'e-mail
```

Le **Type d'authentification** et les champs OAuth se trouvent sous **Plus de champs**, à l'étape Serveur du formulaire. Pour vous connecter avec OAuth, renseignez :

| Champ | Description |
| --- | --- |
| **Nom d'hôte** | Adresse du serveur SMTP |
| **Port** | Port SMTP (en général 587 pour STARTTLS ou 465 pour le TLS implicite) |
| **Nom d'utilisateur** | L'adresse e-mail de la boîte aux lettres qui envoie |
| **Type d'authentification** | `OAuth` |
| **Type de fournisseur OAuth** | `Client Credentials` pour Microsoft 365, ou `JWT Bearer` pour Google Workspace |
| **ID client OAuth** | L'ID d'application (client) de votre fournisseur OAuth (pour Google : l'e-mail du compte de service) |
| **Secret client OAuth** | Le secret client de votre fournisseur OAuth (pour Google : la clé privée) |
| **URL du jeton OAuth** | Le point de terminaison de jeton OAuth de votre fournisseur |
| **Portée OAuth** | La portée OAuth qui donne accès à SMTP |

OneUptime met en cache les jetons OAuth et les renouvelle automatiquement avant leur expiration.

## Configuration de Microsoft 365

Pour utiliser OAuth avec Microsoft 365 (Exchange Online), enregistrez une application dans Microsoft Entra, donnez-lui l'autorisation d'envoyer des e-mails par SMTP et autorisez-la à utiliser la boîte aux lettres d'envoi.

:::steps
### Enregistrer une application dans Microsoft Entra

1. Connectez-vous au [centre d'administration Microsoft Entra](https://entra.microsoft.com).
2. Allez dans **Identity** > **Applications** > **App registrations** et cliquez sur **New registration**.
3. Saisissez un nom (par exemple « OneUptime SMTP »), sélectionnez « Accounts in this organizational directory only » et laissez **Redirect URI** vide.
4. Cliquez sur **Register**.

Sur la page **Overview**, notez l'**Application (client) ID** (votre ID client) et le **Directory (tenant) ID** (pour l'URL du jeton).

### Créer un secret client

1. Dans l'enregistrement de votre application, allez dans **Certificates & secrets** et cliquez sur **New client secret**.
2. Ajoutez une description, choisissez une durée d'expiration et cliquez sur **Add**.
3. **Copiez immédiatement la valeur du secret** : elle ne sera plus affichée.

### Ajouter l'autorisation SMTP

1. Allez dans **API permissions** et cliquez sur **Add a permission**.
2. Sélectionnez **APIs my organization uses**, puis recherchez et sélectionnez **Office 365 Exchange Online**.
3. Sélectionnez **Application permissions**, cochez **SMTP.SendAsApp** et cliquez sur **Add permissions**.
4. Cliquez sur **Grant admin consent for [your organization]** (cela demande des droits d'administrateur).

### Enregistrer le principal de service dans Exchange Online

Avant que l'application puisse envoyer des e-mails, enregistrez son principal de service dans Exchange Online et donnez-lui accès à la boîte aux lettres d'envoi :

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> Utilisez `Add-MailboxPermission`, pas `Add-RecipientPermission`. `Add-RecipientPermission` n'accorde que `SendAs` sur le destinataire, ce qui ne suffit pas au principal de service pour envoyer des e-mails par SMTP avec OAuth : l'envoi échoue avec une erreur d'authentification ou d'autorisation.

### Créer la configuration SMTP dans OneUptime

Créez ou modifiez une configuration SMTP avec ces paramètres, en remplaçant `<tenant-id>` par votre **Directory (tenant) ID** :

| Champ | Valeur |
| --- | --- |
| Nom d'hôte | `smtp.office365.com` |
| Port | `587` |
| Nom d'utilisateur | L'adresse e-mail à laquelle vous avez accordé les autorisations (par ex. `sender@yourdomain.com`) |
| Type d'authentification | `OAuth` |
| Type de fournisseur OAuth | `Client Credentials` |
| ID client OAuth | Votre **Application (client) ID** |
| Secret client OAuth | La valeur du secret client |
| URL du jeton OAuth | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Portée OAuth | `https://outlook.office365.com/.default` |
| E-mail de l'expéditeur | Identique au nom d'utilisateur |
| Exiger TLS | Activé |

Vérifiez-la ensuite avec **Envoyer un e-mail de test**.
:::

## Configuration de Google Workspace

Google Workspace demande un **compte de service** avec délégation à l'échelle du domaine, qui envoie les e-mails au nom d'un utilisateur de votre domaine. Les serveurs SMTP de Google ne prennent pas en charge un simple flux client credentials pour Gmail.

### Avant de commencer avec Google Workspace

- Un compte Google Workspace. Les comptes Gmail grand public ne le permettent pas.
- Un accès Super Admin à la console d'administration Google Workspace.
- Un accès à la Google Cloud Console.

:::steps
### Créer un projet Google Cloud

1. Allez sur la [Google Cloud Console](https://console.cloud.google.com).
2. Cliquez sur le sélecteur de projet et choisissez **New Project**.
3. Saisissez un nom de projet, cliquez sur **Create** et sélectionnez votre nouveau projet.

### Activer l'API Gmail

1. Allez dans **APIs & Services** > **Library**.
2. Recherchez « Gmail API », cliquez sur **Gmail API** puis sur **Enable**.

### Créer un compte de service

1. Allez dans **APIs & Services** > **Credentials**.
2. Cliquez sur **Create Credentials** > **Service account**.
3. Saisissez un nom et une description, cliquez sur **Create and Continue**, passez les étapes facultatives et cliquez sur **Done**.

### Créer une clé de compte de service

1. Cliquez sur le compte de service que vous venez de créer et allez dans l'onglet **Keys**.
2. Cliquez sur **Add Key** > **Create new key**, sélectionnez **JSON** et cliquez sur **Create**.
3. Conservez le fichier JSON téléchargé en lieu sûr. Son `client_email` est votre ID client OAuth, et sa `private_key` votre secret client OAuth.

### Activer la délégation à l'échelle du domaine

1. Dans les détails du compte de service, cliquez sur **Show Advanced Settings**.
2. Notez le **Client ID** numérique.
3. Cochez **Enable Google Workspace Domain-wide Delegation** et cliquez sur **Save**.

### Autoriser le compte de service dans l'administration Google Workspace

1. Connectez-vous à la [console d'administration Google Workspace](https://admin.google.com).
2. Allez dans **Security** > **Access and data control** > **API Controls** et cliquez sur **Manage Domain Wide Delegation**.
3. Cliquez sur **Add new**, saisissez le **Client ID** numérique de l'étape précédente et, pour **OAuth Scopes**, saisissez `https://mail.google.com/`.
4. Cliquez sur **Authorize**.

La délégation peut mettre de quelques minutes à 24 heures pour prendre effet.

### Créer la configuration SMTP pour Google Workspace

Créez ou modifiez une configuration SMTP avec ces paramètres :

| Champ | Valeur |
| --- | --- |
| Nom d'hôte | `smtp.gmail.com` |
| Port | `587` |
| Nom d'utilisateur | L'adresse e-mail Google Workspace d'envoi (par ex. `notifications@yourdomain.com`). Le compte de service agit au nom de cet utilisateur. |
| Type d'authentification | `OAuth` |
| Type de fournisseur OAuth | `JWT Bearer` |
| ID client OAuth | Le `client_email` du JSON de votre compte de service (par ex. `your-service@your-project.iam.gserviceaccount.com`) |
| Secret client OAuth | La `private_key` du JSON de votre compte de service (la clé entière, y compris `-----BEGIN PRIVATE KEY-----` et `-----END PRIVATE KEY-----`) |
| URL du jeton OAuth | `https://oauth2.googleapis.com/token` |
| Portée OAuth | `https://mail.google.com/` |
| E-mail de l'expéditeur | Identique au nom d'utilisateur |
| Exiger TLS | Activé |

Vérifiez-la ensuite avec **Envoyer un e-mail de test**.
:::

> [!IMPORTANT]
> Pour Google (JWT Bearer), l'**ID client OAuth** est l'**e-mail du compte de service** (`client_email`), pas le `client_id` numérique. Le compte de service agit au nom de l'utilisateur indiqué dans **Nom d'utilisateur** pour envoyer les e-mails.

## Dépannage

### Erreurs Microsoft 365

| Problème | Solution |
| --- | --- |
| "Authentication unsuccessful" | Vérifiez que le principal de service est enregistré dans Exchange et a les autorisations sur la boîte aux lettres |
| "AADSTS700016: Application not found" | Vérifiez que l'ID client est correct et que l'application existe dans votre locataire |
| "AADSTS7000215: Invalid client secret" | Créez un nouveau secret client : l'ancien a peut-être expiré |
| "The mailbox is not enabled for this operation" | Exécutez `Add-MailboxPermission` pour donner accès à la boîte aux lettres |

### Erreurs Google Workspace

| Problème | Solution |
| --- | --- |
| "invalid_grant" | Vérifiez que la délégation à l'échelle du domaine est bien configurée et propagée |
| "unauthorized_client" | Vérifiez que l'ID client est autorisé dans la console d'administration Google Workspace |
| "access_denied" | Vérifiez que la portée `https://mail.google.com/` est autorisée |
| "Domain policy has disabled third-party Drive apps" | Activez l'accès aux API dans l'administration Google Workspace, sous Security > API Controls |

### Autres problèmes

:::details "Cannot send email. Please check your SMTP config."
**Envoyer un e-mail de test** affiche ce message quand un serveur auquel on se connecte avec un nom d'utilisateur et un mot de passe, ou sans connexion, n'accepte pas l'e-mail. Vérifiez le **Nom d'hôte**, le **Port**, le **Nom d'utilisateur** et le **Mot de passe**. Si votre serveur ne propose pas TLS, ou si son certificat n'est pas valide pour son nom d'hôte, désactivez **Exiger TLS** sous **Plus de champs** et réessayez. La réponse du serveur est conservée avec le test : ouvrez l'onglet **E-mail** de **Paramètres du projet > Notifications > Journaux de notification** et sélectionnez **Voir le message de statut** sur sa ligne.
:::

:::details "Cannot send email with OAuth authentication"
La connexion OAuth a échoué, et le message se termine par l'erreur renvoyée par votre fournisseur. Vérifiez l'**ID client OAuth**, le **Secret client OAuth**, l'**URL du jeton OAuth** et la **Portée OAuth**, que l'application a les autorisations ci-dessus et que le consentement administrateur a été accordé. Si SMTP AUTH est désactivé dans votre locataire Microsoft 365, réglez plutôt **Transport** sur `Microsoft Graph`.
:::

:::details "Microsoft Graph send failed"
Une configuration dont le **Transport** est `Microsoft Graph` affiche ce message quand Graph n'accepte pas l'e-mail, suivi de l'erreur de Microsoft. Vérifiez que l'application a l'autorisation d'application **Mail.Send** avec le consentement administrateur accordé, que la **Portée OAuth** est `https://graph.microsoft.com/.default` et que l'**E-mail de l'expéditeur** est une boîte aux lettres sous licence de votre locataire.
:::

:::details "SMTP server host … could not be reached"
OneUptime a refusé de se connecter au serveur de messagerie du projet. Sur OneUptime Cloud, un nom d'hôte qui ne se résout pas, ou qui se résout en une adresse privée, de bouclage ou lien-local, est refusé avec ce message, qui ne dit jamais lequel de ces cas s'applique : utilisez le nom d'hôte public du serveur de messagerie. Sur une installation auto-hébergée, et pour un serveur de messagerie indiqué par son adresse IP, le message donne la raison. **Envoyer un e-mail de test** ne l'affiche que pour une configuration OAuth ; pour les autres, retrouvez-le avec **Voir le message de statut** dans l'onglet **E-mail** des journaux de notification.
:::

:::details L'e-mail de test n'arrive pas
Vérifiez l'**E-mail de l'expéditeur** : votre serveur doit autoriser l'envoi depuis cette adresse. Regardez ensuite le dossier de spam du destinataire, et les journaux de votre serveur de messagerie pour cette tentative.
:::

## Bonnes pratiques de sécurité

- **Renouvelez régulièrement les secrets.** Programmez des rappels pour remplacer les secrets client avant leur expiration.
- **Utilisez des identifiants dédiés.** Créez des identifiants propres à OneUptime plutôt que de les partager avec d'autres applications.
- **Accordez le moindre privilège.** N'accordez que ce que l'envoi demande : **SMTP.SendAsApp** pour Microsoft, la portée `https://mail.google.com/` pour Google.
- **Surveillez l'utilisation.** Examinez les journaux d'e-mails et les connexions des applications OAuth pour repérer toute activité inhabituelle.
- **Stockez les secrets en lieu sûr.** Ne versionnez jamais de secrets client.

## Pour aller plus loin

- Microsoft : [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft : [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google : [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google : [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google : [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## Étapes suivantes

:::cards
- [Récapitulatif des notifications](/docs/emails/notification-rollup): Comment OneUptime regroupe les rafales d'e-mails envoyés aux propriétaires.
- [Abonnés et annonces](/docs/status-pages/subscribers): Envoyer les e-mails aux abonnés d'une page de statut par une configuration SMTP du projet.
:::
