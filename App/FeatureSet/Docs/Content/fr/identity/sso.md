# SSO (Authentification unique)

OneUptime prend en charge l'authentification unique (SSO) basée sur SAML 2.0 pour l'authentification d'entreprise. Le SSO permet à vos membres d'équipe de se connecter à OneUptime en utilisant le fournisseur d'identité (IdP) de votre organisation, offrant une gestion centralisée des accès et une sécurité renforcée.

## Aperçu

L'intégration SSO offre les avantages suivants :

- **Authentification centralisée** : Les utilisateurs se connectent avec leurs identifiants d'entreprise existants
- **Sécurité renforcée** : Exploitez l'authentification multifacteur et les politiques de sécurité de votre IdP
- **Gestion des utilisateurs simplifiée** : Gérez les accès depuis votre système de gestion des identités existant
- **Réduction de la fatigue des mots de passe** : Les utilisateurs n'ont pas besoin de mémoriser un mot de passe OneUptime séparé

## Configuration du SSO

1. **Accéder aux paramètres du projet**

   - Accédez à votre projet OneUptime
   - Naviguez vers **Paramètres du projet** > **Authentification** > **SSO**

2. **Créer une configuration SSO**

   - Cliquez sur **Créer SSO**
   - Saisissez un **Nom** pour la configuration SSO (par ex., « Keycloak SAML » ou « Okta SAML »)
   - Saisissez l'**URL d'ouverture de session** de votre fournisseur d'identité
   - Saisissez l'**Émetteur** (Entity ID) de votre fournisseur d'identité
   - Collez le **Certificat public** de votre fournisseur d'identité
   - Sélectionnez l'**Algorithme de signature** (par ex., `RSA-SHA-256`)
   - Sélectionnez l'**Algorithme de hachage** (par ex., `SHA256`)

3. **Obtenir les métadonnées SSO OneUptime**
   - Après l'enregistrement, cliquez sur le bouton **Afficher la configuration SSO**
   - Copiez l'**Identifiant (Entity ID)** — cela est nécessaire dans la configuration de votre IdP
   - Copiez l'**URL de réponse (URL du service consommateur d'assertion)** — cela est nécessaire dans la configuration de votre IdP

## Configuration SAML Keycloak

Keycloak est une solution populaire de gestion des identités et des accès en open source. Suivez ces étapes pour configurer Keycloak comme fournisseur d'identité SAML pour OneUptime.

### Prérequis

- Une instance Keycloak en cours d'exécution avec un domaine configuré
- Accès administrateur à Keycloak et à OneUptime
- Compte OneUptime avec prise en charge SSO

### Étape 1 : Configurer le SSO OneUptime

1. Connectez-vous à votre tableau de bord OneUptime
2. Naviguez vers **Paramètres du projet** > **Authentification** > **SSO**
3. Cliquez sur **Créer SSO** et remplissez les champs suivants :
   - **Nom** : Un nom descriptif (par ex., `my-project-oneuptime`)
   - **URL d'ouverture de session** : `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Émetteur** : `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certificat** : Voir [Étape 2](#étape-2-obtenir-le-certificat-keycloak) ci-dessous
   - **Algorithme de signature** : `RSA-SHA-256`
   - **Algorithme de hachage** : `SHA256`
4. Enregistrez la configuration

### Étape 2 : Obtenir le certificat Keycloak

1. Dans Keycloak, naviguez vers la configuration de votre client
2. Cliquez sur **Exporter** (ou accédez à l'onglet **Clés** selon votre version de Keycloak)
3. Dans le fichier JSON exporté, trouvez la clé avec `certificate` dans le nom
4. Copiez la valeur du certificat et collez-la dans OneUptime au format suivant :

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### Étape 3 : Configurer le client Keycloak

1. Dans Keycloak, naviguez vers **Clients** dans votre domaine
2. Créez un nouveau client ou modifiez un existant
3. Définissez le **Protocole client** sur `saml`
4. Définissez l'**ID client** sur la valeur de l'**Identifiant (Entity ID)** depuis la **Vue de la configuration SSO** de OneUptime
5. Définissez les **URI de redirection valides** vers votre URL OneUptime
6. Définissez l'**URL racine** vers l'URL de base de OneUptime
7. Collez l'**URL de réponse (URL du service consommateur d'assertion)** de OneUptime dans le champ **URL de liaison POST du service consommateur d'assertion**

### Étape 4 : Configurer les paramètres du client Keycloak

1. Désactivez la **Configuration des clés de signature** (sous l'onglet Clés)
2. Définissez le **Format d'ID de nom** sur `email`
3. Assurez-vous que l'option **Forcer le format d'ID de nom** est activée pour que Keycloak envoie toujours l'e-mail comme ID de nom

### Étape 5 : Vérifier la configuration

1. Enregistrez tous les paramètres dans Keycloak et OneUptime
2. Essayez de vous connecter à OneUptime via SSO
3. Vous devriez être redirigé vers votre page de connexion Keycloak puis vers OneUptime après une authentification réussie

### Dépannage Keycloak

- **Échec de connexion avec une erreur de signature** : Assurez-vous que le certificat est correctement copié, y compris les lignes `BEGIN CERTIFICATE` et `END CERTIFICATE`
- **Erreur d'ID de nom** : Vérifiez que le **Format d'ID de nom** est défini sur `email` dans Keycloak
- **Boucle de redirection** : Vérifiez que les **URI de redirection valides** et l'**URL de liaison POST du service consommateur d'assertion** sont correctement configurés
- **Certificat introuvable** : Assurez-vous d'exporter depuis le bon client dans le bon domaine

---

## Configuration SAML Microsoft Entra ID (anciennement Azure AD / Active Directory)

Microsoft Entra ID est le service de gestion des identités et des accès basé sur le cloud de Microsoft. Suivez ces étapes pour configurer Entra ID comme fournisseur d'identité SAML pour OneUptime.

### Prérequis

- Locataire Microsoft Entra ID (tout niveau prenant en charge les applications d'entreprise avec SSO SAML)
- Accès administrateur à Microsoft Entra ID et à OneUptime
- Compte OneUptime avec prise en charge SSO

### Étape 1 : Configurer le SSO OneUptime

1. Connectez-vous à votre tableau de bord OneUptime
2. Naviguez vers **Paramètres du projet** > **Authentification** > **SSO**
3. Cliquez sur **Créer SSO** et remplissez les champs suivants :
   - **Nom** : Un nom descriptif (par ex., `Azure AD SAML`)
   - **URL d'ouverture de session** : Vous l'obtiendrez depuis Entra ID à l'étape 3
   - **Émetteur** : Vous l'obtiendrez depuis Entra ID à l'étape 3
   - **Certificat** : Vous l'obtiendrez depuis Entra ID à l'étape 3
   - **Algorithme de signature** : `RSA-SHA-256`
   - **Algorithme de hachage** : `SHA256`
4. Cliquez sur **Afficher la configuration SSO** et copiez l'**Identifiant (Entity ID)** et l'**URL de réponse (URL du service consommateur d'assertion)** — vous en aurez besoin pour Entra ID

### Étape 2 : Créer une application d'entreprise dans Microsoft Entra ID

1. Connectez-vous au [Centre d'administration Microsoft Entra](https://entra.microsoft.com)
2. Naviguez vers **Identité** > **Applications** > **Applications d'entreprise**
3. Cliquez sur **+ Nouvelle application**
4. Cliquez sur **+ Créer votre propre application**
5. Saisissez un nom (par ex., « OneUptime »)
6. Sélectionnez **Intégrer toute autre application que vous ne trouvez pas dans la galerie (Non-galerie)**
7. Cliquez sur **Créer**

### Étape 3 : Configurer le SSO SAML dans Entra ID

1. Dans votre nouvelle application d'entreprise, accédez à **Authentification unique**
2. Sélectionnez **SAML** comme méthode d'authentification unique
3. Dans la **Configuration SAML de base**, cliquez sur **Modifier** et définissez :
   - **Identifiant (Entity ID)** : Collez l'**Identifiant (Entity ID)** depuis la **Vue de la configuration SSO** de OneUptime
   - **URL de réponse (URL du service consommateur d'assertion)** : Collez l'**URL de réponse** depuis la **Vue de la configuration SSO** de OneUptime
4. Cliquez sur **Enregistrer**
5. Dans la section **Certificats SAML** :
   - Téléchargez le **Certificat (Base64)**
   - Ouvrez le fichier de certificat téléchargé dans un éditeur de texte et copiez le contenu
6. Dans la section **Configurer OneUptime**, copiez :
   - **URL de connexion** — collez-la comme **URL d'ouverture de session** dans OneUptime
   - **Identifiant Azure AD** — collez-le comme **Émetteur** dans OneUptime
7. Retournez dans OneUptime et collez le certificat et les URL, puis enregistrez

### Étape 4 : Configurer les attributs et les revendications utilisateur

1. Dans la page de configuration SAML, cliquez sur **Modifier** sur **Attributs et revendications**
2. Assurez-vous que les revendications suivantes sont configurées :

| Nom de la revendication                                              | Valeur                                  |
| -------------------------------------------------------------------- | --------------------------------------- |
| `Unique User Identifier (Name ID)`                                   | `user.userprincipalname` ou `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail`                             |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`    | `user.givenname`                        |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`      | `user.surname`                          |

3. Définissez le **Format d'identifiant de nom** sur `Adresse e-mail`
4. Cliquez sur **Enregistrer**

### Étape 5 : Affecter des utilisateurs et des groupes

1. Dans votre application d'entreprise, accédez à **Utilisateurs et groupes**
2. Cliquez sur **+ Ajouter un utilisateur/groupe**
3. Sélectionnez les utilisateurs et/ou groupes auxquels accorder l'accès SSO
4. Cliquez sur **Affecter**

### Étape 6 : Vérifier la configuration

1. Enregistrez tous les paramètres dans Entra ID et OneUptime
2. Essayez de vous connecter à OneUptime via SSO
3. Vous devriez être redirigé vers la page de connexion Microsoft puis vers OneUptime après une authentification réussie

### Dépannage Microsoft Entra ID

- **Erreur AADSTS700016** : L'Identifiant (Entity ID) dans Entra ID ne correspond pas à OneUptime — vérifiez que les deux valeurs sont identiques
- **Erreur de certificat** : Assurez-vous d'avoir téléchargé le certificat **Base64** (pas le format brut/binaire) et d'avoir inclus les lignes `BEGIN CERTIFICATE` / `END CERTIFICATE`
- **Utilisateur non affecté** : Les utilisateurs doivent être explicitement affectés à l'application d'entreprise avant de pouvoir se connecter via SSO
- **Incompatibilité d'ID de nom** : Assurez-vous que la revendication d'ID de nom est définie sur une adresse e-mail correspondant à l'e-mail de l'utilisateur dans OneUptime

---

## Configuration SAML Okta

Okta est une plateforme d'identité largement utilisée qui offre des capacités SSO SAML robustes. Suivez ces étapes pour configurer Okta comme fournisseur d'identité SAML pour OneUptime.

### Prérequis

- Organisation Okta avec accès administrateur
- Compte OneUptime avec prise en charge SSO

### Étape 1 : Configurer le SSO OneUptime

1. Connectez-vous à votre tableau de bord OneUptime
2. Naviguez vers **Paramètres du projet** > **Authentification** > **SSO**
3. Cliquez sur **Créer SSO** et remplissez les champs suivants :
   - **Nom** : Un nom descriptif (par ex., `Okta SAML`)
   - **URL d'ouverture de session** : Vous l'obtiendrez depuis Okta à l'étape 3
   - **Émetteur** : Vous l'obtiendrez depuis Okta à l'étape 3
   - **Certificat** : Vous l'obtiendrez depuis Okta à l'étape 3
   - **Algorithme de signature** : `RSA-SHA-256`
   - **Algorithme de hachage** : `SHA256`
4. Cliquez sur **Afficher la configuration SSO** et copiez l'**Identifiant (Entity ID)** et l'**URL de réponse (URL du service consommateur d'assertion)** — vous en aurez besoin pour Okta

### Étape 2 : Créer une application SAML dans Okta

1. Connectez-vous à votre Console d'administration Okta
2. Naviguez vers **Applications** > **Applications**
3. Cliquez sur **Créer une intégration d'application**
4. Sélectionnez **SAML 2.0** et cliquez sur **Suivant**
5. Saisissez « OneUptime » comme **Nom de l'application** et cliquez sur **Suivant**
6. Dans la section **Paramètres SAML**, configurez :
   - **URL d'authentification unique** : Collez l'**URL de réponse (URL du service consommateur d'assertion)** depuis la **Vue de la configuration SSO** de OneUptime
   - **URI d'audience (SP Entity ID)** : Collez l'**Identifiant (Entity ID)** depuis la **Vue de la configuration SSO** de OneUptime
   - **Format d'ID de nom** : Sélectionnez `EmailAddress`
   - **Nom d'utilisateur de l'application** : Sélectionnez `E-mail`
7. Cliquez sur **Suivant**, puis sélectionnez **Je suis un client Okta ajoutant une application interne** et cliquez sur **Terminer**

### Étape 3 : Copier les métadonnées SAML Okta vers OneUptime

1. Dans votre application Okta, accédez à l'onglet **Connexion**
2. Dans la section **Certificats de signature SAML**, trouvez le certificat actif et cliquez sur **Actions** > **Afficher les métadonnées IdP**
3. Depuis le XML des métadonnées ou les détails de l'onglet **Connexion** :
   - Copiez l'**URL d'ouverture de session** (aussi appelée **URL d'authentification unique du fournisseur d'identité**) — collez-la comme **URL d'ouverture de session** dans OneUptime
   - Copiez l'**Émetteur** (aussi appelé **Émetteur du fournisseur d'identité**) — collez-le comme **Émetteur** dans OneUptime
4. Téléchargez le certificat de signature :
   - Dans la section **Certificats de signature SAML**, cliquez sur **Actions** > **Télécharger le certificat** pour le certificat actif
   - Ouvrez le fichier `.cert` téléchargé dans un éditeur de texte et copiez le contenu
   - Collez le certificat dans OneUptime (y compris les lignes `BEGIN CERTIFICATE` et `END CERTIFICATE`)
5. Enregistrez la configuration SSO OneUptime

### Étape 4 : Configurer les déclarations d'attributs (facultatif)

1. Dans l'application Okta, accédez à l'onglet **Général**
2. Cliquez sur **Modifier** dans la section **Paramètres SAML** et cliquez sur **Suivant** pour accéder aux paramètres SAML
3. Dans la section **Déclarations d'attributs**, ajoutez :

| Nom         | Valeur           |
| ----------- | ---------------- |
| `email`     | `user.email`     |
| `firstName` | `user.firstName` |
| `lastName`  | `user.lastName`  |

4. Cliquez sur **Suivant** puis sur **Terminer**

### Étape 5 : Affecter des utilisateurs et des groupes

1. Dans votre application Okta, accédez à l'onglet **Affectations**
2. Cliquez sur **Affecter** > **Affecter à des personnes** ou **Affecter à des groupes**
3. Sélectionnez les utilisateurs ou groupes auxquels accorder l'accès SSO
4. Cliquez sur **Affecter** pour chaque sélection, puis cliquez sur **Terminé**

### Étape 6 : Vérifier la configuration

1. Enregistrez tous les paramètres dans Okta et OneUptime
2. Essayez de vous connecter à OneUptime via SSO
3. Vous devriez être redirigé vers la page de connexion Okta puis vers OneUptime après une authentification réussie

### Dépannage Okta

- **404 ou URL SSO invalide** : Vérifiez que l'**URL d'authentification unique** dans Okta correspond exactement à l'**URL de réponse** de OneUptime
- **Incompatibilité d'audience** : Assurez-vous que l'**URI d'audience** dans Okta correspond exactement à l'**Identifiant (Entity ID)** de OneUptime
- **Erreur de certificat** : Assurez-vous d'avoir téléchargé le certificat du certificat de signature **actif**, pas un inactif
- **Utilisateur non affecté** : Les utilisateurs doivent être affectés à l'application Okta avant de pouvoir se connecter via SSO
- **Erreur d'ID de nom** : Vérifiez que le **Format d'ID de nom** est défini sur `EmailAddress` et que le **Nom d'utilisateur de l'application** est défini sur `E-mail`

---

## Autres fournisseurs d'identité

L'implémentation SSO de OneUptime utilise le protocole SAML 2.0 et devrait fonctionner avec tout fournisseur d'identité conforme. Les étapes de configuration générales sont :

1. Dans OneUptime, créez une configuration SSO et notez l'**Identifiant (Entity ID)** et l'**URL de réponse (URL du service consommateur d'assertion)** depuis le bouton **Afficher la configuration SSO**
2. Dans votre fournisseur d'identité, créez une application SAML en utilisant :
   - **URL du service consommateur d'assertion / URL de réponse** : Depuis la configuration SSO de OneUptime
   - **Entity ID / URI d'audience** : Depuis la configuration SSO de OneUptime
   - **Format d'ID de nom** : Adresse e-mail
3. Depuis votre fournisseur d'identité, copiez les éléments suivants dans OneUptime :
   - **URL d'ouverture de session** (point de terminaison SSO)
   - **Émetteur** (Entity ID de l'IdP)
   - **Certificat public** (certificat de signature X.509)
4. Définissez l'**Algorithme de signature** sur `RSA-SHA-256` et l'**Algorithme de hachage** sur `SHA256`

## Notes sur SSO et les rôles

OneUptime ne prend actuellement pas en charge le mappage des rôles SAML depuis votre fournisseur d'identité. L'accès basé sur les rôles doit être configuré séparément dans les **Paramètres du projet** > **SSO** de OneUptime, où vous pouvez attribuer des rôles par défaut pour les utilisateurs SSO.
