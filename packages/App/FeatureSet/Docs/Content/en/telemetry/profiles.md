# Send Continuous Profiling Data to OneUptime

## Overview

Continuous profiling is the fourth pillar of observability alongside logs, metrics, and traces. Profiles capture how your application spends CPU time and allocates memory at the function level, and OneUptime renders them as interactive flamegraphs alongside your other telemetry.

OneUptime exposes a **Pyroscope-compatible ingest API**. Anything that can push to a Pyroscope server — the Grafana Alloy eBPF profiler or a Pyroscope language SDK — can push to OneUptime.

## Ingest Endpoint

| Setting                             | Value                                               |
| ----------------------------------- | --------------------------------------------------- |
| Base URL (Pyroscope server address) | `https://oneuptime.com/pyroscope`                   |
| Authentication header               | `x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_TOKEN` |

Clients append their own path to the base URL — `/ingest` for most Pyroscope SDKs, `/push.v1.PusherService/Push` for Grafana Alloy and the .NET SDK from v0.14 — so you always configure just the base URL, with no trailing slash.

OneUptime reads the ingestion token from any of these, so use whichever your client supports:

- the `x-oneuptime-token` header (for clients that let you add custom headers);
- `Authorization: Bearer <token>` — what SDKs with an `authToken` / `auth_token` option send;
- HTTP basic auth with the token as the **password** (any username) — for clients that only offer a basic-auth user and password.

**Self Hosted OneUptime:** replace `https://oneuptime.com` with your own host, e.g. `http(s)://YOUR-ONEUPTIME-HOST/pyroscope`.

## Supported Profile Formats

| Format                                      | Sent by                                                             | Supported                                     |
| ------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| pprof (binary protobuf, optionally gzipped) | Go, Node.js, and .NET Pyroscope SDKs; Grafana Alloy                 | Yes                                           |
| Folded / collapsed text                     | Python, Ruby, and Rust Pyroscope SDKs (their default upload format) | Yes                                           |
| JFR (Java Flight Recorder)                  | Pyroscope Java agent                                                | Not yet — use Grafana Alloy for Java services |

## Step 1 - Create a Telemetry Ingestion Token

After you sign up to OneUptime and create a project, click on "Products" in the navigation bar and click on "Project Settings".

On the Telemetry Ingestion Key page, click on "Create Ingestion Key" to create a token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Once you created a token, click on "View" to view the token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Step 2 - Send Profiles

### Option A: Grafana Alloy with eBPF (recommended, zero code changes)

[Grafana Alloy](https://grafana.com/docs/alloy/latest/) collects CPU profiles from every process on a Linux host using eBPF — no agent inside your application and no code changes. It works for Go, Rust, C/C++, Java, Python, Ruby, PHP, Node.js, and .NET.

Create `alloy-config.alloy`:

```hcl
discovery.process "all" {
  refresh_interval = "60s"
}

discovery.relabel "alloy_profiles" {
  targets = discovery.process.all.targets

  rule {
    action       = "replace"
    source_labels = ["__meta_process_exe"]
    target_label  = "service_name"
  }
}

pyroscope.ebpf "default" {
  targets    = discovery.relabel.alloy_profiles.output
  forward_to = [pyroscope.write.oneuptime.receiver]

  collect_interval = "15s"
  sample_rate      = 97
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "https://oneuptime.com/pyroscope"
    headers = {
      "x-oneuptime-token" = "YOUR_ONEUPTIME_INGESTION_TOKEN",
    }
  }
}
```

Run it with Docker (eBPF needs a privileged container with the host PID namespace):

```yaml
# docker-compose.yml
services:
  alloy:
    image: grafana/alloy:latest
    privileged: true
    pid: host
    volumes:
      - ./alloy-config.alloy:/etc/alloy/config.alloy
      - /proc:/proc:ro
      - /sys:/sys:ro
    command:
      - run
      - /etc/alloy/config.alloy
```

Or run it directly on the host:

```bash
alloy run alloy-config.alloy
```

### Option B: Pyroscope language SDKs (in-process profiling)

Pyroscope SDKs run inside your application and continuously upload profiles. Point the SDK's server address at the OneUptime base URL and pass your ingestion token as the auth token.

**Go** (uploads pprof):

```go
import "github.com/grafana/pyroscope-go"

pyroscope.Start(pyroscope.Config{
    ApplicationName: "my-service",
    ServerAddress:   "https://oneuptime.com/pyroscope",
    AuthToken:       "YOUR_ONEUPTIME_INGESTION_TOKEN",
    ProfileTypes: []pyroscope.ProfileType{
        pyroscope.ProfileCPU,
        pyroscope.ProfileAllocObjects,
        pyroscope.ProfileAllocSpace,
        pyroscope.ProfileInuseObjects,
        pyroscope.ProfileInuseSpace,
        pyroscope.ProfileGoroutines,
    },
})
```

**Node.js** (uploads pprof):

```javascript
const Pyroscope = require("@pyroscope/nodejs");

Pyroscope.init({
  serverAddress: "https://oneuptime.com/pyroscope",
  appName: "my-service",
  authToken: "YOUR_ONEUPTIME_INGESTION_TOKEN",
});

Pyroscope.start();
```

**Python** (uploads folded text):

```python
import pyroscope

pyroscope.configure(
    application_name="my-service",
    server_address="https://oneuptime.com/pyroscope",
    auth_token="YOUR_ONEUPTIME_INGESTION_TOKEN",
)
```

**Ruby** and **Rust** work the same way: install the [Pyroscope SDK for your language](https://grafana.com/docs/pyroscope/latest/configure-client/) and set the server address to `https://oneuptime.com/pyroscope` with your ingestion token as the auth token (or, if your SDK version only offers basic auth, as the basic-auth password).

### .NET

The Pyroscope .NET profiler is a native CLR profiler: it needs no code changes and is switched on entirely through environment variables. Download the release for your image from [pyroscope-dotnet releases](https://github.com/grafana/pyroscope-dotnet/releases) — `glibc` or `musl` (Alpine), `x86_64` or `aarch64` — and load it into the runtime:

```dockerfile
FROM alpine:3.20 AS pyroscope-profiler
ARG PYROSCOPE_DOTNET_VERSION=0.13.0
ADD https://github.com/grafana/pyroscope-dotnet/releases/download/v${PYROSCOPE_DOTNET_VERSION}-pyroscope/pyroscope.${PYROSCOPE_DOTNET_VERSION}-glibc-x86_64.tar.gz /tmp/pyroscope.tar.gz
RUN mkdir -p /pyroscope && tar -xzf /tmp/pyroscope.tar.gz -C /pyroscope

FROM mcr.microsoft.com/dotnet/aspnet:10.0
# ... your application ...
COPY --from=pyroscope-profiler /pyroscope /pyroscope
ENV CORECLR_ENABLE_PROFILING=1
ENV CORECLR_PROFILER={BD1A650D-AC5D-4896-B64F-D6FA25D6B26A}
ENV CORECLR_PROFILER_PATH=/pyroscope/Pyroscope.Profiler.Native.so
ENV LD_PRELOAD=/pyroscope/Pyroscope.Linux.ApiWrapper.x64.so
ENV LD_LIBRARY_PATH=/pyroscope
```

Then point it at OneUptime, for example in your Kubernetes / Helm environment:

```bash
PYROSCOPE_APPLICATION_NAME=my-service
PYROSCOPE_PROFILING_ENABLED=1
PYROSCOPE_SERVER_ADDRESS=https://oneuptime.com/pyroscope
PYROSCOPE_AUTH_TOKEN=YOUR_ONEUPTIME_INGESTION_TOKEN
```

How the token is passed depends on the profiler release:

| pyroscope-dotnet release | Uploads to                              | Token setting                                                                                                                                                     |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.13 and earlier        | `/pyroscope/ingest`                     | `PYROSCOPE_AUTH_TOKEN`                                                                                                                                            |
| v0.14 to 1.4             | `/pyroscope/push.v1.PusherService/Push` | `PYROSCOPE_AUTH_TOKEN`                                                                                                                                            |
| 1.5 and later            | `/pyroscope/push.v1.PusherService/Push` | `PYROSCOPE_BASIC_AUTH_USER=oneuptime` and `PYROSCOPE_BASIC_AUTH_PASSWORD=<token>` (both must be set), or `PYROSCOPE_HTTP_HEADERS={"x-oneuptime-token":"<token>"}` |

From 1.x the release tags are named `pyroscope-<version>` (for example `https://github.com/grafana/pyroscope-dotnet/releases/download/pyroscope-1.5.1/pyroscope.1.5.1-glibc-x86_64.tar.gz`); the profiler GUID and file names are unchanged.

CPU profiling is on by default. Wall-time, allocation, exception and lock-contention profiling are opt-in: set `PYROSCOPE_PROFILING_WALLTIME_ENABLED`, `PYROSCOPE_PROFILING_ALLOCATION_ENABLED`, `PYROSCOPE_PROFILING_EXCEPTION_ENABLED` or `PYROSCOPE_PROFILING_LOCK_ENABLED` to `true`. Static labels go in `PYROSCOPE_LABELS` (`key:value,key:value`).

The profiler uploads every 15 seconds and does **not** compress its uploads, so a busy service can send several MB per upload. OneUptime's own ingress accepts up to 16 MB on `/pyroscope`; if another proxy sits in front of OneUptime (for example ingress-nginx, whose default `proxy-body-size` is 1 MB), raise its body-size limit for `/pyroscope` as well, or large uploads are rejected with `413` before they reach OneUptime.

### Java

The Pyroscope Java agent uploads profiles in JFR format, which OneUptime does not ingest yet. Profile Java services with the Grafana Alloy eBPF integration (Option A above) instead — it captures JVM CPU profiles with no agent or code changes.

## Supported Profile Types

A pprof can declare several sample types; each uploaded profile is stored under one of them — CPU time (`cpu` in nanoseconds) if it has it, otherwise wall time, otherwise in-use then allocated bytes, otherwise the first type it declares. Any type is stored and viewable; the types below get first-class grouping, units, and labels in the OneUptime UI:

| Profile type                         | Shown as               | Unit        |
| ------------------------------------ | ---------------------- | ----------- |
| `cpu`, `samples`                     | CPU time               | nanoseconds |
| `wall`                               | Wall time              | nanoseconds |
| `inuse_space`, `alloc_space`, `heap` | Memory (bytes)         | bytes       |
| `inuse_objects`, `alloc_objects`     | Memory (object counts) | count       |
| `mutex`, `contention`, `block`       | Lock contention        | nanoseconds |
| `goroutine`                          | Goroutines (Go)        | count       |

Anything else (for example a custom sample type) appears under "Other" with its raw name.

## Verify It Is Working

1. **Check your token.** The ingest endpoints answer a missing or invalid token with `401`, but most profilers do not surface that anywhere you will see it (the .NET profiler, for one, logs HTTP responses only at debug level). Ask the validation endpoint directly:

   ```bash
   curl -i -H "x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_TOKEN" \
     https://oneuptime.com/otlp/v1/validate
   ```

   A valid token returns `200` with `{"valid": true, ...}`; an unknown or revoked token returns `401`.

2. **Open the Profiles page.** In the OneUptime Dashboard go to **Products > Performance Profiles**. With Alloy's default 15-second collect interval (or the SDKs' 10- to 15-second upload interval), the first profiles and their flamegraphs appear within a minute or two of the agent starting.

3. **Check the service.** Profiles are attached to the telemetry service named by the SDK's `application_name` / `appName` / `PYROSCOPE_APPLICATION_NAME` (or the process executable name under Alloy's default relabel rule above).

4. **Still nothing? Look at the upload status.** For the .NET profiler, set `DD_TRACE_DEBUG=1` on the application for a minute: it then logs a `PyroscopePprofSink <status>` line for every upload. `200` means OneUptime accepted it; `401` is the token; `404` usually means `PYROSCOPE_SERVER_ADDRESS` is missing the `/pyroscope` suffix; `413` means a proxy in front of OneUptime rejected the upload's size (see the .NET section above). If you run OneUptime yourself, the ingress (nginx) access log records the same status for every `/pyroscope` request.

## Features

### Flamegraph Visualization

OneUptime renders profile data as interactive flamegraphs. Each bar represents a function in the call stack, and its width is proportional to the time or resources consumed. You can click on any function to zoom in and see its callers and callees.

### Function List

View a sortable table of all functions captured in a profile, ranked by self time, total time, or allocation count. This helps you quickly identify the most expensive functions in your application.

### Trace Correlation

When a profile carries trace and span IDs (for example as `trace_id` / `span_id` sample labels), you can navigate directly from a slow trace span to the corresponding CPU or memory profile to understand exactly what code was executing.

### Filtering by Profile Type

Filter profiles by category (CPU, Memory, Locks, Wall time, Goroutines) to focus on the specific resource dimension you are investigating.

## Data Retention

Profile data retention is configured per telemetry service in your OneUptime project settings. The default retention period is 15 days. Data is automatically deleted after the retention period expires.

To change the retention period for a service, navigate to **Products > Services > [Your Service] > Settings** and update the data retention value.

## Need Help?

Please contact support@oneuptime.com if you need any help setting up profiling with OneUptime.
