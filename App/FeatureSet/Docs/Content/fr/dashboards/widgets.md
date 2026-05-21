# Widgets

Un widget est une tuile sur un tableau de bord. Cette page liste chaque widget que vous pouvez ajouter, ce qu'il affiche et quand y avoir recours.

Pour savoir comment glisser les widgets sur le canevas, voir [Création d'un tableau de bord](/docs/dashboards/authoring).

## Graphiques et nombres

### Chart

Un graphique en courbes, en barres ou en aires d'une ou plusieurs séries de métriques sur la plage temporelle du tableau de bord.

**Paramètres** :

- Une ou plusieurs requêtes de métriques.
- Une formule optionnelle qui combine deux requêtes (par exemple, `errors / total * 100` pour obtenir un taux d'erreur).
- Une option « afficher comme un taux » pour les compteurs cumulatifs qui grandissent sans se réinitialiser.
- Options d'affichage : empilé ou superposé, unité de l'axe Y, position de la légende, type de graphique.

À utiliser quand : les tendances sont importantes. Latence dans le temps, nombre d'erreurs, profondeur de file d'attente, tout ce dont la forme de la courbe raconte l'histoire.

### Value

Un grand nombre unique avec des seuils colorés optionnels.

**Paramètres** :

- Une requête de métrique qui renvoie un seul nombre (dernière valeur, moyenne ou max sur la plage temporelle).
- Un seuil d'**avertissement** optionnel (jaune au-dessus).
- Un seuil **critique** optionnel (rouge au-dessus).
- Format du nombre et unité.

À utiliser quand : un seul nombre répond à la question. Taux d'erreur actuel, latence P95 à l'instant, nombre d'incidents ouverts.

### Gauge

Une jauge circulaire avec un minimum, un maximum, une bande d'avertissement et une bande critique.

**Paramètres** : une requête de métrique et les quatre bornes.

À utiliser quand : la valeur s'inscrit dans une plage connue. Pourcentage CPU (0–100 %), utilisation du disque, capacité d'une file.

### Table

Un tableau des résultats d'une métrique, une ligne par groupe.

**Paramètres** : une requête de métrique (généralement regroupée par une étiquette comme hôte ou service), les colonnes à afficher et une limite de lignes.

À utiliser quand : vous voulez une décomposition plutôt qu'une tendance. Top 10 des hôtes les plus bruyants, nombre d'erreurs par service, requêtes par endpoint.

## Text

Un bloc statique de Markdown.

**Paramètres** : le corps en Markdown. Titres, listes, liens, emphase et blocs de code sont tous rendus.

À utiliser quand : vous voulez un titre de section, un paragraphe de contexte, une liste de liens vers des runbooks ou une bannière temporaire pendant un incident.

## Journaux et traces

### Log Stream

Un flux en direct des lignes de journaux correspondant à un filtre.

**Paramètres** : filtres de journaux (service, sévérité, attributs) et colonnes à afficher.

À utiliser quand : vous voulez voir ce que dit l'application en ce moment, sans quitter le tableau de bord.

### Trace List

Une liste de traces récentes correspondant à un filtre, avec durée, statut et service.

**Paramètres** : filtres de traces (service, statut, attributs).

À utiliser quand : vous voulez une liste de l'activité récente plutôt qu'un graphique. Un schéma courant consiste à placer un graphique de latence en haut avec une liste de traces lentes en dessous.

## Listes en direct

### Incident List

Une liste en direct des incidents correspondant à un filtre.

**Paramètres** : filtres par état, sévérité, étiquettes, monitor ou équipe.

À utiliser quand : le tableau de bord répond à « qu'est-ce qui est cassé en ce moment ? ».

### Alert List

Une liste en direct des alertes correspondant à un filtre.

**Paramètres** : filtres par état, sévérité, étiquettes.

À utiliser quand : un tableau de bord d'équipe suit les alertes sur ses services.

### Monitor List

Une liste en direct des monitors et de leur statut actuel.

**Paramètres** : filtres par type de monitor, étiquettes ou état actuel.

À utiliser quand : vous voulez une vue de flotte — « est-ce que tous les sites sont en ligne ? ».

## Listes de ressources Kubernetes

Pour les projets disposant d'un [agent Kubernetes](/docs/monitor/kubernetes-agent) installé. Chaque widget accepte des filtres optionnels par cluster, namespace et étiquettes.

- **Kubernetes Pod List** — pods avec leur phase, redémarrages et nœud.
- **Kubernetes Node List** — nœuds avec leurs conditions et leur capacité.
- **Kubernetes Namespace List** — namespaces et nombres de workloads.
- **Kubernetes Deployment List** — déploiements avec répliques souhaitées vs prêtes.
- **Kubernetes StatefulSet List** — stateful sets avec répliques prêtes.
- **Kubernetes DaemonSet List** — daemon sets avec souhaitées vs prêtes.
- **Kubernetes Job List** — jobs et leur statut d'exécution.
- **Kubernetes CronJob List** — cron jobs avec planification et dernière exécution.

À utiliser quand : vous voulez un seul tableau de bord mêlant l'état Kubernetes à la télémétrie de ces workloads.

## Listes de ressources Docker

Pour les projets disposant d'une surveillance Docker configurée.

- **Docker Host List** — hôtes exécutant Docker, avec les nombres de conteneurs.
- **Docker Container List** — conteneurs avec état, image, hôte, temps de fonctionnement.
- **Docker Image List** — images et leurs tailles.
- **Docker Network List** — réseaux Docker et conteneurs connectés.
- **Docker Volume List** — volumes Docker et leur utilisation.

## Infrastructure

### Host List

Les hôtes surveillés par le moniteur de serveur de OneUptime, avec statut, CPU, mémoire et temps de fonctionnement.

**Paramètres** : filtres par étiquettes ou état actuel.

## Quel widget choisir ?

Quelques règles rapides :

- **Tendance dans le temps ?** Chart.
- **Un seul nombre qui compte en ce moment ?** Value (ou Gauge s'il a un min/max clair).
- **Décomposition entre plusieurs choses ?** Table.
- **Ce qu'il se passe dans le système en ce moment ?** Log Stream, Trace List, Incident List.
- **L'état d'un groupe spécifique de ressources ?** Le widget de liste correspondant.
- **Un titre, un paragraphe ou un lien ?** Text.

La plupart des tableaux de bord mélangent quelques widgets — un graphique en haut, une ou deux valeurs à côté, un séparateur en texte et une ou deux listes en dessous.

## Pour aller plus loin

- [Variables et filtres](/docs/dashboards/variables) — rendre les widgets réutilisables pour plusieurs services ou clients.
- [Création d'un tableau de bord](/docs/dashboards/authoring) — la mécanique du canevas.
- [Partage et tableaux de bord publics](/docs/dashboards/sharing) — partager au-delà de votre équipe.
