# OneUptime Kubernetes Agent (Helm)

## Überblick

Der OneUptime Kubernetes Agent ist ein vorgefertigtes Helm-Chart, das eine OpenTelemetry-basierte Collector-Pipeline auf Ihrem Cluster installiert. Er liefert Node-, Pod-, Container- und Cluster-Metriken; Kubernetes-Events; Pod-Logs; und — mit standardmäßig aktiviertem eBPF — Anwendungs-Traces, HTTP-RED-Metriken, Service-Graph-Daten sowie Pod-zu-Pod-Netzwerkfluss-Metriken. Keine Codeänderungen, keine SDKs, ein einziges `helm install`.

Diese Seite ist die **Installationsanleitung**. Für die Konfiguration von Kubernetes-Monitoren und Alarmen auf Basis der vom Agent erfassten Daten siehe [Kubernetes Agent (Monitore)](/docs/monitor/kubernetes-agent).

## Voraussetzungen

- Ein laufendes Kubernetes-Cluster (v1.23+)
- `kubectl`, konfiguriert für den Zugriff auf Ihr Cluster
- `helm` v3 installiert
- Ein **OneUptime-API-Schlüssel** — erstellen Sie einen unter _Project Settings → API Keys_

## Schritt 1 — Das OneUptime Helm-Repository hinzufügen

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Schritt 2 — Ein Preset für Ihr Cluster auswählen

Das Chart stellt eine einzige Top-Level-Option bereit — `preset` —, die kompatible Standardwerte für Ihre Kubernetes-Distribution auswählt. Sie steuert Dinge, die Sie andernfalls von Hand anpassen müssten: ob Logs über ein hostPath-DaemonSet oder über die Kubernetes-API geliefert werden und welcher Security Context angewendet wird.

| `preset`                | Verwenden für                                                                            | Log-Erfassung                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `standard` _(Standard)_ | Selbstverwaltete Cluster, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet, das `/var/log/pods` über hostPath liest (geringster Overhead) |
| `gke-autopilot`         | **GKE Autopilot**                                                                        | Kubernetes-API-Log-Tailer-Deployment (kein hostPath, kein Host-Zugriff)  |
| `eks-fargate`           | **EKS Fargate**                                                                          | Kubernetes-API-Log-Tailer-Deployment (kein hostPath, kein Host-Zugriff)  |

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

Auf einem **Standard**-Cluster sehen Sie ein Cluster-Collector-Deployment sowie einen Node-Collector-DaemonSet-Pod pro Node:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

Auf **GKE Autopilot** läuft der Node-Collector weiterhin — er erfasst kubelet- und cAdvisor-Metriken, ohne hostPath zu benötigen — und ein zusätzliches Deployment liest Pod-Logs über die Kubernetes-API:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

Auf **EKS Fargate** sehen Sie zwei Deployments und kein DaemonSet — Fargate gibt jedem Pod seine eigene Mikro-VM und plant niemals DaemonSets ein, sodass Node-Level-Metriken dort nicht verfügbar sind:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Sobald sich der Agent verbindet, erscheint Ihr Cluster automatisch im Abschnitt **Kubernetes** des OneUptime-Dashboards.

## Konfigurationsoptionen

### Namespace-Filterung

`namespaceFilters` beschränkt **Pod-Logs** (sowohl das hostPath-DaemonSet als auch den API-Log-Tailer) und **eBPF-Traces** auf die von Ihnen gewählten Namespaces. Standardmäßig wird `kube-system` ausgeschlossen. Um diese Signale auf bestimmte Namespaces zu beschränken:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

Um einen einzelnen störenden Namespace zu ignorieren und alle anderen zu behalten, verwenden Sie stattdessen `exclude`. `exclude` setzt sich immer gegenüber `include` durch, und der ausgelieferte Standardwert ist `[kube-system]` — führen Sie ihn also erneut auf, wenn er weiterhin ausgeschlossen bleiben soll:

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

Für **Pod-Logs und eBPF-Traces kostet das nichts**: Der Namespace ist Teil des Pod-Log-Pfads und der Prozesserkennung von OBI, sodass ein gefilterter Namespace gar nicht erst gelesen wird — keine CPU, kein Egress.

#### Namespace-Filter auf Metriken und Traces anwenden

Standardmäßig decken die obigen Listen nur Pod-Logs und eBPF-Traces ab. `applyTo` erweitert sie auf andere Signale:

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| Einstellung | Was es abdeckt |
| ----------- | -------------- |
| `applyTo.metrics` | Per-Pod- / Per-Container-Metriken aus kubeletstats, cAdvisor und kube-state-metrics |
| `applyTo.traces` | Spans, die Ihre Anwendungen an den OTLP-Endpunkt des Agents senden (eBPF-Spans sind bereits eingegrenzt) |

Beide sind absichtlich **standardmäßig deaktiviert**. `exclude: [kube-system]` wird als Standardwert ausgeliefert, sodass ein automatisches Einschalten bei jeder bestehenden Installation beim Upgrade stillschweigend die kube-system-Metriken löschen würde.

> **Node- und Cluster-Level-Metriken werden immer behalten.** Ein Namespace ist eine Eigenschaft eines Pods, nicht eines Nodes, sodass Serien wie Node-CPU, Node-Speicher und Dateisystemnutzung nichts haben, worauf ein Filter zutreffen könnte, und niemals verworfen werden. `applyTo.metrics` reduziert die Per-Pod-Kardinalität, ohne Sie jemals blind für einen ausfallenden Node zu machen.

Kubernetes-**Events** sind am Agent nicht nach Namespace filterbar. Sie treffen vom `k8sobjects`-Receiver ohne ein `k8s.namespace.name`-Attribut ein — der Namespace steckt im Event-Body —, sodass es für einen Filter nichts gibt, worauf er zutreffen könnte. Verwerfen Sie diese stattdessen serverseitig (siehe unten).

### Filterung nach Log-Schweregrad

`filters.logs.minSeverity` verwirft **Pod-Log**-Datensätze unterhalb eines Schweregrads, am Agent, bevor irgendetwas gesendet wird:

```bash
  --set filters.logs.minSeverity=WARN
```

Akzeptiert `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. `WARN` behält WARN, ERROR und FATAL und verwirft INFO, DEBUG und TRACE. Der Standardwert (`""`) behält alles. Es gilt in **beiden** Log-Modi — im `daemonset`-Modus über den Collector, im `api`-Modus im Log-Tailer selbst —, sodass die Presets es nicht hinter Ihrem Rücken abschalten können.

Container-Laufzeitumgebungen halten keinen Schweregrad an der Log-Zeile fest, daher parst der Agent selbst einen aus dem Log-Text heraus (`[ERROR]`, `WARN:`, `level=info`, …).

> **Kubernetes-Events und Ressourcen-Spezifikationen werden hiervon niemals gefiltert.** Sie treffen von der Kubernetes-API ohne eigenen Schweregrad ein, sodass ein Schwellenwert den gesamten Feed löschen statt ihn ausdünnen würde — einschließlich der `FailedScheduling`-, `BackOff`- und `OOMKilling`-Warnungen, die Sie am dringendsten brauchen. Sie sind volumenarm und von hohem Wert, daher liefert der Agent sie immer aus. Um sie auszudünnen, verwenden Sie stattdessen die serverseitigen **Logs → Settings → Drop Filters** im Dashboard.

**Was mit einer Zeile ohne erkennbaren Level geschieht, hängt vom Log-Modus ab**, denn den beiden Modi stehen unterschiedliche Informationen zur Verfügung:

| Modus | Zeile ohne Kennzeichnung | Warum |
| ----- | ------------------------ | ----- |
| `daemonset` | `stderr` → wird als ERROR behandelt (behalten), `stdout` → wird als INFO behandelt (von einem WARN-Schwellenwert verworfen) | Die Container-Laufzeitumgebung hält fest, aus welchem Stream jede Zeile stammt. |
| `api` | Wird immer **behalten** | Die Kubernetes-`pods/log`-API führt stdout und stderr zu einem einzigen Stream ohne Markierung pro Zeile zusammen. Statt zu raten, behält der Agent die Zeile. |

> Der `api`-Modus verwirft also strikt weniger als der `daemonset`-Modus. Das ist Absicht: Ein Python-Traceback oder ein `npm ERR!` trägt kein Schweregrad-Schlüsselwort, und es stillschweigend zu löschen ist genau das Versagen, vor dem ein Schweregrad-Schwellenwert Sie schützen soll.

Mehrzeilige Events werden in beiden Modi **vor** der Filterung wieder zusammengefügt, sodass ein Java-Stacktrace anhand seiner ersten Zeile beurteilt und als Ganzes behalten oder verworfen wird — Sie erhalten niemals eine nackte `ERROR`-Zeile, der die Frames abgeschnitten wurden.

### Metriken nach Namen ein- oder ausschließen

`filters.metrics` steuert, welche Metriken das Cluster verlassen — über jeden Receiver in der Pipeline hinweg.

**Einige störende Metriken verwerfen** (eine Denylist — meist das, was Sie möchten):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**Nur einen festen Satz senden** (eine Allowlist — alles andere wird verworfen):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.utilization","k8s.pod.memory.usage"]'
```

**Nach Muster abgleichen** statt nach exaktem Namen:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Schlüssel | Bedeutung |
| --------- | --------- |
| `filters.metrics.exclude` | Metriknamen, die verworfen werden sollen. Wird zusätzlich zu `include` angewendet, sodass exclude sich immer durchsetzt. |
| `filters.metrics.include` | Wenn nicht leer, werden **nur** diese gesendet. |
| `filters.metrics.matchType` | `strict` (exakter Name, der Standard) oder `regexp` (RE2, **nicht verankert**). |

Hinweise, die Ihnen einen Incident ersparen:

- `regexp` ist **nicht verankert** — `system.cpu` trifft auch auf `system.cpu.time` zu. Verankern Sie es (`^system\.cpu$`), wenn Sie genau eine Metrik meinen.
- RE2 hat **kein Lookahead**, daher lässt sich `^(?!container_)` nicht kompilieren. Drücken Sie "alles außer" mit `include` aus, nicht mit einer negativen Regex.
- `include` erstreckt sich auf alle Receiver gleichzeitig. Eine Allowlist, die eine Metrik vergisst, entfernt stillschweigend die darauf aufgebauten Monitore. Bevorzugen Sie `exclude`, sofern Sie nicht wirklich einen geschlossenen Satz möchten.
- Verwenden Sie `--set-json` (oder eine Values-Datei) für Listen. Ein einfaches `--set` ersetzt eine Liste, statt sie zusammenzuführen.

> **Testen Sie eine Regex, bevor Sie sie ausrollen.** Muster werden vom Collector beim Start kompiliert, nicht pro Datensatz, sodass sich ein ungültiges Muster nicht stillschweigend danebenbenimmt — der Collector verweigert den Start und geht in CrashLoopBackOff, wodurch neben den Metriken auch die **Logs** dieses Collectors ausfallen. Helm kann RE2 nicht kompilieren, sodass `helm upgrade` ein fehlerhaftes Muster kommentarlos akzeptiert.

### Trace-Sampling

Jede andere Stellschraube auf dieser Seite entfernt eine **Kategorie** von Telemetrie — einen Namespace, einen Schweregrad, einen Metriknamen. Sampling ist anders: Es behält jede Kategorie und dünnt stattdessen die Grundgesamtheit aus. Setzen Sie `sampling.traces.percentage` auf den Anteil der Traces, den Sie behalten möchten:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Das behält einen von zehn Traces und verwirft die anderen neun am Agent, bevor sie Ihr Cluster verlassen.

**Sie erhalten vollständige Traces, keine Fragmente.** Die Entscheidung ist ein Hash der Trace-ID und kein Münzwurf pro Span, sodass jeder Span eines Traces gemeinsam behalten oder verworfen wird — die Traces, die überleben, sind vollständig und von Anfang bis Ende lesbar. Das ist die Eigenschaft, die Sampling gefahrlos aktivierbar macht.

**Ihre metrikbasierten Monitore bewegen sich nicht.** Die eBPF-RED-Metriken — Request-Rate, Fehlerrate, Dauer — sind eine *Metrik*-Familie. OBI berechnet sie aus jedem Request, und sie durchlaufen die Metrik-Pipeline, in der der Sampler nicht sitzt. Bei `percentage: 10` erhalten Sie ein Zehntel der Traces und zu 100 % genaue Raten-, Fehler- und Latenzwerte. Dashboards und Monitore, die auf diesen Metriken aufbauen, sind nicht betroffen.

**Ihre span-basierten Monitore schon.** Alles, was OneUptime aus den Spans selbst ableitet, skaliert mit der Rate herunter — siehe die Warnung weiter unten, bevor Sie dies aktivieren.

| Schlüssel | Bedeutung |
| --------- | --------- |
| `sampling.traces.percentage` | Prozentsatz der Traces, die **behalten** werden sollen, 0-100. Standardwert `100` (alles behalten). |
| `sampling.traces.hashSeed` | Seed für den Trace-ID-Hash. Standardwert `22`. |

Hinweise, die Ihnen einen Incident ersparen:

- **`0` behält überhaupt keine Traces.** Es ist eine Rate, kein Ausschalter — es löscht jeden Trace, während das eBPF-DaemonSet weiterläuft und Sie Geld kostet. Wenn Sie keine Traces möchten, verwenden Sie `ebpf.enabled=false`. Wenn Sie keine Traces möchten, aber RED-Metriken und die Service-Map *sehr wohl* wollen, lassen Sie eBPF an und setzen Sie dies bewusst auf `0`.
- **Gilt nur, wenn `ebpf.enabled`.** Die Traces-Pipeline existiert sonst nicht, sodass dieser Wert bei `ebpf.enabled=false` nichts bewirkt.
- **Nur Traces.** Es gibt kein `sampling.logs` und kein `sampling.metrics`, und das ist Absicht — siehe den Hinweis unten.
- **Brüche benötigen `--set-json`, und sie haben eine Untergrenze.** `--set sampling.traces.percentage=0.5` schlägt fehl, weil Helm `0.5` als String liest. Verwenden Sie `--set-json 'sampling.traces.percentage=0.5'` oder eine Values-Datei. Ganze Zahlen funktionieren mit `--set` problemlos. Unterhalb von etwa `0.0061` quantisiert die Rate auf null und verhält sich exakt wie `0` — jeder Trace wird verworfen, ohne Fehlermeldung. `0.01` (einer von zehntausend) ist der kleinste Wert, der tut, was er verspricht.
- **Multi-Cluster funktioniert standardmäßig.** Zwei Agents behalten denselben Trace nur dann, wenn sie sich sowohl bei `hashSeed` als auch bei `percentage` einig sind. Beide haben überall denselben Standardwert, sodass ein Trace, der zwei Cluster überquert, ohne zusätzliche Konfiguration vollständig überlebt. Ändern Sie `hashSeed` nur, um zwei Sampling-Stufen bewusst zu *entkoppeln* — weil die Entscheidung ein Schwellenwert auf demselben Hash ist, verschachtelt sich derselbe Seed bei unterschiedlichen Raten, sodass eine zweite Stufe lediglich die Traces erneut auswählt, die die erste bereits behalten hat, statt unabhängig zu ziehen.
- **Pod-Logs werden niemals gesampelt**, sodass mit `ebpf.logToTraceCorrelation: true` jeder Log-Datensatz weiterhin eine Trace-ID trägt, während nur `percentage` % dieser Traces behalten werden. Ungefähr (100 − `percentage`) % der Log-Datensätze zeigen damit einen Trace-Link, der ins Leere führt. Die Navigation Trace → Logs ist davon nicht betroffen; nur Logs → Trace kann danebengehen.

> **Justieren Sie Ihre span-basierten Monitore neu, wenn Sie dies setzen.** Sampling reduziert die Spans, die OneUptime erreichen, sodass alles, was sie zählt, weniger zählt: Ein **Traces**-Monitor auf `Span Count` und ein **Exceptions**-Monitor auf `Exception Count` sehen ungefähr `percentage` % des gestrigen Volumens. Ein Schwellenwert, der auf ungesampeltem Verkehr eingestellt wurde, wird stillschweigend nicht mehr überschritten — der Monitor meldet keinen Fehler, er verstummt einfach. Teilen Sie diese Schwellenwerte durch denselben Faktor, wenn Sie die Rate setzen; die Rate gilt clusterweit, es gibt also keine Möglichkeit, einen einzelnen Service davon auszunehmen. Die Fehler-**Gruppierung** verschlechtert sich schlechter als linear: Eine häufige Exception taucht weiterhin auf, aber ein seltener Einzelfall verschwindet eher ganz, als dass er ein Zehntel so oft erscheint.

> **Warum es hier kein Log- oder Metrik-Sampling gibt.** Der Sampler des Collectors kann Metriken überhaupt nicht samplen. Logs kann er samplen, aber er bezieht seine Zufälligkeit aus der Trace-ID — und Pod-Logs haben keine. Jeder Datensatz ohne Trace-ID hasht dann in denselben Bucket, sodass eine Log-Rate den Feed nicht ausdünnen würde: Sie würde ihn je nach Seed vollständig behalten oder vollständig löschen. Statt eine Stellschraube auszuliefern, die stillschweigend Ihre Logs löscht, bietet das Chart keine an. Dünnen Sie Logs mit [Filterung nach Log-Schweregrad](#filterung-nach-log-schweregrad) und [Namespace-Filterung](#namespace-filterung) aus, die präzise darin sind, was sie entfernen.

### Log-Erfassung deaktivieren

Wenn Sie keine Pod-Logs benötigen:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

Ihre Metriken sind davon nicht betroffen: Der Node-Collector läuft weiter für kubelet-, cAdvisor- und Host-Metriken, er hört lediglich auf, Pod-Logs zu lesen. Log-basierte Alarme stoppen, sonst nichts.

### Einen bestimmten Log-Erfassungsmodus erzwingen

Fortgeschrittene Benutzer können die Auswahl des Presets mit `logs.mode` überschreiben:

- `logs.mode=daemonset` — hostPath-DaemonSet (geringster Overhead, erfordert hostPath)
- `logs.mode=api` — Kubernetes-API-Log-Tailer-Deployment (funktioniert auf jedem Cluster)
- `logs.mode=disabled` — keine Log-Erfassung

> Der Log-Modus entscheidet nur darüber, woher die **Pod-Logs** kommen. Node-Metriken werden unabhängig davon erfasst, sodass `api` und `disabled` Ihre kubelet-, cAdvisor- und Host-Metriken behalten.
>
> Die einzige Ausnahme ist die Plattform, nicht der Modus: **EKS Fargate kann überhaupt keine DaemonSets einplanen**, sodass es dort keinen Node-Collector gibt und Node-, Pod- und Container-Metriken nicht verfügbar sind. GKE Autopilot führt den Node-Collector problemlos aus, blockiert aber `hostPath`, sodass es kubelet- und cAdvisor-Metriken ohne die `hostmetrics`-Metriken (Disk-I/O, Inodes, NIC-Fehler) erfasst, die den Zugriff auf `/proc` und `/sys` des Hosts benötigen.

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

| Kategorie                                                    | Daten                                                                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node-Metriken**                                            | CPU-Auslastung, Speichernutzung, Dateisystemnutzung, Netzwerk-I/O                                                                            |
| **Pod-Metriken**                                             | CPU-Nutzung, Speichernutzung, Netzwerk-I/O, Neustarts                                                                                        |
| **Container-Metriken**                                       | CPU-Nutzung, Speichernutzung pro Container                                                                                                   |
| **Cluster-Metriken**                                         | Node-Bedingungen, zuteilbare Ressourcen, Pod-Anzahlen                                                                                        |
| **Kubernetes-Events**                                        | Warnungen, Fehler, Scheduling-Events                                                                                                         |
| **Pod-Logs**                                                 | stdout/stderr-Logs aus allen Containern (über hostPath-DaemonSet auf Standard-Clustern oder über die Kubernetes-API auf Autopilot / Fargate) |
| **Anwendungs-Traces** _(über eBPF, standardmäßig aktiviert)_ | HTTP-, gRPC-, SQL/Redis-Spans aus jedem Pod — kein SDK und keine Codeänderungen                                                              |
| **HTTP-RED-Metriken** _(über eBPF)_                          | `http.server.request.duration`, Request- und Response-Body-Größen, pro Service                                                               |
| **Service Graph** _(über eBPF)_                              | Caller → Callee Request-Rate, Latenz und Fehler-Edges — speist die Service-Map-Ansicht                                                       |
| **Netzwerkfluss-Metriken** _(über eBPF)_                     | Pod-zu-Pod-TCP/UDP-Byte- und -Paketzähler mit k8s-Metadaten                                                                                  |
| **TCP-Statistiken** _(über eBPF)_                            | Node-Level-RTT-, Fehlverbindungs- und Retransmit-Zähler                                                                                      |

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

| `ebpf.features.*`         | Standard    | Was es hinzufügt                                                       |
| ------------------------- | ----------- | ---------------------------------------------------------------------- |
| `httpMetrics`             | aktiviert   | HTTP/gRPC-RED-Metriken (Request-Rate, Latenz, Fehler) pro Service      |
| `spanMetrics`             | aktiviert   | Request-/Response-Größe und -Dauer pro Span                            |
| `serviceGraph`            | aktiviert   | Caller → Callee Edge-Metriken; speist die Service-Map                  |
| `hostMetrics`             | aktiviert   | CPU und Speicher pro instrumentiertem Prozess                          |
| `networkMetrics`          | aktiviert   | Pod-zu-Pod-TCP/UDP-Fluss-Zähler                                        |
| `networkInterZoneMetrics` | deaktiviert | Inter-Zone-Variante der Netzwerkmetriken (verdoppelt die Kardinalität) |
| `tcpStats`                | aktiviert   | Node-Level-TCP-RTT-, Fehlverbindungs-, Retransmit-Zähler               |

Auch die Trace-Kontext-Propagierung zwischen Services ist standardmäßig aktiviert — OBI injiziert W3C `traceparent` in ausgehenden HTTP/TCP-Verkehr, sodass ein Request, der Pod A → Pod B überquert, als ein einziger Trace erscheint, ohne SDK-Änderungen irgendwo. Schalten Sie sie mit `--set ebpf.contextPropagation=false` aus.

## Das erfasste Datenvolumen reduzieren

Standardmäßig ist der Agent auf **Abdeckung** ausgelegt — er liefert Metriken, Pod-Logs und eBPF-Traces aus dem gesamten Cluster, sodass jedes Dashboard und jeder Monitor vom ersten Tag an funktioniert. Auf großen oder ausgelasteten Clustern kann das mehr Telemetrie sein, als Sie benötigen, was sich als höheres Ingest-Volumen niederschlägt (und, auf OneUptime Cloud, als höhere Kosten). Nichts davon ist erforderlich, aber wenn ein Cluster mehr sendet, als Sie möchten, sind dies die Stellschrauben, an denen Sie drehen können — ungefähr in der Reihenfolge ihrer Auswirkung.

Der Trick besteht darin, **das zu erfassen aufzuhören, was Sie sich nicht ansehen werden**, statt alles zu erfassen und für die Speicherung zu bezahlen. Jeder Hebel unten ist ein Helm-Wert, sodass Sie ihn mit `--set` bei `helm upgrade --reuse-values` anwenden und auf dieselbe Weise zurücksetzen können.

### Woher das Volumen kommt

| Signal                          | Größter Treiber                                           | Herunterregeln mit                                                                           |
| ------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pod-Logs**                    | Jede Zeile aus jedem Container, clusterweit               | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **eBPF-Traces & Span-Metriken** | Ein Trace pro Request von jedem instrumentierten Prozess  | `sampling.traces.percentage`, `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths` |
| **Metrik-Datenpunkte**          | Scrape-Frequenz × Anzahl der Pods/Container               | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Metrik-Kardinalität**         | Anzahl der eindeutigen Serien (pro Container, pro PVC, …) | `filters.metrics.exclude`, `namespaceFilters.applyTo.metrics`, `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Opt-in-Extras**               | Profiling, Audit-Logs, Control Plane, Inter-Zone-Metriken | Lassen Sie sie aus (das sind sie standardmäßig bereits)                                      |

Es gibt drei Wege, das Volumen zu senken, und es lohnt sich zu wissen, welchen Sie gerade verwenden:

- **Am Receiver** — die Daten werden nie erfasst. `namespaceFilters` bei Pod-Logs, `cadvisor.metricsAllowlist`, ein längeres `collectionInterval`. Das kostet im Betrieb nichts und spart CPU, Egress und Ingest zugleich. Bevorzugen Sie diese immer dort, wo sie Ihren Fall abdecken.
- **Am Filter-Processor** — die Daten werden erfasst und dann vor dem Export verworfen. `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.applyTo.*`. Etwas mehr Collector-CPU, dafür wirkt es über Receiver hinweg und kann Dinge ausdrücken, die ein Receiver nicht kann.
- **Am Sampler** — die Daten werden erfasst, und dann wird ein repräsentativer Anteil behalten. `sampling.traces.percentage`. Der Sonderfall: Die beiden oben entfernen eine ganze *Kategorie* von Telemetrie, sodass alles, was sie verwerfen, aus jedem Trace verschwunden ist. Sampling behält jede Kategorie und dünnt die Grundgesamtheit aus, sodass das, was überlebt, weiterhin vollständig und repräsentativ ist.

Alle drei sind **unumkehrbar**: Was Sie hier verwerfen, erreicht OneUptime nie, und alle drei können einen Monitor verstummen lassen. Die ersten beiden lassen einen Monitor verstummen, indem sie das Signal entfernen, das er beobachtet. Sampling ist enger gefasst: Die eBPF-RED-Metriken werden berechnet, bevor der Sampler läuft, sodass metrikbasierte Monitore exakt bleiben — aber Monitore, die *Spans* zählen (**Traces** auf `Span Count`, **Exceptions** auf `Exception Count`), sehen proportional weniger und benötigen ihre Schwellenwerte um denselben Faktor neu justiert. Wenn Sie lieber später entscheiden möchten, kann OneUptime Daten stattdessen serverseitig verwerfen (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — das kostet weiterhin Egress, ist aber eine Einstellung, die Sie ohne erneutes Deployment ändern können.

### Hebel 1 — Pod-Logs sind meist die mit Abstand größte Quelle

Container-Logs sind fast immer der größte Anteil am Ingest, weil es ein Datensatz pro Log-Zeile aus jedem Container im Cluster ist.

- **Möchten Sie nur Logs aus bestimmten Namespaces?** `namespaceFilters` beschränkt Pod-Logs in beiden Log-Modi (und eBPF-Traces gleich mit). Der Abgleich erfolgt auf dem Pod-Log-Pfad, sodass gefilterte Namespaces gar nicht erst gelesen werden — das ist der günstigste Hebel in diesem Dokument:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` ist standardmäßig bereits ausgeschlossen.) Um jeden Namespace außer einem zu behalten, verwenden Sie `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`.

- **Interessieren Sie nur Warnungen und Fehler?** `filters.logs.minSeverity` verwirft den Rest am Agent. Auf einem geschwätzigen Cluster ist das oft die mit Abstand größte verfügbare Reduktion, weil INFO und DEBUG den Großteil der meisten Anwendungsausgaben ausmachen:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  Siehe [Filterung nach Log-Schweregrad](#filterung-nach-log-schweregrad) dazu, wie der Schweregrad bestimmt wird und was mit Logs geschieht, die sich nicht klassifizieren lassen.

- **Benötigen Sie überhaupt keine Pod-Logs von OneUptime?** Schalten Sie sie aus:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > Das stoppt nur die Pod-Logs. Node-, Pod- und Container-Metriken fließen weiter, und die darauf aufbauenden Monitore (OOM-Kills, CPU-Throttling, PVC-Low-Disk) funktionieren weiterhin — der Node-Collector bleibt, er hört lediglich auf, `/var/log/pods` zu lesen. Dasselbe gilt für `logs.mode: api` und `logs.mode: disabled`.

### Hebel 2 — eBPF-Auto-Instrumentierung eingrenzen

eBPF liefert Ihnen Traces, RED-Metriken, die Service-Map und Netzwerkfluss-Metriken ohne Codeänderungen — ist aber auch die zweitgrößte Datenquelle, weil es einen Span pro Request und mehrere Metrikfamilien pro Service ausgibt. Sie haben drei Steuerungsebenen:

- **Liefern Sie bereits Traces über OTel-SDKs oder möchten Sie keine Auto-Traces?** Schalten Sie eBPF vollständig aus:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Behalten Sie die Traces, entfernen Sie die schweren Metrikfamilien.** Die [Signalfamilien-Tabelle oben](#einzelne-signalfamilien-umschalten) listet jedes `ebpf.features.*`-Flag auf. Die volumenstärksten Familien sind Netzwerk- und Span-Metriken — sie auszuschalten lässt Traces, HTTP-RED-Metriken und die Service-Map intakt:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  Lassen Sie `ebpf.features.networkInterZoneMetrics` aus (Standard) — es verdoppelt die Netzwerkfluss-Kardinalität.

- **Instrumentieren Sie nur die Laufzeitumgebungen, die Sie interessieren.** Standardmäßig hängt sich OBI an jeden Prozess, den es erkennt (`ebpf.autoTargetExe: "*"`). Grenzen Sie es auf bestimmte Laufzeitumgebungen ein oder fügen Sie Binaries zur Skip-Liste hinzu, um die Anzahl der "Services" und Traces zu reduzieren, die der Agent erzeugt:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  Siehe [Einzelne Signalfamilien umschalten](#einzelne-signalfamilien-umschalten) und den `excludeExePaths`-Hinweis in den Chart-Values für die vollständigen Standardwerte.

### Hebel 3 — Die Scrape-Intervalle verlangsamen

Das Metrikvolumen ist direkt proportional dazu, wie oft der Agent scrapt. Ein Intervall zu verdoppeln halbiert ungefähr die Anzahl der Datenpunkte, die diese Metrik erzeugt, ohne Verlust an Abdeckung — nur mit gröberer Auflösung. Wenn Sie keine 30-Sekunden-Granularität benötigen, sind 60s oder 120s eine große, sichere Reduktion:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (Standard `30s`) steuert die Node- / Pod- / Container-Metriken (`kubeletstats`) und die Cluster-State-Metriken (`k8s_cluster`) — den Großteil des Metrikvolumens.
- `hostMetrics.collectionInterval` und `cadvisor.scrapeInterval` decken die OS-Metriken pro Node und die Throttling- / OOM-Zähler ab.
- `resourceSpecs.interval` (Standard `300s`) steuert, wie oft vollständige Ressourcen-Specs (Labels, Annotationen, Status) abgerufen werden — erhöhen Sie es, wenn Sie nicht benötigen, dass Spec-Änderungen schnell widergespiegelt werden.
- Wenn Sie einen der optionalen Scraper aktiviert haben, verfügen auch diese über eigene Stellschrauben: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Hebel 4 — Die Metrik-Kardinalität begrenzt halten

Die Kardinalität (die Anzahl der eindeutigen Zeitreihen) ist genauso wichtig wie die Frequenz, weil jede Serie separat gespeichert und abgerechnet wird.

- **cAdvisor ist absichtlich per Allowlist gefiltert.** Der cAdvisor-Receiver (standardmäßig aktiviert) kann Hunderte von Metriken ausgeben; das Chart leitet nur die wenigen weiter, die Monitore speisen (`cadvisor.metricsAllowlist`). Halten Sie die Liste knapp — **jeder Eintrag wird pro Container gehalten, sodass eine zusätzliche Metrik mit der Container-Anzahl des Clusters multipliziert wird.** kube-state-metrics ist standardmäßig deaktiviert, aber wenn Sie es aktivieren (`kubeStateMetrics.enabled=true`), begrenzt dessen `kubeStateMetrics.metricsAllowlist` die Kardinalität auf dieselbe Weise.
- **Volume-Metriken pro PVC** (`kubeletstats.volumeMetrics.enabled`, standardmäßig aktiviert) geben eine Serie pro PVC pro Pod aus. Das ist für die meisten Cluster in Ordnung, kann aber bei zustandsbehafteten Workloads (Kafka, Datenbanken) mit Tausenden von PVCs erheblich sein — schalten Sie es dort aus, wenn Sie den PVC-Speicherplatz nicht beobachten:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Sättigungsmetriken** (`kubeletstats.utilizationMetrics.enabled`, standardmäßig aktiviert) fügen 8 abgeleitete "% von Request/Limit"-Familien hinzu. Sie sind günstig (kein zusätzlicher Scrape), aber wenn Sie die CPU-/Memory-vs-Limit-Monitore nicht verwenden, können Sie sie mit `--set kubeletstats.utilizationMetrics.enabled=false` entfernen.

- **Bestimmte Metriken nach Namen verwerfen.** Die obigen Allowlists gelten pro Receiver; `filters.metrics.exclude` erstreckt sich über alle, verwenden Sie es also für alles, was die Stellschrauben auf Receiver-Ebene nicht ausdrücken können:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  Siehe [Metriken nach Namen ein- oder ausschließen](#metriken-nach-namen-ein-oder-ausschließen) für den Abgleich exakt vs. Regex und die Allowlist-Form.

- **Die Metriken eines ganzen Namespace verwerfen.** Wenn ein Namespace störend ist, Sie dessen Nodes aber weiterhin überwachen möchten, wendet `namespaceFilters.applyTo.metrics=true` Ihre bestehenden Namespace-Listen auf Per-Pod- und Per-Container-Serien an. Node- und Cluster-Level-Serien werden immer behalten:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

### Hebel 5 — Die schweren Opt-in-Features ausgeschaltet lassen

Diese sind **standardmäßig deaktiviert**, gerade weil sie Last hinzufügen — aktivieren Sie eines nur, wenn Sie aktiv nutzen, was es antreibt, und schalten Sie es wieder aus, wenn Sie es nur ausprobiert haben:

| Wert                                                      | Fügt hinzu                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | Kontinuierliches CPU-Profiling-DaemonSet — schwerer als eBPF-Traces                          |
| `auditLogs.enabled`                                       | Jeden Kubernetes-API-Request als Log-Datensatz (hohes Volumen)                               |
| `controlPlane.enabled`                                    | etcd- / API-Server- / Scheduler- / Controller-Manager-Metriken                               |
| `kubeStateMetrics.enabled`                                | CrashLoop- / ImagePull- / Scheduling-Grund-Metriken (fügt ein KSM-Deployment + Scrape hinzu) |
| `ebpf.features.networkInterZoneMetrics`                   | Verdoppelt die Netzwerkfluss-Metrik-Kardinalität                                             |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Zusätzliche Prometheus-Scrape-Jobs                                                           |

### Hebel 6 — Traces samplen, statt sie zu verwerfen

Jeder Hebel oben erkauft Volumen, indem er etwas aufgibt: einen Namespace, den Sie nicht mehr beobachten, einen Schweregrad, den Sie nicht mehr behalten, eine Metrikfamilie, die Sie nicht mehr erfassen. Sampling ist die Ausnahme, und auf einem ausgelasteten Cluster ist es oft die größte verfügbare Reduktion bei kleinstem Verlust:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Das ist eine Reduktion des Trace-Volumens um 90 % bei einem engeren Verlust als bei jedem anderen Hebel hier:

- Die Traces, die Sie behalten, sind **vollständig** — die Entscheidung hasht die Trace-ID, sodass alle Spans eines Traces sie teilen. Sie erhalten weniger Traces, keine kaputten.
- Ihre **RED-Metriken bleiben exakt**. Request-Rate, Fehlerrate und Dauer werden von OBI aus jedem Request berechnet und durchlaufen die Metrik-Pipeline, in der der Sampler nicht sitzt. Jedes Dashboard und jeder Monitor, das bzw. der darauf aufbaut, liest sich wie zuvor.

Was Sie aufgeben, sind größtenteils Beispiel-Traces: Wenn ein Monitor auslöst, haben Sie ein Zehntel so viele Traces zum Öffnen. Auf einem Cluster, das Tausende identischer Requests pro Sekunde abwickelt, ist das meist ein guter Tausch — der hundertste identische `/healthz`-Span lehrt Sie nichts, was der erste nicht schon getan hätte. Auf einem ruhigen Cluster ist es ein schlechter, weil Sie womöglich kein Beispiel des seltenen Requests haben, der kaputtgegangen ist.

Die Ausnahme, und das eine, was Sie vor dem Ausrollen prüfen sollten: Monitore, die **Spans zählen** statt Metriken — **Traces** auf `Span Count`, **Exceptions** auf `Exception Count` —, sehen proportional weniger, sodass ihre Schwellenwerte um denselben Faktor neu justiert werden müssen. Siehe [Trace-Sampling](#trace-sampling).

Greifen Sie dazu, wenn eBPF-Traces einen großen Anteil an Ihrem Ingest ausmachen, Sie aber die Service-Map und die RED-Metriken intakt behalten möchten. Bevorzugen Sie Hebel 2, wenn Sie etwas vollständig nicht mehr instrumentieren möchten.

Siehe [Trace-Sampling](#trace-sampling) für das vollständige Verhalten, einschließlich der Frage, warum `0` eine Rate und kein Ausschalter ist und warum es kein Log- oder Metrik-Äquivalent gibt.

### Ein schlanker Ausgangspunkt

Wenn Sie einen kleineren Footprint möchten, aber weiterhin möchten, dass die Monitore funktionieren, behält dieses Profil die **vollständige Metrik-Abdeckung** und streicht die beiden Dinge, die das Volumen tatsächlich treiben — Log-Zeilen und eBPF-Spans:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# Halve the metric data points. Coarser resolution, same coverage.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# Keep pod logs, but only ship the ones worth alerting on. (Metrics do
# not depend on this — the node collector runs either way.)
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # drop INFO / DEBUG / TRACE at the agent

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

ebpf:
  enabled: true
  features:
    networkMetrics: false # the heaviest eBPF families
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

Ziehen Sie bei Bedarf weiter an: Erhöhen Sie `minSeverity` auf `ERROR`, fügen Sie `namespaceFilters.applyTo.metrics=true` hinzu oder setzen Sie `ebpf.enabled=false`, wenn Sie Traces bereits über OTel-SDKs liefern.

> **Achten Sie darauf, was Sie streichen.** Einige Monitore hängen von bestimmten Signalen ab: Das Deaktivieren von `cadvisor` entfernt die OOM-Kill- und CPU-Throttling-Monitore; das Deaktivieren von `kubeletstats.volumeMetrics` entfernt den PVC-Low-Disk-Monitor; das Deaktivieren von Logs entfernt log-basierte Alarme; und `sampling.traces.percentage` entfernt zwar keinen Monitor, skaliert aber die span-basierten herunter (**Traces** auf `Span Count`, **Exceptions** auf `Exception Count`), justieren Sie deren Schwellenwerte also entsprechend neu. Streichen Sie die Signale, auf die Sie nicht reagieren, nicht die, die ein Monitor überwacht.

### Die Auswirkung messen

Die Telemetrie-Nutzung wird pro Tag aggregiert, prüfen Sie also den Trend über ein oder zwei Tage unter **Project Settings → Usage History**, um den Rückgang zu bestätigen — er bewegt sich nicht in dem Moment, in dem Sie eine Änderung anwenden. Ändern Sie jeweils einen Hebel, damit Sie den Unterschied zuordnen können — Logs aus, dann Intervall hoch, dann eBPF eingegrenzt — statt alles auf einmal herunterzuregeln und einen Monitor zu verlieren, auf den Sie tatsächlich angewiesen waren.

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

   Wenn `401` zurückgegeben wird, ist der Schlüssel in Ihrem Release falsch oder wurde widerrufen. Kopieren Sie einen aktiven Schlüssel aus _Project Settings → Telemetry Ingestion Keys_ und deployen Sie erneut:

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

1. Schließen Sie zunächst einen abgelehnten Ingestion-Schlüssel aus — das ist die häufigste Ursache und von der Agent-Seite aus unsichtbar. Siehe [Agent zeigt "Disconnected" an](#agent-zeigt-disconnected-an) oben (oder führen Sie einfach das Diagnoseskript aus).
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
