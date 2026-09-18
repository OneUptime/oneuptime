# Ressources et groupes

Une ressource, c'est une ligne de votre page de statut — un moniteur (ou un groupe de moniteurs) avec un nom que les visiteurs comprennent, un état courant, et éventuellement un pourcentage de disponibilité et un graphique d'historique. Un groupe, c'est une section qui contient des ressources, pour qu'une page de quarante moniteurs se lise « API », « Application web » et « Pipeline de données » plutôt que comme une liste interminable.

Vous construisez les deux sur un seul écran. Ouvrez une page de statut et choisissez **Ressources** dans le menu latéral (l'entrée s'appelle **Moniteurs** sur les projets qui n'ont pas les groupes de moniteurs activés). Les groupes avaient autrefois leur propre page ; ce n'est plus le cas, et l'ancienne URL `/groups` redirige simplement ici.

Réussissez cette partie et le reste de la page de statut n'est plus que décoration. C'est sur ces lignes que les visiteurs tranchent la question « ça vient de moi ou de chez eux ? » : nommez-les donc comme vos clients parlent de votre produit — **Checkout API**, pas `prod-checkout-lb-healthcheck-us-east-1`.

## L'écran Ressources

L'écran est coupé en deux. À gauche, un navigateur qui liste tous les groupes de la page ; à droite, le contenu du groupe que vous avez sélectionné.

- **Le navigateur de groupes (à gauche)** — une arborescence de groupes, avec un champ de recherche (**Search groups...**) au-dessus et un compteur en dessous, du type `3 groups · 12 resources`. Quand une page compte plus de groupes que la place disponible, un bouton **Show N more of M** révèle le reste.
- **Top of page** — la première ligne du navigateur. Elle contient les ressources qui n'appartiennent à aucun groupe, et son infobulle le dit exactement : les visiteurs les voient en premier, au-dessus de tous les groupes. Si la page n'a aucun groupe, le volet de droite s'intitule **All resources** à la place.
- **Le volet des ressources (à droite)** — il porte le nom du groupe sélectionné. Son en-tête regroupe **Edit Group**, le bouton principal **Ajouter un moniteur**, et un menu de dépassement **More actions**.

Deux boutons vivent dans l'en-tête de la carte elle-même : **New Group**, et un menu à trois points contenant **Import groups from CSV** et **Actualiser**.

La description de la carte change selon la forme de votre page. Avec des groupes, elle indique qu'il s'agit de tout ce que voient les visiteurs et qu'il faut choisir un groupe à gauche pour modifier son contenu. Sans aucun groupe, elle vous pousse à en créer un pour découper une page trop longue en sections.

**Les états vides vous disent quoi faire.** Un groupe vide affiche **No monitors here yet** avec **Ajouter un moniteur**, **Add Multiple** et — uniquement quand la page de statut n'a aucun groupe — **Create a Group**. Une recherche sans résultat affiche **No resources match your search**. Un navigateur vide explique que les groupes découpent une page de statut trop longue en sections et qu'ils peuvent être imbriqués.

## Ajouter un moniteur

Sélectionnez le groupe dans lequel la ressource doit atterrir (ou **Top of page** pour une ligne sans groupe), puis cliquez sur **Ajouter un moniteur**. La fenêtre s'intitule **Add a monitor to {group}** et comporte deux étapes : **Détails du moniteur** et **Avancé**.

Sur **Détails du moniteur** :

- **Moniteur** — la liste déroulante des moniteurs de votre projet, texte indicatif **Sélectionner le moniteur**. Obligatoire.
- **Nom d'affichage** — obligatoire. C'est le texte que lisent les visiteurs, et il est stocké séparément du nom propre du moniteur : vous pouvez donc le renommer ici sans toucher à la surveillance.
- **Description** — du markdown facultatif affiché sous la ligne. Idéal pour une phrase expliquant ce que fait réellement le service.

Si votre projet a les groupes de moniteurs activés, un lien sous la liste déroulante indique **Add a Monitor Group instead.** — cliquez dessus et la liste **Moniteur** est remplacée par une liste **Moniteur Groupe** (**Sélectionner le groupe de moniteurs**). Le lien bascule alors en **Add a Monitor instead.** pour revenir en arrière. Servez-vous d'un groupe de moniteurs quand vous voulez qu'une seule ligne de la page représente plusieurs vérifications agrégées.

### En ajouter plusieurs d'un coup

**Add Multiple** (aussi **Add multiple monitors** dans le menu **More actions**) ouvre **Add Multiple Monitors**. Les deux étapes sont les mêmes, mais la première propose une sélection multiple **Moniteurs** au lieu d'une liste déroulante unique, et les options d'affichage choisies sur **Avancé** s'appliquent à tous les moniteurs retenus. C'est la façon la plus rapide d'amorcer une nouvelle page.

## Options d'affichage d'une ressource

L'étape **Avancé** est identique dans le formulaire d'ajout unitaire et dans la fenêtre d'ajout en masse. Tout ici vaut par ressource — deux lignes du même groupe peuvent être configurées différemment.

| Champ                                                                       | Rôle                                                                                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Infobulle** (`displayTooltip`)                                            | Texte supplémentaire affiché à côté de la ressource sur votre page de statut. Servez-vous-en pour la portée : « Clients US et UE ». |
| **Afficher l'état actuel de la ressource** (`showCurrentStatus`)            | Activé par défaut. Affiche l'état en direct — opérationnel, dégradé, hors ligne — à côté de la ligne.               |
| **Afficher le % de disponibilité** (`showUptimePercent`)                    | Désactivé par défaut. Affiche un pourcentage de disponibilité à côté de la ressource.                              |
| **Sélectionner la précision de disponibilité** (`uptimePercentPrecision`)   | N'apparaît qu'une fois **Afficher le % de disponibilité** activé. Obligatoire, une décimale par défaut.            |
| **Afficher le graphique de l'historique des états** (`showStatusHistoryChart`) | Activé par défaut. Affiche le graphique en barres de la disponibilité jour par jour pour la ressource.            |

**Nom d'affichage** (`displayName`) et **Description** (`displayDescription`) de la première étape relèvent eux aussi du pur affichage — ils ne changent jamais le moniteur lui-même.

## Pourcentages de disponibilité et graphiques d'historique

**Afficher le % de disponibilité** et **Afficher le graphique de l'historique des états** dépendent tous deux d'un réglage qui vit ailleurs. La fenêtre qu'ils couvrent est **Afficher l'historique de disponibilité (en jours)**, sous **Pages de statut → votre page → Avancé → Paramètres avancés**, dans la carte **Paramètres de l'historique de disponibilité**. Elle accepte de 1 à 90 jours et vaut 90 par défaut.

La séquence est donc : activez les bascules ressource par ressource, puis réglez la fenêtre une bonne fois pour toute la page.

**La précision est un choix éditorial.** La liste **Sélectionner la précision de disponibilité** propose `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` et `99.999% (Three Decimal)`. Plus il y a de décimales, plus cela paraît précis — et plus on se dispute sur la troisième ; si vous publiez un SLA à trois neufs, alignez-vous dessus et n'allez pas plus loin.

Les groupes ont leurs propres copies de ces bascules — voyez plus bas — de sorte qu'un groupe peut afficher un pourcentage agrégé pendant que les moniteurs qu'il contient restent discrets, ou l'inverse.

Les couleurs des barres du graphique d'historique, et le choix des statuts de moniteur qui comptent comme « en panne », se règlent sur l'écran d'image de marque **Page de vue d'ensemble**, traité dans [Personnalisation et domaines de la page de statut](/docs/status-pages/branding-and-domains).

## Groupes

Cliquez sur **New Group** pour ouvrir **Create New Status Page Group**. Le formulaire a trois étapes : **Détails du groupe**, **Mise en page** et **Avancé**.

**Détails du groupe** :

- **Nom du groupe** (`name`) — obligatoire. C'est l'intertitre de section que voient les visiteurs.
- **Description du groupe** (`description`) — du markdown facultatif, affiché sous l'intertitre.
- **Parent Group** (`parentStatusPageGroupId`) — facultatif. Laissez **No parent group (top level)** pour garder le groupe au premier niveau.
- **Développer par défaut sur la page de statut** (`isExpandedByDefault`) — si la section démarre ouverte ou repliée pour les visiteurs.

**Avancé** reprend les bascules des ressources, à l'échelle du groupe :

- **Afficher l'état actuel du groupe** (`showCurrentStatus`) — activé par défaut. Affiche un état à côté de l'intertitre du groupe.
- **Afficher le % de disponibilité** (`showUptimePercent`) — désactivé par défaut, avec **Sélectionner la précision de disponibilité** qui apparaît une fois activé.

La modification fonctionne de la même façon : **Edit Group** dans l'en-tête du volet, ou **Edit group** dans le menu de la ligne du navigateur, ouvre **Edit Status Page Group** avec un bouton **Enregistrer les modifications**.

L'en-tête du volet affiche des pastilles pour les réglages actuellement actifs — **Grid**, **Collapsed by default**, **Uptime %** — de quoi voir la configuration d'un groupe sans ouvrir le formulaire.

### Gérer un groupe

Le menu de chaque ligne du navigateur contient **Edit group**, **Move up**, **Move down**, **Afficher l'ID** et **Delete group**. Le menu **More actions** du volet propose les équivalents en version longue — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Actualiser** et **Delete this group**. Un groupe enregistré sans nom s'affiche **Untitled group**, ce qui est un bon indice que vous vouliez taper quelque chose.

## Imbriquer les groupes

Les groupes sont imbricables : renseignez **Parent Group** sur l'enfant, ou utilisez l'action **Add a sub group inside this group** du navigateur. Le texte d'aide du formulaire décrit la forme pour laquelle il a été pensé — quelque chose comme Entités › Région › Marché — et précise que chaque niveau affiche l'état et la disponibilité agrégés de tout ce qui se trouve en dessous.

Quand un groupe a des enfants, le volet des ressources affiche une rangée de pastilles **Sub groups** qui mènent directement à chaque enfant : vous parcourez ainsi la hiérarchie sans repasser par le navigateur.

L'imbrication prend tout son sens sur les grandes pages : un hébergeur avec des régions à l'intérieur des produits, un distributeur avec des marchés à l'intérieur d'unités commerciales. Sur une page de douze moniteurs, un seul niveau plat est plus accueillant.

## Mise en page liste ou grille

L'étape **Mise en page** définit le **Mode d'affichage** (`viewMode`) du groupe, et cela change son rendu public.

| Si vous voulez…                                                            | Choisissez                     |
| -------------------------------------------------------------------------- | ------------------------------ |
| Afficher une simple liste verticale de services, un par ligne              | **List** (le choix par défaut) |
| Afficher le même service sur plusieurs régions ou locataires, en matrice   | **Grid**                       |

Choisissez **Grid** et quatre champs supplémentaires apparaissent :

- **Libellé de l'axe des lignes** — le nom de la dimension des lignes, texte indicatif `Service`.
- **Valeurs de l'axe des lignes** — les lignes elles-mêmes, ajoutées une à une avec **Add Row** (texte indicatif `e.g. Auth`).
- **Étiquette de l'axe des colonnes** — la dimension des colonnes, texte indicatif `Region`.
- **Valeurs de l'axe des colonnes** — ajoutées avec **Add Column** (texte indicatif `e.g. US-East`).

Chaque moniteur d'un groupe en grille est ensuite placé dans une cellule ; la fenêtre d'ajout en masse demande donc la ligne et la colonne en même temps que les moniteurs, en reprenant vos propres libellés d'axes.

**Mettez les axes en place avant d'ajouter des moniteurs.** Un groupe en grille sans lignes ni colonnes affiche un avertissement orangé expliquant qu'il n'y a nulle part où mettre un moniteur tant que les axes n'existent pas, avec un bouton **Set up the grid** — et le bouton **Ajouter un moniteur** disparaît tant que ce n'est pas fait.

## Ordonner ce que voient les visiteurs

L'ordre est explicite, pas alphabétique, et il se règle à trois endroits :

- **Les ressources à l'intérieur d'un groupe** — faites glisser une ligne. Le volet le dit lui-même : **Drag a row to change the order visitors see**.
- **Les groupes les uns par rapport aux autres** — **Move up** / **Move down** dans le menu de la ligne du navigateur, ou **Move group up** / **Move group down** dans le menu de dépassement du volet.
- **Les ressources sans groupe** — elles vivent dans **Top of page** et s'affichent toujours au-dessus de tous les groupes ; mettez-y donc la seule chose que tout le monde vient vérifier.

**Deux cas où le glisser-déposer est désactivé.** Filtrer le volet avec le champ **Search in {group}...** désactive le réordonnancement — le volet affiche `N of M shown · drag to reorder is off while filtering`, alors videz d'abord la recherche. Et les groupes en grille ne prennent jamais en charge l'ordre par glisser-déposer, puisque la position vient des axes lignes et colonnes.

Mettez en haut le service dont on vous parle le plus. Les visiteurs venus pendant une panne s'arrêtent généralement de lire après le premier écran.

## Importer des groupes depuis un CSV

Construire une hiérarchie profonde à la main est fastidieux. Le menu à trois points de l'en-tête de la carte propose **Import groups from CSV**, qui ouvre la fenêtre **Import Groups from CSV**.

Le parcours : **Download CSV Template** pour récupérer `status-page-groups-template.csv`, remplissez-le, **Choose CSV File**, puis **Preview Import** pour vérifier ce qui sera créé avant que quoi que ce soit ne soit écrit. Ensuite, un tableau **Import results** liste chaque ligne comme **Created**, **Failed** ou **Skipped**, avec le motif, pour qu'une mauvaise ligne ne disparaisse pas en silence.

Seul `name` est obligatoire. Les colonnes acceptées sont :

| Colonne                  | Ce qu'elle définit                                                    |
| ------------------------ | --------------------------------------------------------------------- |
| `name`                   | Le nom du groupe. Obligatoire.                                        |
| `parentName`             | Le nom du groupe dans lequel celui-ci s'imbrique.                     |
| `description`            | La description du groupe.                                             |
| `isExpandedByDefault`    | Si la section démarre ouverte pour les visiteurs.                     |
| `showCurrentStatus`      | Si un état s'affiche à côté de l'intertitre du groupe.                |
| `showUptimePercent`      | Si un pourcentage de disponibilité s'affiche à côté du groupe.        |
| `uptimePercentPrecision` | Le nombre de décimales de ce pourcentage.                             |
| `viewMode`               | `List` ou `Grid`.                                                     |
| `rowAxisLabel`           | Le nom de la dimension des lignes pour un groupe en grille.           |
| `rowAxisValues`          | Les valeurs de lignes pour un groupe en grille.                       |
| `columnAxisLabel`        | Le nom de la dimension des colonnes pour un groupe en grille.         |
| `columnAxisValues`       | Les valeurs de colonnes pour un groupe en grille.                     |

L'import crée des groupes, pas des ressources — ajoutez les moniteurs ensuite avec **Ajouter un moniteur** ou **Add Multiple**.

## Où lire ensuite

- [Vue d'ensemble des pages de statut](/docs/status-pages/index) — ce qu'est une page de statut et comment les pièces s'emboîtent.
- [Personnalisation et domaines de la page de statut](/docs/status-pages/branding-and-domains) — logo, favicon, couleurs du graphique, et mettre la page sur votre propre domaine.
- [Abonnés et annonces](/docs/status-pages/subscribers) — qui est prévenu quand ces ressources changent d'état.
- [API publique](/docs/status-pages/public-api) — lire les données de la page de statut par programme.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — ce qui fait apparaître un incident sur la page, et disparaître.
