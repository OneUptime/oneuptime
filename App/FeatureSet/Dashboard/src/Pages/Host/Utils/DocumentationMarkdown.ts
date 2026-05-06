export function getHostInstallationMarkdown(data: {
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

Drop this into \`config.yaml\` next to wherever you'll run the collector:

\`\`\`yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
        metrics:
          system.cpu.utilization:
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

The same \`config.yaml\` is used for every install option below — only the way the collector is started differs.

## Step 2 — Install and run the collector

Pick the option that matches your host.

| If you're running on… | Use option | Why |
| --- | --- | --- |
| Anything (fastest start) | **A. Docker** | One command, works everywhere |
| A long-lived Debian/Ubuntu server | **B. .deb package** | Installs as a systemd service, auto-restarts, picks up package updates |
| RHEL / CentOS / Fedora / Amazon Linux | **C. .rpm package** | Same lifecycle benefits as B, for RPM-based distros |
| A Linux box where you can't install packages | **D. Tarball + systemd** | Drops a single binary into \`/opt\`, no package manager required |
| macOS (developer laptop or Mac mini fleet) | **E. Homebrew** | Native install, managed by \`brew services\` |
| Windows Server | **F. MSI installer** | Installs as a Windows service |
| A Kubernetes cluster | **G. Helm DaemonSet** | One pod per node, monitors every node in the cluster |

> Releases are published at <https://github.com/open-telemetry/opentelemetry-collector-releases/releases>. Replace \`<VERSION>\` (e.g. \`0.115.0\`) with the latest tag in the commands below.

### Option A — Docker (works on Linux, macOS, Windows, WSL)

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

### Option B — Debian / Ubuntu (.deb package)

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

### Option C — RHEL / CentOS / Fedora / Amazon Linux (.rpm package)

\`\`\`bash
VERSION=0.115.0
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

curl -L -o /tmp/otelcol-contrib.rpm \\
  https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v\${VERSION}/otelcol-contrib_\${VERSION}_linux_\${ARCH}.rpm
sudo rpm -Uvh /tmp/otelcol-contrib.rpm

sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml
sudo systemctl enable --now otelcol-contrib
\`\`\`

### Option D — Linux tarball + systemd (any distro)

Use this when packages aren't available (Alpine, NixOS, locked-down hosts, container base images, etc.).

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

Then enable it:

\`\`\`bash
sudo systemctl daemon-reload
sudo systemctl enable --now otelcol-contrib
\`\`\`

### Option E — macOS (Homebrew)

\`\`\`bash
brew install opentelemetry-collector

# Homebrew installs the config under the formula's etc directory.
# Apple Silicon: /opt/homebrew/etc/otelcol  ·  Intel: /usr/local/etc/otelcol
PREFIX=$(brew --prefix)
sudo install -m 0644 config.yaml \${PREFIX}/etc/otelcol/config.yaml

brew services restart opentelemetry-collector
brew services info opentelemetry-collector
\`\`\`

> The Homebrew formula ships the **core** distribution. If you need scrapers that only exist in the **contrib** distribution, install the binary directly from GitHub releases (use Option D's commands with \`darwin\` instead of \`linux\` in the URL) or run via Docker.

### Option F — Windows (MSI installer)

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

### Option G — Kubernetes (Helm DaemonSet)

Deploy one collector pod per node. This is the most common production setup for clusters.

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

## Notes for native (non-Docker) installs

- Native installs read \`/proc\` and \`/sys\` directly — you do **not** need \`HOST_PROC\` / \`HOST_SYS\` env vars or any \`/hostfs\` mount.
- The \`process\` scraper needs to run as root (or have \`CAP_SYS_PTRACE\`) to see processes owned by other users.
- For the Linux package and tarball options, the systemd unit shipped with the .deb/.rpm already runs as root.

## Which install method should I pick?

- **Trying it out / single host?** Start with **Docker** (Option A). It's the fastest path to a working collector and works on every OS.
- **Production Linux fleet?** Use the **.deb / .rpm package** (Option B or C). systemd handles restarts, log rotation, and version upgrades.
- **No package manager available?** Use the **tarball + systemd** path (Option D).
- **Mixed macOS dev fleet?** **Homebrew** (Option E) is the standard.
- **Windows Server?** Use the **MSI** (Option F) — it registers the collector as a Windows service automatically.
- **Kubernetes cluster?** Use the **Helm DaemonSet** (Option G) so every node is monitored without per-node provisioning.

## What you can do next

- Open the Hosts list in OneUptime — your host appears automatically once the first metric batch lands.
- The **Metrics** tab visualizes \`system.*\` series time-series.
- The **Processes** tab lists processes ordered by CPU once the \`process\` scraper is enabled.
- The **Logs** tab streams any logs whose resource attributes include \`host.name\`.
`;
}
