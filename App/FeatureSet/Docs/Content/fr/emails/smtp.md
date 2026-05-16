# Configuration SMTP

OneUptime prend en charge l'envoi d'e-mails via des serveurs SMTP personnalisés avec trois méthodes d'authentification :

- **Nom d'utilisateur et mot de passe** — Authentification SMTP traditionnelle
- **OAuth 2.0** — Authentification moderne pour Microsoft 365 et Google Workspace
- **Aucune** — Pour les serveurs relais ne nécessitant pas d'authentification

Ce guide explique comment configurer l'authentification OAuth 2.0 pour Microsoft 365 et Google Workspace.

## Authentification OAuth 2.0

OAuth 2.0 offre un moyen plus sécurisé de s'authentifier auprès des serveurs de messagerie, en particulier pour les environnements d'entreprise ayant désactivé l'authentification de base. OneUptime prend en charge deux types d'octroi OAuth :

- **Informations d'identification du client** — Utilisé par Microsoft 365 et la plupart des fournisseurs OAuth
- **Jeton JWT Bearer** — Utilisé par les comptes de service Google Workspace

### Champs requis pour OAuth

Lors de la configuration de SMTP avec l'authentification OAuth dans OneUptime, vous aurez besoin de :

| Champ | Description |
|-------|-------------|
| **Nom d'hôte** | Adresse du serveur SMTP |
| **Port** | Port SMTP (généralement 587 pour STARTTLS ou 465 pour TLS implicite) |
| **Nom d'utilisateur** | L'adresse e-mail d'envoi |
| **Type d'authentification** | Sélectionnez « OAuth » |
| **Type de fournisseur OAuth** | Sélectionnez « Informations d'identification du client » pour Microsoft 365, ou « Jeton JWT Bearer » pour Google Workspace |
| **ID client** | ID Application/Client de votre fournisseur OAuth (pour Google : e-mail du compte de service) |
| **Secret client** | Secret client de votre fournisseur OAuth (pour Google : clé privée) |
| **URL du jeton** | URL du point de terminaison du jeton OAuth |
| **Portée** | Portée(s) OAuth requise(s) pour l'accès SMTP |

---

## Configuration Microsoft 365

Pour utiliser OAuth avec Microsoft 365/Exchange Online, vous devez enregistrer une application dans Microsoft Entra (Azure AD) et configurer les permissions appropriées.

### Étape 1 : Enregistrer une application dans Microsoft Entra

1. Connectez-vous au [Centre d'administration Microsoft Entra](https://entra.microsoft.com)
2. Accédez à **Identité** > **Applications** > **Inscriptions d'applications**
3. Cliquez sur **Nouvelle inscription**
4. Saisissez un nom pour votre application (par ex., « OneUptime SMTP »)
5. Pour **Types de comptes pris en charge**, sélectionnez « Comptes dans cet annuaire organisationnel uniquement »
6. Laissez l'**URI de redirection** vide (non nécessaire pour le flux d'informations d'identification du client)
7. Cliquez sur **Inscrire**

Après l'inscription, notez les valeurs suivantes depuis la page **Vue d'ensemble** :
- **ID d'application (client)** — Il s'agit de votre ID client
- **ID d'annuaire (locataire)** — Vous en aurez besoin pour l'URL du jeton

### Étape 2 : Créer un secret client

1. Dans votre inscription d'application, accédez à **Certificats et secrets**
2. Cliquez sur **Nouveau secret client**
3. Ajoutez une description et sélectionnez une période d'expiration
4. Cliquez sur **Ajouter**
5. **Copiez immédiatement la valeur du secret** — elle ne sera plus affichée

### Étape 3 : Ajouter des permissions API SMTP

1. Accédez à **Autorisations d'API**
2. Cliquez sur **Ajouter une autorisation**
3. Sélectionnez **API utilisées par mon organisation**
4. Recherchez et sélectionnez **Office 365 Exchange Online**
5. Sélectionnez **Autorisations d'application**
6. Recherchez et cochez **SMTP.SendAsApp**
7. Cliquez sur **Ajouter des autorisations**
8. Cliquez sur **Accorder le consentement administrateur pour [votre organisation]** (nécessite des privilèges d'administrateur)

### Étape 4 : Enregistrer le principal de service dans Exchange Online

Avant que votre application puisse envoyer des e-mails, vous devez enregistrer le principal de service dans Exchange Online et accorder des permissions de boîte aux lettres.

1. Installez le module PowerShell Exchange Online :

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Connectez-vous à Exchange Online :

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Enregistrez le principal de service (utilisez l'ID d'objet depuis **Applications d'entreprise**, pas les Inscriptions d'applications) :

```powershell
# Trouvez l'ID d'objet dans Microsoft Entra > Applications d'entreprise > Votre app > ID d'objet
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Accordez au principal de service la permission d'envoyer en tant que boîte aux lettres spécifique :

```powershell
# Accorder un accès complet à la boîte aux lettres au principal de service
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **Remarque :** Utilisez `Add-MailboxPermission` (et non `Add-RecipientPermission`). `Add-RecipientPermission` n'accorde que `SendAs` sur le destinataire et n'est pas suffisant pour que le principal de service envoie des e-mails via SMTP avec OAuth — vous obtiendrez une erreur d'authentification/permission lors de l'envoi. `Add-MailboxPermission` avec `FullAccess` est la commande qui fonctionne réellement.

### Étape 5 : Configurer dans OneUptime

Dans OneUptime, créez ou modifiez une configuration SMTP avec ces paramètres :

| Champ | Valeur |
|-------|-------|
| Nom d'hôte | `smtp.office365.com` |
| Port | `587` |
| Nom d'utilisateur | L'adresse e-mail pour laquelle vous avez accordé des permissions (par ex., `sender@yourdomain.com`) |
| Type d'authentification | `OAuth` |
| Type de fournisseur OAuth | `Informations d'identification du client` |
| ID client | Votre ID d'application (client) de l'étape 1 |
| Secret client | La valeur du secret de l'étape 2 |
| URL du jeton | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Portée | `https://outlook.office365.com/.default` |
| E-mail d'envoi | Identique au nom d'utilisateur |
| Sécurisé (TLS) | Activé |

Remplacez `<tenant-id>` par votre ID d'annuaire (locataire) de l'étape 1.

---

## Configuration Google Workspace

Google Workspace nécessite un **compte de service** avec délégation à l'échelle du domaine pour envoyer des e-mails au nom des utilisateurs. Cela est nécessaire car les serveurs SMTP de Google ne prennent pas en charge le flux direct des informations d'identification du client OAuth pour Gmail.

### Prérequis

- Compte Google Workspace (pas Gmail ordinaire — les comptes Gmail grand public ne prennent pas en charge cela)
- Accès Super Administrateur à la Console d'administration Google Workspace
- Accès à Google Cloud Console

### Étape 1 : Créer un projet Google Cloud

1. Accédez à la [Google Cloud Console](https://console.cloud.google.com)
2. Cliquez sur le menu déroulant du projet et sélectionnez **Nouveau projet**
3. Saisissez un nom de projet et cliquez sur **Créer**
4. Sélectionnez votre nouveau projet

### Étape 2 : Activer l'API Gmail

1. Accédez à **API et services** > **Bibliothèque**
2. Recherchez « API Gmail »
3. Cliquez sur **API Gmail** puis sur **Activer**

### Étape 3 : Créer un compte de service

1. Accédez à **API et services** > **Identifiants**
2. Cliquez sur **Créer des identifiants** > **Compte de service**
3. Saisissez un nom et une description pour le compte de service
4. Cliquez sur **Créer et continuer**
5. Ignorez les étapes facultatives et cliquez sur **Terminer**

### Étape 4 : Créer des clés de compte de service

1. Cliquez sur le compte de service que vous venez de créer
2. Accédez à l'onglet **Clés**
3. Cliquez sur **Ajouter une clé** > **Créer une nouvelle clé**
4. Sélectionnez **JSON** et cliquez sur **Créer**
5. Sauvegardez le fichier JSON téléchargé en lieu sûr — il contient :
   - `client_id` — Votre ID client
   - `private_key` — Votre secret client (la clé privée)

### Étape 5 : Activer la délégation à l'échelle du domaine

1. Dans les détails du compte de service, cliquez sur **Afficher les paramètres avancés**
2. Notez l'**ID client** (identifiant numérique)
3. Cochez **Activer la délégation à l'échelle du domaine Google Workspace**
4. Cliquez sur **Enregistrer**

### Étape 6 : Autoriser le compte de service dans la Console d'administration Google Workspace

1. Connectez-vous à la [Console d'administration Google Workspace](https://admin.google.com)
2. Accédez à **Sécurité** > **Contrôle d'accès et de données** > **Contrôles API**
3. Cliquez sur **Gérer la délégation à l'échelle du domaine**
4. Cliquez sur **Ajouter nouveau**
5. Saisissez l'**ID client** de l'étape 5
6. Pour les **Portées OAuth**, saisissez : `https://mail.google.com/`
7. Cliquez sur **Autoriser**

Remarque : La propagation de la délégation peut prendre quelques minutes à 24 heures.

### Étape 7 : Configurer dans OneUptime

Dans OneUptime, créez ou modifiez une configuration SMTP avec ces paramètres :

| Champ | Valeur |
|-------|-------|
| Nom d'hôte | `smtp.gmail.com` |
| Port | `587` |
| Nom d'utilisateur | L'adresse e-mail Google Workspace d'envoi (par ex., `notifications@yourdomain.com`). Cet utilisateur sera usurpé par le compte de service. |
| Type d'authentification | `OAuth` |
| Type de fournisseur OAuth | `Jeton JWT Bearer` |
| ID client | L'`client_email` de votre JSON de compte de service (par ex., `your-service@your-project.iam.gserviceaccount.com`) |
| Secret client | La `private_key` de votre JSON de compte de service (la clé entière incluant `-----BEGIN PRIVATE KEY-----` et `-----END PRIVATE KEY-----`) |
| URL du jeton | `https://oauth2.googleapis.com/token` |
| Portée | `https://mail.google.com/` |
| E-mail d'envoi | Identique au nom d'utilisateur |
| Sécurisé (TLS) | Activé |

**Important :** Pour Google (Jeton JWT Bearer), l'ID client est l'**e-mail du compte de service** (`client_email`), PAS le `client_id` numérique. Le compte de service usurpera l'identité de l'utilisateur spécifié dans le champ Nom d'utilisateur pour envoyer des e-mails.

---

## Dépannage

### Microsoft 365

| Problème | Solution |
|----------|----------|
| « Authentication unsuccessful » | Vérifiez que le principal de service est enregistré dans Exchange et dispose des permissions sur la boîte aux lettres |
| « AADSTS700016: Application not found » | Vérifiez que l'ID client est correct et que l'application existe dans votre locataire |
| « AADSTS7000215: Invalid client secret » | Régénérez le secret client — il peut avoir expiré |
| « The mailbox is not enabled for this operation » | Exécutez `Add-MailboxPermission` pour accorder l'accès à la boîte aux lettres |

### Google Workspace

| Problème | Solution |
|----------|----------|
| « invalid_grant » | Assurez-vous que la délégation à l'échelle du domaine est correctement configurée et propagée |
| « unauthorized_client » | Vérifiez que l'ID client est autorisé dans la Console d'administration Google Workspace |
| « access_denied » | Vérifiez que la portée `https://mail.google.com/` est autorisée |
| « Domain policy has disabled third-party Drive apps » | Activez l'accès API dans Administration Google Workspace > Sécurité > Contrôles API |

### Général

- **Testez votre configuration** : Utilisez le bouton « Envoyer un e-mail de test » dans OneUptime pour vérifier votre configuration
- **Vérifiez les journaux** : Consultez les journaux OneUptime pour les messages d'erreur détaillés
- **Mise en cache des jetons** : OneUptime met en cache les jetons OAuth et les actualise automatiquement avant leur expiration

---

## Bonnes pratiques de sécurité

1. **Renouvelez régulièrement les secrets** : Définissez des rappels pour renouveler les secrets client avant leur expiration
2. **Utilisez des comptes de service dédiés** : Créez des identifiants séparés pour OneUptime plutôt que de les partager avec d'autres applications
3. **Principe du moindre privilège** : N'accordez que les permissions minimales nécessaires (SMTP.SendAsApp pour Microsoft, portée mail.google.com pour Google)
4. **Surveillez l'utilisation** : Consultez les journaux d'e-mails et les connexions d'applications OAuth pour détecter toute activité inhabituelle
5. **Stockage sécurisé** : Ne committez jamais les secrets client dans le contrôle de version

---

## Ressources supplémentaires

### Microsoft 365
- [Authentifier une connexion IMAP, POP ou SMTP à l'aide d'OAuth](https://learn.microsoft.com/fr-fr/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Inscrire une application avec la plateforme d'identité Microsoft](https://learn.microsoft.com/fr-fr/azure/active-directory/develop/quickstart-register-app)

### Google Workspace
- [Utilisation d'OAuth 2.0 pour les applications serveur à serveur](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Documentation de l'API Gmail](https://developers.google.com/gmail/api)
- [Protocole XOAUTH2](https://developers.google.com/gmail/imap/xoauth2-protocol)
