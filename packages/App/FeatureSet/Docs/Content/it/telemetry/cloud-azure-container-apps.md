# Azure Container Apps

Invia a OneUptime le tracce, i log e le metriche delle tue Azure Container Apps. Ogni replica che riporta `cloud.platform=azure_container_apps` entra in un **Cloud Environment** per sottoscrizione Azure e regione, ad esempio _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_, con le repliche in esecuzione elencate in **Istanze**.

:::cards
- [Come funziona](#come-funziona): Cosa impostano i rilevatori, e i due attributi che imposti tu.
- [Configurazione](#configurazione): Salvare il token, configurare l'app con la CLI di Azure o il portale, e verificare.
- [Usare l'agent OpenTelemetry gestito dell'ambiente](#usare-lagent-opentelemetry-gestito-dellambiente): Inoltrare ogni app dell'ambiente senza sidecar.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Esportazioni rifiutate, ambienti mancanti e istanze vuote.
:::

## Come funziona

```mermaid title="Da dove vengono gli attributi di una replica di Container Apps"
flowchart TB
    detector["Rilevatore Azure:<br/>piattaforma e replica"] --> exporter
    manual["OTEL_RESOURCE_<br/>ATTRIBUTES: regione<br/>e sottoscrizione"] --> exporter
    exporter["La tua app, o il suo<br/>collector sidecar"] -->|"OTLP su HTTPS"| ou["OneUptime"]
    ou --> env["Ambiente cloud<br/>sottoscrizione<br/>e regione"]
    ou --> inst["Istanze<br/>una riga per replica"]
```

Container Apps ha dei rilevatori di risorse: il rilevatore `azurecontainerapps` del Collector, e quelli di Node.js (`@opentelemetry/resource-detector-azure`) e .NET (`OpenTelemetry.Resources.Azure`). Leggono `CONTAINER_APP_NAME` e `CONTAINER_APP_REPLICA_NAME`, e impostano `cloud.provider`, `cloud.platform`, `service.name` e l'ID della replica. Nessuno di loro conosce la regione o la sottoscrizione, quindi imposti tu `cloud.region` e `cloud.account.id`, in `OTEL_RESOURCE_ATTRIBUTES`.

| Attributo | Valore | A cosa serve |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `cloud.provider` | `azure` | Mostrato nella panoramica |
| `cloud.platform` | `azure_container_apps` | Archivia la telemetria in **Ambienti cloud** |
| `cloud.region` | la regione dell'ambiente, ad esempio `eastus`: impostata da te | Parte della chiave dell'ambiente |
| `cloud.account.id` | l'ID della sottoscrizione: impostato da te | Parte della chiave dell'ambiente |
| `azure.container_app.instance.id` | il nome della replica, impostato dai rilevatori da `CONTAINER_APP_REPLICA_NAME` | Dà il nome a una replica in esecuzione: una riga ciascuna in **Istanze** |
| `service.instance.id` | il nome della replica, se lo imposti tu | Usato quando nessun rilevatore ha impostato l'ID della replica |

- **Le grafie con il punto funzionano.** I rilevatori di Node.js e .NET scrivono la piattaforma `azure.container_apps`, con un punto. OneUptime la riscrive in `azure_container_apps` quando la riceve, quindi entrambe le grafie finiscono nello stesso ambiente.
- **Il nome host è il nome della replica.** Un SDK che esegue solo il rilevatore `host` riporta il nome della replica come `host.name`, e OneUptime dà quel nome all'istanza quando non c'è niente di più specifico.

La chiave dell'ambiente è `azure_container_apps|<subscription id>|eastus`.

## Prima di iniziare

- **Una chiave di acquisizione.** Crea una chiave **Server** in **Impostazioni del progetto → Telemetria e APM → Chiavi di acquisizione** e copia il suo token.
- **La CLI di Azure con l'estensione `containerapp`** (`az extension add --name containerapp --upgrade`), con accesso alla sottoscrizione, oppure il portale di Azure.
- **La tua applicazione strumentata con un SDK OpenTelemetry** che esporta OTLP.

## Scegliere come la telemetria esce dall'app

| | SDK direct | Sidecar collector |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Container in più | Nessuno | `otel-collector` nell'app, che condivide CPU e memoria della replica |
| Imposta gli attributi | L'SDK e `OTEL_RESOURCE_ATTRIBUTES` sull'app | Il collector, per tutto ciò che lo attraversa |
| Il segreto | `oneuptime-otlp-headers`, l'intestazione completa | `oneuptime-token`, il solo token |

Una terza via, l'agent OpenTelemetry gestito dell'ambiente, inoltra ogni app dell'ambiente senza sidecar: vedi [Usare l'agent OpenTelemetry gestito dell'ambiente](#usare-lagent-opentelemetry-gestito-dellambiente). Ogni passaggio qui sotto ha una scheda per SDK direct e una per il collector sidecar; scegline una e ogni passaggio la seguirà.

## Configurazione

:::steps
### Salvare il token come segreto di Container Apps

> [!IMPORTANT]
> Il token è un segreto. Salvalo come segreto di Container Apps e fai riferimento a esso dalle variabili d'ambiente con `secretref:`. Una volta impostato, un segreto non compare in `az containerapp show` né nel portale; una semplice variabile d'ambiente sì.

:::tabs
@tab SDK direct
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-otlp-headers="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

L'`OTEL_EXPORTER_OTLP_HEADERS` dell'SDK vuole l'intestazione `name=value` completa, quindi il segreto la contiene.
@tab Sidecar collector
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Il collector aggiunge da sé il nome dell'intestazione, quindi il segreto contiene solo il token.
:::

Nel portale: **Azure portal → Container Apps → your app → Settings → Secrets → + Add**. Inserisci la chiave, scegli il tipo **Container Apps secret**, incolla il valore e fai clic su **Add**.

Se conservi i segreti in Key Vault, fai riferimento al segreto invece di copiarne il valore. L'identità gestita dell'app ha bisogno del ruolo **Key Vault Secrets User** sull'insieme di credenziali:

```bash
az containerapp secret set \
  --name checkout-api --resource-group my-rg \
  --secrets "oneuptime-token=keyvaultref:https://my-vault.vault.azure.net/secrets/oneuptime-token,identityref:system"
```

### Configurare la container app

:::tabs
@tab SDK direct
Imposta l'esportatore, e gli attributi che nessun rilevatore conosce, sul container dell'applicazione. Sostituisci la regione e l'ID della sottoscrizione con i tuoi:

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

Per l'identità della replica, attiva il rilevatore Azure dell'SDK: `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure` in Node.js, oppure `.ConfigureResource(r => r.AddAzureContainerAppsDetector())` con `OpenTelemetry.Resources.Azure` in .NET. Imposta `azure.container_app.instance.id` da `CONTAINER_APP_REPLICA_NAME`.

Container Apps non può inserire una variabile d'ambiente in un'altra, quindi negli altri linguaggi `service.instance.id` non può andare in `OTEL_RESOURCE_ATTRIBUTES`. Attiva il rilevatore host (il suo `host.name` è il nome della replica), oppure impostalo nel codice:

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

Qualunque rilevatore usi, tieni `cloud.region` e `cloud.account.id` in `OTEL_RESOURCE_ATTRIBUTES`: nessun rilevatore di Container Apps li imposta, e la chiave dell'ambiente ne ha bisogno.

In alternativa, nel portale:

1. Apri **Application → Containers → Edit and deploy**, seleziona il tuo container nella scheda **Container** e fai clic su **Edit**.
2. In **Environment variables**, aggiungi ogni variabile qui sopra con l'origine **Manual entry**, e `OTEL_EXPORTER_OTLP_HEADERS` con l'origine **Reference a secret**, che punta a `oneuptime-otlp-headers`.
3. Fai clic su **Save**.
@tab Sidecar collector
Un sidecar gira nella stessa replica, quindi vede gli stessi `CONTAINER_APP_NAME` e `CONTAINER_APP_REPLICA_NAME`. Il suo rilevatore `azurecontainerapps` li trasforma in `cloud.provider`, `cloud.platform`, `service.name` e `azure.container_app.instance.id`, e il suo rilevatore `env` legge `cloud.region` e `cloud.account.id` da `OTEL_RESOURCE_ATTRIBUTES` nell'ambiente stesso del collector. L'applicazione esporta solo verso `http://localhost:4318`.

Esporta la definizione dell'app, aggiungi il collector a `template.containers`, e applicala:

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

`az containerapp show` non esporta i valori dei segreti, quindi aggiungi di nuovo a mano la voce `secrets`, oppure omettila se hai impostato il segreto al primo passaggio: un aggiornamento mantiene i segreti esistenti. Container Apps somma CPU e memoria di tutti i container di una replica, quindi le `resources` del sidecar contano su quelle dell'app.

In alternativa, nel portale:

1. Apri **Application → Containers → Edit and deploy**. Nella scheda **Container**, **+ Add** un container chiamato `otel-collector` con l'immagine `otel/opentelemetry-collector-contrib:latest` e l'**Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`.
2. Aggiungi le sue variabili d'ambiente: `ONEUPTIME_TOKEN` (**Reference a secret**: `oneuptime-token`), `OTEL_RESOURCE_ATTRIBUTES` e `OTEL_COLLECTOR_CONFIG` (**Manual entry**, con i valori qui sopra).
3. Fai clic su **Save**.
:::

Se ospiti OneUptime in autonomia, usa `https://YOUR-ONEUPTIME-HOST/otlp` come endpoint.

### Distribuire la nuova revisione

`az containerapp update` distribuisce da solo una nuova revisione. Nel portale, fai clic su **Create**. Se sono attive più revisioni, sposta il traffico sulla nuova in **Revisions and replicas**.

### Verificare la connessione

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` con `"valid": true` significa che il token è accettato. `401` significa che è sconosciuto, revocato, disattivato o scaduto. Poi leggi l'output del collector:

```bash
az containerapp logs show --name checkout-api --resource-group my-rg \
  --container otel-collector --follow
```

Cerca `Everything is ready`, e nessun `401` o `connection refused`. Entro un minuto dal primo span, log o metrica, l'ambiente compare in **Cloud → All Environments** come _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_.
:::

## Usare l'agent OpenTelemetry gestito dell'ambiente

Un ambiente di Container Apps può eseguire l'agent OpenTelemetry gestito di Azure. Riceve OTLP da ogni app dell'ambiente e lo inoltra a un endpoint che configuri tu, senza sidecar in ogni app. L'agent esporta **solo su OTLP/gRPC**, quindi non può usare il percorso HTTP `/otlp`. Puntalo invece all'host di OneUptime sulla porta 443, dove OneUptime serve OTLP/gRPC su TLS:

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

- **In autonomia:** usa `YOUR-ONEUPTIME-HOST:443`. Un OneUptime ospitato in autonomia accetta OTLP/gRPC solo su TLS: vedi [OTLP su gRPC](/docs/telemetry/open-telemetry#otlp-su-grpc).
- **Le app impostano comunque gli attributi.** L'agent mette i propri `OTEL_EXPORTER_OTLP_ENDPOINT` e `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` in ogni app, quindi togli quei due dall'app e tieni `OTEL_SERVICE_NAME` e `OTEL_RESOURCE_ATTRIBUTES`. L'agent inoltra ciò che inviano le app, quindi `cloud.*` e l'ID della replica vengono comunque da ogni app.
- **Il tuo `OTEL_RESOURCE_ATTRIBUTES` vince.** Anche l'agent imposta `OTEL_RESOURCE_ATTRIBUTES`, e un valore impostato sull'app lo sostituisce: includi nel tuo il nome della container app e l'ID della replica, oppure impostali nel codice.

## Rete

- **Il traffico in uscita è aperto per impostazione predefinita.** Una replica raggiunge `oneuptime.com:443` senza alcuna configurazione, che l'ingress dell'ambiente sia esterno o interno.
- **Le VNet personalizzate sono l'eccezione.** Su una VNet con una route definita dall'utente che invia `0.0.0.0/0` a un firewall o a un NAT gateway, o con un gruppo di sicurezza di rete sulla subnet, consenti TCP 443 verso l'host di OneUptime (o la porta del tuo host) sul firewall o sull'NSG.
- **Un OneUptime ospitato in autonomia dentro la VNet** deve essere risolvibile e raggiungibile dalla subnet dell'ambiente.
- **Per la telemetria non serve alcun ruolo Azure.** Solo i riferimenti a Key Vault richiedono che l'identità gestita dell'app abbia **Key Vault Secrets User** sull'insieme di credenziali.

## Che cosa ottieni

- **Panoramica**: richieste, tasso di errore e latenza p95 dalle tue tracce. Container Apps non mostra a un sidecar l'uso delle risorse di una replica, quindi i riquadri **CPU** e **Memoria** si riempiono solo se invii metriche `container.cpu.utilization` e `container.memory.usage` che portano l'identità della replica. La maggior parte dei team le lascia ad Azure Monitor.
- **Istanze**: una riga per replica, con il nome di `azure.container_app.instance.id` dei rilevatori, di `service.instance.id` quando lo imposti tu, o di `host.name` quando è stato eseguito solo il rilevatore host.
- **Registri**, **Tracce** e **Metriche**, filtrati sull'ambiente, e la vista per servizio in **Servizi**.

## Risoluzione dei problemi

:::details Non compare nulla, e il collector registra 401
Il segreto contiene il valore sbagliato. `oneuptime-token` deve essere il solo token; `oneuptime-otlp-headers`, l'intestazione completa `x-oneuptime-token=...`.
:::

:::details L'app è in Servizi, ma non esiste alcun ambiente
`OTEL_RESOURCE_ATTRIBUTES` manca, oppure `cloud.platform` non è esattamente `azure_container_apps`. Controlla cosa ha l'app con `az containerapp show ... --query properties.template.containers[].env`.
:::

:::details L'ambiente esiste, ma Istanze è vuota
Nessuno tra `service.instance.id`, `azure.container_app.instance.id` e `host.name` è sulla risorsa. Aggiungi il rilevatore `azurecontainerapps` al collector, attiva il rilevatore Azure o host dell'SDK, oppure imposta `service.instance.id` nel codice.
:::

:::details Due ambienti per una sottoscrizione
Un'app imposta `cloud.region` (o `cloud.account.id`) e un'altra no, oppure una scrive la regione diversamente (`eastus` e `East US`). I valori devono coincidere carattere per carattere.
:::

Tutto il resto è in [Risoluzione dei problemi cloud](/docs/telemetry/cloud-troubleshooting).

## Prossimi passi

:::cards
- [Ambienti cloud](/docs/telemetry/cloud-environments): Come vengono identificati ambienti e istanze.
- [Altre piattaforme cloud](/docs/telemetry/cloud-other-platforms): Azure App Service e Azure Container Instances.
- [Risoluzione dei problemi cloud](/docs/telemetry/cloud-troubleshooting): I guasti comuni a tutte le piattaforme.
- [Risorse cloud (IaaS e PaaS)](/docs/telemetry/cloud-resources): Ogni risorsa della tua sottoscrizione, da Azure Monitor.
:::
