# Règles d'escalade

Une politique d'astreinte alerte les personnes par niveaux. Chaque règle d'escalade est un niveau : qui est alerté, et combien de temps attendre qu'une personne accuse réception avant d'alerter le niveau suivant. Les règles d'une politique sont listées, dans l'ordre, sur sa page **Règles d'escalade**.

## Qui est alerté en premier

Lorsque vous créez une politique d'astreinte sur la page **Politiques d'astreinte**, le formulaire demande son **Nom** et **Qui est alerté en premier ?**. La question utilise le même sélecteur que **Notifier** : plannings d'astreinte, équipes et personnes, autant qu'il en faut. Les personnes choisies forment la première règle d'escalade de la politique, **Level 1**, qui attend **30 minutes** un accusé de réception avant d'alerter le niveau suivant. La nouvelle politique s'ouvre ensuite sur sa page **Règles d'escalade**, où vous pouvez ajouter d'autres niveaux.

**Qui est alerté en premier ?** est facultatif. Si vous le laissez vide, la politique démarre sans règles d'escalade : elle n'alerte personne tant que vous n'en ajoutez pas, et sa vue d'ensemble le signale. La description et les étiquettes se trouvent sous **Avancé**. La question n'est posée qu'aux personnes autorisées à ajouter des règles d'escalade.

## Ajouter une règle d'escalade

Ouvrez la politique d'astreinte, choisissez **Règles d'escalade** dans son menu latéral et cliquez sur **Ajouter une règle d'escalade**. La boîte de dialogue est une seule page courte qui pose deux questions :

- **Notifier** — qui est alerté à ce niveau. Un seul sélecteur couvre les plannings d'astreinte, les équipes et les personnes : cliquez sur **Ajouter un intervenant**, recherchez et choisissez autant d'entrées que nécessaire. Il en faut au moins une.
  - Un **planning d'astreinte** alerte la personne d'astreinte au moment où le niveau s'exécute, et non une personne fixe.
  - Une **équipe** alerte chacun de ses membres.
  - Une **personne** est alertée directement.
- **Escalader après (en minutes)** — combien de temps attendre un accusé de réception avant d'alerter le niveau suivant. La valeur de départ est **30 minutes** ; adaptez-la au niveau.

Tout le reste se trouve sous **Avancé**, replié jusqu'à ce que vous l'ouvriez :

- **Nom** — facultatif. Une règle sans nom porte le nom de son niveau : la première règle d'une politique est **Level 1**, la deuxième **Level 2**, et ainsi de suite. Le champ du nom affiche le nom que la règle recevra.
- **Description** — notes facultatives, par exemple qui ce niveau alerte et pourquoi.

L'en-tête de **Avancé** indique **Configuré** lorsque la règle a une description ou un nom choisi par vous.

## Comment les niveaux alertent les personnes

Lorsqu'un incident ou une alerte atteint la politique, **Level 1** alerte ses intervenants immédiatement. Si personne n'accuse réception dans son délai, **Level 2** est alerté, et ainsi de suite. Une fois le délai du dernier niveau écoulé sans accusé de réception, la politique recommence à **Level 1** si sa **Politique de répétition** (sous les règles) prévoit une répétition, autant de fois qu'elle le permet, et s'arrête sinon.

Le résumé en haut de la page **Règles d'escalade** montre toute l'échelle : quand chaque niveau est alerté, qui il alerte et ce qui se passe après le dernier. Un niveau dont tous les intervenants ne peuvent pas être alertés l'indique sur sa carte ; cliquez sur le libellé pour voir qui et pourquoi.

Chaque personne alertée par un niveau est jointe selon ses propres règles d'astreinte : **Paramètres utilisateur** > **Règles d'astreinte**, avec un onglet pour les incidents, les épisodes d'incident, les alertes et les épisodes d'alerte, et une carte par gravité qui indique quelle méthode de notification est utilisée et après combien de temps. Un administrateur du projet peut consulter et modifier les règles d'un membre dans **Utilisateurs** > le membre > **Règles d'astreinte**.

## Modifier, réordonner et supprimer des règles

- **Modifier la règle** ouvre la même boîte de dialogue d'une page, remplie avec la règle telle qu'elle est : ses intervenants, son délai, ainsi que son nom et sa description sous **Avancé**. Ajoutez ou retirez des intervenants et enregistrez. Vider le nom redonne à la règle le nom de son niveau.
- **Monter** et **Descendre** dans le menu **⋯** d'une règle changent son niveau. Une règle qui porte le nom de son niveau garde un nom qui correspond à sa place : quand **Level 3** remonte au-dessus de **Level 2**, les deux échangent leurs noms. Un nom que vous avez choisi, comme **Managers**, reste le même où que la règle aille.
- **Supprimer la règle** demande d'abord confirmation et indique qui le niveau alerte. Supprimer un niveau fait remonter les niveaux en dessous, et les règles qui portent le nom de leur niveau sont renommées en conséquence.

## Créer des règles avec l'API ou Terraform

Les règles d'escalade sont la ressource `/api/on-call-duty-policy-escalation-rule` ; les personnes, équipes et plannings qu'une règle alerte sont les ressources `/api/on-call-duty-policy-escalation-rule-user`, `-team` et `-schedule`.

- Une règle créée sans `name` porte le nom de son niveau, comme dans le tableau de bord : **Level 3** pour une règle qui devient le troisième niveau de sa politique. La ressource Terraform des règles d'escalade exige toujours un nom.
- `escalateAfterInMinutes` n'a pas de valeur par défaut en dehors du tableau de bord. Une règle créée sans cette valeur n'attend pas : le niveau suivant est alerté dès que celui-ci s'est exécuté. Définissez-la explicitement — le tableau de bord suggère 30.
- Les règles qui portent le nom de leur niveau sont renommées lorsque vous déplacez ou supprimez des règles dans le tableau de bord. Modifier `order` via l'API ou Terraform ne change que l'ordre.
- Créer une politique d'astreinte via `/api/on-call-duty-policy` avec `onCallSchedules`, `teams` ou `users` (des listes d'identifiants) dans ses `miscDataProps` lui donne sa première règle d'escalade, comme dans le tableau de bord : **Level 1**, qui les alerte, avec un `escalateAfterInMinutes` de 30. Chaque identifiant doit appartenir au projet et l'appelant doit avoir le droit de créer des règles d'escalade, sinon la politique n'est pas créée. Une politique créée sans eux n'a aucune règle, comme avant ; la ressource Terraform des politiques ne les envoie pas.
