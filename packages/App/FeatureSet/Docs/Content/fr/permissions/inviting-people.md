# Inviter des personnes

On rejoint un projet sur invitation. Vous invitez l'adresse e-mail d'une personne dans une équipe, elle accepte, et dès lors son équipe décide de ce qu'elle peut faire. Cette page montre comment inviter des personnes, ce qu'elles voient, et comment modifier ou retirer leur accès plus tard.

:::cards
- [Inviter quelqu'un](#inviter-quelquun): Une adresse e-mail et une équipe.
- [Accepter une invitation](#accepter-une-invitation): Ce que la personne invitée voit et fait.
- [Changer les équipes d'une personne](#changer-les-équipes-dune-personne): Lui donner plus d'accès, ou moins.
- [Retirer quelqu'un](#retirer-quelquun-du-projet): Ce que quitter le projet emporte.
:::

## Comment fonctionne une invitation

```mermaid title="D'une invitation à un membre"
flowchart TB
    invite["Vous invitez une adresse<br/>e-mail dans une équipe"] --> sent["Invitation envoyée :<br/>pas encore d'accès"]
    sent --> mail["La personne reçoit<br/>un e-mail : créer un<br/>compte ou se connecter"]
    mail --> decide{"Accepte-t-elle ?"}
    decide -->|"Accepter"| member["Membre : les droits<br/>de l'équipe s'appliquent"]
    decide -->|"Refuser"| deleted["L'invitation<br/>est supprimée"]
```

- **Son équipe décide de ce qu'elle peut faire.** Personne n'a d'autorisations propres : une personne peut faire ce que permettent les équipes dont elle fait partie. Voir [Utilisateurs, équipes et autorisations](/docs/permissions/index).
- **Rien n'est accordé avant l'acceptation.** Une invitation en attente apparaît comme **Invitation envoyée** et ne donne aucun accès au projet.
- **Une acceptation vaut pour tout le projet.** Accepter une invitation accepte toutes les autres invitations de la personne dans le même projet. Un membre que vous ajoutez plus tard à une autre équipe y est aussitôt, sans rien à accepter.

## Avant de commencer

- **Un rôle qui peut inviter.** Propriétaire du projet, Administrateur du projet, ou un rôle avec l'autorisation **Invite New Members**. Vous ne pouvez inviter des personnes que dans une équipe dont vous détenez vous-même les autorisations, car une invitation leur donne l'accès de l'équipe.
- **Sur OneUptime Cloud, de la place dans votre forfait.** Chaque personne du projet est un siège sur sa facture, dès le moment où elle est invitée. Le forfait Free a de la place pour une personne. Voir [Facturation et utilisation](/docs/configuration/billing#votre-forfait-et-vos-sièges).
- **Pas de SCIM Push Groups.** Tant que votre fournisseur d'identité gère les équipes du projet via SCIM Push Groups, vous invitez et retirez les personnes là-bas, pas dans OneUptime.

## Inviter quelqu'un

:::steps
### Ouvrir Utilisateurs

Allez dans **Produits → Paramètres → Utilisateurs**. La liste **Utilisateurs** montre toutes les personnes du projet, leurs équipes et si elles l'ont rejoint.

### Cliquer sur Inviter un utilisateur

Cliquez sur **Inviter un utilisateur**. La boîte de dialogue **Inviter un nouvel utilisateur** s'ouvre.

### Saisir son adresse e-mail

Saisissez son adresse dans **E-mail**. Pendant la saisie, **E-mail** suggère les personnes du projet par nom ou par adresse, et indique qui est **Invité** et qui est **Déjà dans cette équipe** : cliquez sur l'une d'elles pour remplir son adresse. Sur un serveur auto-hébergé, un administrateur principal se voit aussi proposer les autres comptes du serveur, marqués **Pas encore dans ce projet**, tout comme toute personne pouvant inviter, dès qu'un administrateur principal l'autorise dans l'Admin Dashboard. Pour une adresse que vous saisissez, la boîte de dialogue demande aussi un **Nom**, facultatif : si cette personne n'a pas encore de compte OneUptime, il sera créé avec ce nom. Tant que la personne n'a pas accepté, le projet la montre sous ce nom, ou par sa seule adresse, jamais avec le nom ou la photo de son propre compte. Les formulaires d'invitation de l'Admin Dashboard suggèrent des personnes de la même façon.

### Choisir son équipe

**Équipe** commence sur l'équipe des membres du projet : l'équipe qui détient Membre du projet pour tout le projet, ou sinon celle nommée Members. Choisissez une autre équipe pour lui donner plus d'accès, ou moins. **Équipe** reste vide quand le projet n'a pas une telle équipe, ou quand vous ne pourriez y inviter personne vous-même.

### Envoyer l'invitation

Cliquez sur **Inviter**. OneUptime envoie l'invitation par e-mail et ouvre la page de la personne. Elle apparaît comme **Invitation envoyée** jusqu'à ce qu'elle accepte.

Sur un serveur auto-hébergé qui ne peut pas encore envoyer d'e-mails, aucun e-mail ne part, et la personne apparaît comme **Invité**. Un administrateur principal voit d'abord **Envoyez-leur leur lien d'invitation** : copiez le lien, envoyez-le vous-même à la personne, puis cliquez sur **Terminé**. Toute autre personne demande à l'admin du serveur de [configurer l'e-mail](/docs/emails/smtp#ouvrir-le-formulaire). Configurer l'e-mail plus tard n'envoie pas les invitations faites avant : la personne entre avec son lien d'invitation, ou en s'inscrivant avec l'adresse invitée.
:::

> [!TIP]
> Invitez les personnes dans l'équipe la plus restreinte qui leur permet de faire leur travail. Vous pourrez les ajouter à d'autres équipes plus tard, et chaque équipe qu'elles rejoignent élargit ce qu'elles peuvent faire.

## Accepter une invitation

L'e-mail d'invitation nomme le projet et la personne qui a envoyé l'invitation. Son bouton est **Create Your Account** pour quelqu'un qui n'a pas encore de compte OneUptime, et **Sign In to OneUptime** pour quelqu'un qui en a un. Lorsque le SSO gérera sa connexion, parce que le projet gère la connexion de ses membres avec le SSO, comme chaque autre projet auquel elle appartient, ou parce que tout le serveur exige le SSO, l'e-mail le dit à la place, et son bouton est **Sign In with SSO**.

**Create Your Account** ouvre la page d'inscription avec son adresse et le nom que vous avez saisi déjà remplis, et indique quel projet l'invite et qui. S'inscrire sur cette page fait rejoindre le projet, sans rien d'autre à accepter. **Sign In with SSO** ouvre la même page, qui propose l'authentification unique au lieu d'un mot de passe : se connecter là avec l'un des fournisseurs d'identité du projet fait rejoindre le projet.

Sur un serveur auto-hébergé qui ne peut pas encore envoyer d'e-mails, personne ne reçoit d'e-mail : le lien d'invitation envoyé à la place ouvre la même page d'inscription, ou la page de connexion pour quelqu'un qui a déjà un compte.

Une personne qui se connecte, ou qui s'inscrit autrement, accepte à l'un de deux endroits :

| Où elle se trouve | Ce qu'elle voit | Ce sur quoi elle clique |
| --- | --- | --- |
| Dans aucun projet encore | L'invitation, sur la page où elle arrive après s'être connectée | **Accepter et rejoindre**, ou **Refuser** |
| Déjà dans un autre projet | L'invitation en attente sur la cloche en haut à droite, qui ouvre **Invitations au projet** | **Accepter**, ou **Rejeter** |

L'acceptation la place aussitôt dans le projet, avec les autorisations de son équipe et la configuration de notifications avec laquelle tout membre commence : voir [Ce avec quoi vous commencez](/docs/notifications/index#ce-dont-vous-disposez-au-départ). Refuser supprime l'invitation : pour rejoindre plus tard, il en faut une nouvelle.

## Voir qui est dans le projet

**Utilisateurs** a une ligne par personne :

| Colonne | Ce qu'elle montre |
| --- | --- |
| **Utilisateur** | Son nom et son adresse e-mail. Tant que la personne n'a pas accepté, le nom que vous avez saisi pour elle, s'il y en a un. |
| **Équipes** | Chaque équipe du projet dont elle fait partie, ou à laquelle elle est invitée. |
| **Statut** | **Membre** une fois qu'elle a rejoint le projet, avec le nombre d'invitations vers d'autres équipes qu'elle n'a pas encore acceptées. **Invitation envoyée** jusque-là, ou **E-mail non envoyé** lorsque le service de messagerie a refusé son dernier e-mail d'invitation. Sur un serveur auto-hébergé qui ne peut pas encore envoyer d'e-mails, **Invité** à la place : l'invitation est créée, mais aucun e-mail ne part. |

Filtrez la liste par **Utilisateur**, **Statut** ou **Équipe**. Cliquez sur une ligne pour ouvrir la page de la personne :

| Page | À quoi elle sert |
| --- | --- |
| **Profil** | Son nom, son adresse e-mail, sa photo et son ID utilisateur. |
| **Équipes** | Les équipes dont elle fait partie. Ajoutez ou retirez une équipe ici. |
| **Disponibilité**, **Méthodes de notification**, **Comment me joindre** | Si elle peut être appelée, et comment. Visible par les Propriétaires du projet, les Administrateurs du projet, la personne elle-même et toute personne qui peut lire les règles de notification des autres. Voir [Disponibilité et rapports](/docs/on-call/readiness). |
| **Champs personnalisés** | Les champs personnalisés du projet pour les personnes, s'il en a. |
| **Retirer du projet** | La retirer du projet. |

## Changer les équipes d'une personne

:::steps
### Ouvrir sa page Équipes

Dans **Utilisateurs**, cliquez sur la personne, puis sur **Équipes**.

### L'ajouter à une équipe

Cliquez sur **Inviter**, choisissez l'**Équipe**, puis cliquez sur **Inviter** dans la boîte de dialogue. Un membre est aussitôt dans la nouvelle équipe. Une personne qui n'a pas encore rejoint le projet reçoit une invitation de plus, et accepter l'une accepte les deux.

Votre projet envoie par e-mail au plus une invitation par heure à une personne. Une invitation faite moins d'une heure après le dernier e-mail, vers une autre équipe ou après que vous l'avez retirée, est bien créée, mais aucun deuxième e-mail ne part tant qu'elle n'en a pas accepté ou refusé une. **Renvoyer l'invitation**, dans le menu de la ligne de la personne dans **Utilisateurs**, en envoie toujours un.

### La retirer d'une équipe

Cliquez sur **Supprimer** sur la ligne de l'équipe. Si c'est la dernière équipe qu'elle a rejointe, la retirer la sort du projet, et la boîte de dialogue le dit avant que rien ne change.
:::

L'équipe Owners garde toujours au moins un membre qui a rejoint le projet, pour qu'un projet ne perde jamais son dernier propriétaire.

## Retirer quelqu'un du projet

Dans **Utilisateurs**, ouvrez le menu de la ligne de la personne, **⋯**, et cliquez sur **Retirer du projet**. Ou ouvrez la personne et choisissez **Retirer du projet** dans son menu latéral. Pour retirer plusieurs personnes à la fois, sélectionnez leurs lignes et supprimez la sélection : chacune est retirée de la même façon.

Si votre rôle ne retire des personnes que de certaines équipes, comme celles qui vous appartiennent, **Retirer du projet** est verrouillé pour une personne qui est aussi dans une équipe dont vous ne pouvez pas la retirer, et nomme les équipes qui la gardent dans le projet, celles que vous pouvez voir. Un retrait de plusieurs personnes à la fois la laisse de côté, et le dit.

La retirer l'enlève de chaque équipe du projet. Elle perd l'accès aussitôt, même si elle est connectée, est retirée des plannings d'astreinte et des règles d'escalade, et ne reçoit plus les notifications du projet. Son compte OneUptime n'est pas supprimé, et vous pouvez l'inviter de nouveau. [Utilisateurs, équipes et autorisations](/docs/permissions/index#utilisateurs) liste tout ce que quitter un projet emporte.

## Autres façons de rejoindre un projet

- **Authentification unique.** Une personne qui se connecte pour la première fois avec le fournisseur d'identité du projet rejoint les équipes que le fournisseur nomme. Voir [Rôles et équipes des utilisateurs SSO](/docs/identity/sso#rôles-et-équipes-des-utilisateurs-sso).
- **SCIM.** Votre fournisseur d'identité crée les personnes et les ajoute aux équipes par défaut de la connexion. Voir [SCIM](/docs/identity/scim#provisionnement-dun-utilisateur-de-projet).
- **L'Admin Dashboard.** Sur une installation auto-hébergée, un administrateur principal peut ajouter quelqu'un à un projet et accepter l'invitation pour lui. Voir [Utilisateurs, équipes et autorisations](/docs/permissions/index#utilisateurs). Un administrateur principal peut aussi créer le compte de quelqu'un dans **Utilisateurs** avec **Créer : Utilisateur** : il saisit un nom et une adresse e-mail, et OneUptime envoie à cette adresse un lien pour choisir un mot de passe, valable une fois, pendant 7 jours. Pour définir lui-même le mot de passe, il ouvre **Plus de champs**. Si l'e-mail n'est pas envoyé, le lien lui est affiché pour qu'il l'envoie lui-même.

## Dépannage

:::details "This user has already been invited to this team"
La personne est déjà dans cette équipe, comme membre ou avec une invitation qu'elle n'a pas acceptée. Ouvrez-la dans **Utilisateurs** pour voir ses équipes, ou invitez-la dans une autre équipe.
:::

:::details "You have reached the user limit for the free plan"
Sur OneUptime Cloud, un projet au forfait Free a de la place pour une personne. Changez de forfait, puis invitez de nouveau. Voir [Changer de forfait](/docs/configuration/billing#changer-de-forfait).
:::

:::details "Too many invitations were sent to this email address in the last hour"
Votre projet peut envoyer 10 invitations par heure à une adresse, à ses équipes et à ses pages de statut privées ensemble. Les invitations des autres projets ne comptent pas. Attendez une heure, puis invitez la personne de nouveau.
:::

:::details "This invitation cannot be sent right now"
OneUptime n'envoie pas plus de 50 invitations par heure à une adresse depuis tous les projets ensemble, et celle-ci dépasserait ce nombre. Rien n'a été créé. Réessayez dans une heure.
:::

:::details "You can remove this person from only some of their teams, so you can't remove them from the project"
Votre rôle ne retire des personnes que de certaines équipes du projet, comme celles qui vous appartiennent, et cette personne est aussi dans d'autres. Retirez-la de vos propres équipes depuis sa page **Équipes**, ou demandez à un Propriétaire du projet ou à un Administrateur du projet de la retirer du projet.
:::

:::details L'e-mail d'invitation n'est pas arrivé, ou son lien a expiré
L'invitation ne dépend pas de l'e-mail. Demandez à la personne de s'inscrire avec l'adresse invitée : OneUptime envoie à cette adresse un nouveau lien pour finir de créer le compte. Une personne qui a déjà un compte se connecte et trouve l'invitation qui l'attend.

Pour savoir s'il est parti, ouvrez l'onglet **E-mail** des **Journaux de notification** du projet : la ligne de chaque invitation dit si elle a été envoyée, et sinon pourquoi. Sur un serveur auto-hébergé, un administrateur principal trouve aussi chaque e-mail que le serveur n'a pas pu envoyer dans son [journal des e-mails](/docs/emails/email-providers#voir-ce-que-le-serveur-a-envoyé).

Sur un serveur auto-hébergé qui ne peut pas encore envoyer d'e-mails, l'inscription ne peut pas non plus envoyer de nouveau lien par e-mail : elle invite plutôt la personne à demander son lien d'invitation. Une fois que l'admin du serveur a [configuré l'e-mail](/docs/emails/smtp#ouvrir-le-formulaire), l'inscription fonctionne comme ci-dessus. D'ici là, un administrateur principal peut lui envoyer un nouveau lien, qui fonctionne une fois, uniquement pour cette adresse, pendant 7 jours : dans **Utilisateurs**, ouvrez le menu de la ligne de la personne, **⋯**, et cliquez sur **Obtenir le lien d'invitation**.
:::

:::details Une personne affiche E-mail non envoyé
Le service de messagerie a refusé son dernier e-mail d'invitation : rien ne lui est parvenu. Pointez **E-mail non envoyé**, ou touchez-le, pour en voir la raison, telle que l'onglet **E-mail** des **Journaux de notification** du projet la donne. Vérifiez l'adresse invitée, puis, une fois l'e-mail fonctionnel, ouvrez le menu de la ligne de la personne dans **Utilisateurs**, **⋯**, et cliquez sur **Renvoyer l'invitation** : elle apparaît de nouveau comme **Invitation envoyée** dès qu'il est parti. Sur un serveur auto-hébergé, l'admin du serveur peut plutôt lui envoyer son lien d'invitation : un administrateur principal clique sur **Obtenir le lien d'invitation** dans le même menu.
:::

:::details Inviter un utilisateur indique que les utilisateurs sont gérés par SCIM Push Groups
Votre fournisseur d'identité gère les équipes du projet. Invitez ou retirez les personnes dans le fournisseur d'identité, ou désactivez Push Groups dans **Paramètres du projet → Sécurité → SCIM** pour les gérer ici.
:::

## Étapes suivantes

:::cards
- [Utilisateurs, équipes et autorisations](/docs/permissions/index): Décider de ce que chaque équipe peut faire.
- [Paramètres du projet](/docs/configuration/project-settings): Tout ce qui s'applique au projet entier.
- [Votre compte](/docs/introduction/your-account): Connexion, profil et projets dont vous faites partie.
- [SCIM](/docs/identity/scim): Laisser votre fournisseur d'identité gérer les personnes et les équipes.
:::
