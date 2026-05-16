# Send Continuous Profiling Data to OneUptime

## Overview

Continuous profiling is the fourth pillar of observability alongside logs, metrics, and traces. Profiles capture how your application spends CPU time, allocates memory, and uses system resources at the function level. OneUptime ingests profiling data via the OpenTelemetry Protocol (OTLP) and stores it alongside your other telemetry signals for unified analysis.

With profiling data in OneUptime, you can identify hot functions consuming CPU, detect memory leaks, find contention bottlenecks, and correlate performance issues with specific traces and spans.

## Supported Profile Types

OneUptime supports the following profile types:

| Profile Type | Description | Unit |
| --- | --- | --- |
| cpu | CPU time spent executing code | nanoseconds |
| wall | Wall-clock time (includes waiting/sleeping) | nanoseconds |
| alloc_objects | Number of heap allocations | count |
| alloc_space | Bytes of heap memory allocated | bytes |
| goroutine | Number of active goroutines (Go) | count |
| contention | Time spent waiting on locks/mutexes | nanoseconds |

## Getting Started

### Step 1 - Create a Telemetry Ingestion Token

After you sign up to OneUptime and create a project, click on "More" in the Navigation bar and click on "Project Settings".

On the Telemetry Ingestion Key page, click on "Create Ingestion Key" to create a token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Once you created a token, click on "View" to view the token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

### Step 2 - Configure Your Profiler

OneUptime accepts profiling data over both gRPC and HTTP using the OTLP profiles protocol.

| Protocol | Endpoint |
| --- | --- |
| gRPC | `your-oneuptime-host:4317` (OTLP standard gRPC port) |
| HTTP | `https://your-oneuptime-host/otlp/v1/profiles` |

**Environment Variables**

Set the following environment variables to point your profiler at OneUptime:

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**Self Hosted OneUptime**

If you are self-hosting OneUptime, replace the endpoint with your own host (e.g., `http(s)://YOUR-ONEUPTIME-HOST/otlp`). For gRPC, connect directly to port 4317 on your OneUptime host.

## Instrumentation Guide

### Using Grafana Alloy (eBPF-based profiling)

Grafana Alloy (formerly Grafana Agent) can collect CPU profiles from all processes on a Linux host using eBPF, with zero code changes required. Configure it to export via OTLP to OneUptime.

Example Alloy configuration:

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

### Using async-profiler (Java)

For Java applications, use [async-profiler](https://github.com/async-profiler/async-profiler) with the OpenTelemetry Java agent to send profiling data via OTLP.

```bash
# Start your Java application with the OpenTelemetry Java agent
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

### Using Go pprof with OTLP Export

For Go applications, you can use the standard `net/http/pprof` package alongside an OTLP exporter. Configure continuous profiling by periodically collecting pprof data and forwarding it to OneUptime.

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// Collect a 30-second CPU profile and export periodically
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // Convert pprof output to OTLP format and send to OneUptime
}
```

Alternatively, use the OpenTelemetry Collector with a profiling receiver that scrapes your Go application's `/debug/pprof` endpoint and exports via OTLP.

### Using py-spy (Python)

For Python applications, [py-spy](https://github.com/benfred/py-spy) can capture CPU profiles without code changes. Use the OpenTelemetry Collector to receive and forward profile data.

```bash
# Capture profiles and send to a local OTLP collector
py-spy record --format speedscope --pid $PID -o profile.json
```

For continuous profiling, run py-spy alongside your application and configure the OpenTelemetry Collector to ingest and forward the profiles to OneUptime.

## Using the OpenTelemetry Collector

You can use the OpenTelemetry Collector as a proxy to receive profiles from your applications and forward them to OneUptime.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_ONEUPTIME_SERVICE_TOKEN"

service:
  pipelines:
    profiles:
      receivers: [otlp]
      exporters: [otlphttp]
```

## Features

### Flamegraph Visualization

OneUptime renders profile data as interactive flamegraphs. Each bar represents a function in the call stack, and its width is proportional to the time or resources consumed. You can click on any function to zoom in and see its callers and callees.

### Function List

View a sortable table of all functions captured in a profile, ranked by self time, total time, or allocation count. This helps you quickly identify the most expensive functions in your application.

### Trace Correlation

Profiles in OneUptime can be correlated with distributed traces. When a profile includes trace and span IDs (via the OTLP link table), you can navigate directly from a slow trace span to the corresponding CPU or memory profile to understand exactly what code was executing.

### Filtering by Profile Type

Filter profiles by type (cpu, wall, alloc_objects, alloc_space, goroutine, contention) to focus on the specific resource dimension you are investigating.

## Data Retention

Profile data retention is configured per telemetry service in your OneUptime project settings. The default retention period is 15 days. Data is automatically deleted after the retention period expires.

To change the retention period for a service, navigate to **Telemetry > Services > [Your Service] > Settings** and update the data retention value.

## Need Help?

Please contact support@oneuptime.com if you need any help setting up profiling with OneUptime.
