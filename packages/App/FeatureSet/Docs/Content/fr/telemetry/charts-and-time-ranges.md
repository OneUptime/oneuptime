# Zoomer sur une plage temporelle

Faites glisser le pointeur sur un graphique pour zoomer la page sur ce moment, et double-cliquez pour revenir. Cette page explique les gestes, le comportement d'un zoom et quels graphiques zooment quoi.

:::cards
- [Zoomer et revenir](#zoomer-et-revenir): Les deux gestes et le bouton Reset zoom.
- [Comment se comporte le zoom](#comment-se-comporte-le-zoom): Zooms imbriqués, actualisation automatique, clics et glisser.
- [Où cela fonctionne](#où-cela-fonctionne): Les pages et graphiques dont un glisser change la plage.
- [Graphiques sans zoom](#graphiques-sans-zoom): Bandes, jauges et sparklines.
:::

## Zoomer et revenir

Chaque graphique de série temporelle de OneUptime sert aussi de sélecteur de plage temporelle. Quand un graphique montre un pic que vous voulez examiner, inutile d'ouvrir le sélecteur et de saisir des dates :

:::steps
1. **Faites glisser le pointeur sur le pic** dans n'importe quel graphique. La plage temporelle de la page passe à la fenêtre que vous avez tracée, exactement comme si vous l'aviez choisie dans le sélecteur de plage. Chaque graphique, et chaque tuile ou tableau calculé à partir de la plage de la page, refait sa requête pour elle : vous lisez ainsi un même moment partout.
2. **Double-cliquez sur n'importe quel graphique** pour revenir. La page retrouve la plage temporelle qu'elle avait avant que vous commenciez à zoomer.
:::

Les panneaux qui montrent l'état actuel restent sur maintenant, comme lorsque vous choisissez vous-même une plage : décomptes d'inventaire, santé, plus gros consommateurs de ressources, avertissements récents, incidents et alertes ouverts, et listes en direct d'un tableau de bord.

Tant qu'un zoom est actif, un bouton **Reset zoom** apparaît à côté du sélecteur de plage temporelle de la page. Il fait la même chose qu'un double-clic, et c'est le moyen de revenir au clavier et sur écran tactile.

```mermaid title="Ce que font un glisser, un double-clic et le sélecteur à la plage de la page"
stateDiagram-v2
    state "Plage du sélecteur" as Picked
    state "Fenêtre zoomée" as Zoomed
    [*] --> Picked
    Picked --> Zoomed: glisser sur un graphique
    Zoomed --> Zoomed: glisser à nouveau
    Zoomed --> Picked: double-clic ou Reset zoom
    Zoomed --> Picked: choisir une plage
```

## Comment se comporte le zoom

- **Zoomez aussi loin que vous voulez ; une seule réinitialisation remonte tout.** Après être passé de « Past 1 Hour » à dix minutes puis à une, un seul double-clic (ou **Reset zoom**) rend l'heure entière au lieu de remonter un niveau à la fois.
- **N'importe quel graphique peut réinitialiser n'importe quel zoom.** Glissez sur le graphique CPU, double-cliquez sur celui de la mémoire : c'est la page qui est zoomée, pas le graphique.
- **Choisir vous-même une plage repart de zéro.** Un préréglage ou une plage personnalisée dans le sélecteur est un nouveau point de départ : le zoom est terminé et **Reset zoom** disparaît.
- **Une fenêtre zoomée est fixe.** « Past 30 Minutes » avance avec l'horloge ; un zoom est une fenêtre fixe, il cesse donc d'avancer tant que l'actualisation automatique est active. Réinitialisez le zoom pour qu'elle reprenne.
- **Un zoom ne dépasse jamais maintenant.** Le compartiment le plus récent d'un graphique est en général encore en train de se remplir ; un glisser qui s'y termine est coupé à l'heure actuelle.
- **Vous pouvez relâcher la souris hors du graphique** : le glisser compte quand même.
- **Inutile d'attendre le chargement des graphiques pour revenir.** Juste après un zoom, pendant que les graphiques chargent encore la fenêtre tracée, ou quand cette fenêtre se révèle vide, un double-clic sur un graphique réinitialise aussitôt le zoom.
- **Double-cliquer sur une page non zoomée ne fait rien.**

### Clics et glisser

- **Sur les graphiques en lignes, en aires et en barres, un simple clic n'est pas un zoom.** Cela concerne la plupart des graphiques : cartes de métriques et explorateur de métriques, vues d'ensemble des ressources, SLO, moniteurs et tous les graphiques d'un tableau de bord. Seul un glisser sur plusieurs compartiments zoome : cliquer sur un point, une barre ou une entrée de légende continue donc de faire ce qu'il faisait. Tant qu'un zoom est actif, un clic sur la zone de tracé d'un graphique prend effet un instant plus tard, pour le distinguer du double-clic qui réinitialise. La chronologie des motifs d'erreur dans les Insights des journaux et l'Occurrence Trend d'une exception ne zooment eux aussi que sur un glisser.
- **Sur les graphiques de volume des explorateurs, un clic sur une barre zoome sur cette barre.** Les graphiques de volume des explorateurs de journaux, de traces, d'exceptions et d'événements de sécurité, ainsi que les graphiques d'analyse des journaux et des traces, zooment sur les barres que vous parcourez en glissant, ou sur la barre que vous cliquez. Ces graphiques affichent **Cliquez ou faites glisser pour zoomer**.

### Indications sur les graphiques

La plupart des graphiques qui zooment indiquent le geste au-dessus de la zone de tracé, **Faites glisser pour zoomer** ou **Cliquez ou faites glisser pour zoomer**, et, tant qu'un zoom est actif, ajoutent le rappel **double-cliquez pour réinitialiser**. Les cartes de métriques, l'explorateur de métriques et les graphiques de volume des explorateurs affichent toujours l'indication. Sur les cartes de graphiques des vues d'ensemble des ressources et des SLO, et sur certains widgets de tableau de bord, elle n'apparaît que lorsque vous pointez sur la carte ou y entrez avec la touche Tab.

## Où cela fonctionne

Le zoom change la plage de toute la page sur :

- les vues d'ensemble des ressources et leurs pages d'Insights : clusters Kubernetes, hôtes Docker, Podman et Docker Swarm, hôtes et leurs processus, services et unités systemd, VMware, Proxmox, Ceph, baies de stockage, bases de données, ressources cloud et fonctions serverless ;
- les services et les applications RUM ;
- les métriques et le trafic des équipements réseau ;
- les cartes de métriques, y compris l'onglet Métriques d'une ressource et les métriques d'un moniteur ;
- l'explorateur de métriques ;
- les graphiques d'historique des SLO ;
- les Insights des journaux, y compris la chronologie « Quand c'est arrivé » d'un motif d'erreur, dont le panneau a son propre **Reset zoom** parce qu'il recouvre le sélecteur de la page ;
- les graphiques de volume des journaux, des traces, des exceptions et des événements de sécurité, ainsi que les graphiques d'analyse des journaux et des traces, qui changent la plage de leur explorateur ;
- les [tableaux de bord](/docs/dashboards/authoring), où un glisser change la plage de tout le tableau de bord.

Les graphiques qui ont leur propre fenêtre ne zooment que cette fenêtre et ne changent donc jamais rien d'autre sur la page. Cela concerne l'aperçu d'une métrique dans le formulaire d'un moniteur (le moniteur continue d'évaluer sa propre fenêtre glissante), l'Occurrence Trend d'une exception, un graphique ouvert dans une fenêtre contextuelle ou dans le panneau d'investigation, et les graphiques des réponses du chat IA. Un double-clic sur l'un d'eux, ou son bouton **Reset zoom**, rétablit sa propre fenêtre.

L'instantané de télémétrie d'une page d'incident, d'alerte ou d'épisode a lui aussi sa propre fenêtre. Un glisser sur son graphique (le graphique de métrique, ou le graphique de volume des journaux, des traces ou des exceptions quand c'est ce que montre l'instantané) zoome tout l'instantané : ses onglets Métriques, Journaux, Traces et Exceptions montrent tous la tranche tracée. **Reset zoom** à côté du badge de l'instantané, ou un double-clic sur ce graphique, rétablit la fenêtre de l'instantané.

## Graphiques sans zoom

Quelques visualisations n'ont pas d'axe temporel sur lequel glisser, sont trop petites pour cela, ou affichent toujours une fenêtre fixe qui leur est propre ; elles ne zooment donc pas :

- les bandes d'historique de disponibilité (une barre par jour), qui ne peuvent rien montrer de plus fin qu'un jour ;
- les barres de répartition et de proportion, les jauges et les barres de progression ;
- les graphiques en flammes, les cartes de services et les diagrammes de flux ;
- les petites sparklines de tendance des listes de métriques, où un clic ouvre la métrique : ouvrez-la pour obtenir un graphique que vous pouvez zoomer ;
- les petites sparklines qui ont leur propre fenêtre fixe, comme le temps aller-retour d'un équipement réseau sur la dernière heure : leur lien **Ouvrir les métriques** mène à des graphiques que vous pouvez zoomer.

## Étapes suivantes

:::cards
- [Créer un tableau de bord](/docs/dashboards/authoring): Le zoom fonctionne sur chaque graphique d'un tableau de bord.
- [Syntaxe de recherche](/docs/telemetry/search-syntax): Filtrer les explorateurs une fois le moment trouvé.
- [Surveillance des métriques](/docs/monitor/metrics-monitor): Alerter sur la métrique que vous regardiez.
:::
