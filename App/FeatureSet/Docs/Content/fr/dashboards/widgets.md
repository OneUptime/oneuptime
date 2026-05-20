# Widgets

Un widget est une tuile sur un tableau de bord. Chaque widget a un type (graphique, valeur, liste, …), une position, une taille et une configuration. Cette page est le catalogue — ce que chaque widget montre, ce qu'il prend en entrée, quand y avoir recours.

Pour la mécanique du canevas, voir [Créer un tableau de bord](/docs/dashboards/authoring).

## Widgets de série temporelle

### Chart

Un graphique en lignes / barres / aires d'une ou plusieurs séries de métriques sur la plage temporelle du tableau de bord.

**Configurer** :

- Une ou plusieurs requêtes de métriques (`metricQueryConfig` pour une seule série, `metricQueryConfigs` pour plusieurs).
- **Formule** optionnelle combinant plusieurs requêtes (par exemple, `errors / total * 100`).
- **transformAsRate** optionnel pour les compteurs cumulatifs OpenTelemetry (par exemple, `system.disk.io`) — le widget calcule `(value - previousValue) / Δt` par bucket.
- Affichage : séries empilées vs. superposées, unité de l'axe Y, légende on/off, type de graphique.

À utiliser quand : les tendances comptent. Latence de requête, nombre d'erreurs dans le temps, profondeur de file d'attente, tout ce dont la forme de la courbe vous apprend quelque chose.

### Value

Un seul grand nombre avec des seuils optionnels et un sparkline optionnel.

**Configurer** :

- Une requête de métrique (valeur unique — habituellement `last`, `avg` ou `max` sur la plage temporelle).
- **Seuil d'avertissement** optionnel (jaune au-dessus).
- **Seuil critique** optionnel (rouge au-dessus).
- Affichage : format du nombre, suffixe d'unité.

À utiliser quand : un seul nombre répond à la question. Taux d'erreur actuel, latence P95 en ce moment, nombre d'incidents ouverts.

### Gauge

Une jauge circulaire avec min, max, bande d'avertissement et bande critique.

**Configurer** : la requête de métrique et les quatre bornes (min, max, avertissement, critique).

À utiliser quand : la valeur se situe dans une plage connue. Utilisation CPU (0–100 %), remplissage du disque, capacité de file d'attente.

### Table

Un affichage tabulaire des résultats d'une requête de métrique, une rangée par groupe.

**Configurer** : la requête de métrique (typiquement groupée par une étiquette comme `host.name` ou `service.name`), les colonnes à afficher et une limite de rangées.

À utiliser quand : vous voulez la ventilation plutôt que la tendance. Top 10 des hôtes les plus bruyants, nombre d'erreurs par service, taux de requête par endpoint.

## Widget d'annotation

### Text

Un bloc statique de Markdown.

**Configurer** : le corps Markdown. Les titres, listes, liens, emphase, spans de code, blocs de code délimités se rendent tous.

À utiliser quand : vous voulez un en-tête de section, un paragraphe de contexte (« ce tableau de bord couvre le service checkout »), une liste de liens vers les runbooks ou tableaux de bord apparentés, ou une bannière temporaire pendant un incident.

## Journaux et traces

### LogStream

Une queue en direct des lignes de journal correspondant à un filtre.

**Configurer** : filtres de journaux (service, sévérité, correspondances d'attributs), les colonnes à afficher.

À utiliser quand : vous voulez voir ce que dit l'application *en ce moment* sur un tableau de bord, sans quitter la page pour ouvrir l'explorateur de journaux.

### TraceList

Une liste des traces récentes correspondant à un filtre, avec durée, statut et nom de service.

**Configurer** : filtres de traces (service, statut, correspondances d'attributs).

À utiliser quand : vous voulez une vue paginée de l'activité récente plutôt qu'un graphique. Combinaison courante : un Chart de latence en haut, un TraceList des traces lentes en dessous.

## Listes opérationnelles

### IncidentList

Une liste en direct des incidents correspondant à un filtre.

**Configurer** : filtres par état, sévérité, étiquettes, monitor ou équipe assignée.

À utiliser quand : un tableau de bord est censé répondre à « qu'est-ce qui est cassé en ce moment ? »

### AlertList

Une liste en direct des alertes correspondant à un filtre.

**Configurer** : filtres par état, sévérité, étiquettes.

À utiliser quand : tableaux de bord pour les workflows pilotés par les alertes (par exemple, tableaux de bord d'équipe de développement qui surveillent les alertes de leur service).

### MonitorList

Une liste en direct des monitors correspondant à un filtre, montrant le statut actuel de chaque monitor.

**Configurer** : filtres par type de monitor, étiquettes ou état actuel.

À utiliser quand : vous voulez une vue de flotte « tous les sites web sont-ils en marche ? », ou une liste par équipe des endpoints monitorés.

## Listes de ressources Kubernetes

Pour les projets avec un [Agent Kubernetes](/docs/monitor/kubernetes-agent) installé, les widgets de ressources en direct suivants sont disponibles. Chacun prend des filtres optionnels pour `cluster`, `namespace` et étiquettes.

- **KubernetesPodList** — pods avec phase, redémarrages et affectation de nœud.
- **KubernetesNodeList** — nœuds avec conditions, capacité et allocations.
- **KubernetesNamespaceList** — namespaces et leurs comptes de charges de travail.
- **KubernetesDeploymentList** — deployments avec répliques désirées vs. prêtes.
- **KubernetesStatefulSetList** — stateful sets avec répliques prêtes.
- **KubernetesDaemonSetList** — daemon sets avec désirées vs. prêtes.
- **KubernetesJobList** — jobs avec statut d'achèvement.
- **KubernetesCronJobList** — cron jobs avec planning et dernière exécution.

À utiliser pour ces widgets quand : vous voulez un tableau de bord unique qui mélange l'état des ressources Kubernetes avec la télémétrie de ces charges de travail.

## Listes de ressources Docker

Pour les projets avec un monitor Docker installé :

- **DockerHostList** — hôtes exécutant Docker, avec nombre de conteneurs.
- **DockerContainerList** — conteneurs avec état, image, hôte, uptime.
- **DockerImageList** — images et leurs tailles.
- **DockerNetworkList** — réseaux Docker et nombre de conteneurs connectés.
- **DockerVolumeList** — volumes Docker et leur utilisation.

## Infrastructure

### HostList

Hôtes monitorés par le monitor de serveur OneUptime — avec statut actuel, CPU, mémoire et uptime.

**Configurer** : filtres par étiquettes ou état de santé actuel.

## Choisir le bon widget

Quelques règles de pouce rapides :

- **Tendance dans le temps ?** Chart.
- **Un nombre qui compte en ce moment ?** Value (ou Gauge s'il a une plage naturelle).
- **Ventilation sur plusieurs choses ?** Table.
- **Que se passe-t-il dans le système en ce moment ?** LogStream, TraceList, IncidentList.
- **État d'une flotte de ressources spécifiques ?** Le widget de liste de ressources correspondant.
- **Un titre, un paragraphe ou un lien ?** Text.

La plupart des tableaux de bord utilisent un mélange — un Chart en haut, un Value ou deux à côté, un séparateur Text, puis une ou deux listes en dessous.

## Où lire ensuite

- [Variables et filtres](/docs/dashboards/variables) — rendre les widgets réutilisables à travers services / clients / clusters.
- [Créer un tableau de bord](/docs/dashboards/authoring) — le canevas, la grille et le mode édition.
- [Partage et tableaux de bord publics](/docs/dashboards/sharing) — exposer un tableau de bord hors de l'équipe.
