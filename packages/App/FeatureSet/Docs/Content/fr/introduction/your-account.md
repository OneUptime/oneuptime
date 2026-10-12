# Votre compte

Votre compte est ce par quoi OneUptime vous connaît : l'adresse e-mail et le mot de passe avec lesquels vous vous connectez, votre nom et votre fuseau horaire, et ce qui protège votre connexion. Un compte peut appartenir à de nombreux projets, et ces paramètres vous suivent dans chacun d'eux. La façon dont OneUptime vous joint, et le moment où il vous alerte, se règlent dans chaque projet, sous **Paramètres utilisateur**.

```mermaid title="Ce qui appartient à votre compte, et ce que chaque projet garde pour vous"
flowchart TB
    account["Votre compte :<br/>connexion et profil"] --> projectA["Projet A"]
    account --> projectB["Projet B"]
    projectA --> settingsA["Paramètres utilisateur dans A :<br/>comment vous êtes alerté"]
    projectB --> settingsB["Paramètres utilisateur dans B :<br/>comment vous êtes alerté"]
```

:::cards
- [Votre profil](#votre-profil): Votre nom, votre adresse e-mail, votre fuseau horaire et votre photo.
- [Se connecter en sécurité](#se-connecter-en-sécurité): Votre mot de passe, vos clés d'accès et l'authentification à deux facteurs.
- [Vos projets](#vos-projets): Changer de projet, en créer un et accepter des invitations.
- [Paramètres utilisateur](#ce-que-chaque-projet-garde-pour-vous): Comment OneUptime vous joint dans chaque projet.
:::

## Le menu utilisateur

Cliquez sur votre photo en haut à droite du tableau de bord.

| Élément | Ce qu'il fait |
| --- | --- |
| **Profil** | Ouvre **Profil utilisateur** : votre nom, votre adresse e-mail, votre fuseau horaire, votre photo et la sécurité de votre connexion. |
| **Paramètres admin** | Ouvre l'Admin Dashboard. Seuls les administrateurs principaux d'une installation auto-hébergée le voient. |
| **Thème sombre** | Passe le tableau de bord en thème sombre. En thème sombre, l'élément s'appelle **Thème clair**. |
| **Se déconnecter** | Vous déconnecte. |

**Profil utilisateur** a son propre menu latéral. **Basique** contient **Vue d'ensemble** et **Photo de profil**. **Sécurité** et **Zone de danger** sont repliées : cliquez sur le titre d'une section pour l'ouvrir.

## Votre profil

:::steps
### Ouvrir votre profil

Cliquez sur votre photo en haut à droite et choisissez **Profil**. La page **Vue d'ensemble** s'ouvre sur la carte **Informations de base** : votre nom, votre adresse e-mail et votre fuseau horaire.

### Modifier vos informations

Cliquez sur **Modifier : Utilisateur** et changez ce dont vous avez besoin :

- **E-mail** : l'adresse avec laquelle vous vous connectez. Si vous la changez, vous vérifiez à nouveau la nouvelle adresse.
- **Nom complet** : le nom que votre équipe voit partout dans OneUptime.
- **Fuseau horaire** : le fuseau dans lequel le tableau de bord affiche et lit les heures, et celui des heures indiquées dans les notifications qui vous sont envoyées.

Cliquez sur **Enregistrer les modifications**.

### Ajouter une photo

Choisissez **Photo de profil**, cliquez sur **Update Profile Picture** et téléversez une image. Elle apparaît dans votre menu utilisateur, et à côté de votre nom dans les listes de personnes.
:::

> [!NOTE]
> La première fois que vous vous connectez dans un navigateur, OneUptime enregistre le fuseau horaire de ce navigateur dans votre profil. Si vous vous connectez plus tard là où le navigateur a un fuseau différent, le tableau de bord vous propose de **Mettre à jour le fuseau horaire**. Fermez la question, et il ne la reposera pas pour ce fuseau.

## Se connecter en sécurité

Dépliez **Sécurité** dans le menu latéral de **Profil utilisateur**. La section compte trois pages.

| Page | À quoi elle sert |
| --- | --- |
| **Gestion des mots de passe** | Définir un nouveau mot de passe. |
| **Passkeys** | Se connecter sans mot de passe, avec votre empreinte digitale, votre visage, le verrouillage de votre écran ou une clé de sécurité. |
| **Two-factor authentication** | Demander une deuxième étape après votre mot de passe : un code issu d'une application, ou une clé de sécurité. |

### Changer votre mot de passe

:::steps
1. Ouvrez **Sécurité → Gestion des mots de passe**.
2. Saisissez le nouveau mot de passe dans **Mot de passe**, puis à nouveau dans **Confirmer le mot de passe**. Il doit compter au moins 6 caractères.
3. Cliquez sur **Mettre à jour le mot de passe**.
:::

### Ajouter une clé d'accès

:::steps
1. Ouvrez **Sécurité → Passkeys** et cliquez sur **Ajouter une clé d'accès**.
2. Donnez-lui un nom que vous reconnaîtrez, comme votre appareil ou votre gestionnaire de mots de passe, et cliquez sur **Créer une clé d'accès**.
3. Suivez l'invite de votre navigateur pour enregistrer la clé d'accès.
:::

La prochaine fois, choisissez **Se connecter avec une clé d’accès** sur la page de connexion.

### Activer l'authentification à deux facteurs

L'authentification à deux facteurs s'applique quand vous vous connectez avec votre mot de passe. Ajoutez d'abord une deuxième étape, puis activez-la.

:::steps
### Ajouter une application d'authentification

Ouvrez **Sécurité → Two-factor authentication**. Sous **Applications d'authentification**, ajoutez une application et donnez-lui un nom. Scannez le code QR avec une application comme 1Password, Google Authenticator ou Microsoft Authenticator, saisissez le code à 6 chiffres qu'elle affiche et cliquez sur **Verify and finish**. Pour utiliser plutôt une clé USB ou NFC, ajoutez-la sous **Security keys**.

### Conserver vos codes de secours

La première fois que vous ajoutez une application, une clé ou une clé d'accès, OneUptime affiche **Your backup codes**. Chaque code vous connecte une fois si vous perdez votre application ou votre clé. Copiez-les ou téléchargez-les, cochez la case indiquant que vous les avez conservés et cliquez sur **Terminé**.

### L'activer

En haut de la page, cliquez sur **Activer l'authentification à deux facteurs** et confirmez. La carte indique maintenant **Activé**. Dès votre prochaine connexion avec un mot de passe, OneUptime vous demande votre deuxième étape.
:::

> [!TIP]
> Il vous reste peu de codes de secours ? **Regenerate codes** sur la même page vous donne un nouveau jeu, et les anciens codes cessent aussitôt de fonctionner.

## Vos projets

Vous pouvez appartenir à autant de projets que vous voulez. Le sélecteur de projet en haut à gauche du tableau de bord les liste : choisissez-en un pour y passer.

- **Créer un projet** : ouvrez le sélecteur de projet et cliquez sur **Créer un nouveau projet**. Sur une installation auto-hébergée, l'administrateur peut réserver la création de projets aux administrateurs.
- **Accepter une invitation** : quand quelqu'un vous invite, la cloche en haut à droite affiche l'invitation en attente et ouvre **Invitations au projet**. Là, vous pouvez l'**Accepter** ou cliquer sur **Reject**.
- **Quitter un projet** : demandez à une personne qui gère ses utilisateurs de vous retirer, avec **Retirer du projet** sur sa page **Utilisateurs**.

## Ce que chaque projet garde pour vous

Les **Paramètres utilisateur**, à droite dans la barre sous la barre supérieure, n'appartiennent qu'à vous, et chaque projet a les siens. Ouvrez-les dans chaque projet où vous êtes d'astreinte.

| Page | À quoi elle sert | En savoir plus |
| --- | --- | --- |
| **Liste de configuration** | Vous guide à travers tout ce qui suit, et montre ce qu'il reste à faire. | |
| **Méthodes de notification** | Les adresses e-mail, numéros de téléphone, applications et webhooks par lesquels OneUptime peut vous joindre. Votre e-mail de connexion est ajouté pour vous. | |
| **Règles d'astreinte** | Quelle méthode utiliser, et au bout de combien de temps, quand une politique d'astreinte vous alerte. | [Règles d'escalade](/docs/on-call/escalation-rules) |
| **Paramètres de notification** | Les nouvelles que vous recevez sur les incidents, les alertes, les moniteurs et plus encore, et sur quel canal. | |
| **Préférences e-mail** | Combien d'e-mails vous recevez : un par un, ou regroupés. | [Regroupement des notifications](/docs/emails/notification-rollup) |
| **Journaux d'astreinte** | Chaque alerte qui vous a été envoyée, et ce qu'elle est devenue. | |
| **Numéros de téléphone entrants** | Le numéro sur lequel une politique d'appels entrants vous appelle. | [Politique d'appels entrants](/docs/on-call/incoming-call-policy) |
| **Flux de calendrier** | Vos gardes d'astreinte dans Google Calendar, Apple Calendar ou Outlook. | [Flux de calendrier](/docs/on-call/calendar-feeds) |

## Langue et thème

Les deux sont enregistrés dans votre navigateur, pas dans votre compte : réglez-les à nouveau dans un autre navigateur ou sur un autre appareil.

- **Langue** : le tableau de bord démarre dans la langue de votre navigateur. Pour la changer, utilisez le menu des langues en bas de chaque page. Cette documentation a son propre menu des langues, en haut.
- **Thème** : choisissez **Thème sombre** dans le menu utilisateur. Le tableau de bord démarre en thème clair.

## Supprimer votre compte

Ouvrez **Zone de danger → Supprimer le compte**. Vous ne pouvez supprimer votre compte qu'une fois que vous n'êtes plus dans aucun projet : la page liste les projets où vous êtes encore. Quittez-les d'abord, puis cliquez sur **Supprimer le compte** et confirmez. La suppression de votre compte est définitive et irréversible.

## Dépannage

:::details Je n'ai pas reçu l'e-mail de vérification de mon adresse
Se connecter à nouveau envoie un nouveau lien : vérifiez aussi votre dossier de courrier indésirable. Si vous ne pouvez pas vous connecter, utilisez **Mot de passe oublié ?** sur la page de connexion. Son lien de réinitialisation vérifie aussi votre adresse.
:::

:::details J'ai perdu mon application d'authentification
À la deuxième étape de la connexion, choisissez **Vous avez perdu l'accès à votre application d'authentification ?** et saisissez l'un de vos codes de secours. Ouvrez ensuite **Sécurité → Two-factor authentication** et ajoutez votre nouvelle application. Sans codes de secours, demandez à un administrateur de votre installation OneUptime de réinitialiser l'authentification à deux facteurs de votre compte.
:::

:::details Les heures du tableau de bord sont décalées d'une heure
Le tableau de bord affiche les heures dans le **Fuseau horaire** de votre profil, pas dans celui de votre ordinateur. Vérifiez-le sous **Profil utilisateur → Vue d'ensemble**.
:::

## Étapes suivantes

:::cards
- [Page d'accueil et raccourcis](/docs/introduction/home): Se repérer dans le tableau de bord.
- [Règles d'escalade](/docs/on-call/escalation-rules): Comment une politique d'astreinte vous alerte.
- [Utilisateurs, équipes et autorisations](/docs/permissions/index): Ce qui décide de ce que vous pouvez faire dans un projet.
- [SSO](/docs/identity/sso): Se connecter via le fournisseur d'identité de votre entreprise.
:::
