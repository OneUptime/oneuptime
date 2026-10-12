# Ressources et groupes de la page de statut

Une ressource est une ligne de votre page de statut : un moniteur ou un groupe de moniteurs, avec un nom que vos clients comprennent, son statut actuel et, si vous le souhaitez, sa disponibilité et son historique. Les groupes sont des sections qui contiennent des ressources, si bien qu'une page de quarante moniteurs se lit comme « API », « Application web » et « Pipeline de données » plutôt que comme une liste sans fin. Vous construisez les deux sur un seul écran : ouvrez une page de statut et choisissez **Ressources** dans son menu latéral.

:::cards
- [Ajouter un moniteur](#ajouter-un-moniteur): Mettre un moniteur sur la page, avec le nom que lisent les visiteurs.
- [Groupes](#groupes): Diviser la page en sections, et les imbriquer.
- [Règles de moniteurs](#ajouter-des-moniteurs-automatiquement-avec-des-règles-de-moniteurs): Laisser une règle ajouter pour vous chaque moniteur correspondant.
- [Importer des groupes depuis un CSV](#importer-des-groupes-depuis-un-csv): Construire une hiérarchie profonde en une fois.
:::

Les visiteurs jugent « est-ce chez moi ou chez eux ? » à partir de ces lignes ; nommez-les donc comme vos clients parlent de votre produit : **Checkout API**, pas `prod-checkout-lb-healthcheck-us-east-1`.

## Comment un statut remonte la page

Chaque ligne montre le statut actuel de son moniteur. Chaque niveau au-dessus montre le pire statut de tout ce qui se trouve en dessous, le pire statut étant celui qui a la priorité la plus élevée parmi les statuts de moniteur de votre projet.

```mermaid title="Comment le statut d'un moniteur atteint le haut de la page"
flowchart TB
    subgraph Rows["Lignes de ressources"]
        direction LR
        M["Moniteur :<br/>son propre statut"]
        MG["Groupe de moniteurs :<br/>le pire de ses moniteurs"]
    end
    Rows --> G["Titre de groupe :<br/>pire statut en dessous"]
    G --> P["Groupe parent :<br/>pire statut en dessous"]
    Rows --> O["Bannière de statut global :<br/>pire statut de la page"]
```

Une ressource décide de plus que la couleur de sa ligne :

- **Les moniteurs archivés ne sont pas affichés.** Un moniteur archivé n'est plus vérifié, son dernier statut est donc figé ; la page omet sa ligne (et l'écarte du statut d'un groupe de moniteurs) plutôt que d'afficher ce statut figé comme s'il était actuel. La ligne est conservée : désarchiver le moniteur la fait revenir immédiatement.
- **Les ressources décident des incidents que la page affiche.** Un incident apparaît ici, et les abonnés de la page en sont informés, quand l'un des moniteurs de l'incident est une ressource de la page, directement ou via un groupe de moniteurs. Mettez le même moniteur sur plusieurs pages et ses incidents les atteignent toutes, sauf si un incident est limité à certaines de ces pages. Voir [Une page de statut par public](/docs/status-pages/one-status-page-per-audience).
- **La ligne d'un groupe de moniteurs représente chaque moniteur qu'il contient, y compris pour les abonnés.** Sur une page qui laisse les abonnés choisir des ressources, quelqu'un qui s'abonne à un groupe de moniteurs est informé des incidents, des maintenances planifiées et des annonces de n'importe quel moniteur du groupe, comme s'il avait choisi ce moniteur. Voir [Abonnés et annonces](/docs/status-pages/subscribers#laisser-les-abonnés-choisir-ressources-et-types-dévénements).

## L'écran Ressources

L'entrée s'appelle **Ressources** dans les projets où les groupes de moniteurs sont activés, et **Moniteurs** dans les autres ; c'est le même écran. Les groupes avaient autrefois leur propre page, et l'ancienne adresse `/groups` ouvre désormais cet écran.

L'écran est divisé en deux :

| Partie | Ce qu'elle contient |
| ---- | ------------- |
| **Navigateur de groupes** (à gauche) | Chaque groupe de la page, en arbre, avec un champ **Search groups...** au-dessus et un décompte en dessous, comme `3 groups · 12 resources`. Une longue liste se termine par un bouton **Show N more of M**. |
| **Top of page** | La première ligne du navigateur : les ressources sans groupe, que les visiteurs voient en premier, au-dessus de chaque groupe. Sur une page sans groupe, le volet de droite s'intitule plutôt **Toutes les ressources**. |
| **Volet des ressources** (à droite) | Les ressources du groupe sélectionné. Son en-tête contient **Modifier le groupe**, le bouton principal **Ajouter un moniteur** et un menu **Plus d'actions**. |
| En-tête de la carte | **Nouveau groupe**, et un menu à trois points avec **Importer des groupes depuis un CSV** et **Actualiser**. |

**Les états vides disent quoi faire.** Un groupe vide affiche **Aucun moniteur ici pour le moment** avec **Ajouter un moniteur**, **Ajouter plusieurs** et, seulement tant que la page n'a encore aucun groupe, **Créer un groupe**. Une recherche sans résultat affiche **Aucune ressource ne correspond à votre recherche**.

## Ajouter un moniteur

:::steps
### Choisir où va la ligne

Dans le navigateur de groupes, sélectionnez le groupe auquel appartient la ressource, ou **Top of page** pour une ligne sans groupe.

### Cliquer sur Ajouter un moniteur

La boîte de dialogue **Add a monitor to {group}** s'ouvre. Elle tient sur une seule page.

### Choisir le moniteur

Choisissez-le dans **Moniteur** (texte indicatif **Sélectionner le moniteur**). **Nom d'affichage**, le texte que lisent les visiteurs, se remplit avec le nom du moniteur et le suit si vous choisissez un autre moniteur, jusqu'à ce que vous saisissiez un nom à vous. Il est stocké à part du nom du moniteur : le renommer ici ne change rien à la surveillance.

### Régler les options d'affichage, si vous le souhaitez

**Plus de champs** est replié. Il contient **Description** (du Markdown facultatif affiché sous la ligne, idéal pour une phrase expliquant ce que fait vraiment le service ; une image qui s'y trouve est montrée à chaque visiteur) et les [options d'affichage](#options-daffichage-dune-ressource). Laissez-le fermé et la ressource reçoit leurs valeurs par défaut.

### Enregistrer la ressource

Cliquez sur **Ajouter un moniteur**. La ligne apparaît dans le groupe, et sur la page de statut.
:::

Dans un groupe en grille, la boîte de dialogue demande aussi la ligne et la colonne où va le moniteur, au-dessus de **Plus de champs** ; voir [Disposition en liste ou en grille](#disposition-en-liste-ou-en-grille).

> [!TIP]
> Pour afficher plusieurs vérifications sur une seule ligne, ajoutez un groupe de moniteurs. Avec le commutateur **Groupes de moniteurs** activé (**Paramètres du projet** > **Avancé** > **Drapeaux de fonctionnalités**, qui s'enregistre dès que vous le basculez), un lien sous la liste déroulante indique **Ajoutez plutôt un groupe de moniteurs.** Cliquez dessus et **Moniteur** devient **Groupe de moniteurs** (**Sélectionner le groupe de moniteurs**) ; **Ajoutez plutôt un moniteur.** revient en arrière.

### En ajouter plusieurs à la fois

**Ajouter plusieurs** (aussi **Ajouter plusieurs moniteurs** dans le menu **Plus d'actions**) ouvre **Ajouter plusieurs moniteurs**. Elle tient elle aussi sur une seule page : une sélection multiple **Moniteurs**, puis les mêmes **Plus de champs** repliés, dont les options d'affichage s'appliquent à chaque moniteur choisi. Chaque ressource prend son nom d'affichage et sa description de son moniteur, et **Ajouter des moniteurs** les ajoute tous. C'est le moyen le plus rapide d'alimenter une nouvelle page.

La sélection multiple a un onglet **Étiquettes** : cliquez sur une étiquette et chaque moniteur qui la porte est sélectionné d'un coup.

### Ajouter deux fois par étiquette est sans risque

Une page de statut ne liste un moniteur qu'une fois. L'ajout est idempotent : choisir de nouveau la même étiquette après avoir étiqueté quelques nouveaux moniteurs n'ajoute que les nouveaux – les moniteurs déjà sur la page restent exactement tels quels, avec le nom d'affichage et les options que vous leur avez donnés.

Le résumé à la fin de l'ajout groupé le dit : les moniteurs ajoutés sont listés sous **Ajouté**, et ceux qui étaient déjà là sous **Already Added**. Rien n'est signalé comme un échec, et rien n'est écrit pour eux.

La même règle vaut partout où une ressource est créée. Ajouter un moniteur déjà présent sur la page depuis le formulaire d'ajout unique, ou faire pointer une ressource existante vers lui depuis le formulaire de modification, est refusé avec *« This monitor is already added to this status page »* – y compris quand la ressource existante se trouve dans un autre groupe, car un visiteur verrait quand même le moniteur deux fois. Pour afficher un moniteur dans un autre groupe, supprimez la ressource qu'il a déjà et ajoutez-le là où vous le voulez.

## Options d'affichage d'une ressource

La section **Plus de champs** est la même dans le formulaire d'ajout unique et dans la boîte de dialogue groupée. Elle commence repliée dans les deux, ainsi que dans **Modifier la ressource**, où son en-tête replié montre ce qui n'y est pas à sa valeur par défaut. Tout ici se règle par ressource : deux lignes du même groupe peuvent être configurées différemment.

| Champ | Par défaut | Ce qu'il fait |
| ----- | ------- | ------------ |
| **Infobulle** (`displayTooltip`) | Vide | Affichée comme infobulle à côté de la ressource sur votre page de statut. Servez-vous-en pour la portée : « clients aux États-Unis et dans l'UE ». |
| **Afficher l'état actuel de la ressource** (`showCurrentStatus`) | Activé | Affiche le statut actuel, comme opérationnel, dégradé ou hors ligne, à côté de la ligne. |
| **Afficher le % de disponibilité** (`showUptimePercent`) | Désactivé | Affiche un pourcentage de disponibilité à côté de la ressource. |
| **Sélectionner la précision de disponibilité** (`uptimePercentPrecision`) | Une décimale | Apparaît dès que **Afficher le % de disponibilité** est activé, et devient alors obligatoire. |
| **Afficher le graphique de l'historique des états** (`showStatusHistoryChart`) | Activé | Affiche les barres d'historique de disponibilité jour par jour de la ressource. |

**Nom d'affichage** (`displayName`) et **Description** (`displayDescription`) ne servent eux aussi qu'à l'affichage : ils ne modifient jamais le moniteur lui-même.

## Pourcentages de disponibilité et graphiques d'historique

**Afficher le % de disponibilité** et **Afficher le graphique de l'historique des états** lisent tous deux un réglage valable pour toute la page : le nombre de jours qu'ils couvrent. C'est **Historique de disponibilité** dans la carte **Ce que montre votre page de statut** de **Pages de statut → votre page → Avancé → Paramètres avancés**. Il accepte de 1 à 90 jours et vaut 90 par défaut. Activez donc les commutateurs ressource par ressource, puis fixez la fenêtre une fois pour toute la page.

**La précision est une question de jugement.** **Sélectionner la précision de disponibilité** propose `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` et `99.999% (Three Decimal)`. Plus de décimales ont l'air précises et invitent à discuter de la troisième ; si vous publiez un SLA à trois neuf, alignez-vous dessus, sans plus.

Les groupes ont leurs propres copies de ces commutateurs (voir plus bas) : un groupe peut ainsi afficher un pourcentage consolidé pendant que les moniteurs qu'il contient restent discrets, ou l'inverse.

Les couleurs des barres du graphique d'historique se règlent sous **Plus de paramètres** sur la page **Image de marque**, et les statuts de moniteur qui comptent comme « en panne » dans **Compte comme indisponibilité**, dans la carte **Ce que montre votre page de statut** des **Paramètres avancés** – les deux sont décrits dans [Personnalisation et domaines de la page de statut](/docs/status-pages/branding-and-domains).

## Groupes

La plupart des groupes n'ont besoin que d'un nom.

:::steps
### Cliquer sur Nouveau groupe

**Créer un nouveau groupe de page de statut** s'ouvre : deux champs, puis deux sections repliées.

### Nommer le groupe

Saisissez le **Nom du groupe** : le titre de section que voient les visiteurs.

### L'imbriquer, s'il appartient à un autre groupe

Choisissez un **Parent Group**, ou laissez **Aucun groupe parent (premier niveau)**. **Ajouter un sous-groupe** dans les menus d'un groupe le remplit pour vous.

### Créer le groupe

Cliquez sur **Créer un groupe de page de statut**. Le groupe apparaît dans le navigateur, prêt à recevoir des moniteurs.
:::

Les deux champs sont **Nom du groupe** (`name`) et **Parent Group** (`parentStatusPageGroupId`). Les deux sections repliées contiennent tout le reste :

- **Mise en page** – son en-tête replié indique **Liste** ou **Grille**. Elle contient **Mode d'affichage** et les axes d'une grille (voir [Disposition en liste ou en grille](#disposition-en-liste-ou-en-grille)), et s'ouvre d'elle-même pour un groupe en grille.
- **Plus de champs** – les copies, au niveau du groupe, des options de ressource :
  - **Description du groupe** (`description`) – Markdown facultatif, affiché sous le titre. Une image qui s'y trouve est montrée à chaque visiteur.
  - **Développer par défaut sur la page de statut** (`isExpandedByDefault`) – activé par défaut : si la section commence ouverte ou repliée pour les visiteurs.
  - **Afficher l'état actuel du groupe** (`showCurrentStatus`) – activé par défaut. Affiche un statut à côté du titre du groupe.
  - **Afficher le % de disponibilité** (`showUptimePercent`) – désactivé par défaut, avec **Sélectionner la précision de disponibilité** dès qu'il est activé.

Pour modifier un groupe, utilisez **Modifier le groupe** dans l'en-tête du volet, ou **Modifier le groupe** dans le menu de ligne du navigateur : **Modifier le groupe de la page de statut** s'ouvre, avec un bouton **Enregistrer les modifications**. L'en-tête du volet affiche des pastilles pour les réglages activés – **Grille**, **Réduit par défaut**, **Uptime %** –, pour que vous voyiez comment un groupe est configuré sans ouvrir le formulaire.

### Gérer un groupe

| Où | Actions |
| ----- | ------- |
| Le menu de ligne du navigateur | **Modifier le groupe**, **Monter**, **Descendre**, **Afficher l'ID**, **Supprimer le groupe** |
| Le menu **Plus d'actions** du volet | **Modifier ce groupe**, **Ajouter un sous-groupe**, **Monter le groupe**, **Descendre le groupe**, **Show group ID**, **Actualiser**, **Supprimer ce groupe** |

Un groupe enregistré sans nom s'affiche comme **Untitled group**, bon signe que vous vouliez saisir quelque chose.

## Imbriquer des groupes

Les groupes s'imbriquent : définissez **Parent Group** sur l'enfant, ou utilisez **Ajouter un sous-groupe dans ce groupe** dans le navigateur. Le texte d'aide du formulaire décrit la forme pour laquelle il est conçu – quelque chose comme Unités › Région › Marché –, et chaque niveau montre le statut et la disponibilité consolidés de tout ce qui se trouve en dessous.

Quand un groupe a des enfants, le volet des ressources affiche une rangée de pastilles **Sub groups** qui mène directement à chacun, pour que vous parcouriez la hiérarchie sans revenir au navigateur.

L'imbrication est rentable sur les grandes pages : un hébergeur avec des régions au sein de produits, ou un distributeur avec des marchés au sein d'unités commerciales. Sur une page de douze moniteurs, un seul niveau plat est plus accueillant.

## Disposition en liste ou en grille

La section **Mise en page** du formulaire de groupe définit le **Mode d'affichage** (`viewMode`) du groupe, qui change la façon dont le groupe apparaît sur la page de statut.

| Si vous voulez… | Choisissez |
| --------------- | ---- |
| Afficher une simple liste verticale de services, un par ligne | **Liste** (la valeur par défaut) |
| Afficher le même service sur plusieurs régions ou locataires sous forme de matrice | **Grille** |

Choisissez **Grille** et quatre champs de plus apparaissent :

| Champ | Ce qu'il faut saisir |
| ----- | ------------- |
| **Libellé de l'axe des lignes** | Le nom de la dimension des lignes, texte indicatif `Service`. |
| **Valeurs de l'axe des lignes** | Les lignes, ajoutées une à une avec **Add Row** (texte indicatif `e.g. Auth`). |
| **Étiquette de l'axe des colonnes** | La dimension des colonnes, texte indicatif `Region`. |
| **Valeurs de l'axe des colonnes** | Les colonnes, ajoutées avec **Add Column** (texte indicatif `e.g. US-East`). |

Chaque moniteur d'un groupe en grille occupe une cellule : **Ajouter un moniteur** et la boîte de dialogue groupée demandent donc la ligne et la colonne en plus du moniteur, avec vos propres libellés d'axes.

> [!IMPORTANT]
> Définissez les axes avant d'ajouter des moniteurs. Un groupe en grille sans lignes ni colonnes affiche un avis indiquant qu'il n'y a encore nulle part où placer un moniteur, avec un bouton **Set up the grid** qui ouvre le formulaire du groupe sur sa section **Mise en page**, et son bouton **Ajouter un moniteur** est retiré jusqu'à ce que ce soit fait.

## Ordonner ce que voient les visiteurs

L'ordre, c'est vous qui le fixez, pas l'alphabet :

| Quoi | Comment le réordonner |
| ---- | ------------------ |
| Les ressources d'un groupe | Faites glisser une ligne. Le volet le dit : **Faites glisser une ligne pour changer l'ordre vu par les visiteurs**. |
| Les groupes entre eux | **Monter** / **Descendre** dans le menu de ligne du navigateur, ou **Monter le groupe** / **Descendre le groupe** dans **Plus d'actions**. |
| Les ressources sans groupe | Elles sont dans **Top of page** et s'affichent toujours au-dessus de chaque groupe : mettez-y donc la chose que tout le monde vérifie en premier. |

**Deux cas où le glisser-déposer est désactivé.** Une recherche dans le champ **Search in {group}...** désactive le réordonnancement – le volet indique `N of M shown · drag to reorder is off while filtering` –, videz donc d'abord la recherche. Et les groupes en grille ne se réordonnent jamais par glisser-déposer, car la place d'un moniteur vient de sa ligne et de sa colonne.

Placez en haut le service sur lequel on vous interroge le plus. Les visiteurs qui arrivent sur la page pendant une panne s'arrêtent généralement de lire après le premier écran.

## Ajouter des moniteurs automatiquement avec des règles de moniteurs

Une règle de moniteurs ajoute des moniteurs à la page pour vous : décrivez les moniteurs une fois, et chaque moniteur correspondant atterrit dans le groupe que vous avez choisi. Les règles se trouvent sous **Ressources → Règles de moniteurs**, à côté de l'écran Ressources.

:::steps
### Ouvrir Règles de moniteurs

Ouvrez la page de statut, choisissez **Règles de moniteurs** dans la section **Ressources** de son menu latéral, et cliquez sur **Créer : Règle de moniteurs de la page de statut**.

### Nommer la règle

Sous **Informations de base**, saisissez un **Nom**. **Activé** est activé par défaut.

### Indiquer à quels moniteurs elle s'applique

Sous **Critères de correspondance**, renseignez au moins l'un des champs **Étiquettes du moniteur** (un moniteur portant l'une d'elles correspond), **Nom du moniteur** et **Description du moniteur**. Un moniteur doit satisfaire chaque critère renseigné. Les deux motifs acceptent une expression régulière insensible à la casse (`^api-.*`) ou un joker `*` (`*checkout*`) ; `.*` correspond à tous les moniteurs.

### Choisir le groupe

Sous **Groupe**, choisissez **Ajouter des moniteurs au groupe**, ou laissez vide pour ajouter les moniteurs sans groupe. Les mêmes options d'affichage qu'une ressource suivent ; sur une règle, **Afficher le % de disponibilité** commence activé.

### Enregistrer la règle

La règle s'exécute immédiatement sur chaque moniteur existant, et la liste montre le groupe auquel elle ajoute des moniteurs sous **Ajoute des moniteurs à**.
:::

Ensuite, une règle s'exécute de nouveau pour un moniteur chaque fois qu'un moniteur est créé ou que ses étiquettes, son nom ou sa description changent. Une règle ne retire que les ressources qu'elle a ajoutées : la désactiver ou la supprimer les retire de la page, et un moniteur que vous avez ajouté à la main n'est jamais touché. Un moniteur déjà sur la page n'est jamais ajouté deux fois.

## Importer des groupes depuis un CSV

Construire une hiérarchie profonde à la main est fastidieux. **Importer des groupes depuis un CSV**, dans le menu à trois points de l'en-tête de la carte, ouvre la boîte de dialogue **Importer des groupes depuis un CSV**.

:::steps
### Télécharger le modèle

Cliquez sur **Télécharger le modèle CSV** pour obtenir `status-page-groups-template.csv`.

### Le remplir

Une ligne par groupe. Seul `name` est obligatoire ; les colonnes sont listées ci-dessous.

### Téléverser et prévisualiser

Cliquez sur **Choisir un fichier CSV**, choisissez votre fichier, puis **Preview Import** pour vérifier ce qui sera créé avant que quoi que ce soit ne soit écrit.

### Importer

Lancez l'import. Un tableau **Résultats de l'import** liste chaque ligne comme **Créé**, **Échec** ou **Ignoré**, avec la raison, si bien qu'une ligne erronée ne disparaît jamais en silence.
:::

| Colonne | Ce qu'elle définit |
| ------ | ------------ |
| `name` | Le nom du groupe. Obligatoire. |
| `parentName` | Le nom du groupe dans lequel celui-ci s'imbrique. |
| `description` | La description du groupe. |
| `isExpandedByDefault` | Si la section commence ouverte pour les visiteurs. |
| `showCurrentStatus` | Si un statut s'affiche à côté du titre du groupe. |
| `showUptimePercent` | Si un pourcentage de disponibilité s'affiche à côté du groupe. |
| `uptimePercentPrecision` | Le nombre de décimales de ce pourcentage. |
| `viewMode` | `List` ou `Grid`. |
| `rowAxisLabel` | Le nom de la dimension des lignes, pour un groupe en grille. |
| `rowAxisValues` | Les valeurs des lignes, pour un groupe en grille. |
| `columnAxisLabel` | Le nom de la dimension des colonnes, pour un groupe en grille. |
| `columnAxisValues` | Les valeurs des colonnes, pour un groupe en grille. |

L'import crée des groupes, pas des ressources : ajoutez ensuite des moniteurs avec **Ajouter un moniteur**, **Ajouter plusieurs** ou une règle de moniteurs.

## Dépannage

:::details « This monitor is already added to this status page »
Une page liste chaque moniteur une seule fois, même d'un groupe à l'autre. Le moniteur a déjà une ressource, peut-être dans un autre groupe ou ajoutée par une règle de moniteurs. Cherchez-le dans le navigateur, supprimez cette ressource et ajoutez le moniteur là où vous le voulez.
:::

:::details Un moniteur que j'ai ajouté n'apparaît pas sur la page de statut
Vérifiez si le moniteur est archivé : la ligne d'un moniteur archivé est omise jusqu'à ce que vous le désarchiviez. Vérifiez aussi le groupe : un groupe configuré pour commencer replié (**Développer par défaut sur la page de statut** désactivé) cache ses lignes jusqu'à ce qu'un visiteur l'ouvre.
:::

:::details Il n'y a pas de bouton Ajouter un moniteur dans un groupe en grille
La grille n'a encore ni lignes ni colonnes. Cliquez sur **Set up the grid**, ajoutez les valeurs des axes dans la section **Mise en page**, et **Ajouter un moniteur** revient.
:::

:::details Je ne peux pas faire glisser les lignes
Videz le champ **Search in {group}...** : le réordonnancement est désactivé tant que le volet est filtré. Les groupes en grille ne se réordonnent jamais par glisser-déposer.
:::

## Étapes suivantes

:::cards
- [Personnalisation et domaines de la page de statut](/docs/status-pages/branding-and-domains): Logo, favicon, couleurs du graphique d'historique et votre propre domaine.
- [Abonnés et annonces](/docs/status-pages/subscribers): Qui est prévenu quand ces ressources changent.
- [Une page de statut par public](/docs/status-pages/one-status-page-per-audience): Le même moniteur sur plusieurs pages, et un incident qui n'en atteint que certaines.
- [API publique](/docs/status-pages/public-api): Lire les ressources, les groupes et la disponibilité en JSON.
:::
