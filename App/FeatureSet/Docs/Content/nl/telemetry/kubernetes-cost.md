# Kubernetes-kostenobservability

## Overzicht

OneUptime kan je laten zien wat elke Kubernetes-workload daadwerkelijk kost — uitgaven per namespace, per controller en per pod, met ongebruikte capaciteit en request-versus-gebruik-efficiëntie — direct naast de metrieken, logs en traces die je al verzamelt met de [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

Inschakelen is één commando:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

Dat is een complete installatie. De chart bundelt de open-source [OpenCost](https://opencost.io)-engine (Apache-2.0, CNCF — het [cost-model](https://github.com/kubecost/cost-model) dat ook Kubecost aandrijft) plus een minimale, toegewijde Prometheus die hij nodig heeft voor de gebruiksgeschiedenis — twee kleine pods aan onzichtbare infrastructuur. OpenCost prijst je nodes, volumes en load balancers **automatisch op basis van de publieke lijstprijzen van je cloudprovider, zonder credentials** (AWS, GCP, Azure); on-prem clusters stellen in plaats daarvan een tarievenkaart in (zie hieronder).

Binnen ongeveer een uur (het eerste afgesloten uurvenster) krijg je:

- Een **Costs-pagina per cluster** (_Kubernetes → je cluster → Costs_): uitgaventrend, uitgaven per namespace met cpu-/geheugen-/opslagverdeling, uitgaven per workload, ongebruikte uitgaven en efficiëntie.
- Een **Costs-pagina op projectniveau** (_Kubernetes → Costs_): uitgaven over elk cluster in het project.
- Een **Kubernetes Cost-dashboardsjabloon** (_Dashboards → Create → Kubernetes Cost Dashboard_): trends in uurlijkse nodekosten, CPU/RAM-eenheidskosten, uitgaven aan persistent volumes en load balancers.
- Ruwe kostenmetrieken (`node_total_hourly_cost`, `pv_hourly_cost`, ...) in de **Metric Explorer**, bruikbaar in eigen dashboards en metriek-alerts.

## Hoe het werkt

Met `cost.enabled=true` draait de chart vier dingen:

1. **OpenCost** (gebundeld) — observeert het cluster, achterhaalt de cloudlijstprijzen en berekent voorgeprijsde kostenallocaties per workload.
2. **Een minimale Prometheus** (gebundeld) — OpenCost vereist een PromQL-endpoint voor gebruiks-/prijsgeschiedenis. Deze bestaat uitsluitend daarvoor: één replica, 3 dagen retentie en precies twee scrape-targets (cAdvisor via de node-proxy van de API-server, en OpenCost zelf — OpenCost zendt zijn eigen KSM-achtige resource-request-metrieken uit, dus kube-state-metrics is er niet bij betrokken). Hij wordt nooit buiten het cluster blootgesteld en zijn data verlaat het cluster nooit.
3. **De kostenallocatie-poller** (`cost.agent`) — bevraagt de Allocation API van OpenCost eenmaal per afgesloten uurvenster en POST kostenrijen per workload (cpu / ram / gpu / pv / netwerk / load balancer / idle, plus efficiëntie) naar OneUptime. Vensters worden precies één keer verzonden — de server slaat vensters over die hij al heeft opgenomen, dus herstarts kunnen uitgaven niet dubbel tellen.
4. **Een kostenmetrieken-scrape** (`cost.metrics`) — de OpenTelemetry-collector van de agent scrapet de Prometheus-metrieken van OpenCost (via een allowlist beperkt tot de kostenreeksen) door dezelfde OTLP-pipeline als de rest van je clustermetrieken.

## Draait er al Kubecost of OpenCost?

Wijs de chart in plaats daarvan naar je bestaande engine — dan wordt er niets gebundeld:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| Engine   | Typische service-URL                                             |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Het pad van de Allocation API wordt automatisch gedetecteerd (`/model/allocation` voor Kubecost, `/allocation/compute` of `/allocation` voor OpenCost). Stel `cost.engine.allocationPath` alleen in voor niet-standaard installaties.

## On-prem / bare-metal prijzen

Clusters waarvan de nodes geen publieke cloudlijstprijs hebben, kunnen een tarievenkaart instellen — OpenCost prijst dan elke resource op basis van deze cijfers. Alle waarden zijn **USD per resource-uur**:

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

## Handige knoppen

Allemaal optioneel — zie de `values.yaml` van de chart voor de volledige lijst:

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 3d         # bundled TSDB history — a few days is plenty
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## Alerten op kosten

De gescrapete kostenmetrieken zijn gewone OneUptime-metrieken, dus je kunt er net als op al het andere metriek-alerts op zetten — bijv. alerten wanneer het gemiddelde van `node_total_hourly_cost` boven een budgetdrempel uitstijgt, of wanneer `pv_hourly_cost` verschijnt voor een volumeklasse die in een cluster niet zou mogen bestaan.

## Datamodel & retentie

Allocatierijen worden opgeslagen in ClickHouse (één rij per cluster, venster, namespace, controller, pod en container) en volgen de telemetrieretentie van het cluster: de instelling `retainTelemetryDataForDays` op de Kubernetes-clusterresource, met terugval op de dataretentie van het project. Ongebruikte en niet-toegewezen capaciteit worden opgeslagen als gewone rijen onder de namespaces `__idle__` / `__unallocated__`, zodat ze met dezelfde group-bys bevraagbaar zijn als workload-uitgaven.

## Probleemoplossing

- **Costs-pagina's zijn leeg** — controleer de logs van de cost-agent: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. Een `401` betekent dat de ingestion-sleutel ongeldig is; `cost engine did not answer any known allocation path` betekent dat de engine nog niet draait (de gebundelde OpenCost heeft na installatie een paar minuten nodig om zijn eerste vensters te prijzen) of dat `cost.engine.url` verkeerd is.
- **Gebundelde OpenCost niet gereed** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. Hij logt welke cloudprovider hij heeft gedetecteerd en of er prijsdata is geladen.
- **Dashboardsjabloon toont geen data** — het sjabloon leest de gescrapete kostenmetrieken; bevestig dat `cost.metrics.enabled` op `true` staat.
- **Cijfers wijken af van de eigen UI van de engine** — OneUptime neemt de reconciliatie-aanpassingen van de engine op in elke kostencomponent en verzendt hele afgesloten vensters; gedeeltelijke uitgaven van het lopende uur verschijnen nadat het venster is gesloten.
- **Prometheus-pod herstart** — met de standaard `emptyDir`-opslag verliest een herstart een paar uur gebruiksgeschiedenis, dus allocaties voor die vensters kunnen kleiner uitvallen. Stel `cost.prometheus.persistence.enabled=true` in als dat voor jou belangrijk is.
