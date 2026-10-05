import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
} from "../../../Components/SetupGuide/SetupGuide";
import { getKubernetesSetupGuide } from "../../Kubernetes/Utils/DocumentationMarkdown";
import { HOST_COLLECTOR_VERSION } from "../../../Components/AgentVersion/AgentKind";

/*
 * How the OpenTelemetry Collector gets onto the host. Every method runs the
 * upstream otelcol-contrib build with the same config.yaml; what differs is
 * the install, the service manager that keeps it running, and which host
 * tabs the method can fill. Kubernetes nodes are the exception: OneUptime
 * files them under their cluster, so that option installs the Kubernetes
 * agent instead.
 */
export type HostInstallMethod =
  | "docker"
  | "linux-deb"
  | "linux-rpm"
  | "linux-tarball"
  | "macos"
  | "windows"
  | "kubernetes";

export const HOST_INSTALL_METHODS: Array<SetupGuideOption<HostInstallMethod>> =
  [
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
      description: "Release tarball of otelcol-contrib, run by launchd.",
    },
    {
      key: "windows",
      label: "Windows",
      description: "Upstream otelcol-contrib, registered as a Windows service.",
    },
    {
      key: "kubernetes",
      label: "Kubernetes",
      description:
        "Cluster nodes, monitored by the OneUptime Kubernetes agent.",
    },
  ];

export const DEFAULT_HOST_INSTALL_METHOD: HostInstallMethod = "docker";

export function resolveHostInstallMethod(
  method: string | null | undefined,
): HostInstallMethod {
  return (
    resolveSetupGuideOption(HOST_INSTALL_METHODS, method) ||
    DEFAULT_HOST_INSTALL_METHOD
  );
}

/*
 * The installs that run the collector natively under systemd. Only these are
 * offered the systemd receiver: it talks to the host's D-Bus socket, which a
 * containerised collector (Docker, Kubernetes) cannot reach, so offering it
 * there would send people down a path that cannot work.
 */
export const NATIVE_LINUX_INSTALL_METHODS: ReadonlyArray<HostInstallMethod> = [
  "linux-deb",
  "linux-rpm",
  "linux-tarball",
];

function isNativeLinux(method: HostInstallMethod): boolean {
  return NATIVE_LINUX_INSTALL_METHODS.includes(method);
}

export interface HostSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  method: HostInstallMethod;
}

// The methods that put a collector on the host itself.
export type HostCollectorMethod = Exclude<HostInstallMethod, "kubernetes">;

export const HOST_COLLECTOR_METHODS: ReadonlyArray<HostCollectorMethod> = [
  "docker",
  "linux-deb",
  "linux-rpm",
  "linux-tarball",
  "macos",
  "windows",
];

/*
 * The install methods a host's collector can have been installed with,
 * from the os.type it reports: a Windows host or a Mac ran the native
 * install for it, and a Linux host any of the four Linux ones (a Docker
 * collector reports the Linux it runs on, on a Mac's or Windows' Docker VM
 * too). Unknown: every method.
 */
export function getHostCollectorMethodsForOsType(
  osType: string | null | undefined,
): Array<HostCollectorMethod> {
  const os: string = (osType || "").trim().toLowerCase();

  if (os === "windows") {
    return ["windows"];
  }
  if (os === "darwin" || os === "macos") {
    return ["macos"];
  }
  if (os === "linux") {
    return ["docker", "linux-deb", "linux-rpm", "linux-tarball"];
  }
  return [...HOST_COLLECTOR_METHODS];
}

interface HostCollectorGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  method: HostCollectorMethod;
}

const RELEASES_URL: string =
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases";

/*
 * Every install method installs the otelcol-contrib release OneUptime pins
 * (HOST_COLLECTOR_VERSION), and the config stamps the same version as
 * oneuptime.agent.version: that is the host's agent version, which gets a
 * sign beside it once OneUptime pins a newer release.
 */
const PINNED_VERSION_COMMENT: string =
  "the release config.yaml reports as the agent version";

// The Linux and macOS installs download the pinned otelcol-contrib release.
const PINNED_VERSION: string = `VERSION=${HOST_COLLECTOR_VERSION}   # ${PINNED_VERSION_COMMENT}`;

const HOST_COLLECTOR_IMAGE: string = `otel/opentelemetry-collector-contrib:${HOST_COLLECTOR_VERSION}`;

const DOCKER_CONTAINER_NAME: string = "otel-collector";

const MACOS_PLIST_PATH: string =
  "/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist";

const WINDOWS_INSTALL_DIR: string = "C:\\Program Files\\otelcol-contrib";

/**
 * The collector config every install method except Kubernetes runs, filled
 * in with the reader's OneUptime URL and ingestion key.
 */
export function getHostCollectorConfig(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `receivers:
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
        # surfaces it on the Host Network card and on the host's
        # Inventory item, so enable it here.
        host.ip:
          enabled: true
        # host.mac and os.version are opt-in as well, and fill the
        # MAC address and OS version rows of the Inventory item.
        host.mac:
          enabled: true
        os.type:
          enabled: true
        os.description:
          enabled: true
        os.version:
          enabled: true
  # The collector release this config is for. OneUptime shows it as the
  # host's agent version, with a sign beside it once a newer one is out.
  # Change it only together with the collector you install.
  resource:
    attributes:
      - key: oneuptime.agent.version
        value: "${HOST_COLLECTOR_VERSION}"
        action: upsert
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
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp/oneuptime]`;
}

/*
 * The container the Docker install runs. Its upgrade removes the container
 * and runs this again: the image tag is the pin.
 */
function getDockerRunCommand(): string {
  return `docker run -d \\
  --name ${DOCKER_CONTAINER_NAME} \\
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
  ${HOST_COLLECTOR_IMAGE} \\
  --config /etc/otelcol-contrib/config.yaml`;
}

// The Windows download, shared by the install and the upgrade.
const WINDOWS_DOWNLOAD: string = `$version = "${HOST_COLLECTOR_VERSION}"   # ${PINNED_VERSION_COMMENT}
$dest = "${WINDOWS_INSTALL_DIR}"
$tar  = "$env:TEMP\\otelcol-contrib.tar.gz"`;

const WINDOWS_DOWNLOAD_URL: string = `${RELEASES_URL}/download/v$version/otelcol-contrib_\${version}_windows_amd64.tar.gz`;

/**
 * How to move a host's collector to the release this OneUptime pins, per
 * install method: the new release over the installed one, the config.yaml
 * saved again in the current folder (it stamps the new version) put in
 * place, and the collector restarted on both. The guide's "Upgrade the
 * collector" topic and the dialog beside an outdated agent version
 * (Components/AgentVersion) both show it.
 */
export function getHostCollectorUpgradeCommand(
  method: HostCollectorMethod,
): string {
  switch (method) {
    case "docker":
      return `docker rm -f ${DOCKER_CONTAINER_NAME}
${getDockerRunCommand()}`;

    case "linux-deb":
      return `${PINNED_VERSION}
ARCH=$(dpkg --print-architecture)   # amd64 or arm64

curl -fL -o /tmp/otelcol-contrib.deb \\
  ${RELEASES_URL}/download/v\${VERSION}/otelcol-contrib_\${VERSION}_linux_\${ARCH}.deb
# --force-confold: keep the installed config without asking; the next line replaces it
sudo dpkg -i --force-confold /tmp/otelcol-contrib.deb

# Put the new config in place and restart the service on the new release
sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml
sudo systemctl restart otelcol-contrib
sudo systemctl status otelcol-contrib`;

    case "linux-rpm":
      return `${PINNED_VERSION}
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

curl -fL -o /tmp/otelcol-contrib.rpm \\
  ${RELEASES_URL}/download/v\${VERSION}/otelcol-contrib_\${VERSION}_linux_\${ARCH}.rpm
sudo rpm -Uvh /tmp/otelcol-contrib.rpm

# Put the new config in place and restart the service on the new release
sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml
sudo systemctl restart otelcol-contrib
sudo systemctl status otelcol-contrib`;

    case "linux-tarball":
      return `${PINNED_VERSION}
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

curl -fL -o /tmp/otelcol.tar.gz \\
  ${RELEASES_URL}/download/v\${VERSION}/otelcol-contrib_\${VERSION}_linux_\${ARCH}.tar.gz

# Stop the collector while its binary is replaced, then start the new one
sudo systemctl stop otelcol-contrib
sudo tar -xzf /tmp/otelcol.tar.gz -C /opt/otelcol-contrib
sudo install -m 0644 config.yaml /opt/otelcol-contrib/config.yaml
sudo systemctl start otelcol-contrib
sudo systemctl status otelcol-contrib`;

    case "macos":
      return `${PINNED_VERSION}
ARCH=$(uname -m | sed 's/x86_64/amd64/')   # arm64 on Apple silicon, amd64 on Intel

curl -fL -o /tmp/otelcol-contrib.tar.gz \\
  ${RELEASES_URL}/download/v\${VERSION}/otelcol-contrib_\${VERSION}_darwin_\${ARCH}.tar.gz

# Stop the collector while its binary is replaced, then start the new one
sudo launchctl unload ${MACOS_PLIST_PATH}
sudo tar -xzf /tmp/otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml
sudo launchctl load -w ${MACOS_PLIST_PATH}`;

    case "windows":
      return `# Download the new release (amd64; use _windows_arm64.tar.gz on ARM)
${WINDOWS_DOWNLOAD}
Invoke-WebRequest -Uri "${WINDOWS_DOWNLOAD_URL}" -OutFile $tar

# Stop the service while its binary is replaced, then start the new one
Stop-Service otelcol-contrib
tar -xf $tar -C $dest
Copy-Item config.yaml "$dest\\config.yaml" -Force
Start-Service otelcol-contrib`;
  }
}

// The language of a method's commands, for its code blocks.
export function getHostCollectorCommandLanguage(
  method: HostCollectorMethod,
): "bash" | "powershell" {
  return method === "windows" ? "powershell" : "bash";
}

function getPrerequisites(method: HostCollectorMethod): Array<string> {
  const network: string =
    "Network access from the host to your OneUptime instance";

  switch (method) {
    case "docker":
      return ["Docker installed on the host you want to monitor", network];
    case "linux-deb":
      return ["A Debian or Ubuntu host (amd64 or arm64) with `sudo`", network];
    case "linux-rpm":
      return [
        "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`",
        network,
      ];
    case "linux-tarball":
      return [
        "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`",
        network,
      ];
    case "macos":
      return [
        "A Mac (Apple silicon or Intel) and an administrator account for `sudo`",
        network,
      ];
    case "windows":
      return [
        "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)",
        "An elevated PowerShell prompt (Run as administrator)",
        network,
      ];
  }
}

function getPlaceholderNote(apiKey: string): string {
  if (apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER) {
    return "";
  }
  return `\n\nPick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`;
}

function getConfigStep(data: HostCollectorGuideOptions): SetupGuideStep {
  let where: string =
    "Save this as `config.yaml` in your current directory — step 3 installs it.";

  if (data.method === "docker") {
    where =
      "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.";
  } else if (data.method === "windows") {
    where =
      "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.";
  }

  return {
    title: "Save the collector config",
    description:
      "One config for every install method: what to collect, and where to send it.",
    markdown: `${where}

${codeBlock("yaml", getHostCollectorConfig(data))}${getPlaceholderNote(data.apiKey)}`,
  };
}

/*
 * The native Linux installs run as a systemd service. The packaged unit
 * runs as the unprivileged otelcol-contrib user; the tarball unit below is
 * written with User=root.
 */
const PACKAGED_UNIT_NOTE: string =
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.";

function getInstallStep(data: HostCollectorGuideOptions): SetupGuideStep {
  switch (data.method) {
    case "docker":
      return {
        title: "Run the collector with Docker",
        description:
          "Start the collector in a container that can see the host's processes and filesystems.",
        markdown: `${codeBlock("bash", getDockerRunCommand())}

\`--network host\`, \`--pid host\`, and the \`/hostfs\` bind mount let the \`hostmetrics\` and \`process\` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.`,
      };

    case "linux-deb":
      return {
        title: "Install the collector",
        description:
          "Install the otelcol-contrib .deb package and restart it with your config.",
        markdown: `${codeBlock(
          "bash",
          `${PINNED_VERSION}
ARCH=$(dpkg --print-architecture)   # amd64 or arm64

curl -fL -o /tmp/otelcol-contrib.deb \\
  ${RELEASES_URL}/download/v\${VERSION}/otelcol-contrib_\${VERSION}_linux_\${ARCH}.deb
sudo dpkg -i /tmp/otelcol-contrib.deb

# Install the config and restart the service — the package has already
# started it with its own default config
sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml
sudo systemctl enable otelcol-contrib
sudo systemctl restart otelcol-contrib
sudo systemctl status otelcol-contrib`,
        )}

${PACKAGED_UNIT_NOTE}`,
      };

    case "linux-rpm":
      return {
        title: "Install the collector",
        description:
          "Install the otelcol-contrib .rpm package and restart it with your config.",
        markdown: `${codeBlock(
          "bash",
          `${PINNED_VERSION}
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

curl -fL -o /tmp/otelcol-contrib.rpm \\
  ${RELEASES_URL}/download/v\${VERSION}/otelcol-contrib_\${VERSION}_linux_\${ARCH}.rpm
sudo rpm -Uvh /tmp/otelcol-contrib.rpm

# Install the config and restart the service — the package has already
# started it with its own default config
sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml
sudo systemctl enable otelcol-contrib
sudo systemctl restart otelcol-contrib
sudo systemctl status otelcol-contrib`,
        )}

${PACKAGED_UNIT_NOTE}`,
      };

    case "linux-tarball":
      return {
        title: "Install the collector",
        description:
          "Unpack the static binary and run it with a systemd unit of its own.",
        markdown: `${codeBlock(
          "bash",
          `${PINNED_VERSION}
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

curl -fL -o /tmp/otelcol.tar.gz \\
  ${RELEASES_URL}/download/v\${VERSION}/otelcol-contrib_\${VERSION}_linux_\${ARCH}.tar.gz

sudo mkdir -p /opt/otelcol-contrib
sudo tar -xzf /tmp/otelcol.tar.gz -C /opt/otelcol-contrib
sudo install -m 0644 config.yaml /opt/otelcol-contrib/config.yaml`,
        )}

Drop a systemd unit at \`/etc/systemd/system/otelcol-contrib.service\`:

${codeBlock(
  "ini",
  `[Unit]
Description=OpenTelemetry Collector
After=network.target

[Service]
ExecStart=/opt/otelcol-contrib/otelcol-contrib --config /opt/otelcol-contrib/config.yaml
Restart=on-failure
RestartSec=5s
User=root

[Install]
WantedBy=multi-user.target`,
)}

Then enable and start it:

${codeBlock(
  "bash",
  `sudo systemctl daemon-reload
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib`,
)}

Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No \`HOST_PROC\` env vars or \`/hostfs\` mount are needed: the collector reads kernel state directly, and \`User=root\` lets the \`process\` scraper see processes owned by other users (granting \`CAP_SYS_PTRACE\` instead works too).`,
      };

    case "macos":
      return {
        title: "Install and start the collector",
        description:
          "Install the otelcol-contrib release for your Mac and run it as a launchd service.",
        markdown: `${codeBlock(
          "bash",
          `${PINNED_VERSION}
ARCH=$(uname -m | sed 's/x86_64/amd64/')   # arm64 on Apple silicon, amd64 on Intel

curl -fL -o /tmp/otelcol-contrib.tar.gz \\
  ${RELEASES_URL}/download/v\${VERSION}/otelcol-contrib_\${VERSION}_darwin_\${ARCH}.tar.gz

sudo mkdir -p /usr/local/otelcol-contrib /usr/local/bin /etc/otelcol-contrib
sudo tar -xzf /tmp/otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml`,
        )}

Create \`${MACOS_PLIST_PATH}\`:

${codeBlock(
  "xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.oneuptime.otelcol-contrib</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/otelcol-contrib</string>
    <string>--config=/etc/otelcol-contrib/config.yaml</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/otelcol-contrib.out.log</string>
  <key>StandardErrorPath</key><string>/var/log/otelcol-contrib.err.log</string>
</dict>
</plist>`,
)}

Load it:

${codeBlock("bash", `sudo launchctl load -w ${MACOS_PLIST_PATH}`)}

> **Install the contrib build, as above.** The core \`otelcol\` build has no \`resourcedetection\` processor, so it refuses to start with this config.`,
      };

    case "windows":
      return {
        title: "Install and start the collector",
        description:
          "Download otelcol-contrib and register it as a Windows service.",
        markdown: `On Windows, install the upstream **\`otelcol-contrib\`** collector — from **v0.155.0** it bundles the \`windows_service\` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:

${codeBlock(
  "powershell",
  `# Download otelcol-contrib for Windows (amd64; use _windows_arm64.tar.gz on ARM)
${WINDOWS_DOWNLOAD}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Invoke-WebRequest -Uri "${WINDOWS_DOWNLOAD_URL}" -OutFile $tar
tar -xf $tar -C $dest   # tar.exe ships with Windows 10 1803+ / Server 2019+

# Use the config.yaml you saved in step 2
Copy-Item config.yaml "$dest\\config.yaml" -Force

# Register and start it as a Windows service (runs as LocalSystem).
# --% hands the rest of the line to sc.exe unchanged, so its quoting
# survives PowerShell — hence the literal paths.
sc.exe --% create "otelcol-contrib" binPath= "\\"${WINDOWS_INSTALL_DIR}\\otelcol-contrib.exe\\" --config=\\"${WINDOWS_INSTALL_DIR}\\config.yaml\\"" start= auto DisplayName= "OpenTelemetry Collector (OneUptime)"
sc.exe start "otelcol-contrib"`,
)}

> **Note:** The service runs as \`LocalSystem\` so it can read every Windows service. On Windows the \`load\` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the \`hostmetrics\` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed \`.msi\` installer.`,
      };
  }
}

// Where the running collector logs, per method.
function getLogsMarkdown(method: HostCollectorMethod): string {
  switch (method) {
    case "docker":
      return codeBlock("bash", "docker logs -f otel-collector");
    case "linux-deb":
    case "linux-rpm":
    case "linux-tarball":
      return codeBlock(
        "bash",
        "sudo systemctl status otelcol-contrib\nsudo journalctl -u otelcol-contrib -f",
      );
    case "macos":
      return codeBlock(
        "bash",
        "sudo launchctl list | grep otelcol-contrib\ntail -f /var/log/otelcol-contrib.err.log",
      );
    case "windows":
      return `${codeBlock("powershell", 'sc.exe query "otelcol-contrib"')}

Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source \`otelcol-contrib\`).`;
  }
}

function getVerifyStep(method: HostCollectorMethod): SetupGuideStep {
  return {
    title: "Check the host appears",
    description:
      "The host shows up in Hosts once its first metrics arrive, usually within 30 seconds.",
    markdown: `Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:

${getLogsMarkdown(method)}`,
  };
}

// The collector's config file for a method, as a phrase for the topics below.
function getConfigLocation(method: HostInstallMethod): string {
  switch (method) {
    case "linux-deb":
    case "linux-rpm":
    case "macos":
      return "`/etc/otelcol-contrib/config.yaml`";
    case "linux-tarball":
      return "`/opt/otelcol-contrib/config.yaml`";
    case "windows":
      return `\`${WINDOWS_INSTALL_DIR}\\config.yaml\``;
    default:
      return "the `config.yaml` you mounted into the container";
  }
}

// How a config edit reaches the running collector, per method.
function getRestartMarkdown(method: HostInstallMethod): string {
  switch (method) {
    case "docker":
      return `Then recreate the container so it reads the edited file — remove it, and run the \`docker run\` command from step 3 again:

${codeBlock("bash", "docker rm -f otel-collector")}`;
    case "macos":
      return `Then restart the collector:

${codeBlock(
  "bash",
  `sudo launchctl unload ${MACOS_PLIST_PATH}\nsudo launchctl load -w ${MACOS_PLIST_PATH}`,
)}`;
    case "windows":
      return `Then restart the service:

${codeBlock("powershell", "Restart-Service otelcol-contrib")}`;
    default:
      return `Then restart the service:

${codeBlock("bash", "sudo systemctl restart otelcol-contrib")}`;
  }
}

const MERGE_NOTE: string =
  "Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.";

function getSystemdTopic(method: HostInstallMethod): SetupGuideTopic {
  const privileges: string =
    method === "linux-tarball"
      ? "so it needs no extra rights."
      : "so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights.";

  return {
    title: "Enable the Systemd Units tab",
    summary:
      "Report the state of every systemd unit on the host's Systemd Units tab.",
    markdown: `\`otelcol-contrib\` has bundled the \`systemd\` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to ${getConfigLocation(method)} and the metrics pipeline. ${MERGE_NOTE}

${codeBlock(
  "yaml",
  `receivers:
  systemd:
    collection_interval: 30s
    # Which units to scrape, as systemctl unit patterns. The default is
    # every service; narrow it to cut volume on hosts with many units:
    units: ["*.service"]
    # units: [nginx.service, postgresql.service, "*.timer"]
    metrics:
      # Per-service CPU time is on by default and doubles this receiver's
      # datapoint count; the Systemd Units tab does not use it. On
      # v0.142.0 this key is systemd.unit.cpu.time instead — naming a
      # metric your build does not have stops the collector at startup.
      systemd.service.cpu.time:
        enabled: false

service:
  pipelines:
    metrics:
      # Add systemd alongside the hostmetrics receiver. Keep
      # resourcedetection — it is what stamps host.name onto each unit —
      # and resource, which reports the collector's version.
      receivers: [hostmetrics, systemd]
      processors: [resourcedetection, resource, batch]`,
)}

${getRestartMarkdown(method)}

The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as \`systemctl list-units\`, which systemd allows unprivileged, ${privileges} A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (\`active\`, \`failed\`, \`inactive\`, ...).

Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow \`units:\` or raise \`collection_interval\` rather than scraping everything.`,
  };
}

function getWindowsServicesTopic(): SetupGuideTopic {
  return {
    title: "Enable the Windows Services tab",
    summary:
      "Report each Windows service's running state and startup type on the host's Services tab.",
    markdown: `From **v0.155.0** \`otelcol-contrib\` includes the \`windows_service\` receiver — turn it on by adding it to ${getConfigLocation("windows")} and the metrics pipeline. ${MERGE_NOTE}

${codeBlock(
  "yaml",
  `receivers:
  windows_service:
    collection_interval: 30s
    # Collect every service by default. To cut volume / avoid access-denied
    # noise, list only the ones you care about:
    # include_services: [Spooler, W3SVC, MSSQLSERVER]

service:
  pipelines:
    metrics:
      # Add windows_service alongside the hostmetrics receiver.
      receivers: [hostmetrics, windows_service]`,
)}

${getRestartMarkdown("windows")}

The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.`,
  };
}

function getHardwareIntro(method: HostInstallMethod): string {
  let source: string = "They come from the machine's firmware through DMI.";

  if (method === "linux-deb" || method === "linux-rpm") {
    source =
      "They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself.";
  } else if (method === "windows") {
    source = "They come from the machine's firmware through WMI.";
  } else if (method === "macos") {
    source = "They come from the machine's firmware.";
  }

  return `The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** ${source}`;
}

const HARDWARE_ALIASES: string =
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.";

const HARDWARE_MOBILE_WARNING: string =
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.";

const HARDWARE_PIPELINE: string = `service:
  pipelines:
    metrics:
      processors: [resourcedetection, resource, resource/oneuptime-hardware, batch]`;

// How to read the four values on the machine itself, per OS.
function getHardwareReadingMarkdown(method: HostInstallMethod): string {
  if (method === "macos") {
    return `On a Mac, read them like this — the manufacturer is \`Apple Inc.\`:

${codeBlock(
  "bash",
  `ioreg -l | awk -F'"' '/IOPlatformSerialNumber/{print $4}'   # host.serial_number
sysctl -n hw.model                                          # device.model.name
system_profiler SPHardwareDataType | awk -F': ' '/System Firmware Version/{print $2}'   # device.firmware.version`,
)}

\`hw.model\` is the model *identifier* (\`MacBookPro18,3\`), not the marketing name. Put it in \`device.model.name\` anyway — \`device.model.identifier\` marks a batch as a mobile app.`;
  }

  return `On Linux, read them as root (\`bios_version\` is readable by anyone):

${codeBlock(
  "bash",
  `cat /sys/class/dmi/id/product_serial   # host.serial_number
cat /sys/class/dmi/id/sys_vendor       # device.manufacturer
cat /sys/class/dmi/id/product_name     # device.model.name
cat /sys/class/dmi/id/bios_version     # device.firmware.version`,
)}`;
}

function getHardwareTopic(method: HostInstallMethod): SetupGuideTopic {
  const title: string =
    "Record the serial number, make, model and firmware version";
  const summary: string =
    "Stamp the hardware facts no detector can read onto the host's Inventory item.";

  if (method === "windows") {
    return {
      title: title,
      summary: summary,
      markdown: `${getHardwareIntro(method)}

Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:

${codeBlock(
  "powershell",
  `$bios = Get-CimInstance -ClassName Win32_BIOS
$cs   = Get-CimInstance -ClassName Win32_ComputerSystem

# Quote for YAML: trim, escape any embedded quote, wrap in single quotes.
# The cast to string first is what keeps this working on machines whose
# firmware leaves a field empty — .Trim() on a null value throws.
function Format-YamlValue($value) {
  "'" + ("$value".Trim() -replace "'", "''") + "'"
}

@"
  resource/oneuptime-hardware:
    attributes:
      - key: host.serial_number
        value: $(Format-YamlValue $bios.SerialNumber)
        action: upsert
      - key: device.manufacturer
        value: $(Format-YamlValue $cs.Manufacturer)
        action: upsert
      - key: device.model.name
        value: $(Format-YamlValue $cs.Model)
        action: upsert
      - key: device.firmware.version
        value: $(Format-YamlValue $bios.SMBIOSBIOSVersion)
        action: upsert
"@`,
)}

It prints one processor entry, already indented. Add it inside the \`processors:\` block your \`config.yaml\` already has — alongside \`resourcedetection:\`, \`resource:\` and \`batch:\`, not as a second \`processors:\` key — then name it in the metrics pipeline:

${codeBlock("yaml", HARDWARE_PIPELINE)}

${getRestartMarkdown(method)}

Use \`Get-CimInstance\`, not the deprecated \`Get-WmiObject\` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as \`''\`; drop that attribute rather than shipping a blank one.

Within a few minutes the machine's **Inventory** item shows \`host.serial_number\`, \`device.manufacturer\`, \`device.model.name\` and \`device.firmware.version\` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.

${HARDWARE_ALIASES}

${HARDWARE_MOBILE_WARNING}`,
    };
  }

  return {
    title: title,
    summary: summary,
    markdown: `${getHardwareIntro(method)} Read them once at provisioning time and stamp them onto the resource — add this processor to ${getConfigLocation(method)} and name it in the metrics pipeline. ${MERGE_NOTE}

${codeBlock(
  "yaml",
  `processors:
  resource/oneuptime-hardware:
    attributes:
      - key: host.serial_number
        value: "7XYZ123"
        action: upsert
      - key: device.manufacturer
        value: "Dell Inc."
        action: upsert
      - key: device.model.name
        value: "OptiPlex 7090"
        action: upsert
      - key: device.firmware.version
        value: "1.21.0"
        action: upsert

${HARDWARE_PIPELINE}`,
)}

${getRestartMarkdown(method)}

The values are the machine's own, so they are written once by whatever provisions it. ${getHardwareReadingMarkdown(method)}

Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.

${HARDWARE_ALIASES}

${HARDWARE_MOBILE_WARNING}`,
  };
}

function getLabelsTopic(method: HostInstallMethod): SetupGuideTopic {
  return {
    title: "Tag the host with project labels",
    summary:
      "Attach labels such as team or environment to the host and the telemetry it sends.",
    markdown: `Any resource attribute prefixed with \`oneuptime.label.\` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: \`oneuptime.label.<dimension>=<value>\` becomes a label named \`<dimension>:<value>\`.

Add a \`resource\` processor to ${getConfigLocation(method)} and reference it from the metrics pipeline. ${MERGE_NOTE}

${codeBlock(
  "yaml",
  `processors:
  resource/oneuptime-labels:
    attributes:
      - key: oneuptime.label.team
        value: payments
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert
      - key: oneuptime.label.region
        value: us-east-1
        action: upsert

service:
  pipelines:
    metrics:
      processors: [resourcedetection, resource, resource/oneuptime-labels, batch]`,
)}

${getRestartMarkdown(method)}

The host shows up tagged \`team:payments\`, \`env:production\`, and \`region:us-east-1\`. Labels are matched case-insensitively, so an existing manually-created \`Production\` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.`,
  };
}

function getReportedTopic(method: HostInstallMethod): SetupGuideTopic {
  const tabs: Array<string> = [
    "- The **Metrics** tab visualizes `system.*` time-series.",
    "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.",
  ];

  if (isNativeLinux(method)) {
    tabs.push(
      "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).",
    );
  }

  if (method === "windows") {
    tabs.push(
      "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).",
    );
  }

  tabs.push(
    "- The **Logs** tab streams any logs whose resource attributes include `host.name`.",
  );

  return {
    title: "What gets reported",
    summary:
      "How the host is discovered, what fills its Inventory item, and which host tabs fill in.",
    markdown: `Hosts are auto-discovered from the OTel \`host.name\` resource attribute, which the \`resourcedetection\` processor sets. OneUptime registers the host once a batch that carries \`host.name\` also carries any of:

- \`hostmetrics\` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR
- \`process\` scraper metrics (per-process CPU/memory/threads), OR
- an \`os.type\` or \`container.runtime\` resource attribute, on metrics, logs or traces

…and starts populating the Overview, Metrics, Processes, and Logs tabs. \`host.id\` or \`host.arch\` alone do not register a host, and telemetry that carries a Kubernetes identity (\`k8s.cluster.name\`, \`k8s.node.name\`, \`k8s.pod.name\`, …) is filed under its Kubernetes cluster instead.

The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. \`host.ip\`, \`host.mac\`, \`host.arch\`, \`host.id\`, \`os.type\`, \`os.description\` and \`os.version\` all come from the \`resourcedetection\` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).

Once the host is reporting:

${tabs.join("\n")}`,
  };
}

export const HOST_AI_AGENT_TOPIC_TITLE: string = "Add the OneUptime AI agent";

export const HOST_AI_AGENT_INSTALL_COMMAND: string = `curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/HostAIAgent/install.sh -o install.sh
sudo bash install.sh`;

/*
 * The Host AI agent (agents/HostAIAgent): a host has no OneUptime container
 * for it to sit beside, so it has its own installer. AI investigations are on
 * by default for every host — the agent is what lets OneUptime AI run
 * commands there. Linux only: it enters the host's namespaces from a
 * privileged container.
 */
function getAiAgentTopic(method: HostCollectorMethod): SetupGuideTopic {
  return {
    title: HOST_AI_AGENT_TOPIC_TITLE,
    summary:
      "A container that lets OneUptime AI run read-only commands on this Linux host while it investigates. AI investigations are on by default.",
    markdown: `**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as \`systemctl status\`, \`df -h\`, \`free -m\` and \`ps aux\`, and changes nothing unless you allow fixes. It is a Linux container with its own installer${
      method === "docker" ? ", so add it on Linux hosts only" : ""
    }; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:

${codeBlock("bash", HOST_AI_AGENT_INSTALL_COMMAND)}

It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).`,
  };
}

export const HOST_COLLECTOR_UPGRADE_TOPIC_TITLE: string =
  "Upgrade the collector";

/*
 * How to move the collector to the release this OneUptime pins. The config
 * stamps the release it is for, so the upgrade saves the config again
 * (step 2) and installs the new release over the old one.
 */
function getUpgradeTopic(method: HostCollectorMethod): SetupGuideTopic {
  return {
    title: HOST_COLLECTOR_UPGRADE_TOPIC_TITLE,
    summary:
      "Install the release OneUptime pins, with the config that reports it.",
    markdown: `The config reports the collector release it is for (\`oneuptime.agent.version\`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.

1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.
2. In the folder that holds it, install the new release and restart the collector:

${codeBlock(getHostCollectorCommandLanguage(method), getHostCollectorUpgradeCommand(method))}`,
  };
}

function getAdvancedTopics(
  method: HostCollectorMethod,
): Array<SetupGuideTopic> {
  const topics: Array<SetupGuideTopic> = [];

  if (isNativeLinux(method)) {
    topics.push(getSystemdTopic(method));
  }

  if (method === "windows") {
    topics.push(getWindowsServicesTopic());
  }

  // The Host AI agent runs on Linux only.
  if (isNativeLinux(method) || method === "docker") {
    topics.push(getAiAgentTopic(method));
  }

  // The hardware values belong to one machine, stamped into its own config.
  topics.push(
    getHardwareTopic(method),
    getLabelsTopic(method),
    getReportedTopic(method),
    getUpgradeTopic(method),
  );

  return topics;
}

function getCollectorLogsPhrase(method: HostCollectorMethod): string {
  switch (method) {
    case "docker":
      return "`docker logs -f otel-collector`";
    case "macos":
      return "`tail -f /var/log/otelcol-contrib.err.log`";
    case "windows":
      return "**Event Viewer → Windows Logs → Application** (source `otelcol-contrib`)";
    default:
      return "`sudo journalctl -u otelcol-contrib -f`";
  }
}

const KEY_REFUSAL_NOTE: string =
  "An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry).";

function getTroubleshootingTopics(data: {
  oneuptimeUrl: string;
  method: HostCollectorMethod;
}): Array<SetupGuideTopic> {
  const method: HostCollectorMethod = data.method;
  const logs: string = getCollectorLogsPhrase(method);

  const reachability: string =
    method === "windows"
      ? `\`curl.exe -v ${data.oneuptimeUrl}/otlp\``
      : `\`curl -v ${data.oneuptimeUrl}/otlp\``;

  const topics: Array<SetupGuideTopic> = [
    {
      title: "The host does not appear in Hosts",
      markdown: `1. Read the collector's logs for export errors: ${logs}. ${KEY_REFUSAL_NOTE} Pick a working key in step 1 and update \`x-oneuptime-token\` in ${getConfigLocation(method)}.
2. Check the host can reach OneUptime: ${reachability} from the same machine.
3. Keep \`resourcedetection\` in the metrics pipeline — it sets \`host.name\`, which is how OneUptime recognises the host.`,
    },
  ];

  if (method === "docker") {
    topics.push({
      title: "Metrics describe the container instead of the host",
      markdown:
        "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.",
    });
  }

  if (isNativeLinux(method)) {
    topics.push({
      title: "The Systemd Units tab stays empty",
      markdown: `1. Keep \`resourcedetection\` in the same metrics pipeline as the \`systemd\` receiver — the receiver attaches only \`systemd.unit.name\` to each unit, so without \`host.name\` the samples never attach to the host.
2. Run \`otelcol-contrib\` v0.143.0 or newer: older builds stop at startup with \`'receivers' unknown type: "systemd"\`, or name the CPU metric differently (see **Enable the Systemd Units tab**).
3. Check the collector can reach the system D-Bus: \`/run/dbus/system_bus_socket\` must exist, and \`systemctl list-units\` run as the collector's user is the quickest test. Root is not required.`,
    });
  }

  if (method === "windows") {
    topics.push(
      {
        title: "The Windows service does not start",
        markdown: `1. Run the collector in the foreground to see the real error instead of the generic \`Error 1064\`:
   \`& "${WINDOWS_INSTALL_DIR}\\otelcol-contrib.exe" --config="${WINDOWS_INSTALL_DIR}\\config.yaml"\`
2. \`Error 2: The system cannot find the file specified\` means the service points at a file that is not there — compare \`BINARY_PATH_NAME\` from \`sc.exe qc "otelcol-contrib"\` with the contents of \`${WINDOWS_INSTALL_DIR}\`. The archive must be the \`otelcol-contrib_\` one, which unpacks \`otelcol-contrib.exe\`.
3. **Event Viewer → Windows Logs → Application** (source \`otelcol-contrib\`) records the startup error the service manager swallowed.`,
      },
      {
        title: "The Services tab still lists every service",
        markdown:
          "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.",
      },
    );
  }

  return topics;
}

/*
 * Kubernetes nodes are not hosts in OneUptime: telemetry that carries a
 * Kubernetes identity is filed under its cluster, and a collector
 * DaemonSet's node metrics would never add a row to the Hosts list. So the
 * Kubernetes option installs what does show nodes — the OneUptime
 * Kubernetes agent, with the Kubernetes section's own steps for a standard
 * cluster.
 */
function getKubernetesNodesGuide(
  options: HostSetupGuideOptions,
): SetupGuideContent {
  const guide: SetupGuideContent = getKubernetesSetupGuide({
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    platform: "standard",
  });

  return {
    ...guide,
    keyStep: {
      description:
        "The Kubernetes agent sends your cluster's data to OneUptime with this key. Pick an existing key or create a new one — the install command below updates to use it.",
    },
    intro: `Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.`,
  };
}

/**
 * The host collector install guide for one install method, filled in with
 * the reader's OneUptime URL and ingestion key.
 */
export function getHostSetupGuide(
  options: HostSetupGuideOptions,
): SetupGuideContent {
  const method: HostInstallMethod = options.method;

  if (method === "kubernetes") {
    return getKubernetesNodesGuide(options);
  }

  const collectorOptions: HostCollectorGuideOptions = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    method: method,
  };

  return {
    keyStep: {
      description:
        "The collector sends this host's metrics to OneUptime with this key. Pick an existing key or create a new one — the config below updates to use it.",
      endpointLabel: "OTLP Endpoint",
      endpointValue: `${options.oneuptimeUrl}/otlp`,
    },
    prerequisites: getPrerequisites(method),
    steps: [
      getConfigStep(collectorOptions),
      getInstallStep(collectorOptions),
      getVerifyStep(method),
    ],
    advanced: getAdvancedTopics(method),
    troubleshooting: getTroubleshootingTopics({
      oneuptimeUrl: options.oneuptimeUrl,
      method: method,
    }),
    links: [
      {
        title: "Host OpenTelemetry Collector documentation",
        url: "/docs/telemetry/host-otel-collector",
      },
    ],
  };
}
