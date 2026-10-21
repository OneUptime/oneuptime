# Ce que crée une soumission

Chaque soumission via un formulaire crée un enregistrement dans votre projet : un **incident** ou un **événement de maintenance planifiée**. La page **À la soumission** d'un formulaire montre lequel, et comment chaque champ du nouvel enregistrement est rempli — à partir d'une réponse, d'une valeur par défaut, d'un paramètre qui s'applique toujours, ou du modèle d'incident. **Modifier les paramètres** modifie les valeurs par défaut et ce qui s'applique toujours.

:::cards
- [Comment une soumission devient un incident](#comment-une-soumission-devient-un-incident): Chaque champ du nouvel incident, et d'où vient sa valeur.
- [Comment une soumission devient un événement de maintenance planifiée](#comment-une-soumission-devient-un-événement-de-maintenance-planifiée): La même chose, pour une demande de maintenance.
- [Les paramètres À la soumission](#les-paramètres-à-la-soumission): Valeurs par défaut, ce qui est toujours joint, propriétaires et publication.
- [La note privée](#la-note-privée): Qui l'a envoyée, et les réponses qu'aucun champ ne contient.
:::

## Ce qui se passe à la soumission

```mermaid title="D'une soumission à un incident ou un événement de maintenance"
flowchart TB
    submit["Soumettre"] --> checks["Protections et<br/>vérification des réponses"]
    checks --> fields["Chaque champ : la réponse,<br/>sinon les paramètres,<br/>sinon le modèle d'incident"]
    fields --> record["L'incident ou<br/>l'événement de maintenance"]
    record --> note["Une note privée : qui l'a envoyée,<br/>et les autres réponses"]
    record --> runs["Les règles, politiques d'astreinte<br/>et flux de travail s'exécutent"]
```

Une soumission qui échoue à une vérification ne crée rien. Voir [Ce qui protège un formulaire](/docs/forms/sharing-and-security#ce-qui-protège-un-formulaire).

## Ce que crée chaque soumission

La carte **Ce que crée chaque soumission** contient le choix que vous avez fait en créant le formulaire :

- **Incident** — chaque soumission déclare un incident, pour que votre équipe d'astreinte soit prévenue tout de suite. Utilisez-le pour les signalements de problèmes.
- **Maintenance planifiée** — chaque soumission planifie un événement de maintenance. Utilisez-le pour les demandes de changement et de maintenance.

Choisir l'autre demande une confirmation, car le formulaire change avec lui :

- Le titre, la description, les moniteurs et les étiquettes restent liés : les deux types d'enregistrement les ont.
- Toute autre question liée — une gravité, un choix de page de statut, un champ personnalisé de l'ancien type — devient une question propre au formulaire, avec le même libellé, dont la réponse est listée sur la note privée.
- Les paramètres À la soumission recommencent à zéro, puisque les paramètres d'un incident et d'un événement sont différents.
- Un formulaire qui crée désormais des événements de maintenance demande quand la maintenance commence et finit.

Les questions sont enregistrées immédiatement, avec le changement. Vérifiez-les sur la page **Construire**.

## Comment une soumission devient un incident

La carte liste chaque champ du nouvel incident et d'où vient sa valeur :

| Champ | Vient de |
| --- | --- |
| **Titre** | La réponse à la question **Titre**. Quand le formulaire ne la pose pas, ou qu'elle est laissée vide : le **Titre par défaut**, sinon le nom du formulaire. |
| **Description** | La réponse à la question **Description**. Quand elle n'est pas posée ou est laissée vide, la description du modèle d'incident, si le formulaire a un modèle. |
| **Gravité** | Le choix de la personne qui soumet, quand le formulaire le demande. Sinon le paramètre **Gravité** du formulaire, sinon la gravité du modèle d'incident. |
| **Moniteurs** | Les moniteurs choisis par la personne qui soumet, avec ceux que les paramètres joignent toujours. Sans aucun des deux, ceux du modèle d'incident. |
| **Étiquettes** | Les étiquettes choisies par la personne qui soumet, avec celles que les paramètres ajoutent toujours. Sans aucune des deux, celles du modèle d'incident. |
| **Début de l'impact** | La réponse à **Début de l'impact**, quand le formulaire la pose. |
| **Modèle d'incident** | Le paramètre **Modèle d'incident** du formulaire. Il remplit ce que les réponses et les paramètres laissent vide. |
| **Politiques d'astreinte** | Les politiques que nomment les paramètres, exécutées pour chaque incident que le formulaire déclare. Sans aucune, celles du modèle d'incident. |
| **Propriétaires** | Les personnes et équipes que nomment les paramètres, avec les propriétaires du modèle. Elles sont informées de chaque incident. |
| **Champs personnalisés** | La réponse à chaque question de champ personnalisé — sauf si le champ copie sa valeur d'un champ personnalisé de moniteur et que les moniteurs de l'incident en ont une ; le modèle remplit le reste. |
| **Pages de statut** | Jamais affiché sur les pages de statut, et les abonnés ne sont pas informés, jusqu'à ce que quelqu'un de votre équipe le publie. |
| **Autres réponses** | Listées sur une note privée de l'incident, avec la personne qui a soumis. |

> [!IMPORTANT]
> **Pas de gravité, pas d'incident.** Un incident a besoin d'une gravité. Quand le formulaire n'en demande pas et que ses paramètres n'en nomment aucune — ou que celle nommée a été supprimée — et que son modèle n'en définit pas non plus, la ligne **Gravité** vous avertit, et chaque soumission est refusée avec "Ce formulaire ne peut pas créer d'incident, car aucune gravité ne lui est associée. Veuillez prévenir l'équipe qui l'a partagé." Choisissez une gravité dans **Modifier les paramètres**, ou un modèle qui en définit une.

### Le modèle d'incident

Choisissez un **Modèle d'incident** dans les paramètres et chaque incident que le formulaire déclare est déclaré à partir de lui, de la façon dont le serveur applique un modèle partout — voir [Comment un modèle est appliqué](/docs/incidents/settings#comment-un-modèle-est-appliqué). Les réponses et les paramètres du formulaire passent en premier, et le modèle remplit tout le reste : l'état initial, la description, la gravité, les ressources affectées, les politiques d'astreinte, les propriétaires, les étiquettes, les valeurs des champs personnalisés et un changement d'état de moniteur.

> [!WARNING]
> **Attention aux moniteurs.** Déclarer un incident sur un moniteur via un formulaire affecte le moniteur exactement comme déclarer un incident sur lui à la main : la surveillance active du moniteur se met en pause jusqu'à la résolution de l'incident, et le **Changer le statut du moniteur en** d'un modèle change l'état du moniteur immédiatement — sur chaque page de statut qui liste le moniteur, même tant que l'incident lui-même est masqué. Avec un formulaire, toute personne qui a le lien peut faire cela. Ne joignez des moniteurs via un formulaire que si chaque soumission doit les mettre en pause.

### À quoi ressemble l'incident

Un incident déclaré via un formulaire est un incident ordinaire, avec quelques paramètres propres :

- **Masqué des pages de statut.** **Visible sur la page de statut** est désactivé, de même que **Notifier les abonnés de la page de statut**. Tant qu'un intervenant ne le publie pas, rien de l'incident n'atteint une page de statut ou un abonné — hormis le changement d'état de moniteur d'un modèle, plus haut.
- **Déclaré par personne.** La personne qui soumet n'est pas un utilisateur de OneUptime, donc aucun utilisateur n'est enregistré comme ayant déclaré l'incident.
- **Ses propriétaires sont informés.** Les propriétaires que nomment les paramètres et le modèle sont ajoutés dès que les canaux Slack et Microsoft Teams de l'incident existent, et sont notifiés — la notification **Incident créé** de l'incident attend qu'ils en soient propriétaires, pour leur parvenir à eux plutôt qu'aux propriétaires du projet.
- **Une note privée consigne la soumission** — voir [La note privée](#la-note-privée).

Tout ce qui s'exécute pour un nouvel incident s'exécute aussi pour ceux-ci : les règles de confidentialité, de propriétaires, d'étiquettes, d'astreinte et de runbooks, les politiques d'astreinte, et les flux de travail **On Create Incident**. Les règles d'astreinte correspondent aux incidents d'un formulaire comme aux autres — y compris sur leur titre et leur description, écrits par la personne qui soumet.

:::steps
#### Lire ce qu'a écrit la personne qui soumet

Le titre et la description apparaissent sur les pages de statut une fois l'incident publié.

#### Publier l'incident

Activez **Visible sur la page de statut** depuis la page **Paramètres** de l'incident.

#### Informer les abonnés, s'ils doivent savoir

Comme l'incident a été déclaré avec **Notifier les abonnés de la page de statut** désactivé, le publier n'envoie pas la notification « incident créé ». Pour informer les abonnés, publiez une note publique avec **Notifier les abonnés de la page de statut** coché — voir [Publier une note publique](/docs/incidents/notes-owners-and-feed#publier-une-note-publique).
:::

## Comment une soumission devient un événement de maintenance planifiée

| Champ | Vient de |
| --- | --- |
| **Titre** | La réponse à la question **Titre**. Quand le formulaire ne la pose pas, ou qu'elle est laissée vide : le **Titre par défaut**, sinon le nom du formulaire. |
| **Description** | La réponse à la question **Description**. |
| **Commence le**, **Se termine le** | Les réponses à **Commence le** et **Se termine le**, que chaque formulaire de maintenance pose et exige. La fin doit être après le début. |
| **Moniteurs** | Les moniteurs choisis par la personne qui soumet, avec ceux que les paramètres joignent toujours. |
| **Pages de statut** | Les pages de statut choisies par la personne qui soumet, avec celles que nomment les paramètres. |
| **Étiquettes** | Les étiquettes choisies par la personne qui soumet, avec celles que les paramètres ajoutent toujours. |
| **Propriétaires** | Les personnes et équipes que nomment les paramètres. Elles sont propriétaires de chaque événement que le formulaire planifie. |
| **Afficher sur les pages de statut** | **Non** sauf si les paramètres l'activent. |
| **Notifier les abonnés** | **Non** sauf si les paramètres l'activent. |
| **Champs personnalisés** | La réponse à chaque question de champ personnalisé — sauf si le champ copie sa valeur d'un champ personnalisé de moniteur et que les moniteurs de l'événement en ont une. |
| **Autres réponses** | Listées sur une note privée de l'événement, avec la personne qui a soumis. |

L'événement commence dans l'état **Scheduled** de votre projet et avance comme n'importe quel autre : il passe en cours quand il commence et se termine quand il finit.

Une soumission est la demande de quelqu'un, et une demande est examinée avant d'être publiée. Ainsi, sauf si vous le changez, l'événement reste hors de ses pages de statut jusqu'à ce que quelqu'un de votre équipe l'affiche, et ses abonnés ne sont pas informés quand il est créé, commence ou finit. **Afficher sur les pages de statut** et **Notifier les abonnés**, à l'étape **Publication** des paramètres, changent cela pour chaque événement que le formulaire planifie — ne les activez que si vous faites confiance à toute personne ayant le lien.

## Les paramètres À la soumission

**Modifier les paramètres** ouvre les paramètres par étapes : **Suivant** avance, et **Enregistrer les modifications** est à la dernière étape. Chaque étape est déjà remplie, donc la liste des étapes à côté du formulaire ouvre n'importe laquelle, la dernière comprise : changez un paramètre à son étape, puis ouvrez la dernière étape et enregistrez.

| Étape | Formulaire d'incident | Formulaire de maintenance |
| --- | --- | --- |
| **Valeurs par défaut** | **Titre par défaut**, **Gravité**, **Modèle d'incident** | **Titre par défaut** |
| **Toujours associer** | **Moniteurs**, **Étiquettes**, **Politiques d'astreinte** | **Moniteurs**, **Pages de statut**, **Étiquettes** |
| **Propriétaires** | **Propriétaires** | **Propriétaires** |
| **Publication** | — | **Afficher sur les pages de statut**, **Notifier les abonnés** |

**Propriétaires** est un seul sélecteur pour les personnes et les équipes : **Ajouter un propriétaire** ouvre une seule liste de recherche des deux, et chaque choix apparaît comme une puce que vous pouvez retirer. Tout ce que nomment les paramètres doit appartenir au projet du formulaire, et les propriétaires doivent en être membres. Un enregistrement supprimé après avoir été choisi est ignoré quand une soumission est créée, et le reste s'applique toujours.

## La note privée

Chaque soumission laisse une note privée sur ce qu'elle a créé :

> Submitted through the form **Report a Problem** by Ada Lovelace (<ada@example.com>).
>
> **Which office are you in?**\
> Berlin

Elle nomme le formulaire et la personne qui soumet — "Submitted anonymously through the form **Report a Problem**." quand le formulaire n'a pas demandé qui elle est —, puis, quand la soumission est partie de l'un des modèles du formulaire, dit lequel : "Started from the template **Application Outage**." — et liste enfin les réponses aux questions propres au formulaire, chacune sous sa question, dans l'ordre du formulaire. Les réponses aux questions liées sont déjà sur l'enregistrement : son titre, sa gravité, ses champs personnalisés. Comme elle est privée, la note n'atteint jamais une page de statut, mais elle est publiée dans les canaux Slack et Microsoft Teams de l'enregistrement comme toute autre note.

L'adresse est un lien qui écrit exactement à cette adresse — dans le tableau de bord, dans Slack et dans l'e-mail aux propriétaires.

## Questions masquées et modèles

Une [question masquée](/docs/forms/building#questions-masquées) reçoit sa réponse du [modèle](/docs/forms/building#modèles) dont est partie la soumission — jamais de la requête —, et sa réponse va exactement là où irait une réponse saisie : une **Description** masquée devient la description de l'incident, un champ personnalisé masqué sa valeur, une question propre au formulaire masquée une ligne de la note privée. Une soumission partie d'aucun modèle laisse les questions masquées sans réponse, et leurs champs sont remplis à partir des paramètres À la soumission, comme pour toute question laissée vide. Un modèle supprimé pendant que quelqu'un avait le formulaire ouvert n'empêche pas sa soumission : elle est créée telle que la personne a répondu, sans les réponses masquées du modèle.

Un modèle peut poser les questions du formulaire [à sa façon](/docs/forms/building#comment-un-modèle-pose-chaque-question), et le serveur tient la soumission aux questions telles que les pose le modèle qu'elle nomme. Une question que le modèle masque reçoit sa réponse du modèle, comme une question masquée, même quand le formulaire la pose ; une question que le modèle pose est lue dans la requête, même quand le formulaire la masque ; et une question que le modèle exige doit recevoir une réponse, sinon la soumission est refusée et rien n'est créé.

Les réponses qu'un modèle a remplies sur la page appartiennent à la personne qui soumet dès qu'elle soumet : le serveur prend les réponses que la requête envoie pour les questions que pose la page, quoi qu'ait dit le modèle.

## Le texte qu'écrit une personne qui soumet

Une soumission va droit à des endroits où du texte peut agir de lui-même — les canaux Slack et Microsoft Teams, le navigateur de chaque intervenant, les e-mails des propriétaires — et personne ne la lit d'abord. Donc, avant la création de l'enregistrement :

| Ce qu'écrit la personne qui soumet | Ce qui est stocké |
| --- | --- |
| Une mention, comme \<!channel\>, \<!here\> ou \<@U0123ABC\>, dans le titre, la description ou toute réponse textuelle | **Les mentions ne notifient personne.** Tout ce que Slack lit comme une mention reçoit un caractère invisible après son chevron ouvrant. Le texte se lit pareil partout, mais aucun outil de discussion n'y réagit. |
| Une image, dans la description ou une réponse **Texte enrichi** | **Les images deviennent des liens.** Chaque image devient un lien vers la même adresse, si bien que rien n'est chargé depuis l'endroit choisi par la personne qui soumet tant qu'un intervenant ne clique pas. |
| Un bloc de code dont le langage est `mermaid`, quelle que soit l'écriture | **Les diagrammes deviennent du code.** Il est stocké comme du code brut, et affiche donc son texte au lieu de dessiner un diagramme. |
| Une syntaxe d'image ou un bloc de diagramme dans le titre | **Le titre est du texte brut.** Ils reçoivent aussi le caractère invisible, si bien que partout où le titre arrive — un épisode, un message de discussion, un modèle de note — il ne charge rien et ne dessine rien. Les caractères invisibles comptent dans la limite du titre. |

Tout le reste — les liens, le reste du Markdown, les choix de liste déroulante, les nombres, les dates, une case cochée — est stocké tel que la personne qui soumet l'a donné, et la soumission garde le nom et l'e-mail de la personne qui soumet tels que saisis.

## Étapes suivantes

:::cards
- [Créer un formulaire](/docs/forms/building): Les questions qui remplissent ces champs, les questions masquées et les modèles.
- [Paramètres et automatisation des incidents](/docs/incidents/settings): Modèles d'incident et champs personnalisés.
- [Notes, propriétaires et fil d'incident](/docs/incidents/notes-owners-and-feed): Notes privées, notes publiques et propriétaires.
- [Partage et sécurité](/docs/forms/sharing-and-security): Qui peut soumettre, et à quelle fréquence.
:::
