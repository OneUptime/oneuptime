# OneUptime Host Collector

A prebuilt OpenTelemetry Collector distribution for monitoring **hosts** (Linux,
macOS, Windows) with OneUptime.

It is the upstream collector's host components **plus** the
[`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver)
(config type `windows_service`) — the receiver that powers the host **Services**
tab in OneUptime. That receiver is **not** shipped in the upstream prebuilt
`otelcol-contrib` binary (it isn't in the contrib release manifest), so without
this distribution users have to compile their own collector with `ocb`. This
distribution ships it prebuilt so Windows service status is paste‑and‑run.

## What's included

Built from [`builder-config.yaml`](./builder-config.yaml) with the OpenTelemetry
Collector Builder (`ocb`):

- **Receivers:** `hostmetrics`, `windows_service`, `windowseventlog`, `filelog`, `journald`, `otlp`
- **Processors:** `batch`, `memory_limiter`, `resource`, `resourcedetection`
- **Exporters:** `otlphttp`, `otlp`, `debug`
- **Extensions:** `health_check`

## Install (released binaries)

Download the asset for your OS/arch from the
[OneUptime releases page](https://github.com/OneUptime/oneuptime/releases):

| OS | Asset |
|---|---|
| Windows | `oneuptime-host-collector_windows_amd64.zip` / `_arm64.zip`, or the `oneuptime-host-collector-amd64.msi` / `-arm64.msi` installer |
| Linux | `oneuptime-host-collector_linux_amd64.tar.gz` / `_arm64.tar.gz` |
| macOS | `oneuptime-host-collector_darwin_amd64.tar.gz` / `_arm64.tar.gz` |

Each archive contains the `oneuptime-host-collector` binary and an
OS-appropriate `config.yaml`. Set your `x-oneuptime-token` (and the endpoint if
you self-host) in `config.yaml`, then run the binary as a service. See the
[Host OpenTelemetry Collector docs](https://oneuptime.com/docs/telemetry/host-otel-collector)
for the per-OS service-registration steps.

## Build from source

```bash
# Cross-compile every platform + package archives into ./dist
bash build.sh <version>

# Then (Linux, needs msitools/wixl) build the Windows MSI installers
bash build-msi.sh <version>
```

`build.sh` installs `ocb`, generates the collector source into `_build/`, and
cross-compiles with `CGO_ENABLED=0`. Both `_build/` and `dist/` are gitignored.

The CI release job (`host-collector-deploy` in `.github/workflows/release.yml`)
runs these two scripts and uploads `dist/*.zip`, `dist/*.tar.gz`, and `dist/*.msi`
to the GitHub release.
