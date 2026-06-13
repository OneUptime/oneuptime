# OneUptime Kubernetes Agent (Helm)

## Überblick

Der OneUptime Kubernetes Agent ist ein vorgefertigtes Helm-Chart, das eine OpenTelemetry-basierte Collector-Pipeline auf Ihrem Cluster installiert. Er liefert Node-, Pod-, Container- und Cluster-Metriken; Kubernetes-Events; Pod-Logs; und — mit standardmäßig aktiviertem eBPF — Anwendungs-Traces, HTTP-RED-Metriken, Service-Graph-Daten sowie Pod-zu-Pod-Netzwerkfluss-Metriken. Keine Codeänderungen, keine SDKs, ein einziges `helm install`.

Diese Seite ist die **Installationsanleitung**. Für die Konfiguration von Kubernetes-Monitoren und Alarmen auf Basis der vom Agent erfassten Daten siehe [Kubernetes Agent (Monitore)](/docs/monitor/kubernetes-agent).

## Voraussetzungen

- Ein laufendes Kubernetes-Cluster (v1.23+)
- `kubectl`, konfiguriert für den Zugriff auf Ihr Cluster
- `helm` v3 installiert
- Ein **OneUptime-API-Schlüssel** — erstellen Sie einen unter *Project Settings → API Keys*

## Schritt 1 — Das OneUptime Helm-Repository hinzufügen

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Schritt 2 — Ein Preset für Ihr Cluster auswählen

Das Chart stellt eine einzige Top-Level-Option bereit — `preset` —, die kompatible Standardwerte für Ihre Kubernetes-Distribution auswählt. Sie steuert Dinge, die Sie andernfalls von Hand anpassen müssten: ob Logs über ein hostPath-DaemonSet oder über die Kubernetes-API geliefert werden und welcher Security Context angewendet wird.

| `preset` | Verwenden für | Log-Erfassung |
|---|---|---|
| `standard` *(Standard)* | Selbstverwaltete Cluster, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet, das `/var/log/pods` über hostPath liest (geringster Overhead) |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes-API-Log-Tailer-Deployment (kein hostPath, kein Host-Zugriff) |
| `eks-fargate` | **EKS Fargate** | Kubernetes-API-Log-Tailer-Deployment (kein hostPath, kein Host-Zugriff) |

Wenn Sie sich nicht sicher sind, beginnen Sie mit `standard`. Falls die Installation mit einem Pod-Security-Fehler fehlschlägt, der `hostPath` erwähnt, führen Sie sie erneut mit `preset=gke-autopilot` (oder `eks-fargate` auf Fargate) aus, und es wird funktionieren.

## Schritt 3 — Den Kubernetes Agent installieren

Ersetzen Sie `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` und den Cluster-Namen durch Werte für Ihre Umgebung. Der Cluster-Name ist die Art und Weise, wie das Cluster in OneUptime erscheint — wählen Sie etwas Stabiles wie `prod-us-east-1`.

### Standard-Cluster (selbstverwaltet, EKS on EC2, GKE Standard, AKS)

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster"
```

### GKE Autopilot

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=gke-autopilot
```

### EKS Fargate

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=eks-fargate
```

## Schritt 4 — Die Installation überprüfen

Prüfen Sie, ob die Agent-Pods laufen:

```bash
kubectl get pods -n oneuptime-agent
```

Auf einem **Standard**-Cluster sehen Sie ein Metrics-Collector-Deployment sowie einen Log-Collector-DaemonSet-Pod pro Node:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

Auf **GKE Autopilot** oder **EKS Fargate** sehen Sie stattdessen zwei Deployments (kein DaemonSet):

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Sobald sich der Agent verbindet, erscheint Ihr Cluster automatisch im Abschnitt **Kubernetes** des OneUptime-Dashboards.

## Konfigurationsoptionen

### Namespace-Filterung

Standardmäßig wird `kube-system` ausgeschlossen. Um nur bestimmte Namespaces zu überwachen:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

### Log-Erfassung deaktivieren

Wenn Sie nur Metriken und Events benötigen (keine Pod-Logs):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Einen bestimmten Log-Erfassungsmodus erzwingen

Fortgeschrittene Benutzer können die Auswahl des Presets mit `logs.mode` überschreiben:

- `logs.mode=daemonset` — hostPath-DaemonSet (geringster Overhead, erfordert hostPath)
- `logs.mode=api` — Kubernetes-API-Log-Tailer-Deployment (funktioniert auf jedem Cluster)
- `logs.mode=disabled` — keine Log-Erfassung

Das explizite `logs.mode` setzt sich immer gegenüber dem Preset-Standard durch. Verwenden Sie dies, wenn Sie Ihr Cluster besser kennen als das Preset.

### Control-Plane-Überwachung aktivieren

Für selbstverwaltete Cluster (nicht EKS / GKE / AKS) können Sie Control-Plane-Metriken aktivieren:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> Verwaltete Kubernetes-Dienste (EKS, GKE, AKS) stellen Control-Plane-Metriken in der Regel nicht bereit. Aktivieren Sie dies nur für selbstverwaltete Cluster.

### Automatisches Tagging mit Projekt-Labels

Jedes Ressourcenattribut mit dem Präfix `oneuptime.label.` wird zu einem Projekt-Label hochgestuft und an das Cluster, die Services und Hosts angehängt, die von diesem Agent ausgegeben werden. Muster: `oneuptime.label.<dimension>=<value>` wird zu einem Label mit dem Namen `<dimension>:<value>`.

Übergeben Sie Labels zur Installationszeit mit `--set oneuptime.labels.<key>=<value>`:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="prod" \
  --set oneuptime.labels.team=payments \
  --set oneuptime.labels.env=production \
  --set oneuptime.labels.region=us-east-1
```

Oder behalten Sie sie in einer Values-Datei:

```yaml
# values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
  labels:
    team: payments
    env: production
    region: us-east-1
clusterName: prod
```

Labels werden ohne Beachtung der Groß-/Kleinschreibung abgeglichen, sodass ein vorhandenes, manuell erstelltes `Production`-Label wiederverwendet statt dupliziert wird. In der OneUptime-Benutzeroberfläche manuell hinzugefügte Labels werden vom Agent niemals entfernt.

## Den Agent aktualisieren

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` behält Ihre bestehende Konfiguration bei (Preset, Cluster-Name, Filter); übergeben Sie alle neuen `--set`-Überschreibungen zusätzlich.

## Den Agent deinstallieren

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## Was erfasst wird

| Kategorie | Daten |
|----------|------|
| **Node-Metriken** | CPU-Auslastung, Speichernutzung, Dateisystemnutzung, Netzwerk-I/O |
| **Pod-Metriken** | CPU-Nutzung, Speichernutzung, Netzwerk-I/O, Neustarts |
| **Container-Metriken** | CPU-Nutzung, Speichernutzung pro Container |
| **Cluster-Metriken** | Node-Bedingungen, zuteilbare Ressourcen, Pod-Anzahlen |
| **Kubernetes-Events** | Warnungen, Fehler, Scheduling-Events |
| **Pod-Logs** | stdout/stderr-Logs aus allen Containern (über hostPath-DaemonSet auf Standard-Clustern oder über die Kubernetes-API auf Autopilot / Fargate) |
| **Anwendungs-Traces** *(über eBPF, standardmäßig aktiviert)* | HTTP-, gRPC-, SQL/Redis-Spans aus jedem Pod — kein SDK und keine Codeänderungen |
| **HTTP-RED-Metriken** *(über eBPF)* | `http.server.request.duration`, Request- und Response-Body-Größen, pro Service |
| **Service Graph** *(über eBPF)* | Caller → Callee Request-Rate, Latenz und Fehler-Edges — speist die Service-Map-Ansicht |
| **Netzwerkfluss-Metriken** *(über eBPF)* | Pod-zu-Pod-TCP/UDP-Byte- und -Paketzähler mit k8s-Metadaten |
| **TCP-Statistiken** *(über eBPF)* | Node-Level-RTT-, Fehlverbindungs- und Retransmit-Zähler |

## Anwendungs-Traces & HTTP-Metriken über eBPF (standardmäßig aktiviert)

Das Chart führt ein DaemonSet mit [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) auf jedem Node aus. Es lädt eBPF-Programme in den Kernel und erfasst automatisch HTTP/HTTPS-, gRPC- und SQL/Redis-Verkehr aus jeder unterstützten Laufzeitumgebung (Go, .NET, Java, Node.js, Python, Ruby, Rust) — kein SDK und kein Sidecar erforderlich. Traces und Request-Metriken fließen dann über den clusterinternen Collector zu OneUptime.

**Anforderungen:** Linux-Kernel **5.8+** mit BTF (standardmäßig auf Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). Das eBPF-DaemonSet läuft im **privileged mode**, weil es das muss, um eBPF-Programme zu laden.

### eBPF-Auto-Instrumentierung deaktivieren

Sie sollten sie deaktivieren, wenn:

- Sie auf **GKE Autopilot** oder **EKS Fargate** installieren — diese Plattformen blockieren privilegierte Pods (verwenden Sie `preset=gke-autopilot` / `preset=eks-fargate` und kombinieren Sie es mit `ebpf.enabled=false`).
- Nodes einen Kernel älter als 5.8 ohne BTF-Backports ausführen.
- Sie Traces bereits über OpenTelemetry-SDKs aus Ihren Apps liefern und keine Duplikate möchten.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Einzelne Signalfamilien umschalten

Alle standardmäßig aktiviert. Schalten Sie jede mit `--set ebpf.features.<name>=false` aus:

| `ebpf.features.*` | Standard | Was es hinzufügt |
|---|---|---|
| `httpMetrics` | aktiviert | HTTP/gRPC-RED-Metriken (Request-Rate, Latenz, Fehler) pro Service |
| `spanMetrics` | aktiviert | Request-/Response-Größe und -Dauer pro Span |
| `serviceGraph` | aktiviert | Caller → Callee Edge-Metriken; speist die Service-Map |
| `hostMetrics` | aktiviert | CPU und Speicher pro instrumentiertem Prozess |
| `networkMetrics` | aktiviert | Pod-zu-Pod-TCP/UDP-Fluss-Zähler |
| `networkInterZoneMetrics` | deaktiviert | Inter-Zone-Variante der Netzwerkmetriken (verdoppelt die Kardinalität) |
| `tcpStats` | aktiviert | Node-Level-TCP-RTT-, Fehlverbindungs-, Retransmit-Zähler |

Auch die Trace-Kontext-Propagierung zwischen Services ist standardmäßig aktiviert — OBI injiziert W3C `traceparent` in ausgehenden HTTP/TCP-Verkehr, sodass ein Request, der Pod A → Pod B überquert, als ein einziger Trace erscheint, ohne SDK-Änderungen irgendwo. Schalten Sie sie mit `--set ebpf.contextPropagation=false` aus.

## Fehlerbehebung

> **Schnellster Weg — das Diagnoseskript ausführen.** Es prüft die Pod-Gesundheit, dekodiert und validiert den Ingestion-Schlüssel, kontrolliert, ob Ihr Cluster OneUptime erreichen kann, und fragt OneUptime, ob Ihr Token tatsächlich akzeptiert wird — und gibt dann eine einzige Ursachendiagnose aus:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> Es liest nur den Cluster-Zustand und führt ein paar Probes aus; es ändert nichts. Für den genauesten Egress-Test installieren Sie zunächst mit `--set debug.enabled=true` (dies fügt den Agent-Pods einen kleinen Netzwerk-Tools-Sidecar hinzu, sodass das Skript den exakten Egress-Pfad des Collectors testet), und führen Sie es dann erneut aus.

### Installation schlägt mit "hostPath volumes are not allowed" oder einem Pod-Security-Admission-Fehler fehl

Ihr Cluster blockiert `hostPath` — häufig bei **GKE Autopilot** und **EKS Fargate**. Wechseln Sie zum API-Modus-Preset:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Agent zeigt "Disconnected" an

Der Verbindungsstatus eines Clusters wird ausschließlich durch eintreffende Telemetrie bestimmt — wenn keine Daten ankommen, wird das Cluster nach ~15 Minuten als getrennt markiert. Daher haben "disconnected" und "keine Metriken" fast immer **dieselbe** Ursache: Die Telemetrie des Agents wird nicht akzeptiert.

Der häufigste Grund — besonders nach einer Neuinstallation — ist ein **falscher oder widerrufener Ingestion-Schlüssel**. Das ist leicht zu übersehen, weil die OTLP-Ingest-Endpunkte absichtlich HTTP `200` zurückgeben, selbst bei einem fehlerhaften Token (damit ein falsch konfigurierter Collector den Server nicht mit Retry-Stürmen überlasten kann). Das Ergebnis: Der Collector meldet Erfolg, seine Logs zeigen keine Fehler, und die Daten werden stillschweigend verworfen.

1. Prüfen Sie, ob die Agent-Pods laufen: `kubectl get pods -n oneuptime-agent`
2. Prüfen Sie die Metrics-Collector-Logs: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (keine Fehler hier bedeutet **nicht**, dass Daten ankommen — siehe oben)
3. **Validieren Sie den Ingestion-Schlüssel.** Fragen Sie OneUptime direkt, ob Ihr Token akzeptiert wird (`200` = gültig, `401` = unbekannt/widerrufen):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Wenn `401` zurückgegeben wird, ist der Schlüssel in Ihrem Release falsch oder wurde widerrufen. Kopieren Sie einen aktiven Schlüssel aus *Project Settings → Telemetry Ingestion Keys* und deployen Sie erneut:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Stellen Sie sicher, dass Ihre OneUptime-URL korrekt ist und Ihr Cluster sie über das Netzwerk erreichen kann.
5. Wenn Sie `clusterName` bei der Neuinstallation geändert haben, erscheint der Agent als **neues** Cluster — der alte Eintrag bleibt "Disconnected" (das ist zu erwarten; er ist veraltet).

### Keine Logs erscheinen (nur API-Modus)

1. Bestätigen Sie, dass der Log-Tailer-Pod Ready ist: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Prüfen Sie dessen `/healthz` — es meldet die Anzahl aktiver Streams und den letzten Export-Fehler
3. Prüfen Sie die Logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. Bei sehr großen Clustern kann ein einzelnes Replica zum Engpass werden — sharden Sie nach Namespace mithilfe von `namespaceFilters.include` über separate Releases

### Keine Metriken erscheinen

1. Schließen Sie zunächst einen abgelehnten Ingestion-Schlüssel aus — das ist die häufigste Ursache und von der Agent-Seite aus unsichtbar. Siehe [Agent zeigt "Disconnected" an](#agent-shows-disconnected) oben (oder führen Sie einfach das Diagnoseskript aus).
2. Prüfen Sie, ob der Cluster-Bezeichner mit dem Wert übereinstimmt, den Sie als `clusterName` übergeben haben
3. Überprüfen Sie die RBAC-Berechtigungen: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Prüfen Sie die OTel-Collector-Logs auf Export-Fehler

### eBPF-Pods sind CrashLoopBackOff oder starten nicht

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Häufige Ursachen:

- **Kernel zu alt oder BTF fehlt.** OBI benötigt Linux 5.8+ mit BTF. Führen Sie `uname -r` auf einem Node aus. Wenn Sie kein Upgrade durchführen können, deaktivieren Sie eBPF: `--set ebpf.enabled=false`.
- **Privilegierte Pods blockiert.** Einige Cluster lehnen privilegierte Pods ab (GKE Autopilot, EKS Fargate und abgeschottete Umgebungen). Deaktivieren Sie eBPF.
- **`debugfs` / `tracefs` ist auf dem Host nicht gemountet.** Das `tcpStats`-Feature hängt sich an Kernel-Tracepoints, die diese benötigen. Das Chart mountet beide über `hostPath` — wenn Ihr Host sie jedoch nicht bereitstellt, deaktivieren Sie nur diese Familie: `--set ebpf.features.tcpStats=false`.

### Keine Anwendungs-Traces erscheinen

1. Bestätigen Sie, dass das eBPF-DaemonSet gesund ist: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Aktivieren Sie den Debug-Trace-Printer, um zu bestätigen, dass OBI Verkehr erfasst: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, prüfen Sie dann `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. Wenn Sie Spans in OBIs stdout sehen, aber nicht im Dashboard, liegt das Problem beim Export Collector → OneUptime — prüfen Sie die Logs des Metrics-Collector-Pods.

## Nächste Schritte

- Konfigurieren Sie **Kubernetes-Monitore** auf Basis der Metriken, die dieser Agent erfasst — siehe [Kubernetes Agent (Monitore)](/docs/monitor/kubernetes-agent).
- Fügen Sie **Logs-Monitore** hinzu, um auf bestimmte Log-Muster zu alarmieren (z. B. Fehleranzahlen über einem Schwellenwert pro Pod oder pro Namespace).
- Für Nicht-Kubernetes-Hosts (Linux / macOS / Windows VMs und Bare Metal) verwenden Sie die Seite [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
