# Kubernetes-kostnadsobservabilitet

## Oversikt

OneUptime kan vise deg hva hver Kubernetes-arbeidslast faktisk koster — forbruk per namespace, per controller og per pod, med ledig kapasitet og request-mot-forbruk-effektivitet — rett ved siden av metrikkene, loggene og sporingene du allerede samler inn med [Kubernetes-agenten](/docs/telemetry/kubernetes-agent).

Å slå det på er én kommando:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

Det er en komplett installasjon. Chartet bunter den åpne kildekode-motoren [OpenCost](https://opencost.io) (Apache-2.0, CNCF — den [cost-model](https://github.com/kubecost/cost-model) som også driver Kubecost) pluss en minimal, dedikert Prometheus den trenger for forbrukshistorikk — to små pods med usynlig rørleggerarbeid. OpenCost prissetter nodene, volumene og load balancerne dine fra skyleverandørens **offentlige listepriser automatisk, uten påloggingsinformasjon** (AWS, GCP, Azure); on-prem-klynger setter i stedet en prisliste (nedenfor).

I løpet av omtrent en time (det første lukkede timevinduet) får du:

- En **kostnadsside per klynge** (_Kubernetes → din klynge → Costs_): forbrukstrend, forbruk per namespace med cpu/minne/lagring-fordeling, forbruk per arbeidslast, ledig forbruk og effektivitet.
- En **kostnadsside på prosjektnivå** (_Kubernetes → Costs_): forbruk på tvers av hver klynge i prosjektet.
- En **Kubernetes Cost dashbordmal** (_Dashbord → Opprett → Kubernetes Cost Dashboard_): trender for nodenes timekostnad, CPU/RAM-enhetskostnader, forbruk på persistente volumer og load balancere.
- Rå kostnadsmetrikker (`node_total_hourly_cost`, `pv_hourly_cost`, ...) i **Metrikkutforsker**, som kan brukes i egendefinerte dashbord og metrikkvarsler.

## Slik fungerer det

Med `cost.enabled=true` kjører chartet fire ting:

1. **OpenCost** (buntet) — overvåker klyngen, oppdager skyens listepriser og beregner forhåndsprisede kostnadsallokeringer per arbeidslast.
2. **En minimal Prometheus** (buntet) — OpenCost krever et PromQL-endepunkt for forbruks-/prishistorikk. Denne finnes utelukkende for det: én replika, 3 dagers retensjon og nøyaktig to skrapemål (cAdvisor via API-serverens node-proxy, og OpenCost selv — OpenCost sender ut sine egne KSM-aktige resource-request-metrikker, så kube-state-metrics er ikke involvert). Den eksponeres aldri utenfor klyngen, og dataene dens forlater den aldri.
3. **Kostnadsallokeringspolleren** (`cost.agent`) — poller OpenCosts Allocation API én gang per lukket timevindu og POST-er kostnadsrader per arbeidslast (cpu / ram / gpu / pv / nettverk / load balancer / ledig, pluss effektivitet) til OneUptime. Vinduer leveres nøyaktig én gang — serveren hopper over vinduer den allerede har tatt inn, så omstarter kan ikke telle forbruk dobbelt.
4. **En kostnadsmetrikk-skrape** (`cost.metrics`) — agentens OpenTelemetry-collector skraper OpenCosts Prometheus-metrikker (med tillatelsesliste begrenset til kostnadsseriene) gjennom den samme OTLP-pipelinen som resten av klyngemetrikkene dine.

## Kjører du allerede Kubecost eller OpenCost?

Pek chartet på din eksisterende motor i stedet — da buntes ingenting:

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

Allocation API-stien oppdages automatisk (`/model/allocation` for Kubecost, `/allocation/compute` eller `/allocation` for OpenCost). Sett `cost.engine.allocationPath` kun for ikke-standard-installasjoner.

## On-prem / bare-metal-prissetting

Klynger der nodene ikke har noen offentlig sky-listepris, kan sette en prisliste — OpenCost prissetter da hver ressurs fra disse tallene. Alle verdier er **USD per ressurstime**:

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

## Nyttige spaker

Alle valgfrie — se chartets `values.yaml` for den fullstendige listen:

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

## Varsling på kostnader

De skrapede kostnadsmetrikkene er vanlige OneUptime-metrikker, så du kan sette metrikkvarsler på dem som på alt annet — f.eks. varsle når gjennomsnittet av `node_total_hourly_cost` stiger over en budsjettterskel, eller når `pv_hourly_cost` dukker opp for en volumklasse som ikke burde finnes i en klynge.

## Datamodell og retensjon

Allokeringsrader lagres i ClickHouse (én rad per klynge, vindu, namespace, controller, pod og container) og følger klyngens telemetriretensjon: innstillingen `retainTelemetryDataForDays` på Kubernetes-klyngeressursen, med tilbakefall til prosjektets dataretensjon. Ledig og uallokert kapasitet lagres som vanlige rader under namespacene `__idle__` / `__unallocated__`, slik at de kan spørres med de samme group-by-ene som arbeidslastforbruk.

## Feilsøking

- **Kostnadssidene er tomme** — sjekk cost-agentens logger: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. En `401` betyr at ingest-nøkkelen er ugyldig; `cost engine did not answer any known allocation path` betyr at motoren ikke er oppe ennå (den buntede OpenCost trenger noen minutter etter installasjonen for å prissette sine første vinduer), eller at `cost.engine.url` er feil.
- **Buntet OpenCost er ikke klar** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. Den logger hvilken skyleverandør den oppdaget, og om prisdata ble lastet inn.
- **Dashbordmalen viser ingen data** — malen leser de skrapede kostnadsmetrikkene; bekreft at `cost.metrics.enabled` er `true`.
- **Tallene avviker fra motorens eget grensesnitt** — OneUptime inkluderer motorens avstemmingsjusteringer i hver kostnadskomponent og leverer hele lukkede vinduer; delvis forbruk for inneværende time vises etter at vinduet lukkes.
- **Prometheus-poden startet på nytt** — med standard-`emptyDir`-lagringen mister en omstart noen timers forbrukshistorikk, så allokeringer for de vinduene kan bli mindre. Sett `cost.prometheus.persistence.enabled=true` hvis det betyr noe for deg.
