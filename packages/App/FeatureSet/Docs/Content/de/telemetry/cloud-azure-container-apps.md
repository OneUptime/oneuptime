# Azure Container Apps

Senden Sie die Traces, Logs und Metriken Ihrer Azure Container Apps an OneUptime. Jedes Replikat, das `cloud.platform=azure_container_apps` meldet, gehört zu einer **Cloud-Umgebung** pro Azure-Abonnement und Region, etwa _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_, und die laufenden Replikate stehen unter **Instanzen**.

:::cards
- [So funktioniert es](#so-funktioniert-es): Was die Detektoren setzen, und die zwei Attribute, die Sie selbst setzen.
- [Einrichten](#einrichten): Das Token speichern, die App mit der Azure CLI oder im Portal konfigurieren und prüfen.
- [Den verwalteten OpenTelemetry-Agenten der Umgebung nutzen](#den-verwalteten-opentelemetry-agenten-der-umgebung-nutzen): Jede App der Umgebung ohne Sidecar weiterleiten.
- [Fehlerbehebung](#fehlerbehebung): Abgelehnte Exporte, fehlende Umgebungen und leere Instanzen.
:::

## So funktioniert es

```mermaid title="Woher die Attribute eines Container-Apps-Replikats kommen"
flowchart TB
    detector["Azure-Detektor:<br/>Plattform und Replikat"] --> exporter
    manual["OTEL_RESOURCE_<br/>ATTRIBUTES: Region<br/>und Abonnement"] --> exporter
    exporter["Ihre App oder ihr<br/>Sidecar-Collector"] -->|"OTLP über HTTPS"| ou["OneUptime"]
    ou --> env["Cloud-Umgebung<br/>Abonnement und Region"]
    ou --> inst["Instanzen<br/>eine Zeile pro Replikat"]
```

Container Apps hat Ressourcendetektoren: den `azurecontainerapps`-Detektor des Collectors und die für Node.js (`@opentelemetry/resource-detector-azure`) und .NET (`OpenTelemetry.Resources.Azure`). Sie lesen `CONTAINER_APP_NAME` und `CONTAINER_APP_REPLICA_NAME` und setzen `cloud.provider`, `cloud.platform`, `service.name` und die Replikat-ID. Keiner von ihnen kennt die Region oder das Abonnement, daher setzen Sie `cloud.region` und `cloud.account.id` selbst, in `OTEL_RESOURCE_ATTRIBUTES`.

| Attribut | Wert | Wofür |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `cloud.provider` | `azure` | Wird in der Übersicht angezeigt |
| `cloud.platform` | `azure_container_apps` | Legt die Telemetrie unter **Cloud-Umgebungen** ab |
| `cloud.region` | die Region der Umgebung, etwa `eastus`: von Ihnen gesetzt | Teil des Umgebungsschlüssels |
| `cloud.account.id` | die Abonnement-ID: von Ihnen gesetzt | Teil des Umgebungsschlüssels |
| `azure.container_app.instance.id` | der Replikatname, von den Detektoren aus `CONTAINER_APP_REPLICA_NAME` gesetzt | Benennt ein laufendes Replikat: je eine Zeile unter **Instanzen** |
| `service.instance.id` | der Replikatname, wenn Sie ihn selbst setzen | Wird verwendet, wenn kein Detektor die Replikat-ID gesetzt hat |

- **Schreibweisen mit Punkt funktionieren.** Die Detektoren für Node.js und .NET schreiben die Plattform `azure.container_apps`, mit einem Punkt. OneUptime schreibt sie beim Empfang in `azure_container_apps` um, sodass beide Schreibweisen in derselben Umgebung landen.
- **Der Hostname ist der Replikatname.** Ein SDK, das nur den `host`-Detektor ausführt, meldet `host.name` als Replikatnamen, und OneUptime benennt die Instanz danach, wenn nichts Genaueres vorhanden ist.

Der Umgebungsschlüssel ist `azure_container_apps|<subscription id>|eastus`.

## Bevor Sie beginnen

- **Ein Ingestion-Schlüssel.** Erstellen Sie einen **Server**-Schlüssel unter **Projekteinstellungen → Telemetrie & APM → Ingestion-Schlüssel** und kopieren Sie sein Token.
- **Die Azure CLI mit der Erweiterung `containerapp`** (`az extension add --name containerapp --upgrade`), beim Abonnement angemeldet, oder das Azure-Portal.
- **Ihre Anwendung, mit einem OpenTelemetry SDK instrumentiert**, das OTLP exportiert.

## Wählen, wie die Telemetrie die App verlässt

| | SDK direct | Sidecar collector |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Zusätzlicher Container | Keiner | `otel-collector` in der App, teilt sich CPU und Arbeitsspeicher des Replikats |
| Setzt die Attribute | Das SDK und `OTEL_RESOURCE_ATTRIBUTES` an der App | Der Collector, für alles, was durchläuft |
| Das Secret | `oneuptime-otlp-headers`, der ganze Header | `oneuptime-token`, das reine Token |

Ein dritter Weg, der verwaltete OpenTelemetry-Agent der Umgebung, leitet jede App der Umgebung ohne Sidecar weiter: siehe [Den verwalteten OpenTelemetry-Agenten der Umgebung nutzen](#den-verwalteten-opentelemetry-agenten-der-umgebung-nutzen). Jeder Schritt unten hat einen Tab für SDK direct und den Sidecar-Collector; wählen Sie einen, und jeder Schritt folgt ihm.

## Einrichten

:::steps
### Das Token als Container-Apps-Secret speichern

> [!IMPORTANT]
> Das Token ist ein Geheimnis. Speichern Sie es als Container-Apps-Secret und verweisen Sie in Umgebungsvariablen mit `secretref:` darauf. Einmal gesetzt, wird ein Secret weder in `az containerapp show` noch im Portal angezeigt; eine einfache Umgebungsvariable schon.

:::tabs
@tab SDK direct
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-otlp-headers="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

Das `OTEL_EXPORTER_OTLP_HEADERS` des SDK will den ganzen `name=value`-Header, daher enthält das Secret ihn.
@tab Sidecar collector
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Der Collector fügt den Namen des Headers selbst hinzu, daher enthält das Secret nur das Token.
:::

Im Portal: **Azure portal → Container Apps → your app → Settings → Secrets → + Add**. Geben Sie den Schlüssel ein, wählen Sie den Typ **Container Apps secret**, fügen Sie den Wert ein und klicken Sie auf **Add**.

Wenn Sie Secrets in Key Vault aufbewahren, verweisen Sie auf das Secret, statt seinen Wert zu kopieren. Die verwaltete Identität der App braucht die Rolle **Key Vault Secrets User** auf dem Vault:

```bash
az containerapp secret set \
  --name checkout-api --resource-group my-rg \
  --secrets "oneuptime-token=keyvaultref:https://my-vault.vault.azure.net/secrets/oneuptime-token,identityref:system"
```

### Die Container-App konfigurieren

:::tabs
@tab SDK direct
Setzen Sie den Exporter und die Attribute, die kein Detektor kennt, am Anwendungs-Container. Ersetzen Sie Region und Abonnement-ID durch Ihre eigenen:

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

Für die Identität des Replikats schalten Sie den Azure-Detektor des SDK ein: `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure` in Node.js oder `.ConfigureResource(r => r.AddAzureContainerAppsDetector())` mit `OpenTelemetry.Resources.Azure` in .NET. Er setzt `azure.container_app.instance.id` aus `CONTAINER_APP_REPLICA_NAME`.

Container Apps kann keine Umgebungsvariable in eine andere einsetzen, daher kann `service.instance.id` in anderen Sprachen nicht in `OTEL_RESOURCE_ATTRIBUTES` stehen. Schalten Sie den Host-Detektor ein (sein `host.name` ist der Replikatname), oder setzen Sie es im Code:

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

Welchen Detektor Sie auch nutzen, behalten Sie `cloud.region` und `cloud.account.id` in `OTEL_RESOURCE_ATTRIBUTES`: Kein Container-Apps-Detektor setzt sie, und der Umgebungsschlüssel braucht sie.

Stattdessen im Portal:

1. Öffnen Sie **Application → Containers → Edit and deploy**, wählen Sie auf dem Tab **Container** Ihren Container und klicken Sie auf **Edit**.
2. Fügen Sie unter **Environment variables** jede Variable oben mit der Quelle **Manual entry** hinzu, und `OTEL_EXPORTER_OTLP_HEADERS` mit der Quelle **Reference a secret**, die auf `oneuptime-otlp-headers` zeigt.
3. Klicken Sie auf **Save**.
@tab Sidecar collector
Ein Sidecar läuft im selben Replikat und sieht daher dieselben `CONTAINER_APP_NAME` und `CONTAINER_APP_REPLICA_NAME`. Sein `azurecontainerapps`-Detektor macht daraus `cloud.provider`, `cloud.platform`, `service.name` und `azure.container_app.instance.id`, und sein `env`-Detektor liest `cloud.region` und `cloud.account.id` aus `OTEL_RESOURCE_ATTRIBUTES` in der eigenen Umgebung des Collectors. Die Anwendung exportiert nur an `http://localhost:4318`.

Exportieren Sie die Definition der App, fügen Sie den Collector zu `template.containers` hinzu und wenden Sie sie an:

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

`az containerapp show` exportiert keine Secret-Werte, also fügen Sie den Eintrag `secrets` von Hand wieder hinzu, oder lassen Sie ihn weg, wenn Sie das Secret im ersten Schritt gesetzt haben: Ein Update behält vorhandene Secrets. Container Apps addiert CPU und Arbeitsspeicher aller Container eines Replikats, daher zählen die `resources` des Sidecars gegen die der App.

Stattdessen im Portal:

1. Öffnen Sie **Application → Containers → Edit and deploy**. Fügen Sie auf dem Tab **Container** mit **+ Add** einen Container namens `otel-collector` mit dem Image `otel/opentelemetry-collector-contrib:latest` und dem **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG` hinzu.
2. Fügen Sie seine Umgebungsvariablen hinzu: `ONEUPTIME_TOKEN` (**Reference a secret**: `oneuptime-token`), `OTEL_RESOURCE_ATTRIBUTES` und `OTEL_COLLECTOR_CONFIG` (**Manual entry**, mit den Werten oben).
3. Klicken Sie auf **Save**.
:::

Wenn Sie OneUptime selbst hosten, verwenden Sie `https://YOUR-ONEUPTIME-HOST/otlp` als Endpunkt.

### Die neue Revision bereitstellen

`az containerapp update` stellt von sich aus eine neue Revision bereit. Klicken Sie im Portal auf **Create**. Wenn mehrere Revisionen aktiv sind, leiten Sie den Verkehr unter **Revisions and replicas** auf die neue um.

### Die Verbindung prüfen

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` mit `"valid": true` bedeutet, dass das Token angenommen wird. `401` bedeutet, dass es unbekannt, widerrufen, deaktiviert oder abgelaufen ist. Lesen Sie dann die Ausgabe des Collectors:

```bash
az containerapp logs show --name checkout-api --resource-group my-rg \
  --container otel-collector --follow
```

Achten Sie auf `Everything is ready` und darauf, dass weder `401` noch `connection refused` erscheint. Innerhalb einer Minute nach dem ersten Span, Log oder der ersten Metrik erscheint die Umgebung unter **Cloud → Alle Umgebungen** als _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_.
:::

## Den verwalteten OpenTelemetry-Agenten der Umgebung nutzen

Eine Container-Apps-Umgebung kann den verwalteten OpenTelemetry-Agenten von Azure ausführen. Er empfängt OTLP von jeder App der Umgebung und leitet es an einen Endpunkt weiter, den Sie konfigurieren, ohne Sidecar in jeder App. Der Agent exportiert **nur über OTLP/gRPC**, kann also den HTTP-Pfad `/otlp` nicht nutzen. Richten Sie ihn stattdessen auf den OneUptime-Host an Port 443, wo OneUptime OTLP/gRPC über TLS bereitstellt:

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

- **Selbst gehostet:** Verwenden Sie `YOUR-ONEUPTIME-HOST:443`. Ein selbst gehostetes OneUptime nimmt OTLP/gRPC nur über TLS an: siehe [OTLP über gRPC](/docs/telemetry/open-telemetry#otlp-über-grpc).
- **Die Apps setzen die Attribute weiterhin.** Der Agent setzt seine eigenen `OTEL_EXPORTER_OTLP_ENDPOINT` und `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` in jede App, also lassen Sie diese beiden an der App weg und behalten `OTEL_SERVICE_NAME` und `OTEL_RESOURCE_ATTRIBUTES`. Der Agent leitet weiter, was die Apps senden, daher kommen `cloud.*` und die Replikat-ID weiterhin von jeder App.
- **Ihr `OTEL_RESOURCE_ATTRIBUTES` gewinnt.** Der Agent setzt `OTEL_RESOURCE_ATTRIBUTES` ebenfalls, und ein an der App gesetzter Wert ersetzt ihn: Nehmen Sie den Namen der Container App und die Replikat-ID in Ihren auf, oder setzen Sie sie im Code.

## Netzwerk

- **Ausgehender Verkehr ist standardmäßig offen.** Ein Replikat erreicht `oneuptime.com:443` ohne jede Konfiguration, ob der Ingress der Umgebung extern oder intern ist.
- **Eigene VNets sind die Ausnahme.** In einem VNet mit einer benutzerdefinierten Route, die `0.0.0.0/0` an eine Firewall oder ein NAT-Gateway schickt, oder mit einer Netzwerksicherheitsgruppe am Subnetz erlauben Sie TCP 443 zum OneUptime-Host (oder zum Port Ihres eigenen Hosts) an der Firewall oder NSG.
- **Ein selbst gehostetes OneUptime im VNet** muss vom Subnetz der Umgebung aus auflösbar und erreichbar sein.
- **Für Telemetrie ist keine Azure-Rolle nötig.** Nur Key-Vault-Verweise brauchen für die verwaltete Identität der App die Rolle **Key Vault Secrets User** auf dem Vault.

## Was Sie erhalten

- **Übersicht**: Anfragen, Fehlerrate und p95-Latenz aus Ihren Traces. Container Apps zeigt einem Sidecar die Ressourcennutzung eines Replikats nicht, daher füllen sich die Kacheln **CPU** und **Arbeitsspeicher** nur, wenn Sie Metriken `container.cpu.utilization` und `container.memory.usage` mit der Identität des Replikats senden. Die meisten Teams überlassen diese Azure Monitor.
- **Instanzen**: eine Zeile pro Replikat, benannt nach `azure.container_app.instance.id` der Detektoren, nach `service.instance.id`, wenn Sie es selbst setzen, oder nach `host.name`, wenn nur der Host-Detektor lief.
- **Protokolle**, **Traces** und **Metriken**, auf die Umgebung gefiltert, und die Ansicht pro Dienst unter **Dienste**.

## Fehlerbehebung

:::details Nichts erscheint, und der Collector meldet 401
Das Secret enthält den falschen Wert. `oneuptime-token` muss das reine Token sein; `oneuptime-otlp-headers` der ganze Header `x-oneuptime-token=...`.
:::

:::details Die App steht unter Dienste, aber es gibt keine Umgebung
`OTEL_RESOURCE_ATTRIBUTES` fehlt, oder `cloud.platform` ist nicht genau `azure_container_apps`. Sehen Sie mit `az containerapp show ... --query properties.template.containers[].env` nach, was die App hat.
:::

:::details Die Umgebung existiert, aber Instanzen ist leer
Keines von `service.instance.id`, `azure.container_app.instance.id` oder `host.name` steht auf der Ressource. Fügen Sie dem Collector den `azurecontainerapps`-Detektor hinzu, schalten Sie den Azure- oder Host-Detektor des SDK ein, oder setzen Sie `service.instance.id` im Code.
:::

:::details Zwei Umgebungen für ein Abonnement
Eine App setzt `cloud.region` (oder `cloud.account.id`) und eine andere nicht, oder eine schreibt die Region anders (`eastus` und `East US`). Die Werte müssen Zeichen für Zeichen übereinstimmen.
:::

Alles Weitere steht unter [Cloud-Fehlerbehebung](/docs/telemetry/cloud-troubleshooting).

## Nächste Schritte

:::cards
- [Cloud-Umgebungen](/docs/telemetry/cloud-environments): Wie Umgebungen und Instanzen erkannt werden.
- [Weitere Cloud-Plattformen](/docs/telemetry/cloud-other-platforms): Azure App Service und Azure Container Instances.
- [Cloud-Fehlerbehebung](/docs/telemetry/cloud-troubleshooting): Die Fehler, die alle Plattformen gemeinsam haben.
- [Cloud-Ressourcen (IaaS & PaaS)](/docs/telemetry/cloud-resources): Jede Ressource in Ihrem Abonnement, aus Azure Monitor.
:::
