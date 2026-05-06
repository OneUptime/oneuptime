export type HostInstallMethod =
  | "docker"
  | "linux-deb"
  | "linux-rpm"
  | "linux-tarball"
  | "macos"
  | "windows"
  | "kubernetes";

export interface HostInstallMethodOption {
  key: HostInstallMethod;
  label: string;
  description: string;
}

export const HOST_INSTALL_METHODS: Array<HostInstallMethodOption> = [
  {
    key: "docker",
    label: "Docker",
    description: "Single command. Works on any OS with Docker installed.",
  },
  {
    key: "linux-deb",
    label: "Debian / Ubuntu",
    description: ".deb package installed as a systemd service.",
  },
  {
    key: "linux-rpm",
    label: "RHEL / Fedora",
    description: ".rpm for RHEL, CentOS, Fedora, Amazon Linux.",
  },
  {
    key: "linux-tarball",
    label: "Linux Tarball",
    description: "Static binary + systemd unit. No package manager needed.",
  },
  {
    key: "macos",
    label: "macOS",
    description: "Homebrew formula, managed by brew services.",
  },
  {
    key: "windows",
    label: "Windows",
    description: "MSI installer, registered as a Windows service.",
  },
  {
    key: "kubernetes",
    label: "Kubernetes",
    description: "Helm DaemonSet — one collector pod per node.",
  },
];

export function getHostIntroMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- A Linux, macOS, Windows, or Kubernetes host you want to monitor
- An ingestion key (selected above) — used to authenticate the collector with OneUptime

## What gets reported

Hosts are auto-discovered from the OTel \`host.name\` resource attribute. Once your collector forwards any of:

- \`hostmetrics\` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR
- \`process\` scraper metrics (per-process CPU/memory/threads), OR
- Logs / traces tagged with \`host.id\`, \`host.arch\`, \`os.type\`, \`container.runtime\`, or \`k8s.cluster.name\`

…OneUptime will register the host automatically and start populating the Overview, Metrics, Processes, and Logs tabs.

## Step 1 — Save the collector config

Drop this into \`config.yaml\` next to wherever you'll run the collector. The same file is used for every install method below — only the way the collector is started differs.

\`\`\`yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
        metrics:
          system.cpu.utilization:
            enabled: true
          # Lets OneUptime cache CPU core count on the host record
          # so the Hosts list and host detail page can show it
          # without re-aggregating metrics on every page load.
          system.cpu.logical.count:
            enabled: true
      memory:
        metrics:
          system.memory.utilization:
            enabled: true
      disk:
      filesystem:
        metrics:
          system.filesystem.utilization:
            enabled: true
      load:
      network:
      processes:
      paging:
      process:
        mute_process_name_error: true
        mute_process_exe_error: true
        mute_process_io_error: true
        metrics:
          process.cpu.utilization:
            enabled: true
          process.memory.utilization:
            enabled: true

processors:
  resourcedetection:
    detectors: [system, env]
    system:
      hostname_sources: [os]
      resource_attributes:
        host.name:
          enabled: true
        host.id:
          enabled: true
        host.arch:
          enabled: true
        # host.ip is opt-in in the system detector. OneUptime
        # surfaces it on the Host Network card, so enable it here.
        host.ip:
          enabled: true
        os.type:
          enabled: true
        os.description:
          enabled: true
  batch:

exporters:
  otlphttp/oneuptime:
    endpoint: ${data.oneuptimeUrl}/otlp
    headers:
      x-oneuptime-token: ${data.apiKey}

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
\`\`\`
`;
}

export function getHostMethodMarkdown(
  data: {
    oneuptimeUrl: string;
    apiKey: string;
  },
  method: HostInstallMethod,
): string {
  switch (method) {
    case "docker":
      return `
## Step 2 — Run the collector with Docker

Works on Linux, macOS, Windows, and WSL — anywhere Docker is installed.

\`\`\`bash
docker run -d \\
  --name otel-collector \\
  --restart unless-stopped \\
  --network host \\
  --pid host \\
  -v $(pwd)/config.yaml:/etc/otelcol-contrib/config.yaml:ro \\
  --volume /:/hostfs:ro,rslave \\
  -e HOST_PROC=/hostfs/proc \\
  -e HOST_SYS=/hostfs/sys \\
  -e HOST_ETC=/hostfs/etc \\
  -e HOST_VAR=/hostfs/var \\
  -e HOST_RUN=/hostfs/run \\
  -e HOST_DEV=/hostfs/dev \\
  otel/opentelemetry-collector-contrib:latest \\
  --config /etc/otelcol-contrib/config.yaml
\`\`\`

\`--network host\`, \`--pid host\`, and the \`/hostfs\` bind mount let the \`hostmetrics\` and \`process\` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.

Logs: \`docker logs -f otel-collector\`.
`;

    case "linux-deb":
      return `
## Step 2 — Install the .deb package (Debian / Ubuntu)

\`\`\`bash
VERSION=0.115.0
ARCH=$(dpkg --print-architecture)   # amd64 or arm64

curl -L -o /tmp/otelcol-contrib.deb \\
  https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v\${VERSION}/otelcol-contrib_\${VERSION}_linux_\${ARCH}.deb
sudo dpkg -i /tmp/otelcol-contrib.deb

# Install the config and (re)start the service
sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
\`\`\`

Logs: \`sudo journalctl -u otelcol-contrib -f\`.

Releases are published at <https://github.com/open-telemetry/opentelemetry-collector-releases/releases>. Replace the \`VERSION\` value with the latest tag.

> **Note for native installs:** Unlike Docker, the package install reads \`/proc\` and \`/sys\` directly — no \`HOST_PROC\` env vars or \`/hostfs\` mount required. The systemd unit shipped with the package runs as root, so the \`process\` scraper can see processes owned by other users.
`;

    case "linux-rpm":
      return `
## Step 2 — Install the .rpm package (RHEL / Fedora / CentOS / Amazon Linux)

\`\`\`bash
VERSION=0.115.0
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

curl -L -o /tmp/otelcol-contrib.rpm \\
  https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v\${VERSION}/otelcol-contrib_\${VERSION}_linux_\${ARCH}.rpm
sudo rpm -Uvh /tmp/otelcol-contrib.rpm

# Install the config and (re)start the service
sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
\`\`\`

Logs: \`sudo journalctl -u otelcol-contrib -f\`.

> **Note for native installs:** No \`HOST_PROC\` env vars or \`/hostfs\` bind mount needed — the collector reads \`/proc\` and \`/sys\` directly. The packaged systemd unit runs as root, so the \`process\` scraper sees every user's processes.
`;

    case "linux-tarball":
      return `
## Step 2 — Install from a tarball (any Linux distro)

Use this when packages aren't available — Alpine, NixOS, locked-down servers, or container base images you want to instrument from outside.

\`\`\`bash
VERSION=0.115.0
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

curl -L -o /tmp/otelcol.tar.gz \\
  https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v\${VERSION}/otelcol-contrib_\${VERSION}_linux_\${ARCH}.tar.gz

sudo mkdir -p /opt/otelcol-contrib
sudo tar -xzf /tmp/otelcol.tar.gz -C /opt/otelcol-contrib
sudo install -m 0644 config.yaml /opt/otelcol-contrib/config.yaml
\`\`\`

Drop a systemd unit at \`/etc/systemd/system/otelcol-contrib.service\`:

\`\`\`ini
[Unit]
Description=OpenTelemetry Collector
After=network.target

[Service]
ExecStart=/opt/otelcol-contrib/otelcol-contrib --config /opt/otelcol-contrib/config.yaml
Restart=on-failure
RestartSec=5s
User=root

[Install]
WantedBy=multi-user.target
\`\`\`

Then enable and start it:

\`\`\`bash
sudo systemctl daemon-reload
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
\`\`\`

> **Note for native installs:** No \`HOST_PROC\` env vars or \`/hostfs\` mount — the collector reads kernel state directly. Run as root (or grant \`CAP_SYS_PTRACE\`) so the \`process\` scraper can see processes owned by other users.
`;

    case "macos":
      return `
## Step 2 — Install on macOS (Homebrew)

\`\`\`bash
brew install opentelemetry-collector

# Homebrew installs the config under the formula's etc directory.
# Apple Silicon: /opt/homebrew/etc/otelcol  ·  Intel: /usr/local/etc/otelcol
PREFIX=$(brew --prefix)
sudo install -m 0644 config.yaml \${PREFIX}/etc/otelcol/config.yaml

brew services restart opentelemetry-collector
brew services info opentelemetry-collector
\`\`\`

Logs: \`tail -F $(brew --prefix)/var/log/opentelemetry-collector.log\` (path varies by formula version).

> **Heads up:** The Homebrew formula ships the **core** distribution. If you need scrapers that only exist in the **contrib** distribution, install the binary directly from <https://github.com/open-telemetry/opentelemetry-collector-releases/releases> (use the \`darwin\` archive matching your CPU) or run via Docker.
`;

    case "windows":
      return `
## Step 2 — Install on Windows (MSI)

Run from an elevated PowerShell prompt:

\`\`\`powershell
$VERSION = "0.115.0"
$msi = "$env:TEMP\\otelcol-contrib.msi"

Invoke-WebRequest \`
  -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_\${VERSION}_windows_amd64.msi" \`
  -OutFile $msi

Start-Process msiexec.exe -ArgumentList "/i", "$msi", "/quiet" -Wait

# Drop your config into the install dir
Copy-Item config.yaml "C:\\Program Files\\OpenTelemetry Collector Contrib\\config.yaml" -Force

# (Re)start the service that the installer registered
Restart-Service otelcol-contrib
Get-Service otelcol-contrib
\`\`\`

Logs are written to the Windows Application event log under source \`otelcol-contrib\`. Tail with:

\`\`\`powershell
Get-WinEvent -ProviderName otelcol-contrib -MaxEvents 50 | Format-Table -AutoSize -Wrap
\`\`\`

> **Note:** The MSI registers \`otelcol-contrib\` as a Windows service that starts automatically on boot. The \`load\` scraper isn't supported on Windows — the rest of the \`hostmetrics\` config above runs unchanged.
`;

    case "kubernetes":
      return `
## Step 2 — Deploy to Kubernetes (Helm DaemonSet)

This deploys one collector pod per node — the standard production setup for monitoring every node in a cluster.

\`\`\`bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update

cat > values.yaml <<'EOF'
mode: daemonset
image:
  repository: otel/opentelemetry-collector-contrib

# hostmetrics + process scrapers need access to the host kernel namespaces
hostNetwork: true
hostPID: true

presets:
  hostMetrics:
    enabled: true
  kubernetesAttributes:
    enabled: true

config:
  exporters:
    otlphttp/oneuptime:
      endpoint: ${data.oneuptimeUrl}/otlp
      headers:
        x-oneuptime-token: ${data.apiKey}
  service:
    pipelines:
      metrics:
        exporters: [otlphttp/oneuptime]
      logs:
        exporters: [otlphttp/oneuptime]
      traces:
        exporters: [otlphttp/oneuptime]
EOF

helm upgrade --install otel-collector \\
  open-telemetry/opentelemetry-collector \\
  --namespace otel --create-namespace \\
  -f values.yaml
\`\`\`

Each node will appear as a separate host in OneUptime, linked to its Kubernetes cluster.

Logs: \`kubectl -n otel logs -l app.kubernetes.io/name=opentelemetry-collector -f\`.

> **Note:** When using the Helm chart, the \`config.yaml\` from Step 1 is merged into the chart's \`values.yaml\` under the \`config:\` key. The chart's \`hostMetrics\` preset enables the receiver and mounts \`/proc\` and \`/sys\` from the host into each pod for you, so you don't need to repeat the receiver config above — only the exporter that points to OneUptime.
`;
  }
}

export function getHostFooterMarkdown(): string {
  return `
## What you can do next

- Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds).
- The **Metrics** tab visualizes \`system.*\` time-series.
- The **Processes** tab lists processes ordered by CPU once the \`process\` scraper is enabled.
- The **Logs** tab streams any logs whose resource attributes include \`host.name\`.
`;
}
