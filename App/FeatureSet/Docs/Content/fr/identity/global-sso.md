# Global SSO (Authentification unique à l'échelle de l'instance)

Global SSO permet à un **administrateur d'instance** OneUptime (master admin) de configurer un seul fournisseur d'identité SAML 2.0 ou OpenID Connect (OIDC) **une seule fois au niveau de l'instance** et de le connecter à n'importe quel projet du serveur. Il s'agit de l'équivalent à l'échelle de l'instance du SSO par projet : au lieu que chaque propriétaire de projet configure son propre fournisseur d'identité, un master admin en met un en place qui peut servir l'ensemble de l'instance.

Global SSO est une fonctionnalité de **OneUptime Enterprise Edition** et n'est disponible que sur les instances exécutant la version Enterprise Edition.

## Global SSO vs. SSO de projet

|                          | SSO de projet                                                | Global SSO                                                     |
| ------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Configuré par            | Propriétaire/administrateur du projet (Paramètres du projet) | Master admin de l'instance (Admin Dashboard)                   |
| Portée                   | Un seul projet                                               | L'ensemble de l'instance — connectable à n'importe quel projet |
| Résultat de la connexion | Accès à ce seul projet                                       | Accès à tous les projets que l'utilisateur peut atteindre      |

## Configuration de Global SSO

1. **Ouvrir l'Admin Dashboard**

   - Connectez-vous en tant que master admin et ouvrez **Admin** > **Settings** > **Global SSO** (pour SAML) ou **Global OIDC** (pour OpenID Connect).

2. **Créer un fournisseur**

   - Cliquez sur **Create Global SSO**.
   - Pour SAML : saisissez un **Name**, le **Sign On URL** et l'**Issuer** de votre fournisseur d'identité, puis collez le **Public Certificate**. Choisissez les méthodes **Signature** et **Digest** (laissez les valeurs par défaut — `RSA-SHA256` / `SHA256` — si vous n'êtes pas sûr).
   - Pour OIDC : saisissez le **Discovery URL**, l'**Issuer**, le **Client ID**, le **Client Secret**, les **Scopes** (doivent inclure `openid`), ainsi que les noms de revendications **email** / **name**.

3. **Copier les URL OneUptime dans votre fournisseur d'identité**

   - Ouvrez le fournisseur (cliquez sur sa ligne dans la liste) pour afficher la carte **Identity Provider URLs**.
   - Pour SAML, copiez l'**ACS URL (Reply URL)** et l'**Issuer (Entity ID)** dans votre IdP (Okta, Azure AD, OneLogin, JumpCloud et plus encore).
   - Pour OIDC, copiez le **Redirect URI** dans la liste des redirections autorisées de votre IdP.

4. **Tester le fournisseur**
   - Utilisez le lien **Test this SSO provider** sur la page du fournisseur pour exécuter une connexion de bout en bout via votre fournisseur d'identité. Le fournisseur doit être **activé** pour que le lien fonctionne. Activer un fournisseur global ajoute uniquement une option « Sign in with SSO » sur la page de connexion — cela ne force jamais le SSO et ne verrouille personne, il est donc sans risque de l'activer, de le tester et de le désactiver à nouveau si nécessaire.

## Comment les utilisateurs se connectent

Le comportement d'un fournisseur global dépend de la présence ou non de projets qui lui sont attachés :

- **Aucun projet attaché (par défaut pour tous / invitation d'abord) :** Les utilisateurs peuvent se connecter avec le fournisseur et atteindre **tout projet dont ils sont déjà membres**. Les nouveaux utilisateurs ne sont **pas** créés automatiquement — un utilisateur doit d'abord être invité à un projet. Utilisez cette approche pour un SSO à l'échelle de l'entreprise où les adhésions sont gérées ailleurs.

- **Projets attachés (approvisionnement automatique) :** Ouvrez le fournisseur et utilisez le tableau **Attached Projects** pour attacher un ou plusieurs projets, chacun avec un ensemble d'équipes par défaut. Les utilisateurs qui se connectent sont **approvisionnés automatiquement** dans ces projets et ajoutés aux équipes par défaut lors de leur première connexion. Ajoutez un projet + des équipes à la fois pour construire la liste ; pour modifier un attachement, supprimez-le et ajoutez-le à nouveau.

Si vous souhaitez empêcher toute création automatique de compte même lorsque des projets sont attachés, activez **Disable Sign Up with SSO** sur le fournisseur — les utilisateurs doivent alors être invités avant de pouvoir se connecter.

## Imposer le SSO

Configurer un fournisseur global n'oblige personne à l'utiliser ; la connexion par mot de passe fonctionne toujours. Pour exiger le SSO, utilisez les contrôles **Require SSO for Login** :

- **Par projet :** un projet peut exiger le SSO, et éventuellement exiger un fournisseur _spécifique_ (de projet ou global).
- **À l'échelle de l'instance :** **Admin** > **Settings** > **Authentication** dispose d'un commutateur **Require SSO for Login** qui force le SSO pour chaque utilisateur de l'instance. Les master admins restent exemptés afin de ne pas pouvoir être verrouillés à l'extérieur.

## Connexes

- [SSO (SSO de projet)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
