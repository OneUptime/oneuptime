# Plannings d'astreinte

Un planning d'astreinte détermine qui est d'astreinte à chaque instant. Les personnes s'y relaient : chacune est d'astreinte un certain temps, puis la suivante prend le relais. Ajoutez un planning aux règles d'escalade d'une politique d'astreinte, et la politique alerte la personne d'astreinte dans ce planning lorsque ce niveau s'exécute.

## Qui se relaie

Lorsque vous créez un planning sur la page **Plannings d'astreinte**, le formulaire demande son **Nom** et **Qui assure l'astreinte à tour de rôle ?**. Cliquez sur **Ajouter un utilisateur** et choisissez les personnes dans l'ordre où elles se relaient : elles sont d'astreinte l'une après l'autre, et la première l'est dès que le planning est créé. Elles forment la première couche du planning, **Layer 1**, d'astreinte 24 h/24. Le nouveau planning s'ouvre ensuite sur sa page **Couches**, où vous pouvez modifier la rotation ou ajouter d'autres couches.

**Qui assure l'astreinte à tour de rôle ?** est facultatif. Laissez-le vide et le planning démarre sans couches : il ne met personne d'astreinte tant que vous n'avez pas ajouté de couche sur sa page **Couches**. La question n'est posée qu'aux personnes autorisées à ajouter des couches.

Tout le reste se trouve sous **Plus de champs**, replié jusqu'à ce que vous l'ouvriez :

- **Chaque tour dure** : **1 jour**, **1 semaine**, **2 semaines** ou **1 mois**, et **1 semaine** sauf si vous le changez. La question est posée dès que quelqu'un est choisi. Chaque personne est d'astreinte pendant cette durée, puis la suivante prend le relais, à l'heure à laquelle le planning a été créé.
- **Fuseau horaire** : le fuseau horaire dans lequel s'appliquent les heures de relève et les heures d'astreinte. Il commence par le vôtre.
- **Description** et **Étiquettes**.

Tant que quelqu'un est choisi et que rien n'est modifié sous **Plus de champs**, son en-tête replié indique ce qui va se passer : chaque personne est d'astreinte pendant une semaine, puis la suivante prend le relais.

## Couches

La rotation d'un planning est faite de couches, sur sa page **Couches**. Les couches se lisent de haut en bas : la couche la plus haute où quelqu'un est d'astreinte est celle qui alerte. Placez donc la rotation principale en haut et la relève de secours en dessous.

**Ajouter une couche** ajoute une couche qui démarre comme la première : d'astreinte dès maintenant, chaque personne pendant une semaine, 24 h/24. Dépliez une couche pour y ajouter des personnes et pour modifier quand elle commence, à quelle fréquence elle passe le relais, quand elle le passe pour la première fois et les heures où elle est d'astreinte.

Chaque personne garde la même couleur partout, pour que vous la suiviez d'un coup d'œil : sur chaque couche, dans le planning final et ses remplacements, et sur la **Chronologie des astreintes**.

## Créer des plannings avec l'API ou Terraform

Les plannings d'astreinte sont la ressource `/api/on-call-duty-policy-schedule` ; leurs couches et les personnes qu'elles contiennent sont les ressources `/api/on-call-duty-schedule-layer` et `/api/on-call-duty-schedule-layer-user`.

- Créer un planning avec `firstLayerUsers` (une liste d'identifiants d'utilisateurs, dans l'ordre où ils se relaient) dans ses `miscDataProps` lui donne sa première couche, comme le fait le tableau de bord : **Layer 1**, d'astreinte dès maintenant, 24 h/24. `firstLayerRotation` indique la durée de chaque tour, sous forme de rotation telle que `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}` ; sans elle, une semaine. Chaque utilisateur doit être membre du projet et l'appelant doit être autorisé à créer des couches, sinon le planning n'est pas créé.
- Un planning créé sans eux n'a pas de couches, comme avant ; la ressource de planning de Terraform ne les envoie pas.
- Une couche créée sans `rotation` passe le relais chaque jour, comme toujours.
