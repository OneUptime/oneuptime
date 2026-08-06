# Observabilité des coûts Kubernetes

## Aperçu

OneUptime peut vous montrer ce que chaque workload Kubernetes coûte réellement — dépenses par espace de noms, par contrôleur et par pod, avec la capacité inactive et l'efficacité requêtes-vs-utilisation — juste à côté des métriques, journaux et traces que vous collectez déjà avec l'[Agent Kubernetes](/docs/telemetry/kubernetes-agent).

L'activer tient en une seule commande :

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

C'est une installation complète. Le chart embarque le moteur open source [OpenCost](https://opencost.io) (Apache-2.0, CNCF — le [cost-model](https://github.com/kubecost/cost-model) qui alimente aussi Kubecost) ainsi qu'un Prometheus minimal et dédié dont il a besoin pour l'historique d'utilisation — deux petits pods de plomberie invisible. OpenCost tarife vos nœuds, volumes et load balancers à partir des **prix catalogue publics de votre fournisseur cloud, automatiquement et sans identifiants** (AWS, GCP, Azure) ; les clusters on-prem définissent à la place une grille tarifaire (ci-dessous).

En une heure environ (la première fenêtre horaire close), vous obtenez :

- Une **page Costs par cluster** (_Kubernetes → votre cluster → Costs_) : tendance des dépenses, dépenses par espace de noms avec répartition cpu/mémoire/stockage, dépenses par workload, dépenses inactives et efficacité.
- Une **page Costs au niveau du projet** (_Kubernetes → Costs_) : les dépenses de chaque cluster du projet.
- Un **modèle de tableau de bord Kubernetes Cost** (_Tableaux de bord → Créer → Kubernetes Cost Dashboard_) : tendances du coût horaire des nœuds, coûts unitaires CPU/RAM, dépenses des volumes persistants et des load balancers.
- Les métriques de coût brutes (`node_total_hourly_cost`, `pv_hourly_cost`, ...) dans l'**Explorateur de métriques**, utilisables dans des tableaux de bord personnalisés et des alertes de métriques.

## Fonctionnement

Avec `cost.enabled=true`, le chart exécute quatre choses :

1. **OpenCost** (embarqué) — observe le cluster, découvre les prix catalogue du cloud et calcule des allocations de coûts pré-tarifées par workload.
2. **Un Prometheus minimal** (embarqué) — OpenCost requiert un point de terminaison PromQL pour l'historique d'utilisation et de prix. Celui-ci n'existe que pour cela : un seul réplica, 3 jours de rétention et exactement deux cibles de scrape (cAdvisor via le proxy de nœud de l'API-server, et OpenCost lui-même — OpenCost émet ses propres métriques de requêtes de ressources de style KSM, kube-state-metrics n'est donc pas impliqué). Il n'est jamais exposé hors du cluster et ses données ne le quittent jamais.
3. **Le poller d'allocation des coûts** (`cost.agent`) — interroge l'API Allocation d'OpenCost une fois par fenêtre horaire close et envoie par POST à OneUptime des lignes de coût par workload (cpu / ram / gpu / pv / réseau / load balancer / inactif, plus l'efficacité). Les fenêtres sont expédiées exactement une fois — le serveur ignore les fenêtres qu'il a déjà ingérées, de sorte que les redémarrages ne peuvent pas compter les dépenses en double.
4. **Un scrape des métriques de coût** (`cost.metrics`) — le collecteur OpenTelemetry de l'agent scrape les métriques Prometheus d'OpenCost (restreintes par liste d'autorisation aux séries de coût) via le même pipeline OTLP que le reste de vos métriques de cluster.

## Vous exécutez déjà Kubecost ou OpenCost ?

Pointez plutôt le chart vers votre moteur existant — rien n'est alors embarqué :

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| Moteur   | URL de service typique                                           |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Le chemin de l'API Allocation est détecté automatiquement (`/model/allocation` pour Kubecost, `/allocation/compute` ou `/allocation` pour OpenCost). Ne définissez `cost.engine.allocationPath` que pour les installations non standard.

## Tarification on-prem / bare metal

Les clusters dont les nœuds n'ont pas de prix catalogue cloud public peuvent définir une grille tarifaire — OpenCost tarife alors chaque ressource à partir de ces chiffres. Toutes les valeurs sont en **USD par ressource-heure** :

```yaml
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

## Réglages utiles

Tous optionnels — consultez le `values.yaml` du chart pour la liste complète :

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 7d         # bundled TSDB history; right-sizing reads peaks back over days
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## Alerter sur les coûts

Les métriques de coût scrapées sont des métriques OneUptime ordinaires, vous pouvez donc leur appliquer des alertes de métriques comme à n'importe quelle autre — par exemple alerter lorsque la moyenne de `node_total_hourly_cost` dépasse un seuil budgétaire, ou lorsque `pv_hourly_cost` apparaît pour une classe de volumes qui ne devrait pas exister dans un cluster.

## Modèle de données et rétention

Les lignes d'allocation sont stockées dans ClickHouse (une ligne par cluster, fenêtre, espace de noms, contrôleur, pod et conteneur) et suivent la rétention de télémétrie du cluster : le paramètre `retainTelemetryDataForDays` de la ressource de cluster Kubernetes, avec repli sur la rétention de données du projet. La capacité inactive et non allouée est stockée sous forme de lignes ordinaires sous les espaces de noms `__idle__` / `__unallocated__`, elle est donc interrogeable avec les mêmes regroupements que les dépenses des workloads.

## Dépannage

- **Les pages Costs sont vides** — vérifiez les journaux de l'agent de coûts : `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. Un `401` signifie que la clé d'ingestion est invalide ; `cost engine did not answer any known allocation path` signifie que le moteur n'est pas encore opérationnel (l'OpenCost embarqué a besoin de quelques minutes après l'installation pour tarifer ses premières fenêtres) ou que `cost.engine.url` est incorrect.
- **L'OpenCost embarqué n'est pas prêt** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. Il journalise quel fournisseur cloud il a détecté et si les données de tarification ont été chargées.
- **Le modèle de tableau de bord n'affiche aucune donnée** — le modèle lit les métriques de coût scrapées ; confirmez que `cost.metrics.enabled` est à `true`.
- **Les chiffres diffèrent de l'interface du moteur lui-même** — OneUptime inclut les ajustements de réconciliation du moteur dans chaque composante de coût et expédie des fenêtres closes entières ; les dépenses partielles de l'heure en cours apparaissent après la clôture de la fenêtre.
- **Le pod Prometheus a redémarré** — avec le stockage `emptyDir` par défaut, un redémarrage perd quelques heures d'historique d'utilisation, les allocations de ces fenêtres peuvent donc être plus faibles. Définissez `cost.prometheus.persistence.enabled=true` si cela compte pour vous.
