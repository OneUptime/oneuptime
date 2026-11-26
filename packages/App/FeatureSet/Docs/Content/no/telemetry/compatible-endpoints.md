# Prometheus, Loki, Splunk, Datadog & Sentry

Kjører du allerede Prometheus, en Loki-klient, en Splunk-forwarder, Datadog Agent eller et Sentry-SDK? Behold det. OneUptime tar imot det hvert av disse verktøyene sender, på stiene verktøyet allerede bruker, og lagrer det som OpenTelemetry-data. Å prøve OneUptime krever bare en ny URL og nøkkel, ikke ny instrumentering, og drop-filtrene, scrub-reglene, loggpipelinene, dataoppbevaringen og inntaksbudsjettene dine gjelder for disse dataene som for alle andre.

:::cards
- [Prometheus remote write](#prometheus-remote-write): Målinger fra Prometheus, Grafana Alloy eller en hvilken som helst annen avsender av remote write.
- [Loki](#loki): Logger fra Promtail, Grafana Alloy, Fluent Bit eller Vector.
- [Splunk HTTP Event Collector](#splunk-http-event-collector): Logger og målingshendelser fra en hvilken som helst HEC-klient.
- [Datadog Agent](#datadog-agent): Målinger, logger og APM-traces fra Datadog Agent.
- [Sentry-SDK-er](#sentry-sdk-er): Feil, transaksjoner, logger, cron-check-ins, tilbakemeldinger og profiler fra et hvilket som helst Sentry-SDK.
:::

## Slik fungerer det

```mermaid title="Fra verktøyene du kjører til OneUptime"
flowchart TB
    subgraph tools["Agentene og SDK-ene du allerede kjører"]
        direction LR
        prometheus["Prometheus"]
        loki["Loki-klienter"]
        splunk["Splunk HEC-klienter"]
        datadog["Datadog Agent"]
        sentry["Sentry-SDK-er"]
    end
    tools -->|"Sin egen protokoll + inntaksnøkkelen din"| endpoint["Kompatible endepunkter i OneUptime"]
    endpoint --> otlp["Lagret som OpenTelemetry-data"]
    otlp --> signals["Logger, målinger, traces, unntak og profiler"]
```

Hvert endepunkt svarer slik verktøyet selv forventer — en `204` til Prometheus og Loki, HECs `{"text": "Success", "code": 0}`, Datadogs `202`, Sentrys hendelses-ID — så verktøyet melder suksess og feil slik det alltid har gjort. Deretter behandles dataene nøyaktig som data fra et OpenTelemetry-SDK.

## Før du begynner

- **Et OneUptime-prosjekt** – i OneUptime Cloud faktureres telemetri per inntatt GB, og et prosjekt på Free-planen trenger en betalingsmetode før det kan sende telemetri.
- **Inntaksnøkkel for telemetri** – opprett en **Server**-nøkkel under **Produkter → Prosjektinnstillinger → Telemetri og APM → Inntaksnøkler**, og kopier **Hemmelig nøkkel**. Hvert verktøy sender den der det sender sin egen legitimasjon. Sentry-DSN-en til en nettleserapp tar i stedet en nøkkel av typen **Nettleser**, med opprinnelsene til nettstedet ditt på.
- **Verten din** – eksemplene bruker `oneuptime.com`. Hvis du hoster OneUptime selv, bruker du din egen vert.

> [!TIP]
> Fanen Oppsettveiledning på Logger, Målinger, Spor og Unntak har disse verktøyene med blant sine måter å sende på, med verten din og en nøkkel du velger, allerede fylt inn.

## Endepunkter

| Verktøy | Pek det mot | Hvor nøkkelen skal |
| --- | --- | --- |
| Prometheus remote write | `https://oneuptime.com/telemetry/prometheus/api/v1/write` | Et bearer-token, eller basic auth med nøkkelen som passord. |
| Loki | `https://oneuptime.com/telemetry/loki/api/v1/push` | Basic auth med nøkkelen som passord, eller et bearer-token. |
| Splunk HTTP Event Collector | `https://oneuptime.com/telemetry/services/collector` | HEC-tokenet: `Authorization: Splunk <key>`. |
| Datadog Agent | `https://oneuptime.com/telemetry/datadog` | API-nøkkelen: `DD-API-KEY`. |
| Sentry-SDK-er | DSN-en `https://<key>@oneuptime.com/telemetry/sentry/1` | Den offentlige nøkkelen i DSN-en. |

Hvert endepunkt tar også imot nøkkelen i headeren `x-oneuptime-token`, og headeren `x-oneuptime-service-name` angir tjenesten alt verktøyet sender, hører til. En nøkkel kan skrives som sine 32 heksadesimale sifre uten bindestreker; i Sentry-DSN-en og API-nøkkelen til Datadog må den skrives slik.

## Prometheus remote write

Legg til OneUptime som et remote write-mål. Prometheus fortsetter å skrape som nå og sender en kopi av hver sample:

```yaml title="prometheus.yml"
remote_write:
  - url: https://oneuptime.com/telemetry/prometheus/api/v1/write
    authorization:
      credentials: YOUR_TELEMETRY_KEY
    send_exemplars: true
```

Med Grafana Alloy legger du til en `prometheus.remote_write`-komponent og videresender skrapingene dine til den:

```text title="config.alloy"
prometheus.remote_write "oneuptime" {
  endpoint {
    url          = "https://oneuptime.com/telemetry/prometheus/api/v1/write"
    bearer_token = "YOUR_TELEMETRY_KEY"
  }
}

prometheus.scrape "app" {
  targets    = [{"__address__" = "localhost:8080"}]
  forward_to = [prometheus.remote_write.oneuptime.receiver]
}
```

Remote write 1.0 og 2.0 tas begge imot, snappy-komprimert slik alle avsendere sender dem. For å sende 2.0, som har med type, enhet og beskrivelse for hver serie, angir du `protobuf_message: io.prometheus.write.v2.Request` (Prometheus 3) eller `protobuf_message = "io.prometheus.write.v2.Request"` (Alloy). Prometheus sender exemplars med `send_exemplars: true` når den lagrer dem (`--enable-feature=exemplar-storage`); Alloy sender dem som standard.

### Hva en serie blir til

- **Navnet og etikettene beholdes.** `http_requests_total{job="checkout", code="500"}` er målingen `http_requests_total` med attributtene `job` og `code`, så en spørring som flyttes fra Grafana, finner den.
- **Jobben er tjenesten.** Hver `job` blir en tjeneste, og hver `instance` blir tjenesteinstansen dens, slik OpenTelemetrys Prometheus-regler kartlegger dem.
- **Typene beholdes.** Tellere, og bøttene og antallene i et histogram, er kumulative summer, så ratene deres vises riktig i diagrammer. En type kommer fra metadataene avsenderen sender med; uten dem er et navn som slutter på `_total`, en teller, og en `_bucket` med en `le`-etikett en histogrambøtte.
- **Klassiske histogrammer viser persentilene sine.** Et klassisk histogram beholder seriene `_bucket`, `_count` og `_sum`. Vis målingen `_bucket` med P50 til P99 i [Målingsutforsker](/docs/telemetry/metrics-explorer), så leses bøttene i hver scrape som ett histogram, uansett hvilken request hver bøtte kom i. I [PromQL](/docs/telemetry/promql) svarer `histogram_quantile(0.95, sum by (le) (rate(<name>_bucket[5m])))` som i Prometheus.
- **Native histogrammer** blir eksponentielle histogrammer, og native histogrammer med egendefinerte bøtter blir vanlige histogrammer.
- **Exemplars lenker til traces.** Et exemplar med en etikett `trace_id` (eller `traceID`) knytter datapunktet sitt til den tracen og det spanet: klikk på punktet i diagrammet for målingen for å se tracen eller loggene. Verdien og de andre etikettene beholdes ikke, og heller ikke et exemplar der datapunktet kom i en annen request.
- **Beholdes ikke:** staleness-markører og andre verdier som er NaN eller uendelige, og `_created`-seriene til tellere. De telles likevel som skrevet, så avsenderen ikke melder om mislykkede samples.
- **Avvises:** data som ingen versjon av remote write tillater, for eksempel en serie uten målingsnavn eller et sample med et negativt tidsstempel. Resten av requesten lagres, og avsenderen får `400` med det som ble avvist.

## Loki

OneUptime tar imot push-API-et til Loki på Lokis egen sti, i JSON eller som den snappy-komprimerte protobufen Promtail og Grafana Alloy sender. Legg til OneUptime som klient:

```yaml title="promtail.yaml"
clients:
  - url: https://oneuptime.com/telemetry/loki/api/v1/push
    bearer_token: YOUR_TELEMETRY_KEY
```

I Fluent Bit tar `loki`-utdataen verten og stien hver for seg:

```text title="fluent-bit.conf"
[OUTPUT]
    Name         loki
    Match        *
    Host         oneuptime.com
    Port         443
    Tls          On
    Uri          /telemetry/loki/api/v1/push
    Http_User    oneuptime
    Http_Passwd  YOUR_TELEMETRY_KEY
    Labels       job=fluent-bit
```

OneUptime svarer slik Loki gjør: `204` når en push er lagret, `400` for en den ikke kan lese, `413` for en over grensene nedenfor, `401` for en manglende eller ukjent nøkkel, `403` for et oppbrukt dagsbudsjett, `429` med `Retry-After` over en hastighetsgrense og `503` når den ikke kan ta imot en akkurat nå. Promtail, Alloy og Vector prøver en `429` eller en `503` på nytt, og forkaster enhver annen avvist batch og logger hvorfor; Fluent Bit forkaster en `400` og prøver alt annet på nytt, opptil sin `Retry_Limit`.

### Hva en strøm blir til

- **Hver oppføring er en logg**, med sitt eget tidsstempel ned til nanosekundet og linjen sin som innhold.
- **Etiketter og strukturerte metadata er attributter**, under navnene de har i Loki.
- **Tjenesten** kommer fra den første av `service_name`, `service`, `app`, `application`, `name`, `app_kubernetes_io_name`, `container`, `container_name`, `component`, `workload` og `job` som en strøm har, slik Loki finner den. En `host`- eller `hostname`-etikett angir verten.
- **Nivået** kommer fra en `level`-, `detected_level`- eller `severity`-etikett eller -metadata, ellers fra en logfmt-`level=` eller `level`-feltet i en JSON-linje.
- **Sporingskontekst:** en `trace_id` og `span_id` i de strukturerte metadataene knytter loggen til tracen.

## Splunk HTTP Event Collector

Bruk OneUptime som HTTP Event Collector, med inntaksnøkkelen din som HEC-token. Docker-loggdriveren til Splunk legger til stien selv, så den tar bare verten:

```bash
docker run \
  --log-driver=splunk \
  --log-opt splunk-url=https://oneuptime.com \
  --log-opt splunk-token=YOUR_TELEMETRY_KEY \
  --log-opt splunk-format=json \
  your-image
```

Alle andre HEC-klienter poster til `/services/collector/event` eller `/services/collector/raw`. Slik sender du én hendelse:

```bash
curl https://oneuptime.com/telemetry/services/collector/event \
  -H "Authorization: Splunk YOUR_TELEMETRY_KEY" \
  -d '{"event": "Payment failed for order 42", "sourcetype": "app", "fields": {"service": "checkout"}}'
```

En `200` med `{"text": "Success", "code": 0}` betyr at hendelsen ble tatt imot. Endepunktet svarer også med HECs egne koder — `No data` (5), `Invalid data format` (6) med nummeret på hendelsen som ikke var gyldig, og `Event field is required` (12) — og svarer på `GET /services/collector/health` uten token.

### Hva en hendelse blir til

- **En logg**, med `time` fra hendelsen som tidsstempel. Er hendelsen en streng, er den innholdet; er den et objekt, er `message`, `msg`, `log`, `line` eller `text` innholdet, og de andre feltene er attributter.
- **Metadataene beholdes:** `host` er verten, og `source`, `sourcetype` og `index` beholdes som `com.splunk.source`, `com.splunk.sourcetype` og `com.splunk.index`. `host`, `source`, `sourcetype` og `index` i spørrestrengen fyller inn det en hendelse utelater.
- **Feltene er attributter.** Et `service.name`-felt angir tjenesten, og det gjør også `service`-feltet i en logg.
- **Målingshendelser** (`"event": "metric"`, med `metric_name` og `_value`, eller `metric_name:<name>`-felter) lagres som målinger, aldri som logger.
- **Tilbys ikke:** indexer acknowledgement. En klient som ber om det, får ingen `ackId`.

## Datadog Agent

Pek målingene, loggene og APM-tracene til Agenten mot OneUptime, med inntaksnøkkelen din som API-nøkkel:

```yaml title="datadog.yaml"
api_key: YOUR_TELEMETRY_KEY_WITHOUT_HYPHENS
dd_url: https://oneuptime.com/telemetry/datadog
logs_enabled: true
logs_config:
  use_http: true
  logs_dd_url: oneuptime.com:443
apm_config:
  enabled: true
  apm_dd_url: https://oneuptime.com/telemetry/datadog
process_config:
  process_collection:
    enabled: false
```

Agenten legger til sine egne stier på `dd_url` og `apm_dd_url`, og sender logger til `/api/v2/logs` på verten og porten som `logs_dd_url` angir. OneUptime svarer på disse stiene i roten bare for en request som har en `DD-API-KEY`-header. Start Agenten på nytt etter endringen; `datadog-agent status` viser API-nøkkelen som gyldig når OneUptime godtar den.

### Hva dataene fra Agenten blir til

- **Målinger** beholder navnene sine. Gauges forblir gauges, counts blir summer, og rates blir gauges av verdien per sekund.
- **Distributions** blir summaries med antall, sum, minimum og maksimum.
- **Service checks** blir en måling oppkalt etter sjekken, der verdien er statusen til sjekken: 0 OK, 1 advarsel, 2 kritisk, 3 ukjent.
- **Logger** beholder melding, status, vert og tjeneste, og resten av feltene som attributter.
- **APM-traces** vises i Spor. Hvert span er oppkalt etter ressursen sin (`GET /users/:id`, en spørring) og hører til tjenesten sin; et span som en integrasjon har gitt et eget tjenestenavn, som `checkout-postgres`, hører til tjenesten som gjorde kallet. Operasjonsnavnet og typen beholdes som `datadog.operation_name` og `datadog.span_type`.
- **Feil** i et span vises i Unntak, med stack tracen som traceren registrerte.
- **Tagger er attributter**, og taggene `service`, `env` og `version` angir tjenesten, miljøet og versjonen. HTTP- og databasetaggene til et span skrives også under OpenTelemetry-navnene sine: `http.status_code` som `http.response.status_code`, `db.type` som `db.system.name`.
- **Leses ikke ennå:** prosesser, containere, nettverksdata og profiler. La dem være slått av i `datadog.yaml`, som ovenfor. APM-statistikken til Agenten tas imot og beholdes ikke: OneUptime beregner sin egen ut fra spannene.

HTTP API-klientene til Datadog — et loggbibliotek som poster til `/api/v2/logs`, et skript som poster serier — kan sende til det samme endepunktet med `DD-API-KEY`-headeren.

### Uten Agent

dd-trace-go kan sende tracene sine til OneUptime selv, med inntaksnøkkelen din som passord i Agent-URL-en:

```bash
DD_TRACE_AGENT_URL=https://oneuptime:YOUR_TELEMETRY_KEY@oneuptime.com/telemetry/datadog
```

Tracerne for Python og Node.js utelater stien og passordet i URL-en, så send tracene deres gjennom Agenten.

## Sentry-SDK-er

Bytt ut DSN-en der du setter opp Sentry. Resten av Sentry-koden din forblir som den er:

```javascript
Sentry.init({
  dsn: "https://YOUR_TELEMETRY_KEY_WITHOUT_HYPHENS@oneuptime.com/telemetry/sentry/1",
  release: "checkout@1.4.2",
  environment: "production",
});
```

```python
sentry_sdk.init(
    dsn="https://YOUR_TELEMETRY_KEY_WITHOUT_HYPHENS@oneuptime.com/telemetry/sentry/1",
    release="checkout@1.4.2",
    environment="production",
)
```

Ettallet `1` på slutten av DSN-en kreves av SDK-ene til Sentry og leses ikke. DSN-en til en nettleserapp er offentlig, så bruk en inntaksnøkkel av typen **Nettleser** der, med opprinnelsene til nettstedet ditt på. Alt den sender, arkiveres da som RUM-telemetri for den nettleserappen, aldri som en backend-tjeneste.

### Hva en konvolutt blir til

- **Feil** vises i Unntak, med stack trace og unntakene som forårsaket dem, gruppert som alle andre unntak. Hver feil er et span i tracen sin, under spannet som var aktivt.
- **Transaksjoner** og spannene deres vises i Spor.
- **Sentry-logger** og meldinger som fanges med `capture_message`, vises i Logger.
- **Cron-check-ins** vises i Logger, én post per check-in, med slugen til monitoren i `sentry.monitor.slug` og statusen i `sentry.check_in.status`. En check-in som feilet, gikk ut på tid eller uteble, logges på nivået Error. For å få vite når en jobb feiler eller ikke kjører, oppretter du en [logg-monitor](/docs/monitor/logs-monitor) på slugen.
- **Tilbakemeldinger fra brukere**, fra feedback-widgeten til Sentry eller `capture_user_feedback`, vises i Logger, i tracen de ble sendt fra. `sentry.feedback.associated_event_id` er `sentry.event_id` til feilen de gjelder.
- **Profiler**, av transaksjoner og fra kontinuerlig profilering, vises i Profiler som wall time-profiler, koblet til tracen til transaksjonen. Android-profiler leses ikke ennå.
- **Tjenesten** er en `service`-tagg, ellers navnet på releasen før `@`: `checkout@1.4.2` er `checkout`. Releasen er tjenesteversjonen, og miljøet beholdes.
- **Beholdes ikke:** økter, replays og vedlegg. SDK-et sender dem fortsatt; OneUptime tar imot dem og forkaster dem.

## Grenser og inntaksbudsjetter

- **Requeststørrelse** – ingressen i OneUptime godtar requester på opptil 4 MB under `/telemetry`, og innholdet i hver request kan være på høyst 64 MB dekomprimert. En request fra Prometheus remote write kan være på høyst 32 MB dekomprimert og inneholde høyst 500 000 serier, etiketter og samples, slik at ingen enkelt request kan bruke opp minnet til serveren. Prometheus og Alloy sender som standard 2 000 samples per request, langt under begge; en request over avvises med `413`, så senk `max_samples_per_send` i `queue_config`.
- **Loki-pusher** – en push kan være på høyst 32 MB dekomprimert og inneholde høyst 500 000 oppføringer, etiketter og strukturerte metadata, der etikettene til en strøm telles én gang for hver av oppføringene dens. Promtail og Alloy sender som standard batcher på 1 MB, langt under begge; en push over avvises med `413`, så senk batchstørrelsen til klienten.
- **JSON-, MessagePack- og Datadog-nyttelaster** – et JSON- eller MessagePack-innhold kan inneholde høyst 1 000 000 verdier (objekter, matriser, strenger og tall), og en protobuf-nyttelast fra Datadog Agent høyst 500 000 serier, punkter, span, tagger og sketcher. Hver telles før den leses, og en request over en grense avvises med `413`.
- **Inntaksbudsjetter** – Prometheus remote write og Loki sjekkes mot budsjettet for målinger eller logger før innholdet leses, og avvises med `403` når det er brukt opp. Hver request telles deretter med den dekomprimerte størrelsen, slik en OTLP-request telles, også mot budsjettene til et team eller en etikett. En HEC-batch, en Datadog-nyttelast eller en Sentry-konvolutt kan inneholde flere signaler, så hvert signal telles mot sitt eget budsjett når det lagres, og forkastes når det budsjettet er brukt opp: loggene og målehendelsene i en HEC-batch deler størrelsen dens, og hvert element i en Sentry-konvolutt telles mot sitt eget signal – profilene mot profilbudsjettet, check-ins og tilbakemeldinger mot loggbudsjettet – mens vedleggene, replayene og øktene, som ikke beholdes, ikke telles mot noe.

## Feilsøking

### Alle requester avvises med 401

Nøkkelen kom ikke fram der endepunktet ser etter den, eller den er ikke en nøkkel i dette prosjektet. Sammenlign legitimasjonsinnstillingen i verktøyet med tabellen [Endepunkter](#endepunkter), og sjekk at nøkkelen ikke er slått av eller utløpt.

### Et Sentry-SDK sier at DSN-en er ugyldig

SDK-ene til Sentry avviser en DSN der nøkkelen har bindestreker. Skriv nøkkelen som sine 32 heksadesimale sifre, uten bindestrekene.

### Datadog-målinger kommer fram, men ikke logger

Sjekk at `logs_config.use_http` er `true`, og at `logs_config.logs_dd_url` er en vert og en port, ikke en URL. Agenten sender logger over TCP når `use_http` ikke er satt.

### En Datadog-logg er ikke koblet til tracen sin

Traceren skrev bare de laveste 64 bitene av trace-ID-en i loggen. Sett `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED=true` på traceren, så den skriver hele ID-en.

### Prometheus melder 415

Avsenderen ba om en remote write-protokoll som OneUptime ikke leser. Send remote write 1.0 eller 2.0.
