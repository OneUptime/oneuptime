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
 * On Linux it reads only what the host has, as the installer found it
 * (HostCollectorHostFeatures): the journal where journalctl is, systemd
 * units where the system D-Bus is. A receiver that cannot start stops the
 * whole collector, so a default that asked for what a host lacks would send
 * nothing at all.
 *
 * Every config OneUptime sends refers to the host's own URL and key through
 * the environment the installer gives the collector, so no config holds a
 * key (HostCollectorConfigPolicy refuses one that tries).
 *
 * The default is not stored: it follows OneUptime's release, so a host on
 * the default gets OneUptime's improvements to it with the next release.
 */

/*
 * What the installer found on a Linux host, which it reports with the
 * supervisor's description (oneuptime.host.journald, oneuptime.host.systemd).
 */
export interface HostCollectorHostFeatures {
  // journalctl and a journal: the journald receiver can read the logs.
  journald: boolean;
  // The system D-Bus: the systemd receiver can read the units.
  systemd: boolean;
}

// What a Linux host OneUptime knows nothing about gets: host metrics only.
export const UNKNOWN_HOST_FEATURES: HostCollectorHostFeatures = {
  journald: false,
  systemd: false,
};

// What the default for Linux reads on a host that has everything.
export const ALL_HOST_FEATURES: HostCollectorHostFeatures = {
  journald: true,
  systemd: true,
};

// The receivers every system shares: CPU, memory, disks, network, processes.
const HOST_METRICS_RECEIVER: string = `  host_metrics:
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

const JOURNALD_RECEIVER: string = `  # The systemd journal: every unit's logs, info and above.
  journald:
    priority: info`;

const SYSTEMD_RECEIVER: string = `  # The Systemd Units page: the state of every service.
  systemd:
    collection_interval: 30s
    units: ["*.service"]
    metrics:
      systemd.service.cpu.time:
        enabled: false`;

/*
 * Stamps host.name, host.id and os.type on everything the host sends: that
 * is how OneUptime files the telemetry under the host, so every config keeps
 * it.
 */
const PROCESSORS: string = `processors:
  # Stamps host.name, host.id and os.type: this is how OneUptime files the
  # telemetry under this host. Keep it in every pipeline.
  resource_detection:
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
  otlp_http/oneuptime:
    endpoint: ${HOST_COLLECTOR_EXPORTER_ENDPOINT}
    headers:
      x-oneuptime-token: ${HOST_COLLECTOR_INGESTION_KEY_REFERENCE}`;

function getLinuxDefaultConfig(features: HostCollectorHostFeatures): string {
  const receivers: Array<string> = [HOST_METRICS_RECEIVER];
  const metricsReceivers: Array<string> = ["host_metrics"];

  if (features.journald) {
    receivers.push(JOURNALD_RECEIVER);
  }

  if (features.systemd) {
    receivers.push(SYSTEMD_RECEIVER);
    metricsReceivers.push("systemd");
  }

  const logsPipeline: string = features.journald
    ? `
    logs:
      receivers: [journald]
      processors: [resource_detection, batch]
      exporters: [otlp_http/oneuptime]`
    : "";

  return `# OneUptime's default config for Linux hosts.
receivers:
${receivers.join("\n\n")}

${PROCESSORS}

${EXPORTERS}

service:
  pipelines:
    metrics:
      receivers: [${metricsReceivers.join(", ")}]
      processors: [resource_detection, batch]
      exporters: [otlp_http/oneuptime]${logsPipeline}
`;
}

const WINDOWS_DEFAULT_CONFIG: string = `# OneUptime's default config for Windows hosts.
receivers:
${HOST_METRICS_RECEIVER}

  windows_event_log/system:
    channel: System
    start_at: end

  windows_event_log/application:
    channel: Application
    start_at: end

  windows_event_log/security:
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
      receivers: [host_metrics, windows_service]
      processors: [resource_detection, batch]
      exporters: [otlp_http/oneuptime]
    logs:
      receivers:
        - windows_event_log/system
        - windows_event_log/application
        - windows_event_log/security
      processors: [resource_detection, batch]
      exporters: [otlp_http/oneuptime]
`;

const MACOS_DEFAULT_CONFIG: string = `# OneUptime's default config for macOS hosts.
receivers:
${HOST_METRICS_RECEIVER}

  file_log/system:
    include:
      - /var/log/install.log
      - /var/log/wifi.log
    start_at: end

${PROCESSORS}

${EXPORTERS}

service:
  pipelines:
    metrics:
      receivers: [host_metrics]
      processors: [resource_detection, batch]
      exporters: [otlp_http/oneuptime]
    logs:
      receivers: [file_log/system]
      processors: [resource_detection, batch]
      exporters: [otlp_http/oneuptime]
`;

/*
 * A config for any system can only read what every system has: host
 * metrics. It is what a Collector Config for "any system" starts from, and
 * what a host whose system is not known yet runs.
 */
const ANY_SYSTEM_DEFAULT_CONFIG: string = `# A config for hosts on any system: host metrics only.
receivers:
${HOST_METRICS_RECEIVER}

${PROCESSORS}

${EXPORTERS}

service:
  pipelines:
    metrics:
      receivers: [host_metrics]
      processors: [resource_detection, batch]
      exporters: [otlp_http/oneuptime]
`;

/*
 * OneUptime's default config for hosts of this system. On Linux it reads
 * what the host has (features; everything when left out, which is what a
 * new Collector Config for Linux starts from). A host whose system is not
 * known (it has not reported one, or it is not one the installers support)
 * gets the one every system can run.
 */
export function getHostCollectorDefaultConfig(
  osType: HostCollectorOsType | null | undefined,
  features: HostCollectorHostFeatures = ALL_HOST_FEATURES,
): string {
  switch (osType) {
    case HostCollectorOsType.Linux:
      return getLinuxDefaultConfig(features);
    case HostCollectorOsType.Windows:
      return WINDOWS_DEFAULT_CONFIG;
    case HostCollectorOsType.MacOS:
      return MACOS_DEFAULT_CONFIG;
    default:
      return ANY_SYSTEM_DEFAULT_CONFIG;
  }
}

/*
 * The features a host reported, as the installer writes them into the
 * supervisor's description ("true" or "false"), or null when it reported
 * neither (a supervisor OneUptime's installer did not set up).
 */
export function readHostCollectorHostFeatures(data: {
  journald: string | null | undefined;
  systemd: string | null | undefined;
}): HostCollectorHostFeatures | null {
  if (
    (data.journald === null || data.journald === undefined) &&
    (data.systemd === null || data.systemd === undefined)
  ) {
    return null;
  }

  return {
    journald: data.journald === "true",
    systemd: data.systemd === "true",
  };
}

// Features as a host stores them: "journald,systemd", "" for none.
export function hostCollectorHostFeaturesToText(
  features: HostCollectorHostFeatures,
): string {
  const names: Array<string> = [];
  if (features.journald) {
    names.push("journald");
  }
  if (features.systemd) {
    names.push("systemd");
  }
  return names.join(",");
}

export function hostCollectorHostFeaturesFromText(
  text: string | null | undefined,
): HostCollectorHostFeatures | null {
  if (text === null || text === undefined) {
    return null;
  }

  const names: Array<string> = text.split(",").map((name: string): string => {
    return name.trim();
  });

  return {
    journald: names.includes("journald"),
    systemd: names.includes("systemd"),
  };
}

// The name a host's page gives the default it runs.
export function getHostCollectorDefaultConfigName(
  osType: HostCollectorOsType | null | undefined,
): string {
  switch (osType) {
    case HostCollectorOsType.Linux:
      return "OneUptime default for Linux";
    case HostCollectorOsType.Windows:
      return "OneUptime default for Windows";
    case HostCollectorOsType.MacOS:
      return "OneUptime default for macOS";
    default:
      return "OneUptime default";
  }
}
