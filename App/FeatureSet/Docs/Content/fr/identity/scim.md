# SCIM (Système de gestion des identités inter-domaines)

OneUptime prend en charge le protocole SCIM v2.0 pour le provisionnement et le déprovisionnement automatisés des utilisateurs. SCIM permet aux fournisseurs d'identité (IdP) comme Azure AD, Okta et d'autres systèmes d'identité d'entreprise de gérer automatiquement l'accès des utilisateurs aux projets OneUptime et aux pages de statut.

## Aperçu

L'intégration SCIM offre les avantages suivants :

- **Provisionnement automatisé des utilisateurs** : Création automatique des utilisateurs dans OneUptime lorsqu'ils sont affectés dans votre IdP
- **Déprovisionnement automatisé des utilisateurs** : Suppression automatique des utilisateurs dans OneUptime lorsqu'ils sont désaffectés dans votre IdP
- **Synchronisation des attributs utilisateur** : Maintien de la synchronisation des informations utilisateur entre votre IdP et OneUptime
- **Gestion centralisée des accès** : Gestion de l'accès OneUptime depuis votre système de gestion des identités existant

## SCIM pour les projets

Le SCIM de projet permet aux fournisseurs d'identité de gérer les membres d'équipe au sein des projets OneUptime.

### Configuration du SCIM de projet

1. **Accéder aux paramètres du projet**

   - Accédez à votre projet OneUptime
   - Naviguez vers **Paramètres du projet** > **Équipe** > **SCIM**

2. **Configurer les paramètres SCIM**

   - Activez **Provisionnement automatique des utilisateurs** pour ajouter automatiquement les utilisateurs lorsqu'ils sont affectés dans votre IdP
   - Activez **Déprovisionnement automatique des utilisateurs** pour supprimer automatiquement les utilisateurs lorsqu'ils sont désaffectés dans votre IdP
   - Sélectionnez les **Équipes par défaut** auxquelles les nouveaux utilisateurs doivent être ajoutés
   - Copiez l'**URL de base SCIM** et le **Jeton Bearer** pour la configuration de votre IdP

3. **Configurer votre fournisseur d'identité**
   - Utilisez l'URL de base SCIM : `https://oneuptime.com/scim/v2/{scimId}`
   - Configurez l'authentification par jeton Bearer avec le jeton fourni
   - Mappez les attributs utilisateur (l'e-mail est requis)

### Points de terminaison SCIM de projet

- **Configuration du fournisseur de services** : `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schémas** : `GET /scim/v2/{scimId}/Schemas`
- **Types de ressources** : `GET /scim/v2/{scimId}/ResourceTypes`
- **Lister les utilisateurs** : `GET /scim/v2/{scimId}/Users`
- **Obtenir un utilisateur** : `GET /scim/v2/{scimId}/Users/{userId}`
- **Créer un utilisateur** : `POST /scim/v2/{scimId}/Users`
- **Mettre à jour un utilisateur** : `PUT /scim/v2/{scimId}/Users/{userId}` ou `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Supprimer un utilisateur** : `DELETE /scim/v2/{scimId}/Users/{userId}`
- **Lister les groupes** : `GET /scim/v2/{scimId}/Groups`
- **Obtenir un groupe** : `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Créer un groupe** : `POST /scim/v2/{scimId}/Groups`
- **Mettre à jour un groupe** : `PUT /scim/v2/{scimId}/Groups/{groupId}` ou `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Supprimer un groupe** : `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Cycle de vie des utilisateurs SCIM de projet

1. **Affectation dans l'IdP** : Lorsqu'un utilisateur est affecté à OneUptime dans votre IdP
2. **Provisionnement SCIM** : L'IdP appelle l'API SCIM OneUptime pour créer l'utilisateur
3. **Appartenance à l'équipe** : L'utilisateur est automatiquement ajouté aux équipes par défaut configurées
4. **Accès accordé** : L'utilisateur peut désormais accéder au projet OneUptime
5. **Désaffectation** : Lorsque l'utilisateur est désaffecté dans l'IdP
6. **Déprovisionnement SCIM** : L'IdP appelle l'API SCIM OneUptime pour supprimer l'utilisateur
7. **Accès révoqué** : L'utilisateur perd l'accès au projet

## SCIM pour les pages de statut

Le SCIM de page de statut permet aux fournisseurs d'identité de gérer les abonnés aux pages de statut privées.

### Configuration du SCIM de page de statut

1. **Accéder aux paramètres de la page de statut**

   - Accédez à votre page de statut OneUptime
   - Naviguez vers **Paramètres de la page de statut** > **Utilisateurs privés** > **SCIM**

2. **Configurer les paramètres SCIM**

   - Activez **Provisionnement automatique des utilisateurs** pour ajouter automatiquement les abonnés lorsqu'ils sont affectés dans votre IdP
   - Activez **Déprovisionnement automatique des utilisateurs** pour supprimer automatiquement les abonnés lorsqu'ils sont désaffectés dans votre IdP
   - Copiez l'**URL de base SCIM** et le **Jeton Bearer** pour la configuration de votre IdP

3. **Configurer votre fournisseur d'identité**
   - Utilisez l'URL de base SCIM : `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - Configurez l'authentification par jeton Bearer avec le jeton fourni
   - Mappez les attributs utilisateur (l'e-mail est requis)

### Points de terminaison SCIM de page de statut

- **Configuration du fournisseur de services** : `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schémas** : `GET /status-page-scim/v2/{scimId}/Schemas`
- **Types de ressources** : `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **Lister les utilisateurs** : `GET /status-page-scim/v2/{scimId}/Users`
- **Obtenir un utilisateur** : `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Créer un utilisateur** : `POST /status-page-scim/v2/{scimId}/Users`
- **Mettre à jour un utilisateur** : `PUT /status-page-scim/v2/{scimId}/Users/{userId}` ou `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Supprimer un utilisateur** : `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Cycle de vie des utilisateurs SCIM de page de statut

1. **Affectation dans l'IdP** : Lorsqu'un utilisateur est affecté à la page de statut OneUptime dans votre IdP
2. **Provisionnement SCIM** : L'IdP appelle l'API SCIM OneUptime pour créer l'abonné
3. **Accès accordé** : L'utilisateur peut désormais accéder à la page de statut privée
4. **Désaffectation** : Lorsque l'utilisateur est désaffecté dans l'IdP
5. **Déprovisionnement SCIM** : L'IdP appelle l'API SCIM OneUptime pour supprimer l'abonné
6. **Accès révoqué** : L'utilisateur perd l'accès à la page de statut

## Configuration du fournisseur d'identité

### Microsoft Entra ID (anciennement Azure AD)

Microsoft Entra ID fournit une gestion des identités de niveau entreprise avec des capacités de provisionnement SCIM robustes. Suivez ces étapes détaillées pour configurer le provisionnement SCIM avec OneUptime.

#### Prérequis

- Locataire Microsoft Entra ID avec licence Premium P1 ou P2 (requis pour le provisionnement automatique)
- Compte OneUptime avec abonnement Scale ou supérieur
- Accès administrateur à Microsoft Entra ID et à OneUptime

#### Étape 1 : Obtenir la configuration SCIM depuis OneUptime

1. Connectez-vous à votre tableau de bord OneUptime
2. Naviguez vers **Paramètres du projet** > **Équipe** > **SCIM**
3. Cliquez sur **Créer une configuration SCIM**
4. Saisissez un nom convivial (par ex., « Provisionnement Microsoft Entra ID »)
5. Configurez les options suivantes :
   - **Provisionnement automatique des utilisateurs** : Activez pour créer automatiquement les utilisateurs
   - **Déprovisionnement automatique des utilisateurs** : Activez pour supprimer automatiquement les utilisateurs
   - **Équipes par défaut** : Sélectionnez les équipes auxquelles les nouveaux utilisateurs doivent être ajoutés
   - **Activer la synchronisation des groupes** : Activez si vous souhaitez gérer l'appartenance aux équipes via les groupes Entra ID
6. Enregistrez la configuration
7. Copiez l'**URL de base SCIM** et le **Jeton Bearer** — vous en aurez besoin pour Entra ID

#### Étape 2 : Créer une application d'entreprise dans Microsoft Entra ID

1. Connectez-vous au [Centre d'administration Microsoft Entra](https://entra.microsoft.com)
2. Naviguez vers **Identité** > **Applications** > **Applications d'entreprise**
3. Cliquez sur **+ Nouvelle application**
4. Cliquez sur **+ Créer votre propre application**
5. Saisissez un nom (par ex., « OneUptime »)
6. Sélectionnez **Intégrer toute autre application que vous ne trouvez pas dans la galerie (Non-galerie)**
7. Cliquez sur **Créer**

#### Étape 3 : Configurer le provisionnement SCIM

1. Dans votre application d'entreprise OneUptime, accédez à **Provisionnement**
2. Cliquez sur **Commencer**
3. Définissez le **Mode de provisionnement** sur **Automatique**
4. Sous **Informations d'identification administrateur** :
   - **URL du locataire** : Saisissez l'URL de base SCIM depuis OneUptime (par ex., `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Jeton secret** : Saisissez le Jeton Bearer depuis OneUptime
5. Cliquez sur **Tester la connexion** pour vérifier la configuration
6. Cliquez sur **Enregistrer**

#### Étape 4 : Configurer les mappages d'attributs

1. Dans la section Provisionnement, cliquez sur **Mappages**
2. Cliquez sur **Provisionner les utilisateurs Azure Active Directory**
3. Configurez les mappages d'attributs suivants :

| Attribut Azure AD                                             | Attribut SCIM OneUptime        | Requis     |
| ------------------------------------------------------------- | ------------------------------ | ---------- |
| `userPrincipalName`                                           | `userName`                     | Oui        |
| `mail`                                                        | `emails[type eq "work"].value` | Recommandé |
| `displayName`                                                 | `displayName`                  | Recommandé |
| `givenName`                                                   | `name.givenName`               | Facultatif |
| `surname`                                                     | `name.familyName`              | Facultatif |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active`                       | Recommandé |

4. Supprimez les mappages non nécessaires pour simplifier le provisionnement
5. Cliquez sur **Enregistrer**

#### Étape 5 : Configurer le provisionnement des groupes (facultatif)

Si vous avez activé la **Synchronisation des groupes** dans OneUptime :

1. Revenez à **Mappages**
2. Cliquez sur **Provisionner les groupes Azure Active Directory**
3. Activez le provisionnement des groupes en définissant **Activé** sur **Oui**
4. Configurez les mappages d'attributs suivants :

| Attribut Azure AD | Attribut SCIM OneUptime |
| ----------------- | ----------------------- |
| `displayName`     | `displayName`           |
| `members`         | `members`               |

5. Cliquez sur **Enregistrer**

#### Étape 6 : Affecter des utilisateurs et des groupes

1. Dans votre application d'entreprise OneUptime, accédez à **Utilisateurs et groupes**
2. Cliquez sur **+ Ajouter un utilisateur/groupe**
3. Sélectionnez les utilisateurs et/ou groupes à provisionner dans OneUptime
4. Cliquez sur **Affecter**

#### Étape 7 : Démarrer le provisionnement

1. Accédez à **Provisionnement** > **Vue d'ensemble**
2. Cliquez sur **Démarrer le provisionnement**
3. Le cycle de provisionnement initial commence (cela peut prendre jusqu'à 40 minutes pour la première synchronisation)
4. Surveillez les **Journaux de provisionnement** pour détecter les erreurs

#### Dépannage Microsoft Entra ID

- **Échec du test de connexion** : Vérifiez que l'URL de base SCIM inclut le préfixe `/api/identity` et que le Jeton Bearer est correct
- **Les utilisateurs ne sont pas provisionnés** : Vérifiez que les utilisateurs sont affectés à l'application et que les mappages d'attributs sont corrects
- **Erreurs de provisionnement** : Consultez les Journaux de provisionnement dans Entra ID pour les messages d'erreur spécifiques
- **Délais de synchronisation** : Le provisionnement initial peut prendre jusqu'à 40 minutes ; les synchronisations suivantes ont lieu toutes les 40 minutes

---

### Okta

Okta fournit une gestion des identités flexible avec un excellent support SCIM. Suivez ces étapes détaillées pour configurer le provisionnement SCIM avec OneUptime.

#### Prérequis

- Locataire Okta avec capacités de provisionnement (fonctionnalité de gestion du cycle de vie)
- Compte OneUptime avec abonnement Scale ou supérieur
- Accès administrateur à Okta et à OneUptime

#### Étape 1 : Obtenir la configuration SCIM depuis OneUptime

1. Connectez-vous à votre tableau de bord OneUptime
2. Naviguez vers **Paramètres du projet** > **Équipe** > **SCIM**
3. Cliquez sur **Créer une configuration SCIM**
4. Saisissez un nom convivial (par ex., « Provisionnement Okta »)
5. Configurez les options suivantes :
   - **Provisionnement automatique des utilisateurs** : Activez pour créer automatiquement les utilisateurs
   - **Déprovisionnement automatique des utilisateurs** : Activez pour supprimer automatiquement les utilisateurs
   - **Équipes par défaut** : Sélectionnez les équipes auxquelles les nouveaux utilisateurs doivent être ajoutés
   - **Activer la synchronisation des groupes** : Activez si vous souhaitez gérer l'appartenance aux équipes via les groupes Okta
6. Enregistrez la configuration
7. Copiez l'**URL de base SCIM** et le **Jeton Bearer** — vous en aurez besoin pour Okta

#### Étape 2 : Créer ou configurer l'application Okta

**Si vous avez une application SSO existante :**

1. Connectez-vous à votre Console d'administration Okta
2. Naviguez vers **Applications** > **Applications**
3. Recherchez et sélectionnez votre application OneUptime existante

**Si vous créez une nouvelle application :**

1. Connectez-vous à votre Console d'administration Okta
2. Naviguez vers **Applications** > **Applications**
3. Cliquez sur **Créer une intégration d'application**
4. Sélectionnez **SAML 2.0** et cliquez sur **Suivant**
5. Saisissez « OneUptime » comme nom d'application
6. Complétez la configuration SAML (référez-vous à la documentation SSO)
7. Cliquez sur **Terminer**

#### Étape 3 : Activer le provisionnement SCIM

1. Dans votre application OneUptime, accédez à l'onglet **Général**
2. Dans la section **Paramètres de l'application**, cliquez sur **Modifier**
3. Sous **Provisionnement**, sélectionnez **SCIM**
4. Cliquez sur **Enregistrer**
5. Un nouvel onglet **Provisionnement** apparaîtra

#### Étape 4 : Configurer la connexion SCIM

1. Accédez à l'onglet **Provisionnement**
2. Cliquez sur **Intégration** dans la barre latérale gauche
3. Cliquez sur **Configurer l'intégration API**
4. Cochez **Activer l'intégration API**
5. Configurez les éléments suivants :
   - **URL de base du connecteur SCIM** : Saisissez l'URL de base SCIM depuis OneUptime (par ex., `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Champ identifiant unique pour les utilisateurs** : Saisissez `userName`
   - **Actions de provisionnement prises en charge** : Sélectionnez les actions à activer
   - **Mode d'authentification** : Sélectionnez **En-tête HTTP**
   - **Autorisation** : Saisissez `Bearer {your-bearer-token}` (remplacez par le jeton réel)
6. Cliquez sur **Tester les informations d'identification API** pour vérifier la connexion
7. Cliquez sur **Enregistrer**

#### Étape 5 : Configurer le provisionnement vers l'application

1. Dans l'onglet **Provisionnement**, cliquez sur **Vers l'application** dans la barre latérale gauche
2. Cliquez sur **Modifier**
3. Activez les options suivantes :
   - **Créer des utilisateurs** : Activez pour provisionner de nouveaux utilisateurs
   - **Mettre à jour les attributs utilisateur** : Activez pour synchroniser les modifications d'attributs
   - **Désactiver les utilisateurs** : Activez pour déprovisionner les utilisateurs lorsqu'ils sont désaffectés
4. Cliquez sur **Enregistrer**

#### Étape 6 : Configurer les mappages d'attributs

1. Faites défiler jusqu'à **Mappages d'attributs**
2. Vérifiez ou configurez les mappages suivants :

| Attribut Okta      | Attribut SCIM OneUptime         | Direction             |
| ------------------ | ------------------------------- | --------------------- |
| `userName`         | `userName`                      | Okta vers application |
| `user.email`       | `emails[primary eq true].value` | Okta vers application |
| `user.firstName`   | `name.givenName`                | Okta vers application |
| `user.lastName`    | `name.familyName`               | Okta vers application |
| `user.displayName` | `displayName`                   | Okta vers application |

3. Supprimez les mappages inutiles
4. Cliquez sur **Enregistrer** si vous avez effectué des modifications

#### Étape 7 : Configurer la synchronisation des groupes (facultatif)

Si vous avez activé la **Synchronisation des groupes** dans OneUptime :

1. Accédez à l'onglet **Synchronisation des groupes**
2. Cliquez sur **+ Synchroniser des groupes**
3. Sélectionnez **Rechercher des groupes par nom** ou **Rechercher des groupes par règle**
4. Recherchez et sélectionnez les groupes à synchroniser
5. Cliquez sur **Enregistrer**

#### Étape 8 : Affecter des utilisateurs

1. Accédez à l'onglet **Affectations**
2. Cliquez sur **Affecter** > **Affecter à des personnes** ou **Affecter à des groupes**
3. Sélectionnez les utilisateurs ou groupes à provisionner
4. Cliquez sur **Affecter** pour chaque sélection
5. Cliquez sur **Terminé**

#### Étape 9 : Vérifier le provisionnement

1. Accédez à **Rapports** > **Journal système** dans la Console d'administration Okta
2. Filtrez les événements liés à votre application OneUptime
3. Vérifiez que les événements de provisionnement ont réussi
4. Vérifiez dans OneUptime que les utilisateurs ont été créés

#### Dépannage Okta

- **Échec du test des informations d'identification API** : Vérifiez que l'URL de base SCIM et le Jeton Bearer sont corrects
- **Les utilisateurs ne sont pas provisionnés** : Assurez-vous que les utilisateurs sont affectés à l'application et que le provisionnement est activé
- **Utilisateurs en double** : Assurez-vous que l'attribut `userName` est unique et correspond correctement à l'e-mail
- **Échecs de synchronisation des groupes** : Vérifiez que les groupes existent et ont la bonne appartenance
- **Erreur : 401 Unauthorized** : Régénérez le Jeton Bearer dans OneUptime et mettez-le à jour dans Okta

---

### Autres fournisseurs d'identité

L'implémentation SCIM de OneUptime suit la spécification SCIM v2.0 et devrait fonctionner avec tout fournisseur d'identité conforme. Étapes de configuration générales :

1. **URL de base SCIM** : `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (pour les projets) ou `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (pour les pages de statut)
2. **Authentification** : Jeton Bearer HTTP
3. **Attribut utilisateur requis** : `userName` (doit être une adresse e-mail valide)
4. **Opérations prises en charge** : GET, POST, PUT, PATCH, DELETE pour les utilisateurs et groupes

#### Points de terminaison SCIM pris en charge

| Point de terminaison     | Méthodes                | Description                                                     |
| ------------------------ | ----------------------- | --------------------------------------------------------------- |
| `/ServiceProviderConfig` | GET                     | Capacités du serveur SCIM                                       |
| `/Schemas`               | GET                     | Schémas de ressources disponibles                               |
| `/ResourceTypes`         | GET                     | Types de ressources disponibles                                 |
| `/Users`                 | GET, POST               | Lister et créer des utilisateurs                                |
| `/Users/{id}`            | GET, PUT, PATCH, DELETE | Gérer des utilisateurs individuels                              |
| `/Groups`                | GET, POST               | Lister et créer des groupes/équipes (SCIM de projet uniquement) |
| `/Groups/{id}`           | GET, PUT, PATCH, DELETE | Gérer des groupes individuels (SCIM de projet uniquement)       |

#### Schéma d'utilisateur SCIM

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "user@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    {
      "value": "user@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true
}
```

#### Schéma de groupe SCIM

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-id-here",
      "display": "user@example.com"
    }
  ]
}
```

## Questions fréquemment posées

### Que se passe-t-il lorsqu'un utilisateur est déprovisionné ?

Lorsqu'un utilisateur est déprovisionné (soit par une requête DELETE, soit en définissant `active: false`), il est supprimé des équipes configurées dans les paramètres SCIM. Le compte utilisateur reste dans OneUptime mais perd l'accès au projet.

### Puis-je utiliser SCIM sans SSO ?

Oui, SCIM et SSO sont des fonctionnalités indépendantes. Vous pouvez utiliser SCIM pour le provisionnement des utilisateurs tout en leur permettant de se connecter avec leurs mots de passe OneUptime ou toute autre méthode d'authentification.

### Comment gérer les utilisateurs qui existent déjà dans OneUptime ?

Lorsque SCIM tente de créer un utilisateur qui existe déjà (correspondance par e-mail), OneUptime les ajoutera simplement aux équipes par défaut configurées plutôt que de créer un utilisateur en double.

### Quelle est la différence entre les équipes par défaut et la synchronisation des groupes ?

- **Équipes par défaut** : Tous les utilisateurs provisionnés via SCIM sont ajoutés aux mêmes équipes prédéfinies
- **Synchronisation des groupes** : L'appartenance aux équipes est gérée par votre fournisseur d'identité, permettant à différents utilisateurs d'appartenir à différentes équipes selon l'appartenance aux groupes IdP

### À quelle fréquence la synchronisation du provisionnement se produit-elle ?

Cela dépend de votre fournisseur d'identité :

- **Microsoft Entra ID** : La synchronisation initiale peut prendre jusqu'à 40 minutes ; les synchronisations suivantes ont lieu toutes les 40 minutes
- **Okta** : Quasi temps réel pour la plupart des opérations, avec des synchronisations complètes périodiques
