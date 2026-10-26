# Chronologie des astreintes

La chronologie des astreintes affiche tous les plannings d'astreinte de votre projet sur une même grille à la semaine ou au mois : une ligne par planning, une colonne par jour. Elle répond à la question « qui est d'astreinte dans mon équipe, ou dans toute l'organisation, cette semaine ? » sans ouvrir chaque planning.

Les permanences affichées sont celles avec lesquelles OneUptime alerte les personnes, remplacements d'utilisateurs compris : la chronologie, les règles d'escalade et les flux de calendrier les lisent tous au même endroit.

```mermaid title="Un seul ensemble de permanences derrière la chronologie, les alertes et les flux de calendrier"
flowchart TB
    subgraph setup["Chaque planning"]
        direction LR
        layers["Couches et<br/>rotations"]
        overrides["Remplacements<br/>d'utilisateurs"]
    end
    layers --> shifts["Qui est<br/>d'astreinte,<br/>et quand"]
    overrides --> shifts
    shifts --> timeline["Chronologie<br/>des astreintes"]
    shifts --> paging["Les règles<br/>d'escalade<br/>les alertent"]
    shifts --> feeds["Flux de<br/>calendrier"]
```

## Ouvrir la chronologie

- **Astreinte** > **Chronologie des astreintes** affiche tous les plannings que vous pouvez voir, regroupés par équipe propriétaire. Le bouton **Vue chronologique** de **Plannings d'astreinte** ouvre la même page.
- **Équipes** > une équipe > **Plannings d'astreinte** n'affiche que les plannings dont cette équipe est propriétaire.

Une équipe est propriétaire d'un planning lorsqu'elle figure sur la page **Propriétaires** du planning. Les plannings sans équipe propriétaire sont regroupés sous **Aucune équipe propriétaire**. Désactivez **Grouper par équipe** pour voir tous les plannings dans une seule liste, triée par nom.

## Lire la grille

| Sur la grille | Ce que cela signifie |
| --- | --- |
| Une barre | Une permanence : qui est d'astreinte, et de quand à quand. Une personne a la même couleur dans tous les plannings. |
| Une barre estompée | Une permanence passée. |
| Une barre marquée **⇄** | Un remplacement : quelqu'un assure une permanence à la place d'un autre. La fine piste en dessous nomme la personne remplacée, barrée. |
| Un bloc orangé hachuré | Un trou de couverture : personne n'est d'astreinte. Une alerte qui escalade vers ce planning n'alerte alors personne. |
| La ligne rouge | Maintenant. |
| La ligne sous le nom d'un planning | Qui est d'astreinte en ce moment, ou **Personne d'astreinte maintenant**. |

Survolez une barre ou un trou, ou atteignez-le au clavier, pour en voir le détail.

Sous la grille, **D'astreinte cette semaine** (**D'astreinte ce mois-ci** dans la vue mensuelle) liste toutes les personnes d'astreinte sur la période. Survolez un nom pour voir combien de temps la personne est d'astreinte, et sur combien de plannings.

## Changer la période et le fuseau horaire

- Basculez entre **Semaine** et **Mois**, naviguez avec les flèches et revenez avec **Aujourd'hui**.
- Les heures s'affichent dans votre propre fuseau horaire. Le bouton de fuseau horaire ouvre **Afficher la chronologie dans un fuseau horaire**, qui affiche la chronologie dans n'importe quel autre fuseau sans changer qui est d'astreinte : chaque planning continue de faire ses passations dans son propre fuseau.
- La chronologie couvre 180 jours en arrière et 365 jours en avant.

> [!NOTE]
> Les permanences passées sont recalculées à partir de la configuration actuelle de chaque planning : elles montrent donc la rotation telle qu'elle est configurée aujourd'hui, qui peut différer de qui a réellement été alerté à l'époque. Pour les heures réellement passées d'astreinte, utilisez **Astreinte** > **Rapports** > **Temps d'astreinte de l'utilisateur**. Voir [Temps d'astreinte de l'utilisateur](/docs/on-call/readiness#temps-dastreinte-de-lutilisateur).

## Trouver un planning ou une personne

- **Rechercher** trouve les noms de plannings, les noms d'équipes et les personnes d'astreinte.
- Le filtre d'équipe restreint l'affichage à une équipe ou à **Mes équipes** ; **Plannings dont je fais partie** ne garde que les plannings dont vous faites partie.
- Au-dessus de la grille, cliquez sur **sans personne d'astreinte maintenant** ou **avec des trous de couverture cette semaine** (**avec des trous de couverture ce mois-ci** dans la vue mensuelle) pour ne voir que ces plannings. Cliquez à nouveau pour les revoir tous.
- Cliquez sur une personne sous la grille, ou sur l'une de ses barres, pour mettre en évidence toutes ses permanences. **Effacer la mise en évidence** l'annule, et **Effacer les filtres** réinitialise la recherche et les filtres.

## Qui voit quoi

| S'applique à | Règle |
| --- | --- |
| Autorisations | Les mêmes autorisations et restrictions par étiquette que **Plannings d'astreinte**, plus l'autorisation de lire les couches des plannings. |
| Remplacements | La personne dont un remplacement couvre la permanence n'est visible que de ceux qui peuvent lire les remplacements d'utilisateurs. Les autres voient quand même qui est alerté. |
| Nombre de plannings | Jusqu'à 250 plannings à la fois, triés par nom. La page **Plannings d'astreinte** d'une équipe la limite aux plannings de cette équipe. |
| Offre | Sur OneUptime Cloud, la chronologie nécessite l'offre **Growth**, comme les plannings d'astreinte. |

## Étapes suivantes

:::cards
- [Plannings d'astreinte](/docs/on-call/schedules): Définir qui assure l'astreinte à tour de rôle, les couches et les heures d'astreinte.
- [Flux de calendrier](/docs/on-call/calendar-feeds): Mettre vos permanences dans Google Agenda, Outlook ou Apple Calendrier.
- [Règles d'escalade](/docs/on-call/escalation-rules): Décider qui chaque niveau d'une politique d'astreinte alerte.
:::
