# Kubernetes kostnadsobservabilitet

## Översikt

OneUptime kan visa dig vad varje Kubernetes-arbetsbelastning faktiskt kostar — utgifter per namespace, per controller och per pod, med outnyttjad kapacitet och request-mot-användning-effektivitet — direkt bredvid måtten, loggarna och spårningarna du redan samlar in med [Kubernetes-agenten](/docs/telemetry/kubernetes-agent).

Att aktivera det är ett enda kommando:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

Det är en komplett installation. Diagrammet buntar den öppna källkodsmotorn [OpenCost](https://opencost.io) (Apache-2.0, CNCF — den [cost-model](https://github.com/kubecost/cost-model) som även driver Kubecost) plus ett minimalt, dedikerat Prometheus som den behöver för användningshistorik — två små poddar med osynlig infrastruktur. OpenCost prissätter dina noder, volymer och lastbalanserare **automatiskt utifrån din molnleverantörs publika listpriser, utan några autentiseringsuppgifter** (AWS, GCP, Azure); on-prem-kluster sätter i stället en pristabell (nedan).

Inom ungefär en timme (det första stängda timfönstret) får du:

- En **Costs-sida per kluster** (_Kubernetes → ditt kluster → Costs_): utgiftstrend, utgifter per namespace med uppdelning på cpu/minne/lagring, utgifter per arbetsbelastning, outnyttjade utgifter och effektivitet.
- En **Costs-sida på projektnivå** (_Kubernetes → Costs_): utgifter över varje kluster i projektet.
- En **instrumentpanelsmall för Kubernetes-kostnader** (_Instrumentpaneler → Skapa → Kubernetes Cost Dashboard_): trender för nodernas timkostnader, enhetskostnader för CPU/RAM, utgifter för persistenta volymer och lastbalanserare.
- Råa kostnadsmått (`node_total_hourly_cost`, `pv_hourly_cost`, ...) i **Måttutforskare**, användbara i egna instrumentpaneler och måttbaserade varningar.

## Hur det fungerar

Med `cost.enabled=true` kör diagrammet fyra saker:

1. **OpenCost** (medföljer) — bevakar klustret, upptäcker molnets listpriser och beräknar förprissatta kostnadsallokeringar per arbetsbelastning.
2. **Ett minimalt Prometheus** (medföljer) — OpenCost kräver en PromQL-slutpunkt för användnings-/prishistorik. Detta finns enbart för det: en enda replika, 3 dagars kvarhållning och exakt två skrapmål (cAdvisor via API-serverns nodproxy, och OpenCost självt — OpenCost avger sina egna KSM-liknande mått för resursbegäran, så kube-state-metrics är inte inblandat). Det exponeras aldrig utanför klustret och dess data lämnar det aldrig.
3. **Kostnadsallokeringspollern** (`cost.agent`) — frågar OpenCosts Allocation-API en gång per stängt timfönster och POST:ar kostnadsrader per arbetsbelastning (cpu / ram / gpu / pv / nätverk / lastbalanserare / idle, plus effektivitet) till OneUptime. Fönster levereras exakt en gång — servern hoppar över fönster den redan har tagit emot, så omstarter kan inte dubbelräkna utgifter.
4. **En skrapning av kostnadsmått** (`cost.metrics`) — agentens OpenTelemetry-insamlare skrapar OpenCosts Prometheus-mått (tillåtelselistade till kostnadsserierna) genom samma OTLP-pipeline som resten av dina klustermått.

## Kör du redan Kubecost eller OpenCost?

Peka diagrammet mot din befintliga motor i stället — då buntas ingenting:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| Motor    | Typisk tjänst-URL                                                |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Allocation-API:ets sökväg upptäcks automatiskt (`/model/allocation` för Kubecost, `/allocation/compute` eller `/allocation` för OpenCost). Sätt `cost.engine.allocationPath` endast för icke-standardinstallationer.

## Prissättning för on-prem / bare metal

Kluster vars noder saknar publikt molnlistpris kan sätta en pristabell — OpenCost prissätter då varje resurs utifrån dessa siffror. Alla värden är **USD per resurstimme**:

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

## Användbara rattar

Alla valfria — se diagrammets `values.yaml` för den fullständiga listan:

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

## Larma på kostnader

De skrapade kostnadsmåtten är vanliga OneUptime-mått, så du kan sätta måttbaserade varningar på dem precis som på allt annat — t.ex. larma när genomsnittet av `node_total_hourly_cost` stiger över en budgettröskel, eller när `pv_hourly_cost` dyker upp för en volymklass som inte borde finnas i ett kluster.

## Datamodell & kvarhållning

Allokeringsrader lagras i ClickHouse (en rad per kluster, fönster, namespace, controller, pod och container) och följer klustrets telemetrikvarhållning: inställningen `retainTelemetryDataForDays` på Kubernetes-klusterresursen, med projektets datakvarhållning som reserv. Outnyttjad och oallokerad kapacitet lagras som vanliga rader under namespacen `__idle__` / `__unallocated__` så att de kan frågas med samma grupperingar som arbetsbelastningsutgifter.

## Felsökning

- **Costs-sidorna är tomma** — kontrollera cost-agentens loggar: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. Ett `401` betyder att ingestnyckeln är ogiltig; `cost engine did not answer any known allocation path` betyder att motorn inte är igång ännu (den medföljande OpenCost behöver några minuter efter installationen för att prissätta sina första fönster) eller att `cost.engine.url` är fel.
- **Medföljande OpenCost inte redo** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. Den loggar vilken molnleverantör den upptäckte och om prisdata laddades.
- **Instrumentpanelsmallen visar ingen data** — mallen läser de skrapade kostnadsmåtten; bekräfta att `cost.metrics.enabled` är `true`.
- **Siffrorna skiljer sig från motorns eget gränssnitt** — OneUptime inkluderar motorns avstämningsjusteringar i varje kostnadskomponent och levererar hela stängda fönster; delvisa utgifter för innevarande timme visas efter att fönstret har stängts.
- **Prometheus-podden startade om** — med standardlagringen `emptyDir` förlorar en omstart några timmars användningshistorik, så allokeringar för de fönstren kan bli mindre. Sätt `cost.prometheus.persistence.enabled=true` om det spelar roll för dig.
