# Kubernetes-Agent installieren

Der OneUptime-Kubernetes-Agent erfasst Cluster-Metriken, Events, Pod-Logs, **Anwendungs-Traces (HTTP/gRPC via eBPF)**, **kontinuierliche CPU-Flame-Graphs (eBPF-Profiler)** und **OS-Level-Node-Metriken** aus Ihrem Kubernetes-Cluster und sendet diese an OneUptime. Er wird als Helm-Chart bereitgestellt und mit einem einzigen Befehl installiert — eBPF-Auto-Instrumentierung und Profiling sind beide standardmäßig aktiviert, sodass Sie ohne Codeänderungen Service-Level-Traces, RED-Metriken und Flame-Graphs sehen.

## Schnellstart

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

Ihr Cluster erscheint innerhalb weniger Minuten in OneUptime.

## Das passende Preset für Ihren Cluster auswählen

Verschiedene Kubernetes-Distributionen haben unterschiedliche Einschränkungen — insbesondere, ob Workloads `hostPath`-Volumes einbinden können. Anstatt Sie zum Lesen von Sicherheitsdokumentationen zu zwingen, stellt das Chart eine einzige Top-Level-Option bereit: `preset`.

| Preset | Verwendung für | Log-Erfassung | Hinweise |
| --- | --- | --- | --- |
| `standard` (Standardwert) | Selbst verwaltet, **EKS auf EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet liest `/var/log/pods` via hostPath | Geringster Overhead. hostPath ist auf diesen Plattformen verfügbar. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes-API-Tailer (Deployment) | hostPath ist auf Autopilot blockiert. Setzt einen gehärteten Security Context, der die Pod Security Standards von Autopilot erfüllt. |
| `eks-fargate` | **EKS Fargate** | Kubernetes-API-Tailer (Deployment) | Wie `gke-autopilot`. Fargate blockiert hostPath und DaemonSets. |

Wenn Sie sich nicht sicher sind, lassen Sie `preset` ungesetzt — Sie erhalten die `standard`-Standardwerte. Wenn Ihr Cluster die Installation mit einem Pod-Security-Policy-Fehler ablehnt, der `hostPath` erwähnt, wechseln Sie zu `gke-autopilot` (oder `eks-fargate` auf EKS Fargate) und installieren Sie erneut.

### Beispiele

**GKE Standard, EKS auf EC2, selbst verwaltet oder AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## Wie sich die beiden Log-Erfassungsmodi unterscheiden

Unter der Haube setzt `preset` den Wert von `logs.mode` — Sie können diesen auch direkt setzen, wenn Sie den Preset-Standard überschreiben möchten.

### DaemonSet-Modus (`logs.mode: daemonset`)

Ein DaemonSet betreibt einen OpenTelemetry-Collector-Pod pro Node. Es liest Log-Dateien unter `/var/log/pods/` über ein hostPath-Volume und leitet sie über OTLP weiter.

- **Vorteile:** geringster Overhead, skaliert linear mit der Anzahl der Nodes, keine Last auf dem Kubernetes-API-Server, behandelt Log-Rotation.
- **Nachteile:** erfordert hostPath, erfordert die Möglichkeit, DaemonSets zu planen — beides nicht verfügbar auf GKE Autopilot und EKS Fargate.

### API-Modus (`logs.mode: api`)

Ein Deployment mit einer einzelnen Replik (das `oneuptime/kubernetes-log-tailer`-Image) nutzt die Kubernetes-API, um Container-Logs zu streamen — derselbe Endpunkt, den `kubectl logs -f` verwendet. Kein hostPath, kein Host-Zugriff, kein DaemonSet.

- **Vorteile:** funktioniert auf GKE Autopilot, EKS Fargate und jedem Cluster, der hostPath blockiert oder den `restricted`-Pod-Security-Standard erzwingt.
- **Nachteile:** jeder Container-Stream ist eine langlebige Verbindung zu `kube-apiserver`. In der Praxis bewältigt eine Replik problemlos einige Tausend Container. Für sehr große Cluster sollten Sie nach Namespace mit `logs.api.replicas` plus `namespaceFilters.include` auf jeder Replik sharden.

### Welchen sollten Sie verwenden?

Wenn hostPath funktioniert, verwenden Sie DaemonSet. Überall sonst verwenden Sie den API-Modus. Die `preset`-Einstellung wählt den passenden für Sie aus.

Sie können die Log-Erfassung auch vollständig mit `--set logs.enabled=false` deaktivieren und Anwendungslogs stattdessen über OpenTelemetry-SDKs senden. Siehe die [OpenTelemetry](/docs/telemetry/open-telemetry)-Dokumentation.

## Anwendungs-Traces und HTTP-Anfragen via eBPF (standardmäßig aktiviert)

Das Chart enthält ein DaemonSet, das [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) auf jedem Node ausführt. OBI lädt eBPF-Programme in den Linux-Kernel und beobachtet Datenverkehr auf Socket-Ebene, um HTTP/HTTPS-, gRPC- und SQL/Redis-Aufrufe von jedem Pod auf dem Node zu rekonstruieren — ohne Codeänderungen, ohne SDK, ohne Sidecar. Der erfasste Datenverkehr wird als OTLP-Traces und Request-/Latenz-Metriken direkt an OneUptime exportiert.

Nach der Installation erscheinen Ihre Services innerhalb von ein bis zwei Minuten unter **Telemetry → Traces** und in der Service-Map, mit `k8s.cluster.name` gesetzt auf Ihren `clusterName`, sodass Sie nach Cluster filtern können.

### Wann sollte es deaktiviert werden

eBPF ist **standardmäßig aktiviert**. Sie sollten es deaktivieren (`--set ebpf.enabled=false`), wenn:

- Sie auf **GKE Autopilot** oder **EKS Fargate** installieren. Diese Plattformen blockieren privilegierte Pods, und OBI benötigt den privilegierten Modus, um eBPF-Programme zu laden.
- Ihre Nodes einen Kernel älter als **Linux 5.8** ohne BTF-Backports ausführen. (Moderne Distributionen — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — sind in Ordnung.)
- Sie bereits Traces über das OpenTelemetry-SDK aus Ihren Apps senden und keine Duplikate möchten.

### Was wird ausgegeben

OBI extrahiert mehrere Signalfamilien aus dem erfassten Datenverkehr. Alle sind standardmäßig aktiviert; jede kann unabhängig mit `--set ebpf.features.<key>=false` deaktiviert werden:

| Signal | Standardwert | Was es ergänzt |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | on | HTTP/gRPC-RED-Metriken — Request-Rate, Latenz-Histogramme, Fehlerzahlen — pro Service. |
| `ebpf.features.spanMetrics` | on | Nach Span-Attributen indizierte Metriken: Request-Größe, Response-Größe, Dauer aufgeschlüsselt nach Route/Operation. |
| `ebpf.features.serviceGraph` | on | Service-zu-Service-Edge-Metriken (Aufrufer → Aufgerufener Request-Rate + Latenz). Speist die Service-Map. |
| `ebpf.features.hostMetrics` | on | CPU und Speicher pro instrumentiertem Prozess — erspart einen separaten Profiler für grundlegende Kapazitätsfragen. |
| `ebpf.features.networkMetrics` | on | Pod-zu-Pod TCP-/UDP-Flow-Byte- und Paketzähler mit k8s-Metadaten. Macht jedes Pod-Paar sichtbar, das kommuniziert, einschließlich solcher, die Protokolle ausführen, die OBI nicht parsen kann. |
| `ebpf.features.networkInterZoneMetrics` | off | Inter-Zonen-Variante der Netzwerk-Metriken. Verdoppelt die Kardinalität; nur sinnvoll zu aktivieren, wenn Sie tatsächlich zonenbasiertes Scheduling nutzen. |
| `ebpf.features.tcpStats` | on | TCP-Statistiken auf Node-Ebene: RTT-Histogramme, Zähler fehlgeschlagener Verbindungen, Retransmits. |

OBI propagiert außerdem standardmäßig Trace-Kontext über Service-Grenzen hinweg. Wenn Pod A eine HTTP-/gRPC-Anfrage an Pod B sendet, injiziert OBI einen W3C-`traceparent`-Header in die ausgehende Anfrage — sodass der resultierende Span auf der Seite von Pod B in denselben Trace verknüpft wird wie der ausgehende Span von Pod A. Es sind keine SDK-Änderungen in einer der beiden Apps erforderlich.

| Option | Standardwert | Beschreibung |
| --- | --- | --- |
| `ebpf.contextPropagation` | on | W3C-`traceparent` in ausgehenden Datenverkehr injizieren (HTTP-Header + benutzerdefinierte TCP-Option). Auf `false` setzen, um die Spans jedes Service lokal zu halten. |
| `ebpf.trackRequestHeaders` | on | Kernel-seitiges Request-Header-Tracking, damit die Propagierung auch auf einfachen HTTP-Servern (nicht-Go, nicht-TLS) funktioniert. Wirkt nur, wenn `contextPropagation` true ist. |

### Log-↔-Trace-Korrelation

Ebenfalls standardmäßig aktiviert. Der Log-Enricher von OBI fängt Pod-stdout-Schreibvorgänge von instrumentierten Prozessen ab und:

- Bei **JSON-formatierten Logs**: injiziert er `trace_id`- und `span_id`-Felder in die Zeile (alle bereits im Log vorhandenen Werte werden bewahrt). Das filelog-DaemonSet hebt diese Felder dann auf die nativen trace_id-/span_id-Slots des LogRecord, sodass das Klicken auf einen Span in der Trace-Ansicht zu seinen Logs in OneUptime springt — und das Klicken auf eine Log-Zeile zu seinem übergeordneten Trace springt.
- Bei **Nicht-JSON-Logs**: bleibt die Zeile unverändert — wird weiterhin erfasst, jedoch nicht automatisch verknüpft.

| Option | Standardwert | Beschreibung |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | on | Aktiviert den OBI-Log-Enricher und die trace_id-Anhebung in der filelog-Pipeline. Auf `false` setzen, um beide zu überspringen. |

Einschränkungen:

- **Logs müssen JSON sein, damit trace_id erscheint.** Stellen Sie Ihren Logger auf einen JSON-Formatter um — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json` usw.
- **Gepufferte stdout-Ausgabe unterbricht die Korrelation**, da der `write()`-Syscall in einem anderen Thread ausgelöst wird als demjenigen, der die Anfrage behandelt hat. Häufige Lösungen:
  - **Python**: setzen Sie `PYTHONUNBUFFERED=1` (die Laufzeit puffert stdout blockweise, wenn es kein TTY ist).
  - **.NET**: beim Startup `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. Microsoft.Extensions.Logging `AddConsole()` und die asynchronen Sinks von Serilog funktionieren ebenfalls nicht — wechseln Sie zu einem synchronen Console-Writer (der Standard `WriteTo.Console()` von Serilog ist in Ordnung).
- Greenlet/gevent, Tornado und andere benutzerdefinierte asynchrone Laufzeitumgebungen werden nicht abgedeckt.

### Tuning

| Option | Standardwert | Beschreibung |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Hauptschalter. Auf `false` setzen, um das eBPF-DaemonSet vollständig zu überspringen. |
| `ebpf.image.tag` | `v0.9.0` | OBI-Image-Tag. OBI ist vor 1.0; pinnen Sie auf eine bekannt funktionierende Version und testen Sie bei Upgrades erneut. |
| `ebpf.autoTargetExe` | `*` | Glob der zu instrumentierenden ausführbaren Dateien. Schränken Sie dies ein (z. B. `*/python,*/java`), wenn Sie die Auto-Instrumentierung eingrenzen möchten. |
| `ebpf.excludeExePaths` | (Shells, kubelet, runc, containerd, otelcol, OBI selbst) | Komma-getrennte Globs zum Überspringen. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn` oder `error`. Beim Troubleshooting auf `debug` setzen. |
| `ebpf.printTraces` | `false` | Spans zusätzlich zum OTLP-Export auf OBIs stdout ausgeben — nützlich, um die Erfassung während der Installation zu verifizieren. |
| `ebpf.resources.*` | `100m / 256Mi` Requests, `1000m / 1Gi` Limits | Erhöhen Sie diese Werte für Cluster mit hohem Datenverkehr. |

Um zu prüfen, ob OBI läuft und Datenverkehr sieht:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Kontinuierliches CPU-Profiling (standardmäßig aktiviert)

Ein separates DaemonSet führt den [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) aus — verpackt als `otel/opentelemetry-collector-ebpf-profiler`-Image. Es nimmt On-CPU-Stack-Samples mit 19 Hz über jede unterstützte Laufzeitumgebung (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) und sendet OTLP-Profile an OneUptime, wo sie unter **Telemetry → Performance Profiles** und als Flame-Graphs erscheinen, die von einzelnen Trace-Spans verlinkt sind.

Wenn die eBPF-Auto-Instrumentierung ebenfalls aktiviert ist (`ebpf.enabled: true`, der Standardwert), wird jedes CPU-Sample über eine gemeinsame bpffs-Map mit dem Trace-Kontext von OBI korreliert — sodass Flame-Graphs trace_id/span_id tragen und die OneUptime-Oberfläche Ihnen einen Flame-Graph pro Span anzeigen kann.

Voraussetzungen:

- **Linux-Kernel 5.10+** (etwas neuer als die 5.8, die OBI benötigt).
- Privilegierter Pod mit hostPID — die gleichen Einschränkungen wie beim eBPF-Auto-Instrumentierungs-DaemonSet. Deaktivieren Sie es auf GKE Autopilot, EKS Fargate und in abgesicherten Umgebungen: `--set profiling.enabled=false`.

Tuning:

| Option | Standardwert | Beschreibung |
| --- | --- | --- |
| `profiling.enabled` | `true` | Hauptschalter. |
| `profiling.image.tag` | `0.152.0` | `otel/opentelemetry-collector-ebpf-profiler`-Image-Tag. Der Profiler ist vor 1.0; pinnen Sie auf eine bekannt funktionierende Version. |
| `profiling.samplesPerSecond` | `19` | Sampling-Frequenz in Hz. Upstream-Standard; vermeidet versehentliches Aliasing mit gängigen Timer-Frequenzen. |
| `profiling.offCpuThreshold` | `0` | (0–1] aktiviert Off-CPU-Profiling — diagnostiziert Lock-Contention und blockierendes I/O. Standardmäßig deaktiviert, weil es Tracepoint-Overhead hinzufügt. |
| `profiling.tracers` | `""` *(alle Laufzeitumgebungen)* | Komma-getrennte Liste der zu ladenden Sprach-Tracer. |
| `profiling.obiProcessContext` | `true` | Korreliert Samples mit dem Trace-Kontext von OBI für Trace-↔-Profile-Verknüpfung. |

## Weitere Datenerfassung (Host-Metriken, Audit-Logs, CSI, CoreDNS)

Das Chart kann außerdem erfassen:

| `<key>.enabled` | Standardwert | Was es ergänzt |
| --- | --- | --- |
| `hostMetrics` | on | OS-Metriken pro Node aus `/proc` und `/sys` — Disk-I/O-Queue-Tiefe, Dateisystem-Inode-Nutzung, NIC-Fehlerzähler, Paging-Statistiken, Load Average. Befindet sich innerhalb des Log-Collector-DaemonSets (keine zusätzlichen Pods). |
| `auditLogs` | off | Liest `/var/log/kubernetes/audit.log` vom Host. Erfasst jede Kubernetes-API-Anfrage — wer hat was mit welcher Ressource gemacht. Nur für selbst verwaltete Cluster — managed K8s (EKS, GKE, AKS, DOKS) leitet Audit-Logs an den Sink des Cloud-Anbieters weiter. |
| `csi` | off | Erkennt automatisch Pods mit dem Label `app=csi-driver` (oder `app.kubernetes.io/component=csi-driver`) und scraped deren Prometheus-`metrics`-Port — Volume-Attach-/Detach-Latenz, Provisioning-Fehler, IOPS. |
| `coreDns` | off | Scraped den Cluster-CoreDNS-Service auf `:9153/metrics`. Macht Query-Rate, Latenz, Cache-Trefferquote, Fehlerzahlen sichtbar — häufige Verursacher hoher P99-Latenz. |

## Häufige Optionen

| Option | Standardwert | Beschreibung |
| --- | --- | --- |
| `preset` | (leer — wird als `standard` behandelt) | Siehe die obige Tabelle. |
| `oneuptime.url` | *(erforderlich)* | URL Ihrer OneUptime-Instanz. |
| `oneuptime.apiKey` | *(erforderlich)* | Projekt-API-Schlüssel (Einstellungen → API-Schlüssel). |
| `clusterName` | *(erforderlich)* | Eindeutiger Name für diesen Cluster. Wird als `k8s.cluster.name` auf jedem Datensatz vermerkt. |
| `namespaceFilters.include` | `[]` | Wenn gesetzt, werden nur diese Namespaces überwacht. |
| `namespaceFilters.exclude` | `["kube-system"]` | Zu überspringende Namespaces. |
| `logs.enabled` | `true` | Log-Erfassung ein- oder ausschalten. |
| `logs.mode` | (abgeleitet von `preset`) | `daemonset`, `api` oder `disabled`. Überschreibt das Preset. |
| `logs.api.replicas` | `1` | Anzahl der Log-Tailer-Deployment-Repliken (nur im API-Modus). |
| `ebpf.enabled` | `true` | Automatische Erfassung von HTTP-/gRPC-Traces von jedem Pod via OpenTelemetry eBPF Instrumentation. Siehe Abschnitt oben. |
| `profiling.enabled` | `true` | Kontinuierliche CPU-Flame-Graphs via OpenTelemetry eBPF Profiler. Siehe Abschnitt oben. |
| `hostMetrics.enabled` | `true` | OS-Metriken pro Node. |
| `auditLogs.enabled` | `false` | Kubernetes-Audit-Log-Erfassung (selbst verwaltete Cluster). |
| `csi.enabled` | `false` | CSI-Treiber-Prometheus-Metriken. |
| `coreDns.enabled` | `false` | CoreDNS-Prometheus-Metriken. |
| `controlPlane.enabled` | `false` | Scraped etcd / api-server / scheduler / controller-manager. Nur für selbst verwaltete Cluster — managed Angebote (EKS/GKE/AKS) stellen diese Endpunkte üblicherweise nicht bereit. |

Siehe die [`values.yaml` des Charts](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) für die vollständige Liste.

## Upgrade

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` behält Ihre bestehende Konfiguration; übergeben Sie alle neuen `--set`-Overrides zusätzlich.

> **Achtung: `--reuse-values` merged keine neuen Standardwerte aus dem Chart.** Helm verwendet Ihre zuvor gerenderten Werte wortgetreu wieder — daher bleibt jedes neue Top-Level-Feld, das in einer neueren Chart-Version hinzugefügt wird (z. B. `profiling.*`, `ebpf.features.*`), in Ihrem bestehenden Release ungesetzt, und das Template wird gerendert, als hätten Sie es deaktiviert.
>
> **Helm 3.14+** — wechseln Sie zu `--reset-then-reuse-values`. Es liest die Chart-Standardwerte für Keys neu ein, die Sie nicht überschrieben haben:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 oder älter** — lassen Sie `--reuse-values` weg und übergeben Sie Ihre ursprünglichen `--set`-Flags (oder `-f values.yaml`) explizit. Neue Chart-Standardwerte gelten für alles, was Sie nicht überschreiben.
>
> Wenn die Pods eines neuen Features (z. B. `kubernetes-agent-profiling-*`) nach dem Upgrade nicht erscheinen, liegt das fast immer daran. `helm get values <release>` zeigt, was Helm tatsächlich hat — Felder, die in der Ausgabe fehlen, bedeuten, dass die Standardwerte für sie nicht gemerged wurden.

## Deinstallation

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Troubleshooting

### Die Installation schlägt mit "hostPath volumes are not allowed" fehl

Ihr Cluster blockiert hostPath. Wechseln Sie zu einem Preset im API-Modus:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Keine Logs erscheinen in OneUptime

Überprüfen Sie die Agent-Pods:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

Im API-Modus stellt der Log-Tailer-Pod `/healthz` auf Port 13133 bereit — rufen Sie ihn via `kubectl port-forward` für einen Schnappschuss des Export-Status auf.

### Der eBPF-DaemonSet-Pod ist in `CrashLoopBackOff` oder startet nicht

Überprüfen Sie die Logs des OBI-Pods:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Häufige Ursachen:

- **Kernel zu alt oder BTF fehlt.** OBI benötigt Linux 5.8+ mit BTF. Prüfen Sie es mit `uname -r` auf einem Node. Wenn Sie nicht upgraden können, deaktivieren Sie eBPF: `--set ebpf.enabled=false`.
- **Privilegierte Pods sind blockiert.** Einige Cluster lehnen privilegierte Pods auch außerhalb von Autopilot/Fargate ab. Deaktivieren Sie eBPF.
- **Keine Traces im Dashboard, aber OBI läuft.** Setzen Sie `--set ebpf.printTraces=true` und überprüfen Sie OBIs stdout — wenn Sie dort Spans sehen, liegt das Problem bei der OTLP-Zustellung (prüfen Sie `OTEL_EXPORTER_OTLP_ENDPOINT` und Ihre OneUptime-URL/API-Schlüssel). Wenn Sie keine Spans sehen, ist der von OBI beobachtete Datenverkehr möglicherweise vollständig durch eine TLS-Bibliothek verschlüsselt, die OBI nicht abfangen kann (z. B. eine statisch gelinkte TLS-Implementierung, die es nicht erkennt).

### Mein Cluster hat zu viele Pods für eine Log-Tailer-Replik (nur API-Modus)

Skalieren Sie horizontal durch Sharding von Namespaces. Deployen Sie einmal pro Namespace-Gruppe:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativ können Sie `logs.api.replicas` erhöhen — beachten Sie jedoch, dass jede Replik alle zugelassenen Namespaces verarbeitet, sodass Sie für Deduplizierung weiterhin Namespace-Sharding benötigen.
