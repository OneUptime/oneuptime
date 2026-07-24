# Kubernetes-omkostningsobservabilitet

## Oversigt

OneUptime kan vise dig, hvad hver Kubernetes-workload faktisk koster — forbrug pr. namespace, pr. controller og pr. pod, med ledig kapacitet og request-vs-forbrug-effektivitet — lige ved siden af de metrikker, logs og sporinger, du allerede indsamler med [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

At slå det til er én kommando:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

Det er en komplet installation. Chartet bundter open source-motoren [OpenCost](https://opencost.io) (Apache-2.0, CNCF — den [cost-model](https://github.com/kubecost/cost-model), der også driver Kubecost) plus en minimal, dedikeret Prometheus, som den skal bruge til forbrugshistorik — to små pods af usynligt rørarbejde. OpenCost prissætter dine noder, volumes og load balancers ud fra din cloud-udbyders **offentlige listepriser automatisk, uden legitimationsoplysninger** (AWS, GCP, Azure); on-prem-clusters sætter i stedet en prisliste (nedenfor).

Inden for cirka en time (det første lukkede time-vindue) får du:

- En **omkostningsside pr. cluster** (_Kubernetes → din cluster → Costs_): forbrugstendens, forbrug pr. namespace med cpu/hukommelse/lager-opdeling, forbrug pr. workload, ledigt forbrug og effektivitet.
- En **omkostningsside på projektniveau** (_Kubernetes → Costs_): forbrug på tværs af hver cluster i projektet.
- En **Kubernetes Cost dashboard-skabelon** (_Dashboards → Create → Kubernetes Cost Dashboard_): tendenser for nodernes timepris, CPU/RAM-enhedspriser, forbrug på persistent volumes og load balancers.
- Rå omkostningsmetrikker (`node_total_hourly_cost`, `pv_hourly_cost`, ...) i **Metric Explorer**, brugbare i brugerdefinerede dashboards og metrik-advarsler.

## Sådan virker det

Med `cost.enabled=true` kører chartet fire ting:

1. **OpenCost** (bundtet) — overvåger clusteren, opdager cloud-listepriser og beregner forudprissatte omkostningsallokeringer pr. workload.
2. **En minimal Prometheus** (bundtet) — OpenCost kræver et PromQL-endpoint til forbrugs-/prishistorik. Denne findes udelukkende til det: én replika, 3 dages retention og præcis to scrape-targets (cAdvisor via API-serverens node-proxy og OpenCost selv — OpenCost udsender sine egne KSM-lignende resource-request-metrikker, så kube-state-metrics er ikke involveret). Den eksponeres aldrig uden for clusteren, og dens data forlader den aldrig.
3. **Omkostningsallokerings-polleren** (`cost.agent`) — poller OpenCosts Allocation API én gang pr. lukket time-vindue og POST'er omkostningsrækker pr. workload (cpu / ram / gpu / pv / netværk / load balancer / ledig, plus effektivitet) til OneUptime. Vinduer leveres præcis én gang — serveren springer vinduer over, som den allerede har indlæst, så genstarter kan ikke tælle forbrug dobbelt.
4. **En omkostningsmetrik-scrape** (`cost.metrics`) — agentens OpenTelemetry-collector scraper OpenCosts Prometheus-metrikker (allowlisted til omkostningsserierne) gennem den samme OTLP-pipeline som resten af dine cluster-metrikker.

## Kører du allerede Kubecost eller OpenCost?

Peg i stedet chartet på din eksisterende motor — så bundtes intet:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| Motor    | Typisk service-URL                                               |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Allocation API-stien detekteres automatisk (`/model/allocation` for Kubecost, `/allocation/compute` eller `/allocation` for OpenCost). Sæt kun `cost.engine.allocationPath` for ikke-standard-installationer.

## On-prem / bare-metal-prissætning

Clusters, hvis noder ikke har nogen offentlig cloud-listepris, kan sætte en prisliste — OpenCost prissætter så hver ressource ud fra disse tal. Alle værdier er **USD pr. ressource-time**:

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

## Nyttige knapper

Alle valgfri — se chartets `values.yaml` for den fulde liste:

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

## Advarsler på omkostninger

De scrapede omkostningsmetrikker er almindelige OneUptime-metrikker, så du kan sætte metrik-advarsler på dem ligesom på alt andet — f.eks. advare, når gennemsnittet af `node_total_hourly_cost` stiger over en budgettærskel, eller når `pv_hourly_cost` dukker op for en volume-klasse, der ikke burde findes i en cluster.

## Datamodel & retention

Allokeringsrækker lagres i ClickHouse (én række pr. cluster, vindue, namespace, controller, pod og container) og følger clusterens telemetri-retention: indstillingen `retainTelemetryDataForDays` på Kubernetes-cluster-ressourcen, med fallback til projektets dataretention. Ledig og uallokeret kapacitet lagres som almindelige rækker under namespacene `__idle__` / `__unallocated__`, så de kan forespørges med de samme group-bys som workload-forbrug.

## Fejlfinding

- **Omkostningssiderne er tomme** — tjek cost-agentens logs: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. En `401` betyder, at ingestion-nøglen er ugyldig; `cost engine did not answer any known allocation path` betyder, at motoren ikke er oppe endnu (den bundtede OpenCost skal bruge et par minutter efter installationen til at prissætte sine første vinduer), eller at `cost.engine.url` er forkert.
- **Bundtet OpenCost er ikke klar** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. Den logger, hvilken cloud-udbyder den detekterede, og om prisdata blev indlæst.
- **Dashboard-skabelonen viser ingen data** — skabelonen læser de scrapede omkostningsmetrikker; bekræft, at `cost.metrics.enabled` er `true`.
- **Tallene afviger fra motorens egen UI** — OneUptime inkluderer motorens afstemningsjusteringer i hver omkostningskomponent og leverer hele lukkede vinduer; delvist forbrug for den aktuelle time vises, efter at vinduet lukker.
- **Prometheus-podden genstartede** — med standard-`emptyDir`-lagringen mister en genstart et par timers forbrugshistorik, så allokeringer for de vinduer kan være mindre. Sæt `cost.prometheus.persistence.enabled=true`, hvis det betyder noget for dig.
