# Votre compte

Votre compte est ce par quoi OneUptime vous connaît : l'adresse e-mail et le mot de passe avec lesquels vous vous connectez, votre nom, votre fuseau horaire et votre langue, et ce qui protège votre connexion. Un compte peut appartenir à de nombreux projets, et ces paramètres vous suivent dans chacun d'eux. La façon dont OneUptime vous joint, et le moment où il vous alerte, se règlent dans chaque projet, sous **Paramètres utilisateur**.

```mermaid title="Ce qui appartient à votre compte, et ce que chaque projet garde pour vous"
flowchart TB
    account["Votre compte :<br/>connexion et profil"] --> projectA["Projet A"]
    account --> projectB["Projet B"]
    projectA --> settingsA["Paramètres utilisateur dans A :<br/>comment vous êtes alerté"]
    projectB --> settingsB["Paramètres utilisateur dans B :<br/>comment vous êtes alerté"]
```

:::cards
- [Votre profil](#votre-profil): Votre nom, votre adresse e-mail, votre fuseau horaire, votre langue et votre photo.
- [Se connecter en sécurité](#se-connecter-en-sécurité): Votre mot de passe, les liens de connexion, vos clés d'accès et l'authentification à deux facteurs.
- [Vos projets](#vos-projets): Changer de projet, en créer un et accepter des invitations.
- [Paramètres utilisateur](#ce-que-chaque-projet-garde-pour-vous): Comment OneUptime vous joint dans chaque projet.
:::

## Le menu utilisateur

Cliquez sur votre photo en haut à droite du tableau de bord.

| Élément | Ce qu'il fait |
| --- | --- |
| **Profil** | Ouvre **Profil utilisateur** : votre nom, votre adresse e-mail, votre fuseau horaire, votre langue, votre photo et la sécurité de votre connexion. |
| **Paramètres admin** | Ouvre l'Admin Dashboard. Seuls les administrateurs principaux d'une installation auto-hébergée le voient. |
| **Thème** | Règle le thème du tableau de bord : **Clair**, **Sombre** ou **Système**, qui est clair ou sombre selon le réglage de votre appareil. |
| **Se déconnecter** | Vous déconnecte, aussitôt sur chaque serveur OneUptime. Là où votre administrateur l'a prévu, vous déconnecte aussi de votre fournisseur d'identité. |

**Profil utilisateur** a son propre menu latéral. **Basique** contient **Vue d'ensemble** et **Photo de profil**. **Sécurité** et **Zone de danger** sont repliées : cliquez sur le titre d'une section pour l'ouvrir.

## Votre profil

:::steps
### Ouvrir votre profil

Cliquez sur votre photo en haut à droite et choisissez **Profil**. La page **Vue d'ensemble** s'ouvre sur la carte **Informations de base** : votre nom, votre adresse e-mail, votre fuseau horaire et votre langue.

### Modifier vos informations

Cliquez sur **Modifier : Utilisateur** et changez ce dont vous avez besoin :

- **E-mail** : l'adresse avec laquelle vous vous connectez. Si vous la changez, OneUptime envoie un lien à la nouvelle adresse, et votre adresse change dès que vous l'ouvrez. D'ici là, vous vous connectez avec l'adresse actuelle, et **Annuler la modification** arrête la modification. L'adresse d'un administrateur principal change aussitôt.
- **Nom complet** : le nom que votre équipe voit partout dans OneUptime.
- **Fuseau horaire** : le fuseau dans lequel le tableau de bord affiche et lit les heures, et celui des heures indiquées dans les notifications qui vous sont envoyées.
- **Langue** : la langue du tableau de bord dans chaque navigateur où vous vous connectez, et celle de vos alertes d'astreinte. Non définie, vos alertes sont en anglais et le tableau de bord suit votre navigateur.

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
| **Clés d'accès** | Se connecter sans mot de passe, avec votre empreinte digitale, votre visage, le verrouillage de votre écran ou une clé de sécurité. |
| **Authentification à deux facteurs** | Demander une deuxième étape après votre mot de passe ou un lien envoyé par e-mail : un code issu d'une application, ou une clé de sécurité. |

### Changer votre mot de passe

:::steps
1. Ouvrez **Sécurité → Gestion des mots de passe**.
2. Saisissez le nouveau mot de passe dans **Nouveau mot de passe**, puis à nouveau dans **Confirmer le mot de passe**. Il doit compter au moins 15 caractères et ne pas être prévisible, comme un mot de passe courant ou un motif répété : quelques mots sans rapport entre eux font très bien l'affaire. La liste de contrôle sous le champ coche chaque point au fil de la saisie.
3. Cliquez sur **Mettre à jour le mot de passe**.
:::

Un nouveau mot de passe déconnecte tous les appareils de votre compte, et tout lien de réinitialisation ou de connexion déjà envoyé cesse de fonctionner.

Toutes les pages qui définissent un mot de passe demandent la même chose : l'inscription, le lien de réinitialisation de **Mot de passe oublié ?**, cette page et **Définir le mot de passe** d'un administrateur du serveur. Un mot de passe défini avant cette règle continue de fonctionner jusqu'à ce que vous le changiez.

### Ajouter une clé d'accès

:::steps
1. Ouvrez **Sécurité → Clés d'accès** et cliquez sur **Ajouter une clé d'accès**.
2. Donnez-lui un nom que vous reconnaîtrez, comme votre appareil ou votre gestionnaire de mots de passe, et cliquez sur **Créer une clé d'accès**.
3. Suivez l'invite de votre navigateur pour enregistrer la clé d'accès.
:::

La prochaine fois, choisissez **Autres moyens de se connecter** → **Se connecter avec une clé d’accès** sur la page de connexion.

### Se connecter avec un lien envoyé par e-mail

Vous pouvez vous connecter avec un lien au lieu de votre mot de passe. Il n'y a rien à configurer.

:::steps
1. Sur la page de connexion, choisissez **Autres moyens de se connecter** → **M'envoyer un lien de connexion**.
2. Saisissez votre adresse e-mail et cliquez sur **M'envoyer un lien de connexion**. La page affiche alors **Consultez vos e-mails**.
3. Ouvrez le lien dans l'e-mail et cliquez sur **Se connecter**.
:::

Le lien fonctionne une seule fois, pendant 15 minutes, et un lien plus récent le remplace. Vous pouvez l'ouvrir sur un autre appareil, et la connexion se fait alors sur celui-ci. Si vous utilisez l'authentification à deux facteurs, OneUptime demande toujours votre deuxième étape.

> [!NOTE]
> Les administrateurs principaux d'une installation auto-hébergée peuvent désactiver les liens de connexion avec **Autoriser la connexion avec un lien envoyé par e-mail**, sous **Admin Dashboard > Paramètres > Authentification**. Les liens déjà envoyés ne fonctionnent alors plus. Tant que le serveur exige le SSO, la page de connexion ne propose que le SSO.

### Activer l'authentification à deux facteurs

L'authentification à deux facteurs s'applique quand vous vous connectez avec votre mot de passe ou un lien envoyé par e-mail. Elle ne s'active qu'une fois votre deuxième étape opérationnelle : elle ne vous demande donc jamais une étape que vous n'avez pas.

:::steps
### Choisir votre deuxième étape

Ouvrez **Sécurité → Authentification à deux facteurs** et cliquez sur **Activer l'authentification à deux facteurs**. Choisissez **Application d'authentification** ou **Clé de sécurité**, puis cliquez sur **Continuer**.

### La configurer

Pour une application d'authentification, scannez le code QR avec une application comme 1Password, Google Authenticator ou Microsoft Authenticator, saisissez le code à 6 chiffres qu'elle affiche et cliquez sur **Vérifier et terminer**. Pour une clé USB ou NFC, donnez-lui un nom et suivez les instructions de votre navigateur. L'authentification à deux facteurs est alors activée, et la carte indique **Activé**. Dès votre prochaine connexion avec un mot de passe ou un lien envoyé par e-mail, OneUptime vous demande votre deuxième étape.

### Conserver vos codes de secours

La première fois que vous ajoutez une application, une clé ou une clé d'accès, OneUptime affiche **Vos codes de secours**. Chaque code vous connecte une fois si vous perdez votre application ou votre clé. Copiez-les ou téléchargez-les, cochez la case indiquant que vous les avez conservés et cliquez sur **Terminé**.
:::

Si vous avez déjà une application sous **Applications d'authentification** ou une clé sous **Clés de sécurité**, **Activer l'authentification à deux facteurs** vous demande simplement de confirmer. Tant qu'elle est activée, votre dernière application, clé ou clé d'accès ne peut pas être supprimée : ajoutez-en d'abord une autre, ou désactivez l'authentification à deux facteurs. Si la carte indique **Configuration requise**, l'authentification à deux facteurs est activée sans rien de configuré, souvent parce qu'un administrateur l'a exigée : cliquez sur **Terminer la configuration**, sinon cela vous sera demandé à votre prochaine connexion.

### Configurer l'authentification à deux facteurs à la connexion

Quand un administrateur exige l'authentification à deux facteurs et que vous n'avez encore rien configuré, votre prochaine connexion avec un mot de passe ou un lien envoyé par e-mail vous demande de la configurer avant de vous laisser entrer. Choisissez **Application d'authentification** ou **Clé de sécurité**, puis cliquez sur **Continuer** :

- **Application d'authentification** : scannez le code QR, saisissez le code à 6 chiffres affiché par votre application et cliquez sur **Vérifier et se connecter**.
- **Clé de sécurité** : cliquez sur **Enregistrer la clé de sécurité** et suivez les instructions de votre navigateur. Touchez une clé USB ou NFC, ou utilisez l'empreinte digitale, le visage ou le verrouillage d'écran de votre téléphone ou de votre ordinateur.

Si vous n'avez pas encore de codes de secours, OneUptime vous les affiche alors une seule fois, et vous êtes connecté. **Choisir une autre méthode** revient au choix. Un navigateur qui ne peut pas enregistrer de clé de sécurité, par exemple sur une page sans HTTPS, ne propose que l'application d'authentification.

> [!TIP]
> Il vous reste peu de codes de secours ? **Régénérer les codes** sur la même page vous donne un nouveau jeu, et les anciens codes cessent aussitôt de fonctionner.

### Quand votre organisation gère votre connexion

Sur un serveur qui exige l'authentification unique, vous vous connectez uniquement via le fournisseur d'identité de votre organisation, comme Okta ou Microsoft Entra ID, et OneUptime ne définit pour vous ni mot de passe, ni clé d'accès, ni authentification à deux facteurs. Le **Profil utilisateur** n'a alors pas de section **Sécurité**, et sa **Vue d'ensemble** indique votre fournisseur sous **Authentification unique**. Changez votre mot de passe et votre deuxième étape auprès de votre fournisseur d'identité. Ce que vous aviez configuré avant reste enregistré : cela ne fonctionne de nouveau que si le serveur cesse d'exiger l'authentification unique, sauf si un administrateur du serveur l'efface, et vous recevez alors un e-mail. Les administrateurs principaux conservent leurs propres réglages de **Sécurité**.

Il en va de même quand chaque projet auquel vous appartenez exige l'authentification unique et a activé **Gérer la connexion avec le SSO**. Votre mot de passe vous connecte toujours à OneUptime, mais chaque projet demande le SSO ; OneUptime ne définit donc pour vous ni nouveau mot de passe, ni nouvelle clé d'accès, ni nouvelle deuxième étape :

- **Un projet qui ne le fait pas** : dès que vous êtes membre d'un projet, ou invité dans un projet, qui n'exige pas le SSO ou n'a pas activé **Gérer la connexion avec le SSO**, votre section **Sécurité** revient. La **Vue d'ensemble** nomme alors ces projets sous **Authentification unique**, comme la raison pour laquelle vos réglages vous appartiennent. Quitter ce projet vous les retire de nouveau.
- **Des projets avec des fournisseurs différents** : si tous vos projets gèrent la connexion, chacun avec son propre fournisseur d'identité, la **Vue d'ensemble** nomme chaque fournisseur.
- **Les administrateurs principaux** gardent toujours leurs propres réglages de **Sécurité**.
- **Ce que vous aviez configuré avant** reste enregistré. Un administrateur du serveur peut l'effacer, tout comme un propriétaire de tous les projets auxquels vous appartenez ; vous recevez alors un e-mail.

## Vos projets

Vous pouvez appartenir à autant de projets que vous voulez. Le sélecteur de projet en haut à gauche du tableau de bord les liste : choisissez-en un pour y passer.

- **Créer un projet** : ouvrez le sélecteur de projet et cliquez sur **Créer un nouveau projet**. Sur une installation auto-hébergée, l'administrateur peut réserver la création de projets aux administrateurs.
- **Accepter une invitation** : quand quelqu'un vous invite, la cloche en haut à droite affiche l'invitation en attente et ouvre **Invitations au projet**. Là, vous pouvez l'**Accepter** ou cliquer sur **Rejeter**.
- **Quitter un projet** : demandez à une personne qui gère ses utilisateurs de vous retirer, avec **Retirer du projet** sur sa page **Utilisateurs**.

## Ce que chaque projet garde pour vous

Les **Paramètres utilisateur**, à droite dans la barre sous la barre supérieure, n'appartiennent qu'à vous, et chaque projet a les siens. Ouvrez-les dans chaque projet où vous êtes d'astreinte. Ils s'ouvrent sur **Liste de configuration** tant qu'il reste quelque chose à configurer, et sur **Méthodes de notification** une fois qu'il ne manque plus rien d'essentiel.

| Page | À quoi elle sert | En savoir plus |
| --- | --- | --- |
| **Liste de configuration** | Vous guide à travers tout ce qui suit, et montre ce qu'il reste à faire. | |
| **Méthodes de notification** | Les adresses e-mail, numéros de téléphone, applications et webhooks par lesquels OneUptime peut vous joindre. Votre e-mail de connexion est ajouté pour vous. | |
| **Comment me joindre** | Quelle méthode utiliser, et au bout de combien de temps, quand une politique d'astreinte vous alerte. | [Règles d'escalade](/docs/on-call/escalation-rules) |
| **Paramètres de notification** | Les nouvelles que vous recevez sur les incidents, les alertes, les moniteurs et plus encore, et sur quel canal. | |
| **Préférences e-mail** | Combien d'e-mails vous recevez : un par un, ou regroupés. | [Regroupement des notifications](/docs/emails/notification-rollup) |
| **Journaux d'astreinte** | Chaque alerte qui vous a été envoyée, et ce qu'elle est devenue. | |
| **Numéros de téléphone entrants** | Le numéro sur lequel une politique d'appels entrants vous appelle. | [Politique d'appels entrants](/docs/on-call/incoming-call-policy) |
| **Flux de calendrier** | Vos gardes d'astreinte dans Google Calendar, Apple Calendar ou Outlook. | [Flux de calendrier](/docs/on-call/calendar-feeds) |

## Langue et thème

Votre thème est enregistré dans votre navigateur : réglez-le à nouveau dans un autre navigateur ou sur un autre appareil. Votre langue est enregistrée dans votre compte dès que vous la choisissez, et chaque navigateur où vous vous connectez démarre dans cette langue. Ils sont conservés lorsque vous vous déconnectez : sur un ordinateur partagé, la personne suivante commence donc avec vos réglages.

- **Langue** : le tableau de bord démarre dans la langue de votre navigateur. Pour la changer, utilisez le menu des langues en bas de chaque page. Votre choix est enregistré dans votre compte, comme **Langue** dans votre profil, et OneUptime rédige vos alertes d'astreinte dans cette langue. Voir [La langue de vos alertes](/docs/notifications/index#la-langue-de-vos-alertes). Cette documentation a son propre menu des langues, en haut.
- **Thème** : choisissez **Clair**, **Sombre** ou **Système** dans le menu utilisateur. **Système** est clair ou sombre selon le réglage de votre appareil, et change avec lui ; chaque navigateur démarre avec lui. Les pages de connexion utilisent le même thème.

## Supprimer votre compte

Ouvrez **Zone de danger → Supprimer le compte**. Vous ne pouvez supprimer votre compte qu'une fois que vous n'êtes plus dans aucun projet : la page liste les projets où vous êtes encore. Quittez-les d'abord, puis cliquez sur **Supprimer le compte** et confirmez. La suppression de votre compte est définitive et irréversible.

## Dépannage

:::details Je n'ai pas reçu l'e-mail de vérification de mon adresse
Se connecter à nouveau envoie un nouveau lien : vérifiez aussi votre dossier de courrier indésirable. Si vous ne pouvez pas vous connecter, utilisez **Mot de passe oublié ?** sur la page de connexion. Son lien de réinitialisation vérifie aussi votre adresse.
:::

:::details L'inscription m'a envoyé un e-mail disant que j'ai déjà un compte
Cette adresse a déjà un compte OneUptime, donc l'inscription n'a rien créé ni rien changé. Connectez-vous avec elle, ou utilisez **Mot de passe oublié ?** sur la page de connexion si vous ne vous souvenez plus de votre mot de passe. La page d'inscription dit la même chose pour toutes les adresses, et n'apprend donc à personne quelles adresses ont un compte.
:::

:::details Mon adresse e-mail n'a pas changé
Votre adresse ne change qu'une fois ouvert le lien envoyé par OneUptime à la nouvelle adresse. Le lien fonctionne pendant 24 heures. S'il a expiré, changez à nouveau votre e-mail pour en recevoir un nouveau. Si un autre compte utilise déjà cette adresse, l'e-mail envoyé à celle-ci le dit, et votre adresse reste telle quelle.
:::

:::details J'ai perdu mon application d'authentification
À la deuxième étape de la connexion, choisissez **Vous avez perdu l'accès à votre application d'authentification ?** et saisissez l'un de vos codes de secours. Ouvrez ensuite **Sécurité → Authentification à deux facteurs** et ajoutez votre nouvelle application. Sans codes de secours, demandez à un administrateur de votre installation OneUptime de réinitialiser l'authentification à deux facteurs de votre compte.
:::

:::details La connexion me demande d'attendre avant d'essayer un autre code
Après cinq codes erronés d'affilée, chaque code suivant attend avant d'être vérifié : une minute, puis deux, puis quatre, et ainsi de suite, jusqu'à une heure. OneUptime compte les codes erronés de votre compte, d'où qu'ils soient saisis, vous envoie un e-mail quand les attentes commencent et repart de zéro quand vous saisissez un code correct. Attendez et réessayez, connectez-vous avec une clé de sécurité, ou choisissez **Vous avez perdu l'accès à votre application d'authentification ?** et saisissez un code de secours. Si vous n'avez pas saisi ces codes, quelqu'un connaît votre mot de passe ou peut lire vos e-mails, et l'e-mail envoyé par OneUptime vous indique de quel cas il s'agit. Si cette personne peut lire vos e-mails, changez d'abord le mot de passe de votre compte de messagerie et supprimez tout transfert que vous n'avez pas configuré : un nouveau mot de passe OneUptime ne l'empêche pas à lui seul de demander un autre lien de connexion. Réinitialisez ensuite votre mot de passe avec **Mot de passe oublié ?** sur la page de connexion, ce qui met fin à l'attente et à tout lien de connexion déjà envoyé.
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
