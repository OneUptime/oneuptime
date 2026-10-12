# Azure Container Apps

Send spor, logger og metrikker fra Azure Container Apps til OneUptime. Hver replika som rapporterer `cloud.platform=azure_container_apps`, havner i ett **Cloud Environment** per Azure-abonnement og region, for eksempel _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_, med de kjørende replikaene oppført under **Instanser**.

:::cards
- [Slik fungerer det](#slik-fungerer-det): Hva detektorene setter, og de to attributtene du setter selv.
- [Oppsett](#oppsett): Lagre tokenet, konfigurer appen med Azure CLI eller portalen, og sjekk.
- [Bruk miljøets administrerte OpenTelemetry-agent](#bruk-miljøets-administrerte-opentelemetry-agent): Videresend alle appene i miljøet uten en sidecar.
- [Feilsøking](#feilsøking): Avviste eksporter, manglende miljøer og tomme instanser.
:::

## Slik fungerer det

```mermaid title="Hvor attributtene til en Container Apps-replika kommer fra"
flowchart TB
    detector["Azure-detektor:<br/>plattform og replika"] --> exporter
    manual["OTEL_RESOURCE_<br/>ATTRIBUTES: region<br/>og abonnement"] --> exporter
    exporter["Appen din eller<br/>sidecar-collectoren"] -->|"OTLP over HTTPS"| ou["OneUptime"]
    ou --> env["Skymiljø<br/>abonnement og region"]
    ou --> inst["Instanser<br/>én rad per replika"]
```

Container Apps har ressursdetektorer: Collectorens detektor `azurecontainerapps`, og de for Node.js (`@opentelemetry/resource-detector-azure`) og .NET (`OpenTelemetry.Resources.Azure`). De leser `CONTAINER_APP_NAME` og `CONTAINER_APP_REPLICA_NAME`, og setter `cloud.provider`, `cloud.platform`, `service.name` og replika-ID-en. Ingen av dem kjenner regionen eller abonnementet, så du setter `cloud.region` og `cloud.account.id` selv, i `OTEL_RESOURCE_ATTRIBUTES`.

| Attributt | Verdi | Brukes til |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `cloud.provider` | `azure` | Vises i oversikten |
| `cloud.platform` | `azure_container_apps` | Arkiverer telemetrien under **Skymiljøer** |
| `cloud.region` | miljøets region, for eksempel `eastus`: satt av deg | En del av miljønøkkelen |
| `cloud.account.id` | abonnements-ID-en: satt av deg | En del av miljønøkkelen |
| `azure.container_app.instance.id` | replikanavnet, satt av detektorene fra `CONTAINER_APP_REPLICA_NAME` | Gir én kjørende replika navn: én rad for hver under **Instanser** |
| `service.instance.id` | replikanavnet, hvis du setter det selv | Brukes når ingen detektor har satt replika-ID-en |

- **Stavemåter med punktum fungerer.** Detektorene for Node.js og .NET staver plattformen `azure.container_apps`, med punktum. OneUptime skriver den om til `azure_container_apps` når den mottas, så begge stavemåtene havner i samme miljø.
- **Vertsnavnet er replikanavnet.** En SDK som bare kjører detektoren `host`, rapporterer replikanavnet som `host.name`, og OneUptime gir instansen navn etter det når det ikke finnes noe mer spesifikt.

Miljønøkkelen er `azure_container_apps|<subscription id>|eastus`.

## Før du begynner

- **En inntaksnøkkel.** Opprett en nøkkel av typen **Server** under **Prosjektinnstillinger → Telemetri og APM → Inntaksnøkler**, og kopier tokenet.
- **Azure CLI med utvidelsen `containerapp`** (`az extension add --name containerapp --upgrade`), logget inn på abonnementet, eller Azure-portalen.
- **Applikasjonen din instrumentert med en OpenTelemetry-SDK** som eksporterer OTLP.

## Velg hvordan telemetrien forlater appen

| | SDK direct | Sidecar collector |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Ekstra container | Ingen | `otel-collector` i appen, som deler replikaens CPU og minne |
| Setter attributtene | SDK-en og `OTEL_RESOURCE_ATTRIBUTES` på appen | Collectoren, for alt som går gjennom den |
| Hemmeligheten | `oneuptime-otlp-headers`, hele headeren | `oneuptime-token`, bare tokenet |

En tredje vei, miljøets administrerte OpenTelemetry-agent, videresender alle appene i miljøet uten en sidecar: se [Bruk miljøets administrerte OpenTelemetry-agent](#bruk-miljøets-administrerte-opentelemetry-agent). Hvert steg nedenfor har en fane for SDK direct og en for sidecar-collectoren; velg én, så følger hvert steg den.

## Oppsett

:::steps
### Lagre tokenet som en Container Apps-hemmelighet

> [!IMPORTANT]
> Tokenet er en hemmelighet. Lagre det som en Container Apps-hemmelighet, og referer til det fra miljøvariabler med `secretref:`. Når en hemmelighet er satt, vises den ikke i `az containerapp show` eller i portalen; det gjør en vanlig miljøvariabel.

:::tabs
@tab SDK direct
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-otlp-headers="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

SDK-ens `OTEL_EXPORTER_OTLP_HEADERS` vil ha hele headeren `name=value`, så hemmeligheten inneholder den.
@tab Sidecar collector
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Collectoren legger til headernavnet selv, så hemmeligheten inneholder bare tokenet.
:::

I portalen: **Azure portal → Container Apps → your app → Settings → Secrets → + Add**. Skriv inn nøkkelen, velg typen **Container Apps secret**, lim inn verdien og klikk **Add**.

Hvis du oppbevarer hemmeligheter i Key Vault, refererer du til hemmeligheten i stedet for å kopiere verdien. Appens administrerte identitet trenger rollen **Key Vault Secrets User** på hvelvet:

```bash
az containerapp secret set \
  --name checkout-api --resource-group my-rg \
  --secrets "oneuptime-token=keyvaultref:https://my-vault.vault.azure.net/secrets/oneuptime-token,identityref:system"
```

### Konfigurer container-appen

:::tabs
@tab SDK direct
Sett eksportøren, og attributtene ingen detektor kjenner, på applikasjonscontaineren. Bytt ut regionen og abonnements-ID-en med dine egne:

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

For replikaens identitet slår du på SDK-ens Azure-detektor: `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure` i Node.js, eller `.ConfigureResource(r => r.AddAzureContainerAppsDetector())` med `OpenTelemetry.Resources.Azure` i .NET. Den setter `azure.container_app.instance.id` fra `CONTAINER_APP_REPLICA_NAME`.

Container Apps kan ikke sette én miljøvariabel inn i en annen, så i andre språk kan ikke `service.instance.id` gå inn i `OTEL_RESOURCE_ATTRIBUTES`. Slå på vertsdetektoren (dens `host.name` er replikanavnet), eller sett den i koden:

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

Uansett hvilken detektor du bruker, beholder du `cloud.region` og `cloud.account.id` i `OTEL_RESOURCE_ATTRIBUTES`: ingen Container Apps-detektor setter dem, og miljønøkkelen trenger dem.

Eller i portalen:

1. Åpne **Application → Containers → Edit and deploy**, velg containeren din på fanen **Container** og klikk **Edit**.
2. Under **Environment variables** legger du til hver variabel ovenfor med kilden **Manual entry**, og `OTEL_EXPORTER_OTLP_HEADERS` med kilden **Reference a secret**, som peker på `oneuptime-otlp-headers`.
3. Klikk **Save**.
@tab Sidecar collector
En sidecar kjører i den samme replikaen, så den ser de samme `CONTAINER_APP_NAME` og `CONTAINER_APP_REPLICA_NAME`. Detektoren `azurecontainerapps` i den gjør dem om til `cloud.provider`, `cloud.platform`, `service.name` og `azure.container_app.instance.id`, og detektoren `env` i den leser `cloud.region` og `cloud.account.id` fra `OTEL_RESOURCE_ATTRIBUTES` i collectorens eget miljø. Applikasjonen eksporterer bare til `http://localhost:4318`.

Eksporter appens definisjon, legg collectoren til i `template.containers`, og bruk den:

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

`az containerapp show` eksporterer ikke hemmelige verdier, så legg til oppføringen `secrets` igjen for hånd, eller utelat den hvis du satte hemmeligheten i første steg: en oppdatering beholder eksisterende hemmeligheter. Container Apps legger sammen CPU og minne for alle containerne i en replika, så sidecarens `resources` teller med i appens.

Eller i portalen:

1. Åpne **Application → Containers → Edit and deploy**. På fanen **Container** bruker du **+ Add** for å legge til en container med navnet `otel-collector`, imaget `otel/opentelemetry-collector-contrib:latest` og **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`.
2. Legg til miljøvariablene for den: `ONEUPTIME_TOKEN` (**Reference a secret**: `oneuptime-token`), `OTEL_RESOURCE_ATTRIBUTES` og `OTEL_COLLECTOR_CONFIG` (**Manual entry**, med verdiene ovenfor).
3. Klikk **Save**.
:::

Hvis du hoster OneUptime selv, bruker du `https://YOUR-ONEUPTIME-HOST/otlp` som endepunkt.

### Rull ut den nye revisjonen

`az containerapp update` ruller ut en ny revisjon på egen hånd. Klikk **Create** i portalen. Hvis flere revisjoner er aktive, flytter du trafikken til den nye under **Revisions and replicas**.

### Sjekk tilkoblingen

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` med `"valid": true` betyr at tokenet er godtatt. `401` betyr at det er ukjent, tilbakekalt, deaktivert eller utløpt. Les deretter utdataene fra collectoren:

```bash
az containerapp logs show --name checkout-api --resource-group my-rg \
  --container otel-collector --follow
```

Se etter `Everything is ready`, og ingen `401` eller `connection refused`. Innen ett minutt etter det første spennet, den første loggen eller metrikken vises miljøet under **Sky → All Environments** som _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_.
:::

## Bruk miljøets administrerte OpenTelemetry-agent

Et Container Apps-miljø kan kjøre Azures administrerte OpenTelemetry-agent. Den tar imot OTLP fra alle appene i miljøet og videresender det til et endepunkt du konfigurerer, uten en sidecar i hver app. Agenten eksporterer **bare over OTLP/gRPC**, så den kan ikke bruke HTTP-stien `/otlp`. Pek den i stedet mot OneUptime-verten på port 443, der OneUptime tilbyr OTLP/gRPC over TLS:

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

- **Selvhostet:** bruk `YOUR-ONEUPTIME-HOST:443`. En selvhostet OneUptime tar bare imot OTLP/gRPC over TLS: se [OTLP over gRPC](/docs/telemetry/open-telemetry#otlp-over-grpc).
- **Appene setter fortsatt attributtene.** Agenten legger sin egen `OTEL_EXPORTER_OTLP_ENDPOINT` og `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` inn i hver app, så utelat de to fra appen, og behold `OTEL_SERVICE_NAME` og `OTEL_RESOURCE_ATTRIBUTES`. Agenten videresender det appene sender, så `cloud.*` og replika-ID-en kommer fortsatt fra hver app.
- **Din `OTEL_RESOURCE_ATTRIBUTES` vinner.** Agenten setter også `OTEL_RESOURCE_ATTRIBUTES`, og en verdi som er satt på appen, erstatter den: ta med navnet på container-appen og replika-ID-en i din, eller sett dem i koden.

## Nettverk

- **Utgående trafikk er åpen som standard.** En replika når `oneuptime.com:443` uten noen konfigurasjon, enten miljøets ingress er ekstern eller intern.
- **Egendefinerte VNet-er er unntaket.** På et VNet med en brukerdefinert rute som sender `0.0.0.0/0` til en brannmur eller NAT-gateway, eller med en nettverkssikkerhetsgruppe på subnettet, må du tillate TCP 443 til OneUptime-verten (eller porten til din egen vert) i brannmuren eller NSG-en.
- **En selvhostet OneUptime inne i VNet-et** må kunne slås opp og nås fra miljøets subnett.
- **Telemetri trenger ingen Azure-rolle.** Bare Key Vault-referanser krever at appens administrerte identitet har **Key Vault Secrets User** på hvelvet.

## Hva du får

- **Oversikt**: forespørsler, feilrate og p95-latens fra sporene dine. Container Apps viser ikke en replikas ressursbruk til en sidecar, så flisene **CPU** og **Minne** fylles bare hvis du sender metrikkene `container.cpu.utilization` og `container.memory.usage` med replikaens identitet. De fleste team overlater dem til Azure Monitor.
- **Instanser**: én rad per replika, navngitt etter detektorenes `azure.container_app.instance.id`, etter `service.instance.id` når du setter den selv, eller etter `host.name` når bare vertsdetektoren kjørte.
- **Logger**, **Spor** og **Målinger**, filtrert til miljøet, og visningen per tjeneste under **Tjenester**.

## Feilsøking

:::details Ingenting vises, og collectoren logger 401
Hemmeligheten inneholder feil verdi. `oneuptime-token` må være bare tokenet; `oneuptime-otlp-headers` hele headeren `x-oneuptime-token=...`.
:::

:::details Appen er under Tjenester, men det finnes ikke noe miljø
`OTEL_RESOURCE_ATTRIBUTES` mangler, eller `cloud.platform` er ikke nøyaktig `azure_container_apps`. Se hva appen har med `az containerapp show ... --query properties.template.containers[].env`.
:::

:::details Miljøet finnes, men Instanser er tom
Verken `service.instance.id`, `azure.container_app.instance.id` eller `host.name` er på ressursen. Legg detektoren `azurecontainerapps` til i collectoren, slå på SDK-ens Azure- eller vertsdetektor, eller sett `service.instance.id` i koden.
:::

:::details To miljøer for ett abonnement
Én app setter `cloud.region` (eller `cloud.account.id`) og en annen gjør det ikke, eller én skriver regionen annerledes (`eastus` og `East US`). Verdiene må stemme overens tegn for tegn.
:::

Alt annet står på [Feilsøking i skyen](/docs/telemetry/cloud-troubleshooting).

## Neste steg

:::cards
- [Skymiljøer](/docs/telemetry/cloud-environments): Slik identifiseres miljøer og instanser.
- [Andre skyplattformer](/docs/telemetry/cloud-other-platforms): Azure App Service og Azure Container Instances.
- [Feilsøking i skyen](/docs/telemetry/cloud-troubleshooting): Feilene alle plattformer har felles.
- [Skyressurser (IaaS og PaaS)](/docs/telemetry/cloud-resources): Hver ressurs i abonnementet ditt fra Azure Monitor.
:::
