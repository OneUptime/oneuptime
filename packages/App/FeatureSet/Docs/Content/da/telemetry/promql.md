# Forespørg metrikker med PromQL

PromQL er Prometheus' forespørgselssprog og det sprog, som de fleste, der laver diagrammer over metrikker, allerede kender. OneUptime læser dit projekts metrikker med det: på fanen **PromQL** under Metrikker og gennem et Prometheus-kompatibelt API, som Grafana eller ethvert værktøj med en Prometheus-datakilde kan pege på.

:::cards
- [Skriv en forespørgsel](#skriv-en-forespørgsel): Kør PromQL på siden Metrikker, og se en graf eller en tabel.
- [Sådan navngives metrikker](#sådan-navngives-metrikker): Sådan læses OpenTelemetry-navne og -attributter i PromQL.
- [Forbind Grafana](#forbind-grafana): Tilføj OneUptime som en Prometheus-datakilde.
- [Grænser](#grænser): Hvad en forespørgsel må læse, og hvor længe.
:::

## Sådan virker det

Fanen PromQL og Grafana bruger det samme API. OneUptime kontrollerer, at kalderen må læse projektets metrikker, læser kun de tjenester, kalderen må læse, og evaluerer forespørgslen, som Prometheus gør.

```mermaid title="Fra en PromQL-forespørgsel til dine metrikker og tilbage"
flowchart TB
    T["Fanen PromQL,<br/>Grafana eller curl"] --> A["/api/prometheus:<br/>tjekker, hvem der spørger"]
    A --> E["Evaluerer forespørgslen,<br/>som Prometheus gør"]
    E --> M["Læser projektets<br/>metrikker, kun fra de<br/>tjenester, kalderen<br/>må læse"]
    M --> R["Svarer i<br/>Prometheus-formatet"]
```

## Før du begynder

- **Metrikker, der ankommer.** Send dem med [OpenTelemetry](/docs/telemetry/open-telemetry) eller fra en agent som [OpenTelemetry-collectoren til værter](/docs/telemetry/host-otel-collector).
- **En rolle, der må læse metrikker.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member eller Telemetry Viewer, eller en brugerdefineret rolle med tilladelsen Read Metrics. En rolle, der er begrænset til bestemte tjenester, læser kun deres metrikker.
- **Til Grafana eller et script: en API-nøgle til projektet** med en af disse roller eller tilladelsen Read Metrics. Se [Opret en API-nøgle](/docs/api-reference/api-reference#opret-en-api-nøgle). På OneUptime Cloud kræver API-nøgler abonnementet **Growth**.

## Skriv en forespørgsel

:::steps
### Åbn PromQL

Åbn **Metrikker**, og klik på fanen **PromQL**.

### Skriv forespørgslen

Skriv den i editoren, vælg et eksempel under **Eksempler**, eller start fra **Tilføj et metriknavn**, som viser dit projekts metrikker med de navne, PromQL giver dem.

### Kør den

Klik på **Kør forespørgsel**, eller tryk på Ctrl+Enter (⌘+Enter på en Mac). **Graf** tegner forespørgslen over tidsintervallet; **Tabel** viser hver series værdi ved slutningen af det.
:::

Et par forespørgsler at starte med:

```text title="PromQL"
# Requests per second, by service
sum by (job) (rate(http_requests_total[5m]))

# The 95th percentile of a latency histogram
histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_bucket[5m])))

# The five hosts using the most memory
topk(5, system_memory_usage)
```

Editoren viser, hvad der gik galt med en forespørgsel, der ikke kan køres, og hvor: ved `rate(http_requests_total)` siger den for eksempel, at funktionen skal have et interval som `[5m]`.

## Sådan navngives metrikker

OneUptime gemmer metrikker på OpenTelemetrys måde. PromQL læser dem med de navne, som Prometheus' egen OpenTelemetry-understøttelse giver dem, så en forespørgsel, der er skrevet til Prometheus, virker her:

| I OneUptime | I PromQL |
| --- | --- |
| En gauge `system.cpu.utilization` | `system_cpu_utilization` |
| En tæller `http.requests` | `http_requests` eller `http_requests_total` |
| Et histogram `http.server.request.duration` | `http_server_request_duration_bucket` (med `le`), `_count` og `_sum` |
| En summary `rpc.latency` | `rpc_latency` (med `quantile`), `_count` og `_sum` |
| En attribut `http.route` | Etiketten `http_route` |
| En ressourceattribut `service.name` | Etiketten `resource_service_name` og `job` |
| En ressourceattribut `service.instance.id` | Etiketten `resource_service_instance_id` og `instance` |

- **Punktummer og bindestreger bliver til understreger** i metrik- og etiketnavne. For at angive en metrik eller en etiket præcis, som den er gemt, sætter du navnet i anførselstegn, som Prometheus 3 gør: `{"http.server.request.duration", "http.route"="/checkout"}`.
- **Delta-tællere lægges sammen** fra starten af forespørgslens tidsinterval, så `rate()` og `increase()` læser dem som enhver anden tæller.
- **Eksponentielle histogrammer** har `_count` og `_sum`, men ingen buckets.

## Forbind Grafana

:::steps
### Opret en API-nøgle

I OneUptime åbner du **Projektindstillinger → Avanceret → API-nøgler** og klikker på **Opret API-nøgle**. Giv nøglen en rolle, der må læse telemetri, eller tilladelsen Read Metrics.

### Tilføj en Prometheus-datakilde

I Grafana åbner du **Connections → Data sources → Add data source** og vælger **Prometheus**.

### Angiv serverens URL

Sæt **Prometheus server URL** til din OneUptime-adresse efterfulgt af `/api/prometheus`. På OneUptime Cloud er det `https://oneuptime.com/api/prometheus`. Fanen **PromQL** viser adressen på din egen server med en kopiknap.

### Send API-nøglen

Under **HTTP headers** tilføjer du headeren `Authorization` med værdien `Bearer` efterfulgt af et mellemrum og din API-nøgle. Basic-godkendelse virker også: et vilkårligt brugernavn med API-nøglen som adgangskode.

### Gem og test

Klik på **Save & test**. Grafana kører en forespørgsel og siger, at datakilden virker.
:::

Enhver anden Prometheus-klient virker på samme måde. Med curl:

```bash title="Query OneUptime's Prometheus API"
curl -H "Authorization: Bearer $ONEUPTIME_API_KEY" \
  "https://oneuptime.com/api/prometheus/api/v1/query?query=up"
```

## API'et

API'et besvarer ruterne i Prometheus' HTTP-API, med `GET` eller `POST`, under `/api/prometheus`:

| Rute | Hvad den besvarer |
| --- | --- |
| `/api/v1/query` | En forespørgsel på ét tidspunkt (`time`, som standard nu). |
| `/api/v1/query_range` | En forespørgsel ved hvert `step` fra `start` til `end`. |
| `/api/v1/series` | De serier, `match[]` vælger. |
| `/api/v1/labels` | Etiketnavne for de serier, `match[]` vælger, eller for alle metrikker. |
| `/api/v1/label/<name>/values` | Én etikets værdier. `__name__` viser metriknavnene. |
| `/api/v1/metadata` | Hver metriks type, hjælpetekst og enhed. |

Tidspunkter er Unix-sekunder eller RFC 3339, varigheder er sekunder eller en varighed som `15s`, og svarene er i Prometheus' format. `/api/v1/status/buildinfo` svarer som en Prometheus 3-server; regler og advarsler er tomme, fordi OneUptime advarer med [monitorer](/docs/monitor/metrics-monitor).

## Hvad PromQL dækker

- **Selektorer** med alle matchere (`=`, `!=`, `=~`, `!~`), intervaller, `offset`, `@` (med `start()` og `end()`) og underforespørgsler.
- **Operatorer**: aritmetik, sammenligninger (med `bool`), `and`, `or`, `unless` og vektormatchning med `on`, `ignoring`, `group_left` og `group_right`.
- **Aggregeringer**: `sum`, `avg`, `min`, `max`, `count`, `group`, `stddev`, `stdvar`, `topk`, `bottomk`, `quantile` og `count_values`, med `by` eller `without`.
- **Funktioner**: `rate`, `irate`, `increase`, `delta`, `idelta`, `deriv`, `predict_linear`, `histogram_quantile`, alle `*_over_time`-funktioner, `changes`, `resets`, `absent`, `label_replace`, `label_join`, `sort`, `clamp`, `round`, matematik- og datofunktionerne og flere til.

Prometheus' funktioner til native histogrammer, såsom `histogram_count()`, er ikke tilgængelige: OneUptime gemmer histogrammer med buckets, som `histogram_quantile()` og serierne `_count` og `_sum` læser.

## Grænser

Hver forespørgsel er afgrænset, så et dashboard med mange paneler ikke kan overbelaste OneUptime:

| Grænse | Værdi |
| --- | --- |
| Punkter i én serie i en intervalforespørgsel | 11.000 |
| Målinger, én forespørgsel må læse og holde | 5.000.000 |
| Metrikpunkter, én selektor må læse | 1.000.000 |
| Tid, en læsning må tage | 30 sekunder |
| Tid, evalueringen må tage | 30 sekunder |
| Hvor langt tilbage en selektor kigger efter en series seneste måling | 5 minutter |
| En underforespørgsels trin, når forespørgslen udelader det | 1 minut |

## Fejlfinding

:::details Grafana siger, at datakilden ikke virker
Tjek, at URL'en ender på `/api/prometheus`, og at headeren `Authorization` indeholder `Bearer`, et mellemrum og API-nøglen. En nøgle uden en rolle, der må læse metrikker, afvises: giv den en under **Projektindstillinger → Avanceret → API-nøgler**.
:::

:::details En metrik fra udforskeren giver ingen resultater
Dens PromQL-navn har understreger, hvor det gemte navn har punktummer, og et histogram læses gennem `_bucket`, `_count` eller `_sum`. **Tilføj et metriknavn** på fanen PromQL viser hvert navn, som PromQL skriver det.
:::

:::details "The query reads more than 1,000,000 metric points"
Forespørgslen beder om mere, end en læsning må rumme. Tilføj etiketmatchere, forkort tidsintervallet, eller brug et større trin.
:::

## Næste trin

:::cards
- [Måleudforsker](/docs/telemetry/metrics-explorer): Vis metrikker i diagrammer uden at skrive en forespørgsel.
- [Metrik-monitor](/docs/monitor/metrics-monitor): Få en advarsel, når en metrik krydser en grænse.
- [Eksterne datakilder](/docs/dashboards/data-sources): Vis en ekstern Prometheus på dine dashboards.
:::
