import {
  HOST_COLLECTOR_EXPORTER_ENDPOINT,
  HOST_COLLECTOR_INGESTION_KEY_REFERENCE,
  HostCollectorOsType,
} from "../../Types/HostCollector/HostCollector";

/*
 * The config a host runs when no Collector Config of its project applies to
 * it: OneUptime's default for its operating system. It fills the host's
 * pages (Overview, Metrics, Processes, Logs, and Systemd Units on Linux or
 * Services on Windows) with what the manual host guide's configs collect,
 * and it is what a new Collector Config starts from.
 *
 * Every config OneUptime sends refers to the host's own URL and key through
 * the environment the installer gives the collector, so no config holds a
 * key (HostCollectorConfigPolicy refuses one that tries).
 *
 * The default is not stored: it follows OneUptime's release, so a host on
 * the default gets OneUptime's improvements to it with the next release.
 */

// The receivers every system shares: CPU, memory, disks, network, processes.
const HOST_METRICS_RECEIVER: string = `  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
        metrics:
          system.cpu.utilization:
            enabled: true
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
      paging:
      processes:
      process:
        mute_process_name_error: true
        mute_process_exe_error: true
        mute_process_io_error: true
        mute_process_user_error: true
        metrics:
          process.cpu.utilization:
            enabled: true
          process.memory.utilization:
            enabled: true`;

/*
 * Stamps host.name, host.id and os.type on everything the host sends: that
 * is how OneUptime files the telemetry under the host, so every config keeps
 * it.
 */
const PROCESSORS: string = `processors:
  # Stamps host.name, host.id and os.type: this is how OneUptime files the
  # telemetry under this host. Keep it in every pipeline.
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
        host.ip:
          enabled: true
        host.mac:
          enabled: true
        os.type:
          enabled: true
        os.description:
          enabled: true
        os.version:
          enabled: true
  batch:`;

const EXPORTERS: string = `exporters:
  # Sends to the OneUptime this host was installed with, with its key.
  otlphttp/oneuptime:
    endpoint: ${HOST_COLLECTOR_EXPORTER_ENDPOINT}
    headers:
      x-oneuptime-token: ${HOST_COLLECTOR_INGESTION_KEY_REFERENCE}`;

const LINUX_DEFAULT_CONFIG: string = `# OneUptime's default config for Linux hosts.
receivers:
${HOST_METRICS_RECEIVER}

  # The systemd journal: every unit's logs, info and above.
  journald:
    priority: info

  # The Systemd Units page: the state of every service.
  systemd:
    collection_interval: 30s
    units: ["*.service"]
    metrics:
      systemd.service.cpu.time:
        enabled: false

${PROCESSORS}

${EXPORTERS}

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, systemd]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [journald]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
`;

const WINDOWS_DEFAULT_CONFIG: string = `# OneUptime's default config for Windows hosts.
receivers:
${HOST_METRICS_RECEIVER}

  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end

  # The Services page: the state of every Windows service.
  windows_service:
    collection_interval: 30s

${PROCESSORS}

${EXPORTERS}

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers:
        - windowseventlog/system
        - windowseventlog/application
        - windowseventlog/security
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
`;

const MACOS_DEFAULT_CONFIG: string = `# OneUptime's default config for macOS hosts.
receivers:
${HOST_METRICS_RECEIVER}

  filelog/system:
    include:
      - /var/log/install.log
      - /var/log/wifi.log
    start_at: end

${PROCESSORS}

${EXPORTERS}

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [filelog/system]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
`;

/*
 * A config for any system can only read what every system has: host
 * metrics. It is what a Collector Config for "any system" starts from.
 */
const ANY_SYSTEM_DEFAULT_CONFIG: string = `# A config for hosts on any system: host metrics only.
receivers:
${HOST_METRICS_RECEIVER}

${PROCESSORS}

${EXPORTERS}

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
`;

const DEFAULT_CONFIGS: Record<HostCollectorOsType, string> = {
  [HostCollectorOsType.Linux]: LINUX_DEFAULT_CONFIG,
  [HostCollectorOsType.Windows]: WINDOWS_DEFAULT_CONFIG,
  [HostCollectorOsType.MacOS]: MACOS_DEFAULT_CONFIG,
  [HostCollectorOsType.Any]: ANY_SYSTEM_DEFAULT_CONFIG,
};

/*
 * OneUptime's default config for hosts of this system. A host whose system
 * is not known (it has not reported one, or it is not one the installers
 * support) gets the one every system can run.
 */
export function getHostCollectorDefaultConfig(
  osType: HostCollectorOsType | null | undefined,
): string {
  return DEFAULT_CONFIGS[osType || HostCollectorOsType.Any];
}

// The name a host's page gives the default it runs.
export function getHostCollectorDefaultConfigName(
  osType: HostCollectorOsType | null | undefined,
): string {
  if (!osType || osType === HostCollectorOsType.Any) {
    return "OneUptime default";
  }

  const names: Record<HostCollectorOsType, string> = {
    [HostCollectorOsType.Linux]: "OneUptime default for Linux",
    [HostCollectorOsType.Windows]: "OneUptime default for Windows",
    [HostCollectorOsType.MacOS]: "OneUptime default for macOS",
    [HostCollectorOsType.Any]: "OneUptime default",
  };

  return names[osType];
}
