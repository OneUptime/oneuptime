# Kubernetes-kostenobservability

Zie wat elke Kubernetes-workload kost — uitgaven per namespace, workload en pod, inactieve capaciteit en hoeveel van elk request wordt gebruikt — naast de metrics, logs en traces die de [Kubernetes-agent](/docs/telemetry/kubernetes-agent) al verzamelt. Het staat standaard aan, zonder cloudinloggegevens: het overzicht van het cluster laat zien wat het kost, de pagina **Kosten** vertelt je welke requests kleiner kunnen, en je kunt de kostenmetrics, net als alle andere metrics, in grafieken zetten en erop waarschuwen.

:::cards
- [Inschakelen](#kostenobservability-inschakelen): Standaard aan; één `helm upgrade` waar dat niet zo is.
- [Waarschuwen op kosten](#waarschuwen-op-kosten): Kosten per cluster, namespace en workload, als metrics.
- [Je eigen engine](#draai-je-al-kubecost-of-opencost): Een Kubecost of OpenCost die je al draait, wordt gevonden en uitgelezen.
- [Right-sizing](#right-sizing): Aanbevelingen voor requests, en hoe ze tot stand komen.
- [Problemen oplossen](#problemen-oplossen): Lege pagina's, ontbrekende aanbevelingen.
:::

## Hoe het werkt

Met kostenmonitoring aan, zoals standaard het geval is (`cost.enabled: auto`), draait de chart vier dingen naast de agent:

```mermaid title="Waar de kostencijfers vandaan komen"
flowchart TB
    cadvisor["cAdvisor, via de<br/>node-proxy van de API-server"] --> prometheus["Meegeleverde Prometheus"]
    prometheus --> opencost["OpenCost"]
    pricing["Cloudcatalogusprijzen<br/>of je tarievenkaart"] --> opencost
    opencost -->|"één afgesloten uur<br/>tegelijk"| poller["Kostenpoller"]
    opencost -->|"kostenmetrics"| collector["Collector van de agent"]
    poller -->|"kostenrijen"| oneuptime["OneUptime"]
    collector -->|"OTLP"| oneuptime
```

1. **OpenCost**, de opensource-kostenengine (Apache-2.0, CNCF; het [cost-model](https://github.com/kubecost/cost-model) waarop ook Kubecost draait). Hij bewaakt het cluster, prijst je nodes, volumes en load balancers en berekent wat elke workload kost.
2. **Een kleine Prometheus**, die OpenCost nodig heeft voor de gebruiks- en prijsgeschiedenis. Hij draait één replica, bewaart 7 dagen geschiedenis en scrapet precies twee doelen: cAdvisor via de node-proxy van de API-server, waarvan hij alleen de series bewaart die OpenCost leest, en OpenCost zelf (dat zijn eigen metrics voor resource-requests uitgeeft, dus kube-state-metrics is er niet bij betrokken). Hij wordt nooit buiten het cluster beschikbaar gesteld, en zijn gegevens verlaten het cluster nooit.
3. **De kostenpoller** (`cost.agent`). Eén keer per afgesloten uur leest hij de Allocation API van OpenCost en stuurt hij per workload één kostenrij naar OneUptime: CPU, geheugen, GPU, volumes, netwerk, load balancers en inactiviteit, met efficiëntie. Elk uur wordt één keer verstuurd; de server slaat een uur over dat hij al heeft, dus een herstart kan uitgaven niet dubbel tellen. OneUptime schrijft uit deze rijen ook de [kostenmetrics](#waarschuwen-op-kosten).
4. **Een scrape van kostenmetrics** (`cost.metrics`). De collector van de agent scrapet de prijsmetrics van OpenCost, wat elke node, elk volume en elke load balancer per uur kost, en stuurt ze mee met de rest van de metrics van het cluster.

OpenCost prijst nodes op basis van de openbare catalogusprijzen van je cloudprovider (AWS, Google Cloud, Azure), zonder inloggegevens. Elders gebruikt hij zijn standaardtarieven, die je kunt vervangen door een eigen [tarievenkaart](#prijzen-voor-on-premises-en-bare-metal).

De drie pods vragen samen ongeveer 150m CPU en 450Mi geheugen aan. Kostenmonitoring staat standaard uit bij de presets `gke-autopilot` en `eks-fargate`: die platforms rekenen elke pod af op zijn requests, dus de kostenpods zouden de rekening verhogen die ze meten, en OpenCost prijst nodes, terwijl geen van beide platforms per node afrekent.

## Kostenobservability inschakelen

Een nieuwe installatie heeft niets nodig: kostenmonitoring staat standaard aan. Upgrade een agent die werd geïnstalleerd voordat dat zo was, of zet het aan met de preset `gke-autopilot` of `eks-fargate`:

:::steps
### De agent upgraden

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reset-then-reuse-values \
  --set cost.enabled=true
```

Dat is een volledige installatie: drie kleine extra pods, OpenCost, zijn Prometheus en de kostenagent. Heb je de agent onder een andere releasenaam of namespace geïnstalleerd, gebruik dan de jouwe (`helm list -A | grep kubernetes-agent` toont ze). Om kostenmonitoring uit te zetten, stel je op dezelfde manier `--set cost.enabled=false` in.

### Wachten op het eerste afgesloten uur

De eerste kosten verschijnen nadat het eerste volledige uur is afgesloten, en OpenCost heeft na het opstarten een paar minuten nodig om zijn eerste uur te prijzen.

### De kostenpagina's openen

- **Producten → Infrastructuur → Kubernetes → Kosten** toont de uitgaven van alle clusters in het project.
- Op een cluster toont het overzicht de uitgaven van de afgelopen 24 uur, een maandprognose, inactieve uitgaven, efficiëntie en de duurste namespaces en workloads.
- Op een cluster toont **Kosten** het verloop van de uitgaven, **Spend by Namespace** met de verdeling over CPU, geheugen en opslag, **Spend by Workload**, inactieve uitgaven, efficiëntie en de kaart **Right-Sizing**.
:::

De kostenmetrics (`node_total_hourly_cost`, `pv_hourly_cost` en de rest) zijn gewone metrics: ze staan in de metricverkenner, op aangepaste dashboards en in metricmonitors. Voor een kant-en-klaar dashboard ga je naar **Producten → Dashboards**, selecteer je **Dashboard aanmaken** en kies je **Kubernetes Cost Dashboard**: het verloop van de uurkosten van nodes, eenheidskosten voor CPU en geheugen, en uitgaven aan volumes en load balancers.

Onder de cijfers vermelden het overzicht en de pagina **Kosten** waar hun prijzen vandaan komen: de catalogusprijzen van een cloud, je tarievenkaart of de standaardtarieven van OpenCost. Efficiëntie is overal hetzelfde cijfer, ook in de efficiëntiemetric: hoeveel van de aangevraagde CPU en het aangevraagde geheugen is gebruikt, waarbij elk uur van een container weegt naar wat zijn CPU en geheugen kosten, zodat een goedkope job die niets gebruikt een goed benut cluster niet omlaag kan trekken, en inactieve capaciteit telt niet mee.

## Draai je al Kubecost of OpenCost?

De kostenagent vindt je eigen engine en leest die uit in plaats van de meegeleverde OpenCost, zodat het cluster wordt geprijsd zoals jij het hebt ingericht: met je tarievenkaart, of met je cloudfactuur waarop Kubecost is aangesloten. Hij zoekt bij het opstarten en daarna elk uur via de Kubernetes-API naar de Services die de eigen charts van de engines in een willekeurige namespace aanmaken (`cost-analyzer` of `frontend` van Kubecost, de chart van OpenCost, en de Service `opencost` die het manifest van OpenCost aanmaakt), te beginnen met Kubecost. Een engine die niet antwoordt, een aanmelding vereist of voor meerdere clusters antwoordt, slaat hij over; dan leest hij de meegeleverde uit.

Het overzicht van het cluster noemt dan je engine en meldt dat de meegeleverde OpenCost niet nodig is. Laat hem niet langer draaien:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reset-then-reuse-values \
  --set cost.engine.url=auto
```

Met `cost.engine.url=auto` wordt er niets meegeleverd en leest de agent je engine uit, waar die ook draait; is er geen engine geïnstalleerd, dan wordt er niets geprijsd. De chart kan zelf niet naar een engine zoeken: de functie `lookup` van Helm ziet niets onder `helm template`, Argo CD of een dry-run. Wil je de meegeleverde OpenCost naast je eigen engine houden, stel dan `cost.engine.preferExisting=false` in; wil je zelf aanwijzen welke engine wordt uitgelezen, stel dan `cost.engine.url` in op de Service ervan:

| Engine | Gebruikelijke service-URL |
| --- | --- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003` |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090` |

Het pad van de Allocation API wordt vanzelf gevonden (`/model/allocation` voor Kubecost, `/allocation/compute` of `/allocation` voor OpenCost). Stel `cost.engine.allocationPath` alleen in bij een ongebruikelijke installatie. Met `auto` of een URL wordt er niets meegeleverd, dus stel voor geheugenaanbevelingen ook `cost.engine.prometheusUrl` in (zie [De gegevens erachter](#de-gegevens-erachter)).

## Prijzen voor on-premises en bare metal

Clusters waarvan de nodes geen openbare cloudcatalogusprijs hebben, kunnen een tarievenkaart instellen. Zonder tarievenkaart prijst OpenCost ze tegen zijn standaardtarieven (on-premises, bare metal, kind, k3s), die ver kunnen afwijken van wat je hardware kost, en dat melden het overzicht en de pagina **Kosten** van het cluster ook; op een cloud die hij herkent, houdt een node zijn catalogusprijs, en prijst een tarievenkaart alleen wat er in de catalogus ontbreekt. Met een tarievenkaart prijst OpenCost dan elke resource op basis van deze bedragen, allemaal in USD per resource-uur:

```yaml title="values.yaml"
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

Dit zijn de eigen standaardtarieven van OpenCost: vul je eigen bedragen in, anders blijft de pagina **Kosten** melden dat het cluster tegen de standaardtarieven van OpenCost wordt geprijsd.

## Instellingen die het weten waard zijn

Allemaal optioneel; de `values.yaml` van de chart bevat de volledige lijst:

```yaml title="values.yaml"
cost:
  enabled: auto           # on, except with the gke-autopilot and eks-fargate presets
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

## Right-sizing

De kaart **Right-Sizing** op de pagina **Kosten** van een cluster beveelt een CPU- en een geheugen-request aan voor elke container waarvan hij genoeg geschiedenis heeft, gerangschikt op hoeveel elke wijziging per maand bespaart.

Een aanbeveling is de waargenomen vraag plus 25% marge, afgerond op een waarde die je in een manifest kunt plakken (10m CPU, 16Mi geheugen):

- CPU wordt gedimensioneerd op basis van het 95e percentiel van het gemiddelde gebruik per uur: hoog genoeg om echte belasting te dekken, laag genoeg dat één piek het request niet een maand lang opblaast.
- Geheugen wordt gedimensioneerd op basis van de piek van de working set, nooit op een gemiddelde (zie [De gegevens erachter](#de-gegevens-erachter)).

Requests worden aanbevolen; limits niet. Een request is wat de scheduler reserveert en waarop de rekening wordt gebaseerd, dus het is het getal dat de kosten beweegt. Een limit is een beslissing over of een container die zich misdraagt moet worden geknepen of beëindigd, en die beslissing kunnen gebruiksgegevens niet voor je nemen.

Elke container wordt vergeleken met zijn huidige request:

| Oordeel | Wat het betekent |
| --- | --- |
| Overgeprovisioneerd | Hij reserveert duidelijk meer dan hij gebruikt. Hier komen de besparingen vandaan. |
| Ondergeprovisioneerd | Hij reserveert minder dan hij gebruikt, dus hij wordt geknepen of loopt risico op een OOM-kill. Dit oplossen kost geld, en de kaart toont dat als een stijging. |
| Geen request ingesteld | Er valt niets te verkleinen, maar de scheduler kan de container niet veilig plaatsen, en hij wordt onder druk als eerste uitgezet. |

Een container binnen 15% van zijn aanbeveling telt als goed gedimensioneerd en wordt weggelaten: niemand zou een manifest moeten bewerken om 3% van een request af te halen.

Twee waarborgen houden het advies eerlijk. Een workload heeft minstens 24 uur aan kostenvensters nodig voordat hij überhaupt wordt gedimensioneerd, omdat een venster van vier uur een nachtelijke batchjob in rust kan treffen en kan adviseren hem tot niets te verkleinen. En besparingen worden doorgerekend op basis van de lengte van het venster waar je naar kijkt, niet op basis van het aantal rijen, dus de besparing van een Deployment wordt niet vermenigvuldigd met zijn aantal replica's. De schatting gaat ervan uit dat de uitgaven meeschalen met wat de engine heeft toegewezen, namelijk `max(request, usage)`; voor een overgeprovisioneerde container is dat het request, dus het besparingsbedrag is exact.

### De gegevens erachter

Naast de uitgaven verzamelt de poller wat een aanbeveling nodig heeft: de CPU- en geheugen-requests, limits en het gebruik van elke container.

Geheugen heeft nog een bron nodig. De Allocation API meldt alleen een gemiddelde per venster, en een uurgemiddelde verbergt de piek die een container met een OOM-kill neerhaalt, dus geheugen daarop dimensioneren zou gevaarlijk zijn. De poller leest in plaats daarvan de geheugenpiek van elke container uit Prometheus, gekoppeld op `(namespace, pod, container)`:

- Met de meegeleverde engine (de standaard) gebruikt hij de eigen Prometheus van de chart. Niets om in te stellen.
- Is `cost.engine.url` ingesteld (`auto` of de URL van je engine), wijs dan `cost.engine.prometheusUrl` naar een Prometheus die cAdvisor scrapet, en stel `cost.engine.prometheusCadvisorJob` in als de scrapejob daarvan niet `kubernetes-nodes-cadvisor` heet.
- Zonder Prometheus werken CPU-aanbevelingen nog steeds, op basis van de opgeslagen uurgemiddelden, en geheugenaanbevelingen worden weggelaten in plaats van geraden.

Een storing van Prometheus stopt het verzamelen van uitgaven nooit: pieken zijn een extraatje, en een uur wordt zonder ze verstuurd. CPU gebruikt bewust geen Prometheus: een te groot CPU-request knijpt alleen, waar een te klein geheugen-request een container beëindigt, dus de uurgemiddelden zijn veilig voor CPU, en de CPU-rate van elke container over een heel cluster opvragen is zwaar genoeg om een kleine Prometheus omver te halen.

## Waarschuwen op kosten

OneUptime schrijft uit de kostenrijen van elk uur vier metrics, in geld uitgedrukt en genoemd naar wat ze zijn, zodat je kosten in grafieken kunt zetten, op een dashboard kunt plaatsen en erop kunt waarschuwen in een [Kubernetes-monitor](/docs/monitor/kubernetes-monitor) of een [metricmonitor](/docs/monitor/metrics-monitor):

| Metric | Wat het is | Attributen |
| --- | --- | --- |
| `oneuptime.kubernetes.cost.total` | Wat het cluster in elk uur kostte, inactieve capaciteit inbegrepen | `k8s.cluster.name` |
| `oneuptime.kubernetes.cost.idle` | Het deel daarvan dat geen workload gebruikte: inactieve en niet-toegewezen capaciteit | `k8s.cluster.name` |
| `oneuptime.kubernetes.cost.workload` | Wat elke workload in elk uur kostte; opgeteld per namespace, wat de namespace kostte | `k8s.cluster.name`, `k8s.namespace.name` en de naam van de workload onder zijn soort, zoals `k8s.deployment.name` |
| `oneuptime.kubernetes.cost.efficiency` | Hoeveel van de aangevraagde CPU en het aangevraagde geheugen elke workload gebruikte, in procenten, gewogen naar kosten | Die van de workload, zoals hierboven |

Elk punt bevat de kosten van één uur, in de valuta van de agent (standaard USD), met het begin van het uur als tijdstempel, en wordt ongeveer een uur na afloop van dat uur geschreven: tel de punten op over een venster van uren, en die van een dag komen samen uit op de kosten van die dag. Ze komen uit wat het cluster al heeft verstuurd, dus ze worden niet als metric-ingestie gefactureerd, en ze worden even lang bewaard als de andere metrics van het cluster.

De Kubernetes-monitor heeft er drie sjablonen voor: Cluster Daily Cost Over Budget, Namespace Daily Cost Over Budget en High Idle Spend, elk met een budget dat je zelf instelt. De prijsmetrics van OpenCost zijn ook gewone metrics: een metricmonitor kan waarschuwen wanneer het gemiddelde van `node_total_hourly_cost` boven een budget stijgt, of wanneer `pv_hourly_cost` verschijnt voor een volumeklasse die in een cluster niet zou moeten bestaan.

## Gegevensmodel en bewaartermijn

Kostenrijen worden opgeslagen in ClickHouse, één per cluster, venster, namespace, controller, pod en container. Ze volgen de telemetriebewaartermijn van het cluster: de `retainTelemetryDataForDays` van het cluster, of de gegevensbewaartermijn van het project als die niet is ingesteld. Inactieve en niet-toegewezen capaciteit worden opgeslagen als gewone rijen onder de namespaces `__idle__` en `__unallocated__`, zodat ze groeperen en filteren zoals workloaduitgaven.

## Problemen oplossen

:::details De kostenpagina's zijn leeg
Bij de presets `gke-autopilot` en `eks-fargate` staat kostenmonitoring standaard uit: zet het aan met `--set cost.enabled=true`. Lees anders de logs van de kostenpoller: `kubectl logs -n oneuptime-agent deploy/kubernetes-agent-cost`. (De deployment heet `<release>-kubernetes-agent-cost` als de releasenaam geen `kubernetes-agent` bevat; `kubectl get deploy -n oneuptime-agent` toont ze.) `HTTP 401` betekent dat OneUptime de ingestiesleutel heeft geweigerd. `did not answer any known allocation path` betekent dat de engine nog niet draait (de meegeleverde OpenCost heeft een paar minuten nodig om zijn eerste uren te prijzen) of dat `cost.engine.url` onjuist is.
:::

:::details De meegeleverde OpenCost is niet gereed
Lees zijn logs: `kubectl logs -n oneuptime-agent deploy/kubernetes-agent-opencost`. Die vermelden welke cloudprovider hij heeft gedetecteerd en of zijn prijsgegevens zijn geladen.
:::

:::details Het overzicht meldt dat de meegeleverde OpenCost niet nodig is
Het cluster draait een eigen Kubecost of OpenCost, en de kostenagent leest die uit, dus de OpenCost en Prometheus die de chart heeft meegeleverd, prijzen niets. Upgrade met `--set cost.engine.url=auto` om ze niet langer te laten draaien, of stel `cost.engine.preferExisting=false` in om in plaats daarvan de meegeleverde engine uit te lezen.
:::

:::details De kostenagent leest je engine niet uit
Het log van de kostenagent vermeldt welke engine hij uitleest en waarom hij de andere heeft overgeslagen: `kubectl logs -n oneuptime-agent deploy/kubernetes-agent-cost`. Hij slaat een engine over die niet antwoordt (door een NetworkPolicy tussen de namespaces, bijvoorbeeld), een aanmelding vereist of voor meerdere clusters antwoordt, zoals een Kubecost die andere clusters federeert. Wijs met `cost.engine.url` aan welke engine hij moet uitlezen.
:::

:::details Het OpenCost-log meldt mkdir /var/configs: permission denied
Een oudere chart draaide OpenCost zonder beschrijfbare configuratiemap, dus `Error downloading default pricing data` liet zijn Allocation API niet antwoorden en de poller stilvallen, terwijl de pod `Running` bleef, `/healthz` groen bleef en de kostenmetrics van de nodes gewoon werden gepubliceerd. Huidige charts lossen dit op: voer `helm repo update` uit en upgrade daarna met `--reset-then-reuse-values`. Kostenrijen verschijnen bij de volgende poll.
:::

:::details Het Kubernetes Cost Dashboard toont geen gegevens
Het sjabloon leest de gescrapete kostenmetrics: controleer of `cost.metrics.enabled` op `true` staat.
:::

:::details De kaart Right-Sizing is leeg
Ofwel is het tijdsbereik korter dan de 24 uur die een aanbeveling nodig heeft (verbreed het), ofwel zit elke container al binnen 15% van zijn aanbevolen request, wat de kaart dan meldt.
:::

:::details Geheugenaanbevelingen tonen -, maar CPU-aanbevelingen werken
Er heeft geen geheugenpiek OneUptime bereikt, dus het geheugen is niet gedimensioneerd in plaats van op basis van een gemiddelde geraden. Stel met je eigen engine `cost.engine.prometheusUrl` in. De kaart meldt om hoeveel containers het gaat.
:::

:::details De cijfers wijken af van de eigen interface van de engine
OneUptime neemt de afstemmingscorrecties van de engine op in elk kostenonderdeel en stuurt hele, afgesloten uren: de uitgaven van het huidige uur verschijnen nadat het is afgesloten.
:::

:::details De meegeleverde Prometheus is opnieuw gestart
Met de standaardopslag `emptyDir` verliest een herstart een paar uur gebruiksgeschiedenis, dus de kosten van die uren kunnen lager uitvallen. Stel `cost.prometheus.persistence.enabled=true` in als dat voor je uitmaakt.
:::

## Volgende stappen

:::cards
- [Kubernetes-agent](/docs/telemetry/kubernetes-agent): Installeer de agent, en al het andere dat hij verzamelt.
- [Metrics-monitor](/docs/monitor/metrics-monitor): Waarschuw wanneer de uitgaven een budget overschrijden.
- [Kubernetes-monitor](/docs/monitor/kubernetes-monitor): Waarschuw ook op de gezondheid van het cluster.
:::
