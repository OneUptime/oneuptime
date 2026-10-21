# Azure Container Apps

Send spor, logs og metrikker fra dine Azure Container Apps til OneUptime. Hver replika, der rapporterer `cloud.platform=azure_container_apps`, havner i ét **Cloud Environment** pr. Azure-abonnement og region, f.eks. _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_, med de kørende replikaer vist under **Instanser**.

:::cards
- [Sådan virker det](#sådan-virker-det): Hvad detektorerne sætter, og de to attributter, du selv sætter.
- [Opsætning](#opsætning): Gem tokenet, konfigurér appen med Azure CLI eller portalen, og tjek.
- [Brug miljøets administrerede OpenTelemetry-agent](#brug-miljøets-administrerede-opentelemetry-agent): Videresend alle apps i miljøet uden en sidecar.
- [Fejlfinding](#fejlfinding): Afviste eksporter, manglende miljøer og tomme instanser.
:::

## Sådan virker det

```mermaid title="Hvor attributterne for en Container Apps-replika kommer fra"
flowchart TB
    detector["Azure-detektor:<br/>platform og replika"] --> exporter
    manual["OTEL_RESOURCE_<br/>ATTRIBUTES: region<br/>og abonnement"] --> exporter
    exporter["Din app eller dens<br/>sidecar-collector"] -->|"OTLP over HTTPS"| ou["OneUptime"]
    ou --> env["Cloud-miljø<br/>abonnement og region"]
    ou --> inst["Instanser<br/>én række pr. replika"]
```

Container Apps har ressourcedetektorer: Collectorens detektor `azurecontainerapps` samt dem til Node.js (`@opentelemetry/resource-detector-azure`) og .NET (`OpenTelemetry.Resources.Azure`). De læser `CONTAINER_APP_NAME` og `CONTAINER_APP_REPLICA_NAME` og sætter `cloud.provider`, `cloud.platform`, `service.name` og replika-ID'et. Ingen af dem kender regionen eller abonnementet, så du sætter selv `cloud.region` og `cloud.account.id` i `OTEL_RESOURCE_ATTRIBUTES`.

| Attribut | Værdi | Bruges til |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `cloud.provider` | `azure` | Vises på oversigten |
| `cloud.platform` | `azure_container_apps` | Arkiverer telemetrien under **Cloud-miljøer** |
| `cloud.region` | miljøets region, f.eks. `eastus`: sat af dig | En del af miljønøglen |
| `cloud.account.id` | abonnements-ID'et: sat af dig | En del af miljønøglen |
| `azure.container_app.instance.id` | replikaens navn, sat af detektorerne fra `CONTAINER_APP_REPLICA_NAME` | Navngiver én kørende replika: én række for hver under **Instanser** |
| `service.instance.id` | replikaens navn, hvis du selv sætter det | Bruges, når ingen detektor har sat replika-ID'et |

- **Stavemåder med punktum virker.** Detektorerne til Node.js og .NET staver platformen `azure.container_apps` med et punktum. OneUptime omskriver den til `azure_container_apps`, når den modtages, så begge stavemåder havner i det samme miljø.
- **Værtsnavnet er replikaens navn.** Et SDK, der kun kører detektoren `host`, rapporterer replikaens navn som `host.name`, og OneUptime navngiver instansen efter det, når der ikke er noget mere specifikt.

Miljønøglen er `azure_container_apps|<subscription id>|eastus`.

## Før du begynder

- **En indtagelsesnøgle.** Opret en nøgle af typen **Server** under **Projektindstillinger → Telemetri og APM → Indtagelsesnøgler**, og kopiér dens token.
- **Azure CLI med udvidelsen `containerapp`** (`az extension add --name containerapp --upgrade`), logget ind på abonnementet, eller Azure-portalen.
- **Din applikation instrumenteret med et OpenTelemetry-SDK**, der eksporterer OTLP.

## Vælg, hvordan telemetrien forlader appen

| | SDK direct | Sidecar collector |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Ekstra container | Ingen | `otel-collector` i appen, som deler replikaens CPU og hukommelse |
| Sætter attributterne | SDK'et og `OTEL_RESOURCE_ATTRIBUTES` på appen | Collectoren, for alt, der passerer igennem |
| Hemmeligheden | `oneuptime-otlp-headers`, hele headeren | `oneuptime-token`, kun tokenet |

En tredje vej, miljøets administrerede OpenTelemetry-agent, videresender alle apps i miljøet uden en sidecar: se [Brug miljøets administrerede OpenTelemetry-agent](#brug-miljøets-administrerede-opentelemetry-agent). Hvert trin nedenfor har en fane til SDK direct og en til sidecar-collectoren; vælg én, så følger hvert trin den.

## Opsætning

:::steps
### Gem tokenet som en Container Apps-hemmelighed

> [!IMPORTANT]
> Tokenet er en hemmelighed. Gem det som en Container Apps-hemmelighed, og referér til det fra miljøvariabler med `secretref:`. Når en hemmelighed er sat, vises den ikke i `az containerapp show` eller i portalen; det gør en almindelig miljøvariabel.

:::tabs
@tab SDK direct
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-otlp-headers="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

SDK'ets `OTEL_EXPORTER_OTLP_HEADERS` skal have hele headeren `name=value`, så hemmeligheden indeholder den.
@tab Sidecar collector
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Collectoren tilføjer selv headernavnet, så hemmeligheden indeholder kun tokenet.
:::

I portalen: **Azure portal → Container Apps → your app → Settings → Secrets → + Add**. Skriv nøglen, vælg typen **Container Apps secret**, indsæt værdien, og klik på **Add**.

Hvis du opbevarer hemmeligheder i Key Vault, så referér til hemmeligheden i stedet for at kopiere dens værdi. Appens administrerede identitet skal have rollen **Key Vault Secrets User** på boksen:

```bash
az containerapp secret set \
  --name checkout-api --resource-group my-rg \
  --secrets "oneuptime-token=keyvaultref:https://my-vault.vault.azure.net/secrets/oneuptime-token,identityref:system"
```

### Konfigurér container-appen

:::tabs
@tab SDK direct
Sæt eksportøren og de attributter, ingen detektor kender, på applikationscontaineren. Udskift regionen og abonnements-ID'et med dine egne:

```bash
az containerapp update \
  --name checkout-api \
  --resource-group my-rg \
  --set-env-vars \
    OTEL_SERVICE_NAME=checkout-api \
    OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp \
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
    OTEL_EXPORTER_OTLP_HEADERS=secretref:oneuptime-otlp-headers \
    "OTEL_RESOURCE_ATTRIBUTES=cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000"
```

For replikaens identitet skal du slå SDK'ets Azure-detektor til: `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure` i Node.js eller `.ConfigureResource(r => r.AddAzureContainerAppsDetector())` med `OpenTelemetry.Resources.Azure` i .NET. Den sætter `azure.container_app.instance.id` fra `CONTAINER_APP_REPLICA_NAME`.

Container Apps kan ikke indsætte én miljøvariabel i en anden, så i andre sprog kan `service.instance.id` ikke komme i `OTEL_RESOURCE_ATTRIBUTES`. Slå værtsdetektoren til (dens `host.name` er replikaens navn), eller sæt det i koden:

```js title="tracing.js"
// Node.js: the file you load with --require before the app starts
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { resourceFromAttributes } = require("@opentelemetry/resources");

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.instance.id": process.env.CONTAINER_APP_REPLICA_NAME,
  }),
});
sdk.start();
```

```python title="tracing.py"
# Python: before the tracer provider is created
import os
from opentelemetry.sdk.resources import Resource

resource = Resource.create({"service.instance.id": os.environ.get("CONTAINER_APP_REPLICA_NAME", "")})
```

Uanset hvilken detektor du bruger, så behold `cloud.region` og `cloud.account.id` i `OTEL_RESOURCE_ATTRIBUTES`: ingen Container Apps-detektor sætter dem, og miljønøglen har brug for dem.

Eller i portalen:

1. Åbn **Application → Containers → Edit and deploy**, vælg din container på fanen **Container**, og klik på **Edit**.
2. Under **Environment variables** skal du tilføje hver variabel ovenfor med kilden **Manual entry** og `OTEL_EXPORTER_OTLP_HEADERS` med kilden **Reference a secret**, som peger på `oneuptime-otlp-headers`.
3. Klik på **Save**.
@tab Sidecar collector
En sidecar kører i den samme replika, så den ser de samme `CONTAINER_APP_NAME` og `CONTAINER_APP_REPLICA_NAME`. Dens detektor `azurecontainerapps` gør dem til `cloud.provider`, `cloud.platform`, `service.name` og `azure.container_app.instance.id`, og dens detektor `env` læser `cloud.region` og `cloud.account.id` fra `OTEL_RESOURCE_ATTRIBUTES` i collectorens eget miljø. Applikationen eksporterer kun til `http://localhost:4318`.

Eksportér appens definition, føj collectoren til `template.containers`, og anvend den:

```bash
az containerapp show --name checkout-api --resource-group my-rg -o yaml > checkout-api.yaml
# edit checkout-api.yaml as below
az containerapp update --name checkout-api --resource-group my-rg --yaml checkout-api.yaml
```

```yaml title="checkout-api.yaml"
properties:
  configuration:
    secrets:
      - name: oneuptime-token
        value: YOUR_TELEMETRY_INGESTION_TOKEN
  template:
    containers:
      - name: app
        image: myregistry.azurecr.io/checkout-api:1.4.2
        env:
          - name: OTEL_SERVICE_NAME
            value: checkout-api
          - name: OTEL_EXPORTER_OTLP_ENDPOINT
            value: http://localhost:4318
          - name: OTEL_EXPORTER_OTLP_PROTOCOL
            value: http/protobuf
        resources:
          cpu: 0.5
          memory: 1Gi
      - name: otel-collector
        image: otel/opentelemetry-collector-contrib:latest
        args:
          - --config=env:OTEL_COLLECTOR_CONFIG
        env:
          - name: ONEUPTIME_TOKEN
            secretRef: oneuptime-token
          # Read by the resourcedetection processor's env detector.
          - name: OTEL_RESOURCE_ATTRIBUTES
            value: cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000
          - name: OTEL_COLLECTOR_CONFIG
            value: |
              receivers:
                otlp:
                  protocols:
                    http:
                      endpoint: 0.0.0.0:4318
                    grpc:
                      endpoint: 0.0.0.0:4317
              processors:
                # env: cloud.region + cloud.account.id from OTEL_RESOURCE_ATTRIBUTES.
                # azurecontainerapps: cloud.provider, cloud.platform, service.name
                # and azure.container_app.instance.id from the CONTAINER_APP_*
                # variables. override: false keeps the service.name the
                # application set instead of the Container App's name.
                resourcedetection:
                  detectors: [env, azurecontainerapps]
                  timeout: 2s
                  override: false
                batch: {}
              exporters:
                otlphttp/oneuptime:
                  endpoint: https://oneuptime.com/otlp
                  headers:
                    x-oneuptime-token: ${env:ONEUPTIME_TOKEN}
              service:
                pipelines:
                  traces:
                    receivers: [otlp]
                    processors: [resourcedetection, batch]
                    exporters: [otlphttp/oneuptime]
                  metrics:
                    receivers: [otlp]
                    processors: [resourcedetection, batch]
                    exporters: [otlphttp/oneuptime]
                  logs:
                    receivers: [otlp]
                    processors: [resourcedetection, batch]
                    exporters: [otlphttp/oneuptime]
        resources:
          cpu: 0.25
          memory: 0.5Gi
```

`az containerapp show` eksporterer ikke hemmelige værdier, så tilføj posten `secrets` igen i hånden, eller udelad den, hvis du satte hemmeligheden i første trin: en opdatering beholder eksisterende hemmeligheder. Container Apps lægger CPU og hukommelse for alle containere i en replika sammen, så sidecarens `resources` tæller med i appens.

Eller i portalen:

1. Åbn **Application → Containers → Edit and deploy**. På fanen **Container** skal du med **+ Add** tilføje en container med navnet `otel-collector`, imaget `otel/opentelemetry-collector-contrib:latest` og **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`.
2. Tilføj dens miljøvariabler: `ONEUPTIME_TOKEN` (**Reference a secret**: `oneuptime-token`), `OTEL_RESOURCE_ATTRIBUTES` og `OTEL_COLLECTOR_CONFIG` (**Manual entry**, med værdierne ovenfor).
3. Klik på **Save**.
:::

Hvis du selv hoster OneUptime, så brug `https://YOUR-ONEUPTIME-HOST/otlp` som endpoint.

### Udrul den nye revision

`az containerapp update` udruller selv en ny revision. Klik på **Create** i portalen. Hvis flere revisioner er aktive, så flyt trafikken til den nye under **Revisions and replicas**.

### Tjek forbindelsen

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` med `"valid": true` betyder, at tokenet er accepteret. `401` betyder, at det er ukendt, tilbagekaldt, deaktiveret eller udløbet. Læs derefter collectorens output:

```bash
az containerapp logs show --name checkout-api --resource-group my-rg \
  --container otel-collector --follow
```

Se efter `Everything is ready` og intet `401` eller `connection refused`. Inden for et minut efter det første span, den første log eller metrik vises miljøet under **Cloud → All Environments** som _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_.
:::

## Brug miljøets administrerede OpenTelemetry-agent

Et Container Apps-miljø kan køre Azures administrerede OpenTelemetry-agent. Den modtager OTLP fra alle apps i miljøet og videresender det til et endpoint, du konfigurerer, uden en sidecar i hver app. Agenten eksporterer **kun over OTLP/gRPC**, så den kan ikke bruge HTTP-stien `/otlp`. Peg den i stedet på OneUptime-værten på port 443, hvor OneUptime leverer OTLP/gRPC over TLS:

```bash
az containerapp env telemetry otlp add \
  --name my-aca-env \
  --resource-group my-rg \
  --otlp-name oneuptime \
  --endpoint oneuptime.com:443 \
  --insecure false \
  --headers "x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN" \
  --enable-open-telemetry-traces true \
  --enable-open-telemetry-logs true \
  --enable-open-telemetry-metrics true
```

- **Selvhostet:** brug `YOUR-ONEUPTIME-HOST:443`. En selvhostet OneUptime tager kun imod OTLP/gRPC over TLS: se [OTLP over gRPC](/docs/telemetry/open-telemetry#otlp-over-grpc).
- **Apps sætter stadig attributterne.** Agenten lægger sin egen `OTEL_EXPORTER_OTLP_ENDPOINT` og `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` ind i hver app, så udelad de to fra appen, og behold `OTEL_SERVICE_NAME` og `OTEL_RESOURCE_ATTRIBUTES`. Agenten videresender, hvad apps sender, så `cloud.*` og replika-ID'et kommer stadig fra hver app.
- **Din `OTEL_RESOURCE_ATTRIBUTES` vinder.** Agenten sætter også `OTEL_RESOURCE_ATTRIBUTES`, og en værdi, der er sat på appen, erstatter den: medtag container-appens navn og replika-ID'et i din, eller sæt dem i koden.

## Netværk

- **Udgående trafik er åben som standard.** En replika når `oneuptime.com:443` uden nogen konfiguration, uanset om miljøets ingress er ekstern eller intern.
- **Brugerdefinerede VNets er undtagelsen.** På et VNet med en brugerdefineret rute, der sender `0.0.0.0/0` til en firewall eller NAT-gateway, eller med en netværkssikkerhedsgruppe på subnettet, skal du tillade TCP 443 til OneUptime-værten (eller din egen værts port) på firewallen eller NSG'en.
- **En selvhostet OneUptime inde i VNet'et** skal kunne slås op og nås fra miljøets subnet.
- **Telemetri kræver ingen Azure-rolle.** Kun Key Vault-referencer kræver, at appens administrerede identitet har **Key Vault Secrets User** på boksen.

## Hvad du får

- **Oversigt**: anmodninger, fejlrate og p95-latens fra dine spor. Container Apps viser ikke en replikas ressourceforbrug til en sidecar, så felterne **CPU** og **Hukommelse** fyldes kun, hvis du sender metrikkerne `container.cpu.utilization` og `container.memory.usage` med replikaens identitet. De fleste teams overlader dem til Azure Monitor.
- **Instanser**: én række pr. replika, navngivet efter detektorernes `azure.container_app.instance.id`, efter `service.instance.id`, når du selv sætter det, eller efter `host.name`, når kun værtsdetektoren kørte.
- **Protokoller**, **Spor** og **Metrikker**, filtreret til miljøet, og visningen pr. tjeneste under **Tjenester**.

## Fejlfinding

:::details Intet vises, og collectoren logger 401
Hemmeligheden indeholder den forkerte værdi. `oneuptime-token` skal kun være tokenet; `oneuptime-otlp-headers` hele headeren `x-oneuptime-token=...`.
:::

:::details Appen er under Tjenester, men der findes intet miljø
`OTEL_RESOURCE_ATTRIBUTES` mangler, eller `cloud.platform` er ikke præcis `azure_container_apps`. Se, hvad appen har, med `az containerapp show ... --query properties.template.containers[].env`.
:::

:::details Miljøet findes, men Instanser er tom
Hverken `service.instance.id`, `azure.container_app.instance.id` eller `host.name` er på ressourcen. Føj detektoren `azurecontainerapps` til collectoren, slå SDK'ets Azure- eller værtsdetektor til, eller sæt `service.instance.id` i koden.
:::

:::details To miljøer for ét abonnement
Én app sætter `cloud.region` (eller `cloud.account.id`) og en anden gør ikke, eller én skriver regionen anderledes (`eastus` og `East US`). Værdierne skal stemme overens tegn for tegn.
:::

Alt andet står på [Cloud-fejlfinding](/docs/telemetry/cloud-troubleshooting).

## Næste trin

:::cards
- [Cloud-miljøer](/docs/telemetry/cloud-environments): Sådan identificeres miljøer og instanser.
- [Andre cloud-platforme](/docs/telemetry/cloud-other-platforms): Azure App Service og Azure Container Instances.
- [Cloud-fejlfinding](/docs/telemetry/cloud-troubleshooting): De fejl, som alle platforme har til fælles.
- [Cloud-ressourcer (IaaS og PaaS)](/docs/telemetry/cloud-resources): Hver ressource i dit abonnement fra Azure Monitor.
:::
