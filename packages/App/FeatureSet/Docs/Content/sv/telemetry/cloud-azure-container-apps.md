# Azure Container Apps

Skicka spår, loggar och mätvärden från dina Azure Container Apps till OneUptime. Varje replik som rapporterar `cloud.platform=azure_container_apps` hamnar i en **Cloud Environment** per Azure-prenumeration och region, till exempel _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_, med replikerna som körs listade under **Instanser**.

:::cards
- [Så fungerar det](#så-fungerar-det): Vad detektorerna sätter, och de två attribut som du sätter själv.
- [Konfigurera](#konfigurera): Spara din token, konfigurera appen med Azure CLI eller portalen, och kontrollera.
- [Använd miljöns hanterade OpenTelemetry-agent](#använd-miljöns-hanterade-opentelemetry-agent): Vidarebefordra varje app i miljön utan en sidecar.
- [Felsökning](#felsökning): Avvisade exporter, miljöer som saknas och tomma instanser.
:::

## Så fungerar det

```mermaid title="Var attributen för en Container Apps-replik kommer ifrån"
flowchart TB
    detector["Azure-detektor:<br/>plattform och replik"] --> exporter
    manual["OTEL_RESOURCE_<br/>ATTRIBUTES: region<br/>och prenumeration"] --> exporter
    exporter["Din app eller dess<br/>sidecar-collector"] -->|"OTLP över HTTPS"| ou["OneUptime"]
    ou --> env["Molnmiljö<br/>prenumeration<br/>och region"]
    ou --> inst["Instanser<br/>en rad per replik"]
```

Container Apps har resursdetektorer: Collectorns detektor `azurecontainerapps`, och de för Node.js (`@opentelemetry/resource-detector-azure`) och .NET (`OpenTelemetry.Resources.Azure`). De läser `CONTAINER_APP_NAME` och `CONTAINER_APP_REPLICA_NAME`, och sätter `cloud.provider`, `cloud.platform`, `service.name` och replik-ID:t. Ingen av dem känner till regionen eller prenumerationen, så du sätter `cloud.region` och `cloud.account.id` själv, i `OTEL_RESOURCE_ATTRIBUTES`.

| Attribut | Värde | Används till |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `cloud.provider` | `azure` | Visas i översikten |
| `cloud.platform` | `azure_container_apps` | Arkiverar telemetrin under **Molnmiljöer** |
| `cloud.region` | miljöns region, till exempel `eastus`: sätts av dig | En del av miljönyckeln |
| `cloud.account.id` | prenumerations-ID:t: sätts av dig | En del av miljönyckeln |
| `azure.container_app.instance.id` | replikens namn, satt av detektorerna från `CONTAINER_APP_REPLICA_NAME` | Namnger en replik som körs: en rad för varje under **Instanser** |
| `service.instance.id` | replikens namn, om du sätter det själv | Används när ingen detektor har satt replik-ID:t |

- **Stavningar med punkt fungerar.** Detektorerna för Node.js och .NET stavar plattformen `azure.container_apps`, med punkt. OneUptime skriver om den till `azure_container_apps` när den tas emot, så båda stavningarna hamnar i samma miljö.
- **Värdnamnet är replikens namn.** Ett SDK som bara kör detektorn `host` rapporterar replikens namn som `host.name`, och OneUptime namnger instansen efter det när inget mer specifikt finns.

Miljönyckeln är `azure_container_apps|<subscription id>|eastus`.

## Innan du börjar

- **En intagningsnyckel.** Skapa en nyckel av typen **Server** under **Projektinställningar → Telemetri och APM → Intagningsnycklar** och kopiera dess token.
- **Azure CLI med tillägget `containerapp`** (`az extension add --name containerapp --upgrade`), inloggat i prenumerationen, eller Azure-portalen.
- **Din applikation instrumenterad med ett OpenTelemetry-SDK** som exporterar OTLP.

## Välj hur telemetrin lämnar appen

| | SDK direct | Sidecar collector |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Extra container | Ingen | `otel-collector` i appen, som delar replikens CPU och minne |
| Sätter attributen | SDK:t och `OTEL_RESOURCE_ATTRIBUTES` på appen | Collectorn, för allt som passerar |
| Hemligheten | `oneuptime-otlp-headers`, hela headern | `oneuptime-token`, bara din token |

Ett tredje sätt, miljöns hanterade OpenTelemetry-agent, vidarebefordrar varje app i miljön utan en sidecar: se [Använd miljöns hanterade OpenTelemetry-agent](#använd-miljöns-hanterade-opentelemetry-agent). Varje steg nedan har en flik för SDK direct och en för sidecar-collectorn; välj en, så följer varje steg den.

## Konfigurera

:::steps
### Spara din token som en Container Apps-hemlighet

> [!IMPORTANT]
> Din token är en hemlighet. Spara den som en Container Apps-hemlighet och referera till den från miljövariabler med `secretref:`. När en hemlighet väl är satt visas den inte i `az containerapp show` eller i portalen; det gör en vanlig miljövariabel.

:::tabs
@tab SDK direct
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-otlp-headers="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

SDK:ts `OTEL_EXPORTER_OTLP_HEADERS` vill ha hela headern `name=value`, så hemligheten innehåller den.
@tab Sidecar collector
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Collectorn lägger själv till headerns namn, så hemligheten innehåller bara din token.
:::

I portalen: **Azure portal → Container Apps → your app → Settings → Secrets → + Add**. Skriv nyckeln, välj typen **Container Apps secret**, klistra in värdet och klicka på **Add**.

Om du förvarar hemligheter i Key Vault refererar du till hemligheten i stället för att kopiera dess värde. Appens hanterade identitet behöver rollen **Key Vault Secrets User** på valvet:

```bash
az containerapp secret set \
  --name checkout-api --resource-group my-rg \
  --secrets "oneuptime-token=keyvaultref:https://my-vault.vault.azure.net/secrets/oneuptime-token,identityref:system"
```

### Konfigurera containerappen

:::tabs
@tab SDK direct
Ange exportören, och de attribut som ingen detektor känner till, på applikationscontainern. Byt ut regionen och prenumerations-ID:t mot dina egna:

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

För replikens identitet slår du på SDK:ts Azure-detektor: `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure` i Node.js, eller `.ConfigureResource(r => r.AddAzureContainerAppsDetector())` med `OpenTelemetry.Resources.Azure` i .NET. Den sätter `azure.container_app.instance.id` från `CONTAINER_APP_REPLICA_NAME`.

Container Apps kan inte lägga en miljövariabel inuti en annan, så i andra språk kan `service.instance.id` inte läggas i `OTEL_RESOURCE_ATTRIBUTES`. Slå på värddetektorn (dess `host.name` är replikens namn), eller sätt den i koden:

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

Oavsett vilken detektor du använder behåller du `cloud.region` och `cloud.account.id` i `OTEL_RESOURCE_ATTRIBUTES`: ingen Container Apps-detektor sätter dem, och miljönyckeln behöver dem.

Eller i portalen:

1. Öppna **Application → Containers → Edit and deploy**, välj din container på fliken **Container** och klicka på **Edit**.
2. Under **Environment variables** lägger du till varje variabel ovan med källan **Manual entry**, och `OTEL_EXPORTER_OTLP_HEADERS` med källan **Reference a secret**, som pekar på `oneuptime-otlp-headers`.
3. Klicka på **Save**.
@tab Sidecar collector
En sidecar körs i samma replik, så den ser samma `CONTAINER_APP_NAME` och `CONTAINER_APP_REPLICA_NAME`. Dess detektor `azurecontainerapps` gör om dem till `cloud.provider`, `cloud.platform`, `service.name` och `azure.container_app.instance.id`, och dess detektor `env` läser `cloud.region` och `cloud.account.id` från `OTEL_RESOURCE_ATTRIBUTES` i collectorns egen miljö. Applikationen exporterar bara till `http://localhost:4318`.

Exportera appens definition, lägg till collectorn i `template.containers` och tillämpa den:

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

`az containerapp show` exporterar inte hemliga värden, så lägg tillbaka posten `secrets` för hand, eller utelämna den om du satte hemligheten i första steget: en uppdatering behåller befintliga hemligheter. Container Apps summerar CPU och minne för alla containrar i en replik, så sidecarens `resources` räknas in i appens.

Eller i portalen:

1. Öppna **Application → Containers → Edit and deploy**. På fliken **Container** använder du **+ Add** för att lägga till en container med namnet `otel-collector`, avbildningen `otel/opentelemetry-collector-contrib:latest` och **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`.
2. Lägg till dess miljövariabler: `ONEUPTIME_TOKEN` (**Reference a secret**: `oneuptime-token`), `OTEL_RESOURCE_ATTRIBUTES` och `OTEL_COLLECTOR_CONFIG` (**Manual entry**, med värdena ovan).
3. Klicka på **Save**.
:::

Om du driftar OneUptime själv använder du `https://YOUR-ONEUPTIME-HOST/otlp` som endpoint.

### Distribuera den nya revisionen

`az containerapp update` distribuerar en ny revision på egen hand. Klicka på **Create** i portalen. Om flera revisioner är aktiva flyttar du trafiken till den nya under **Revisions and replicas**.

### Kontrollera anslutningen

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` med `"valid": true` betyder att din token accepteras. `401` betyder att den är okänd, återkallad, inaktiverad eller har gått ut. Läs sedan collectorns utdata:

```bash
az containerapp logs show --name checkout-api --resource-group my-rg \
  --container otel-collector --follow
```

Leta efter `Everything is ready`, och inga `401` eller `connection refused`. Inom en minut efter det första spannet, den första loggen eller det första mätvärdet visas miljön under **Moln → All Environments** som _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_.
:::

## Använd miljöns hanterade OpenTelemetry-agent

En Container Apps-miljö kan köra Azures hanterade OpenTelemetry-agent. Den tar emot OTLP från varje app i miljön och vidarebefordrar det till en endpoint som du konfigurerar, utan en sidecar i varje app. Agenten exporterar **bara över OTLP/gRPC**, så den kan inte använda HTTP-sökvägen `/otlp`. Peka den i stället mot OneUptime-värden på port 443, där OneUptime tar emot OTLP/gRPC över TLS:

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

- **Egen drift:** använd `YOUR-ONEUPTIME-HOST:443`. En OneUptime i egen drift tar bara emot OTLP/gRPC över TLS: se [OTLP över gRPC](/docs/telemetry/open-telemetry#otlp-över-grpc).
- **Apparna sätter fortfarande attributen.** Agenten lägger in sina egna `OTEL_EXPORTER_OTLP_ENDPOINT` och `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` i varje app, så utelämna de två i appen och behåll `OTEL_SERVICE_NAME` och `OTEL_RESOURCE_ATTRIBUTES`. Agenten vidarebefordrar det som apparna skickar, så `cloud.*` och replik-ID:t kommer fortfarande från varje app.
- **Ditt `OTEL_RESOURCE_ATTRIBUTES` vinner.** Agenten sätter också `OTEL_RESOURCE_ATTRIBUTES`, och ett värde som är satt på appen ersätter det: ta med containerappens namn och replik-ID:t i ditt, eller sätt dem i koden.

## Nätverk

- **Utgående trafik är öppen som standard.** En replik når `oneuptime.com:443` utan någon konfiguration, oavsett om miljöns ingress är extern eller intern.
- **Anpassade VNet är undantaget.** I ett VNet med en användardefinierad väg som skickar `0.0.0.0/0` till en brandvägg eller NAT-gateway, eller med en nätverkssäkerhetsgrupp på undernätet, tillåter du TCP 443 till OneUptime-värden (eller din egen värds port) i brandväggen eller NSG:n.
- **En OneUptime i egen drift inuti VNet:et** måste kunna slås upp och nås från miljöns undernät.
- **Telemetri behöver ingen Azure-roll.** Bara Key Vault-referenser kräver att appens hanterade identitet har **Key Vault Secrets User** på valvet.

## Vad du får

- **Översikt**: begäranden, felfrekvens och p95-latens från dina spår. Container Apps visar inte en repliks resursanvändning för en sidecar, så rutorna **CPU** och **Minne** fylls bara om du skickar mätvärdena `container.cpu.utilization` och `container.memory.usage` med replikens identitet. De flesta team lämnar dem åt Azure Monitor.
- **Instanser**: en rad per replik, namngiven efter detektorernas `azure.container_app.instance.id`, efter `service.instance.id` när du sätter det själv, eller efter `host.name` när bara värddetektorn kördes.
- **Loggar**, **Spår** och **Mätvärden**, filtrerade på miljön, och vyn per tjänst under **Tjänster**.

## Felsökning

:::details Inget visas, och collectorn loggar 401
Hemligheten innehåller fel värde. `oneuptime-token` måste vara bara din token; `oneuptime-otlp-headers` hela headern `x-oneuptime-token=...`.
:::

:::details Appen finns under Tjänster, men det finns ingen miljö
`OTEL_RESOURCE_ATTRIBUTES` saknas, eller så är `cloud.platform` inte exakt `azure_container_apps`. Se vad appen har med `az containerapp show ... --query properties.template.containers[].env`.
:::

:::details Miljön finns, men Instanser är tom
Varken `service.instance.id`, `azure.container_app.instance.id` eller `host.name` finns på resursen. Lägg till detektorn `azurecontainerapps` i collectorn, slå på SDK:ts Azure- eller värddetektor, eller sätt `service.instance.id` i koden.
:::

:::details Två miljöer för en prenumeration
En app sätter `cloud.region` (eller `cloud.account.id`) och en annan gör det inte, eller så skriver en app regionen på ett annat sätt (`eastus` och `East US`). Värdena måste stämma tecken för tecken.
:::

Allt annat finns på [Felsökning i molnet](/docs/telemetry/cloud-troubleshooting).

## Nästa steg

:::cards
- [Molnmiljöer](/docs/telemetry/cloud-environments): Så identifieras miljöer och instanser.
- [Andra molnplattformar](/docs/telemetry/cloud-other-platforms): Azure App Service och Azure Container Instances.
- [Felsökning i molnet](/docs/telemetry/cloud-troubleshooting): Felen som alla plattformar har gemensamt.
- [Molnresurser (IaaS och PaaS)](/docs/telemetry/cloud-resources): Varje resurs i din prenumeration från Azure Monitor.
:::
