# Continuous-Profiling-Daten an OneUptime senden

## Übersicht

Continuous Profiling ist die vierte Säule der Observability neben Logs, Metriken und Traces. Profile erfassen, wie Ihre Anwendung CPU-Zeit verbraucht, Arbeitsspeicher alloziert und Systemressourcen auf Funktionsebene nutzt. OneUptime importiert Profiling-Daten über das OpenTelemetry Protocol (OTLP) und speichert sie zusammen mit Ihren anderen Telemetriesignalen für eine einheitliche Analyse.

Mit Profiling-Daten in OneUptime können Sie heiße Funktionen identifizieren, die CPU verbrauchen, Speicherlecks erkennen, Konkurrenzbottlenecks finden und Leistungsprobleme mit bestimmten Traces und Spans korrelieren.

## Unterstützte Profiltypen

OneUptime unterstützt die folgenden Profiltypen:

| Profiltyp | Beschreibung | Einheit |
| --- | --- | --- |
| cpu | CPU-Zeit für die Codeausführung | Nanosekunden |
| wall | Wanduhrzeit (einschließlich Warten/Schlafen) | Nanosekunden |
| alloc_objects | Anzahl der Heap-Allokationen | Anzahl |
| alloc_space | Bytes des allozierten Heap-Speichers | Bytes |
| goroutine | Anzahl der aktiven Goroutinen (Go) | Anzahl |
| contention | Zeit für das Warten auf Sperren/Mutexes | Nanosekunden |

## Erste Schritte

### Schritt 1 - Telemetrie-Ingestion-Token erstellen

Klicken Sie nach der Anmeldung bei OneUptime und dem Erstellen eines Projekts auf „Mehr" in der Navigationsleiste und dann auf „Projekteinstellungen".

Klicken Sie auf der Seite Telemetrie-Ingestion-Schlüssel auf „Ingestion-Schlüssel erstellen", um ein Token zu erstellen.

### Schritt 2 - Ihren Profiler konfigurieren

OneUptime akzeptiert Profiling-Daten über gRPC und HTTP mit dem OTLP Profiles-Protokoll.

| Protokoll | Endpunkt |
| --- | --- |
| gRPC | `your-oneuptime-host:4317` (OTLP Standard-gRPC-Port) |
| HTTP | `https://your-oneuptime-host/otlp/v1/profiles` |

**Umgebungsvariablen**

Setzen Sie die folgenden Umgebungsvariablen, um Ihren Profiler auf OneUptime zu zeigen:

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

## Instrumentierungsanleitung

### Grafana Alloy verwenden (eBPF-basiertes Profiling)

Grafana Alloy kann CPU-Profile von allen Prozessen auf einem Linux-Host mit eBPF sammeln, ohne Code-Änderungen. Konfigurieren Sie es für den Export über OTLP zu OneUptime.

Beispiel-Alloy-Konfiguration:

```hcl
pyroscope.ebpf "default" {
  forward_to = [pyroscope.write.oneuptime.receiver]
  targets    = discovery.process.all.targets
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "https://oneuptime.com/pyroscope"
    headers = {
      "x-oneuptime-token" = "YOUR_ONEUPTIME_SERVICE_TOKEN",
    }
  }
}
```

### async-profiler verwenden (Java)

Für Java-Anwendungen verwenden Sie [async-profiler](https://github.com/async-profiler/async-profiler) mit dem OpenTelemetry Java-Agenten:

```bash
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

## Funktionen

### Flamegraph-Visualisierung

OneUptime rendert Profildaten als interaktive Flamegraphen. Jeder Balken stellt eine Funktion im Call-Stack dar, und seine Breite ist proportional zur verbrauchten Zeit oder den verbrauchten Ressourcen.

### Funktionsliste

Zeigen Sie eine sortierbare Tabelle aller in einem Profil erfassten Funktionen an, sortiert nach Eigenzeit, Gesamtzeit oder Allokationsanzahl.

### Trace-Korrelation

Profile in OneUptime können mit verteilten Traces korreliert werden. Wenn ein Profil Trace- und Span-IDs enthält, können Sie direkt von einem langsamen Trace-Span zum entsprechenden CPU- oder Arbeitsspeicherprofil navigieren.

## Datenspeicherung

Die Profildaten-Aufbewahrung wird pro Telemetrie-Dienst in Ihren OneUptime-Projekteinstellungen konfiguriert. Der Standard-Aufbewahrungszeitraum beträgt 15 Tage.

## Hilfe benötigt?

Wenden Sie sich bitte an support@oneuptime.com, wenn Sie Hilfe bei der Einrichtung von Profiling mit OneUptime benötigen.
