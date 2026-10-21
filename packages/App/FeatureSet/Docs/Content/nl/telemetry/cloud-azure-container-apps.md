# Azure Container Apps

Stuur de traces, logs en metrieken van je Azure Container Apps naar OneUptime. Elke replica die `cloud.platform=azure_container_apps` meldt, komt terecht in één **Cloud Environment** per Azure-abonnement en regio, zoals _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_, met de draaiende replica's vermeld onder **Instanties**.

:::cards
- [Hoe het werkt](#hoe-het-werkt): Wat de detectors instellen, en de twee attributen die je zelf instelt.
- [Instellen](#instellen): Het token opslaan, de app configureren met de Azure CLI of de portal, en controleren.
- [De beheerde OpenTelemetry-agent van de omgeving gebruiken](#de-beheerde-opentelemetry-agent-van-de-omgeving-gebruiken): Elke app in de omgeving doorsturen zonder sidecar.
- [Problemen oplossen](#problemen-oplossen): Geweigerde exports, ontbrekende omgevingen en lege instanties.
:::

## Hoe het werkt

```mermaid title="Waar de attributen van een Container Apps-replica vandaan komen"
flowchart TB
    detector["Azure-detector:<br/>platform en replica"] --> exporter
    manual["OTEL_RESOURCE_<br/>ATTRIBUTES: regio<br/>en abonnement"] --> exporter
    exporter["Je app, of zijn<br/>sidecar-collector"] -->|"OTLP via HTTPS"| ou["OneUptime"]
    ou --> env["Cloud-omgeving<br/>abonnement en regio"]
    ou --> inst["Instanties<br/>één rij per replica"]
```

Container Apps heeft resource-detectors: de detector `azurecontainerapps` van de Collector, en die voor Node.js (`@opentelemetry/resource-detector-azure`) en .NET (`OpenTelemetry.Resources.Azure`). Ze lezen `CONTAINER_APP_NAME` en `CONTAINER_APP_REPLICA_NAME`, en stellen `cloud.provider`, `cloud.platform`, `service.name` en het replica-ID in. Geen van hen kent de regio of het abonnement, dus `cloud.region` en `cloud.account.id` stel je zelf in, in `OTEL_RESOURCE_ATTRIBUTES`.

| Attribuut | Waarde | Waarvoor |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `cloud.provider` | `azure` | Getoond op het overzicht |
| `cloud.platform` | `azure_container_apps` | Archiveert de telemetrie onder **Cloud-omgevingen** |
| `cloud.region` | de regio van de omgeving, zoals `eastus`: door jou ingesteld | Deel van de omgevingssleutel |
| `cloud.account.id` | het abonnements-ID: door jou ingesteld | Deel van de omgevingssleutel |
| `azure.container_app.instance.id` | de replicanaam, door de detectors ingesteld vanuit `CONTAINER_APP_REPLICA_NAME` | Geeft één draaiende replica een naam: één rij per replica onder **Instanties** |
| `service.instance.id` | de replicanaam, als je die zelf instelt | Gebruikt als geen detector het replica-ID heeft ingesteld |

- **Spellingen met een punt werken.** De detectors voor Node.js en .NET schrijven het platform als `azure.container_apps`, met een punt. OneUptime herschrijft dat bij ontvangst naar `azure_container_apps`, dus beide spellingen komen in dezelfde omgeving terecht.
- **De hostnaam is de replicanaam.** Een SDK die alleen de detector `host` draait, meldt de replicanaam als `host.name`, en OneUptime geeft de instantie die naam als er niets specifiekers is.

De omgevingssleutel is `azure_container_apps|<subscription id>|eastus`.

## Voordat je begint

- **Een ingestiesleutel.** Maak een sleutel van het type **Server** aan onder **Projectinstellingen → Telemetrie & APM → Ingestiesleutels** en kopieer het token.
- **De Azure CLI met de extensie `containerapp`** (`az extension add --name containerapp --upgrade`), aangemeld bij het abonnement, of de Azure-portal.
- **Je applicatie geïnstrumenteerd met een OpenTelemetry-SDK** die OTLP exporteert.

## Kiezen hoe telemetrie de app verlaat

| | SDK direct | Sidecar collector |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Extra container | Geen | `otel-collector` in de app, die de CPU en het geheugen van de replica deelt |
| Stelt de attributen in | De SDK en `OTEL_RESOURCE_ATTRIBUTES` op de app | De collector, voor alles wat erdoorheen gaat |
| Het geheim | `oneuptime-otlp-headers`, de hele header | `oneuptime-token`, alleen het token |

Een derde manier, de beheerde OpenTelemetry-agent van de omgeving, stuurt elke app in de omgeving door zonder sidecar: zie [De beheerde OpenTelemetry-agent van de omgeving gebruiken](#de-beheerde-opentelemetry-agent-van-de-omgeving-gebruiken). Elke stap hieronder heeft een tabblad voor SDK direct en voor de sidecar-collector; kies er een en elke stap volgt die keuze.

## Instellen

:::steps
### Het token opslaan als Container Apps-geheim

> [!IMPORTANT]
> Het token is een geheim. Sla het op als Container Apps-geheim en verwijs ernaar vanuit omgevingsvariabelen met `secretref:`. Eenmaal ingesteld wordt een geheim niet getoond in `az containerapp show` of in de portal; een gewone omgevingsvariabele wel.

:::tabs
@tab SDK direct
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-otlp-headers="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

De `OTEL_EXPORTER_OTLP_HEADERS` van de SDK verwacht de hele header `name=value`, dus het geheim bevat die.
@tab Sidecar collector
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

De collector voegt de headernaam zelf toe, dus het geheim bevat alleen het token.
:::

In de portal: **Azure portal → Container Apps → your app → Settings → Secrets → + Add**. Typ de sleutel, kies het type **Container Apps secret**, plak de waarde en klik op **Add**.

Bewaar je geheimen in Key Vault, verwijs dan naar het geheim in plaats van de waarde te kopiëren. De beheerde identiteit van de app heeft de rol **Key Vault Secrets User** op de kluis nodig:

```bash
az containerapp secret set \
  --name checkout-api --resource-group my-rg \
  --secrets "oneuptime-token=keyvaultref:https://my-vault.vault.azure.net/secrets/oneuptime-token,identityref:system"
```

### De container-app configureren

:::tabs
@tab SDK direct
Stel de exporter, en de attributen die geen detector kent, in op de applicatiecontainer. Vervang de regio en het abonnements-ID door die van jou:

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

Zet voor de identiteit van de replica de Azure-detector van de SDK aan: `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure` in Node.js, of `.ConfigureResource(r => r.AddAzureContainerAppsDetector())` met `OpenTelemetry.Resources.Azure` in .NET. Die stelt `azure.container_app.instance.id` in vanuit `CONTAINER_APP_REPLICA_NAME`.

Container Apps kan geen omgevingsvariabele in een andere opnemen, dus in andere talen kan `service.instance.id` niet in `OTEL_RESOURCE_ATTRIBUTES`. Zet de hostdetector aan (zijn `host.name` is de replicanaam), of stel het in code in:

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

Welke detector je ook gebruikt, houd `cloud.region` en `cloud.account.id` in `OTEL_RESOURCE_ATTRIBUTES`: geen enkele detector van Container Apps stelt ze in, en de omgevingssleutel heeft ze nodig.

Of in de portal:

1. Open **Application → Containers → Edit and deploy**, selecteer je container op het tabblad **Container** en klik op **Edit**.
2. Voeg onder **Environment variables** elke variabele hierboven toe met de bron **Manual entry**, en `OTEL_EXPORTER_OTLP_HEADERS` met de bron **Reference a secret**, die naar `oneuptime-otlp-headers` wijst.
3. Klik op **Save**.
@tab Sidecar collector
Een sidecar draait in dezelfde replica, dus hij ziet dezelfde `CONTAINER_APP_NAME` en `CONTAINER_APP_REPLICA_NAME`. Zijn detector `azurecontainerapps` maakt daar `cloud.provider`, `cloud.platform`, `service.name` en `azure.container_app.instance.id` van, en zijn detector `env` leest `cloud.region` en `cloud.account.id` uit `OTEL_RESOURCE_ATTRIBUTES` in de eigen omgeving van de collector. De applicatie exporteert alleen naar `http://localhost:4318`.

Exporteer de definitie van de app, voeg de collector toe aan `template.containers`, en pas die toe:

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

`az containerapp show` exporteert geen geheime waarden, dus voeg de vermelding `secrets` met de hand weer toe, of laat die weg als je het geheim in de eerste stap hebt ingesteld: een update behoudt bestaande geheimen. Container Apps telt de CPU en het geheugen van alle containers in een replica op, dus de `resources` van de sidecar tellen mee voor die van de app.

Of in de portal:

1. Open **Application → Containers → Edit and deploy**. Voeg op het tabblad **Container** met **+ Add** een container toe met de naam `otel-collector`, de image `otel/opentelemetry-collector-contrib:latest` en de **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`.
2. Voeg de omgevingsvariabelen ervan toe: `ONEUPTIME_TOKEN` (**Reference a secret**: `oneuptime-token`), `OTEL_RESOURCE_ATTRIBUTES` en `OTEL_COLLECTOR_CONFIG` (**Manual entry**, met de waarden hierboven).
3. Klik op **Save**.
:::

Als je OneUptime zelf host, gebruik dan `https://YOUR-ONEUPTIME-HOST/otlp` als endpoint.

### De nieuwe revisie uitrollen

`az containerapp update` rolt zelf een nieuwe revisie uit. Klik in de portal op **Create**. Zijn er meerdere revisies actief, verplaats dan het verkeer naar de nieuwe onder **Revisions and replicas**.

### De verbinding controleren

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` met `"valid": true` betekent dat het token is geaccepteerd. `401` betekent dat het onbekend, ingetrokken, uitgeschakeld of verlopen is. Lees daarna de uitvoer van de collector:

```bash
az containerapp logs show --name checkout-api --resource-group my-rg \
  --container otel-collector --follow
```

Zoek naar `Everything is ready`, en geen `401` of `connection refused`. Binnen een minuut na de eerste span, log of metriek verschijnt de omgeving onder **Cloud → All Environments** als _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_.
:::

## De beheerde OpenTelemetry-agent van de omgeving gebruiken

Een Container Apps-omgeving kan de beheerde OpenTelemetry-agent van Azure draaien. Die ontvangt OTLP van elke app in de omgeving en stuurt het door naar een endpoint dat je instelt, zonder sidecar in elke app. De agent exporteert **alleen via OTLP/gRPC**, dus hij kan het HTTP-pad `/otlp` niet gebruiken. Richt hem in plaats daarvan op de OneUptime-host op poort 443, waar OneUptime OTLP/gRPC via TLS aanbiedt:

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

- **Zelf gehost:** gebruik `YOUR-ONEUPTIME-HOST:443`. Een zelf gehoste OneUptime accepteert OTLP/gRPC alleen via TLS: zie [OTLP via gRPC](/docs/telemetry/open-telemetry#otlp-via-grpc).
- **De apps stellen nog steeds de attributen in.** De agent zet zijn eigen `OTEL_EXPORTER_OTLP_ENDPOINT` en `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` in elke app, dus laat die twee weg uit de app en houd `OTEL_SERVICE_NAME` en `OTEL_RESOURCE_ATTRIBUTES`. De agent stuurt door wat de apps sturen, dus `cloud.*` en het replica-ID komen nog steeds van elke app.
- **Jouw `OTEL_RESOURCE_ATTRIBUTES` wint.** De agent stelt ook `OTEL_RESOURCE_ATTRIBUTES` in, en een waarde die op de app is ingesteld vervangt die: neem de naam van de container-app en het replica-ID op in de jouwe, of stel ze in code in.

## Netwerk

- **Uitgaand verkeer is standaard open.** Een replica bereikt `oneuptime.com:443` zonder enige configuratie, of de ingress van de omgeving nu extern of intern is.
- **Aangepaste VNets zijn de uitzondering.** Op een VNet met een door de gebruiker gedefinieerde route die `0.0.0.0/0` naar een firewall of NAT-gateway stuurt, of met een netwerkbeveiligingsgroep op het subnet, sta je TCP 443 naar de OneUptime-host (of de poort van je eigen host) toe op de firewall of de NSG.
- **Een zelf gehoste OneUptime binnen het VNet** moet vanuit het subnet van de omgeving oplosbaar en routeerbaar zijn.
- **Voor telemetrie is geen Azure-rol nodig.** Alleen Key Vault-verwijzingen vereisen dat de beheerde identiteit van de app **Key Vault Secrets User** op de kluis heeft.

## Wat je krijgt

- **Overzicht**: aanvragen, foutpercentage en p95-latentie uit je traces. Container Apps toont het resourcegebruik van een replica niet aan een sidecar, dus de tegels **CPU** en **Geheugen** vullen zich alleen als je metrieken `container.cpu.utilization` en `container.memory.usage` stuurt die de identiteit van de replica dragen. De meeste teams laten die over aan Azure Monitor.
- **Instanties**: één rij per replica, met als naam de `azure.container_app.instance.id` van de detectors, de `service.instance.id` als je die zelf instelt, of de `host.name` als alleen de hostdetector heeft gedraaid.
- **Logboeken**, **Traces** en **Metrieken**, gefilterd op de omgeving, en de weergave per service onder **Services**.

## Problemen oplossen

:::details Er verschijnt niets, en de collector logt 401
Het geheim bevat de verkeerde waarde. `oneuptime-token` moet alleen het token zijn; `oneuptime-otlp-headers` de hele header `x-oneuptime-token=...`.
:::

:::details De app staat onder Services, maar er bestaat geen omgeving
`OTEL_RESOURCE_ATTRIBUTES` ontbreekt, of `cloud.platform` is niet precies `azure_container_apps`. Bekijk wat de app heeft met `az containerapp show ... --query properties.template.containers[].env`.
:::

:::details De omgeving bestaat, maar Instanties is leeg
Geen van `service.instance.id`, `azure.container_app.instance.id` of `host.name` staat op de resource. Voeg de detector `azurecontainerapps` toe aan de collector, zet de Azure- of hostdetector van de SDK aan, of stel `service.instance.id` in code in.
:::

:::details Twee omgevingen voor één abonnement
Eén app stelt `cloud.region` (of `cloud.account.id`) in en een andere niet, of een app schrijft de regio anders (`eastus` en `East US`). De waarden moeten teken voor teken overeenkomen.
:::

Al het andere staat op [Cloud-probleemoplossing](/docs/telemetry/cloud-troubleshooting).

## Volgende stappen

:::cards
- [Cloud-omgevingen](/docs/telemetry/cloud-environments): Hoe omgevingen en instanties worden herkend.
- [Andere cloudplatforms](/docs/telemetry/cloud-other-platforms): Azure App Service en Azure Container Instances.
- [Cloud-probleemoplossing](/docs/telemetry/cloud-troubleshooting): De storingen die alle platforms gemeen hebben.
- [Cloud-resources (IaaS en PaaS)](/docs/telemetry/cloud-resources): Elke resource in je abonnement, uit Azure Monitor.
:::
