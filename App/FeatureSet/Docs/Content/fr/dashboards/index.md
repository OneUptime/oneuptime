# Présentation des tableaux de bord

Les tableaux de bord sont la manière dont vous transformez la télémétrie que OneUptime collecte déjà — métriques, journaux, traces, incidents, monitors, ressources Kubernetes et Docker — en une page unique qu'on peut consulter d'un coup d'œil pour comprendre la santé d'un système.

Déposez un graphique de la latence des requêtes à côté d'une liste d'incidents ouverts à côté d'une jauge d'utilisation CPU à côté d'une phrase de statut en français clair. Enregistrez. Partagez le lien.

## En un coup d'œil

- **Fonctionnalité de premier niveau** dans le tableau de bord OneUptime, sous **Tableaux de bord**.
- **Canevas basé sur une grille** — 12 unités de large par 60 unités de haut par défaut. Glissez des widgets dedans, redimensionnez-les, alignez sur la grille.
- **Plus de 20 types de widgets** — graphiques, valeurs uniques, jauges, tableaux, blocs de texte, flux de journaux, listes de traces et listes de ressources en direct pour les incidents, alertes, monitors, Kubernetes (pods, nœuds, deployments, …), Docker et hôtes.
- **Variables et filtres** — transforment un tableau de bord unique en vue templatée qui se réutilise pour chaque cluster, service, client ou environnement.
- **Partage public** — basculez un interrupteur et le tableau de bord est accessible sur une URL publique, avec protection par mot de passe optionnelle et liste blanche d'IP.
- **Domaines personnalisés** — hébergez un tableau de bord public sur `status.your-domain.com` au lieu de celui de OneUptime.

## Pourquoi utiliser des tableaux de bord ?

Les tableaux de bord gagnent leur place quand l'une de ces conditions est vraie :

- **Vous avez besoin d'une page « tout va bien ? »** pour une rotation d'astreinte, un standup d'équipe ou un PDG qui passe devant l'écran mural.
- **Vous devez corréler des signaux** — un pic CPU à la même minute qu'une augmentation de latence de trace et un incident ouvert est bien plus évident sur un tableau de bord que sur trois onglets.
- **Vous enquêtez** — un tableau de bord libre que vous construisez pendant une session de débogage est plus rapide que d'exécuter dix requêtes à la main.
- **Vous publiez en externe** — un tableau de bord de performance orienté client, une vue consolidée pour partenaires, un panneau de santé public pour un service open-source.

## Concepts clés

| Terme | Signification |
| --- | --- |
| **Tableau de bord** | Le canevas. Une vue nommée et réutilisable qui contient une liste de widgets, un contrôle de plage temporelle et un ensemble de variables. |
| **Widget** | Un composant sur le canevas — un graphique, une valeur, un tableau, un bloc de texte, une liste. Chacun a un type et une configuration de style JSON. |
| **Unité de tableau de bord** | Le carré de la grille. Les widgets sont dimensionnés en unités de tableau de bord (par exemple, « 4 de large × 6 de haut »). Les unités se convertissent en pixels en fonction de la fenêtre. |
| **Variable** | Une valeur nommée que le visualiseur choisit dans une liste déroulante (ou tape) et que le tableau de bord injecte dans la requête de chaque widget. Cluster, service, client, environnement — tout ce sur quoi vous voudriez filtrer. |
| **Plage temporelle** | La fenêtre de temps sur laquelle chaque widget interroge. Choisissez un préréglage (« dernières 24 heures ») ou une plage personnalisée. |
| **Intervalle de rafraîchissement** | À quelle fréquence les widgets re-interrogent en mode **View**. Off, 5s, 10s, 30s, 1m, 5m, 15m. |
| **Mode** | `Edit` (glisser, redimensionner, configurer) ou `View` (lecture seule). Les deux partagent le même canevas. |

## Le catalogue des widgets

Une carte non exhaustive de ce que vous pouvez mettre sur un tableau de bord :

| Catégorie | Widgets |
| --- | --- |
| **Série temporelle** | Chart |
| **Nombre unique** | Value, Gauge |
| **Tabulaire** | Table |
| **Annotation** | Text |
| **Journaux et traces** | LogStream, TraceList |
| **Listes opérationnelles** | IncidentList, AlertList, MonitorList |
| **Kubernetes** | KubernetesPodList, KubernetesNodeList, KubernetesNamespaceList, KubernetesDeploymentList, KubernetesStatefulSetList, KubernetesDaemonSetList, KubernetesJobList, KubernetesCronJobList |
| **Docker** | DockerHostList, DockerContainerList, DockerImageList, DockerNetworkList, DockerVolumeList |
| **Infrastructure** | HostList |

Pour les arguments de chacun et quand vous y tourner, voir [Widgets](/docs/dashboards/widgets).

## Où vivent les tableaux de bord dans le tableau de bord

| Page | Ce que vous y faites |
| --- | --- |
| **Tableaux de bord** | Parcourir, créer, rechercher, étiqueter les tableaux de bord. |
| **Un tableau de bord → View** | Le canevas — mode Edit pour les auteurs, mode View pour tout le monde. Basculez entre eux dans l'en-tête. |
| **Un tableau de bord → Overview** | Description, propriété, étiquettes. |
| **Un tableau de bord → Settings** | Partage public, mot de passe maître, liste blanche d'IP, domaines personnalisés, branding (titre de page, description, logo, favicon). |
| **Un tableau de bord → Owners** | Utilisateurs et équipes avec propriété explicite. |
| **Un tableau de bord → Delete** | Supprimer le tableau de bord (irréversible). |

## Le cycle de vie d'un tableau de bord

1. **Créer** — Sous **Tableaux de bord → Create Dashboard**, donnez-lui un nom. Le canevas s'ouvre vide.
2. **Déposer des widgets** — Depuis la palette de widgets, choisissez un type, configurez sa source (une requête de métrique, un filtre de liste, un corps texte libre). Positionnez et redimensionnez.
3. **(Optionnel) Ajouter des variables** — Définissez une liste déroulante comme `cluster` ou `service` afin que le même tableau de bord se rende pour chaque valeur.
4. **Régler la plage temporelle et l'intervalle de rafraîchissement** — Les valeurs par défaut conviennent ; ajustez-les plus tard.
5. **(Optionnel) Partager publiquement** — Sous **Settings**, activez **Public Dashboard**. Ajoutez un mot de passe maître si vous voulez une porte, ou restreignez par IP.
6. **(Optionnel) Domaine personnalisé** — Ajoutez un enregistrement `dashboard.your-domain.com` et vérifiez le DNS, puis servez le tableau de bord sur votre propre URL.

## Un exemple détaillé

Objectif : une page d'astreinte pour le service checkout avec la latence, le taux d'erreur, les incidents ouverts et une queue récente de journaux.

1. Créez un tableau de bord « Checkout oncall ».
2. Ajoutez une variable `service` de type **Telemetry Attribute** liée à la clé d'attribut `service.name`. Valeur par défaut `checkout`.
3. Ajoutez un widget **Chart** : latence P95 depuis votre métrique APM, filtré par `service.name = {{service}}`. La plage temporelle suit le tableau de bord.
4. À côté, ajoutez un widget **Value** : pourcentage de taux d'erreur avec un seuil d'avertissement à 1 % et un seuil critique à 5 %.
5. En dessous, ajoutez un widget **IncidentList** filtré par étiquettes incluant `checkout`.
6. En dessous, un widget **LogStream** filtré par `service.name = {{service}}`.
7. Enregistrez. Changez la liste déroulante de la variable à `payments` — l'ensemble du tableau de bord se rerend pour le service payments. Même template, filtre différent.

## Comment les tableaux de bord s'intègrent au reste de OneUptime

- **Les monitors et la télémétrie** alimentent les tableaux de bord avec des données brutes — chaque métrique que vous avez configurée, chaque ligne de journal que vous avez ingérée, chaque trace est interrogeable sur un widget.
- **Les incidents et alertes** apparaissent dans les widgets **IncidentList** et **AlertList** — les tableaux de bord sont des vues en lecture seule sur eux ; créez/modifiez ces entités ailleurs.
- **Les status pages** sont un outil de communication orienté client (« est-ce que le système est en marche en ce moment ? »). Les tableaux de bord sont un outil analytique (« comment le système se comporte-t-il en détail ? »). Les deux sont complémentaires, pas des substituts.
- **Les workflows** sont le côté écriture de OneUptime — les tableaux de bord sont le côté lecture.

## Où lire ensuite

- [Créer un tableau de bord](/docs/dashboards/authoring) — utilisation du canevas, de la grille, mode édition vs vue.
- [Widgets](/docs/dashboards/widgets) — le catalogue et la configuration par widget.
- [Variables et filtres](/docs/dashboards/variables) — templater un tableau de bord pour qu'il fonctionne pour de nombreux services / clients / clusters.
- [Partage et tableaux de bord publics](/docs/dashboards/sharing) — URL publiques, mot de passe maître, liste blanche d'IP, domaines personnalisés.
- [Configuration et permissions](/docs/dashboards/configuration) — propriété, étiquettes, rétention, contrôle d'accès basé sur les rôles.
