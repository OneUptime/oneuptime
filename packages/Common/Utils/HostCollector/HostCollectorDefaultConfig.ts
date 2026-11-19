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

/*
 * The file systems the filesystem scraper leaves out, on every system: the
 * ones that are full by design and the ones that hold no data. Read-only
 * images are always 100% used - snap packages (squashfs), EROFS images, and
 * CDs, DVDs and ISO images, under each system's name for them (iso9660 and
 * udf on Linux, cd9660 and udf on macOS, CDFS and UDF on Windows) - and so
 * is macOS's /dev (devfs). Measured, they would keep High Filesystem Usage
 * firing for as long as they are mounted. The automounter's maps (autofs,
 * which macOS lists) have no size at all. The match is strict, so case
 * counts.
 *
 * Linux's other virtual file systems (proc, sysfs, tmpfs, overlay, nsfs,
 * ...) need no entry: the scraper skips every one /proc/filesystems marks
 * nodev unless include_virtual_filesystems is on.
 */
export const HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES: ReadonlyArray<string> = [
  "autofs",
  "cd9660",
  "CDFS",
  "devfs",
  "erofs",
  "iso9660",
  "squashfs",
  "udf",
  "UDF",
];

/*
 * The filesystem scraper's exclusion as every host collector config OneUptime
 * writes or hands out carries it, indented to sit under `filesystem:` in
 * `scrapers:` (the Hosts guide's config.yaml and the docs' configs too).
 */
export const HOST_COLLECTOR_FILESYSTEM_EXCLUSION: string = `        # Leave out file systems that are full by design (snap packages and
        # other read-only images, CDs and DVDs, macOS's /dev) or hold no data
        # (the automounter's maps): the full ones would read 100% used for good.
        exclude_fs_types:
          fs_types: [${HOST_COLLECTOR_EXCLUDED_FILESYSTEM_TYPES.join(", ")}]
          match_type: strict`;

/*
 * The receivers every system shares: CPU, memory, disks, network, processes,
 * and how long the host has been up.
 */
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
${HOST_COLLECTOR_FILESYSTEM_EXCLUSION}
        metrics:
          system.filesystem.utilization:
            enabled: true
      load:
      network:
      paging:
      # How long the host has been up (system.uptime): when it last started.
      system:
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
 * The journal, as the host's Logs and its Systemd Units pages read it
 * (#9748). journalctl hands each entry over as a map of its fields, which
 * arrived whole: every row of the Logs page was JSON, no row said which
 * unit wrote it, and a failed unit's page could not say why it failed.
 * Each entry is now its message, at its level (PRIORITY), with:
 *
 *   - systemd.unit.name: the unit the line is about, the name the systemd
 *     receiver gives the unit's state - the unit that wrote it, or, for
 *     what systemd itself (PID 1) says about a unit (it started, a process
 *     exited, it failed), that unit (UNIT), as `journalctl -u` reads them;
 *   - systemd.unit.result, systemd.unit.exit_code, systemd.unit.exit_status:
 *     why a unit failed, as systemd says it - only on PID 1's own lines,
 *     whose fields no other process can write (UNIT_RESULT, EXIT_CODE,
 *     EXIT_STATUS: "Failed with result 'exit-code'", "Main process exited,
 *     code=exited, status=1/FAILURE");
 *   - syslog.identifier and process.pid: who wrote it.
 *
 * The rest of an entry - the process's command line, its user and group,
 * its capabilities, the cursor - stays on the host (retain), and a line
 * past journalctl's 4096 bytes stays out, as it always has (no `all`).
 */
export const JOURNALD_SYSTEMD_UNIT_ATTRIBUTE: string = "systemd.unit.name";
export const JOURNALD_SYSTEMD_RESULT_ATTRIBUTE: string = "systemd.unit.result";
export const JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE: string =
  "systemd.unit.exit_code";
export const JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE: string =
  "systemd.unit.exit_status";

export const JOURNALD_RECEIVER: string = `  # The systemd journal: every unit's logs, info and above. Each line is sent
  # as its message, at its level, with the unit it is about and - for a unit
  # that failed - systemd's own result and exit status, which the Systemd
  # Units page reads why it failed from. The rest of an entry (its command
  # line, user and group ids, cursor) stays on this host.
  journald:
    priority: info
    # A line holding a control character arrives as text, not as numbers.
    convert_message_bytes: true
    operators:
      # What systemd itself says about a unit comes from PID 1, naming it in UNIT.
      - type: move
        if: 'body._PID == "1" and body.UNIT != nil'
        from: body.UNIT
        to: attributes["${JOURNALD_SYSTEMD_UNIT_ATTRIBUTE}"]
      - type: move
        if: 'attributes["${JOURNALD_SYSTEMD_UNIT_ATTRIBUTE}"] == nil and body._SYSTEMD_UNIT != nil'
        from: body._SYSTEMD_UNIT
        to: attributes["${JOURNALD_SYSTEMD_UNIT_ATTRIBUTE}"]
      # Why a unit failed, in systemd's words: its result and how its process ended.
      - type: move
        if: 'body._PID == "1" and body.UNIT_RESULT != nil'
        from: body.UNIT_RESULT
        to: attributes["${JOURNALD_SYSTEMD_RESULT_ATTRIBUTE}"]
      - type: move
        if: 'body._PID == "1" and body.EXIT_CODE != nil'
        from: body.EXIT_CODE
        to: attributes["${JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE}"]
      - type: move
        if: 'body._PID == "1" and body.EXIT_STATUS != nil'
        from: body.EXIT_STATUS
        to: attributes["${JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE}"]
      - type: move
        if: 'body.SYSLOG_IDENTIFIER != nil'
        from: body.SYSLOG_IDENTIFIER
        to: attributes["syslog.identifier"]
      - type: move
        if: 'body._PID != nil'
        from: body._PID
        to: attributes["process.pid"]
      # The journal's priority as the line's severity: syslog's levels.
      - type: severity_parser
        if: 'body.PRIORITY != nil'
        parse_from: body.PRIORITY
        preset: none
        overwrite_text: true
        mapping:
          fatal: "0"
          error3: "1"
          error2: "2"
          error: "3"
          warn: "4"
          info2: "5"
          info: "6"
          debug: "7"
      # Nothing else of the entry leaves the host: the message is the line.
      - type: retain
        fields:
          - body.MESSAGE
      - type: move
        from: body.MESSAGE
        to: body
        on_error: send_quiet`;

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

/*
 * The event logs of the security tools a Windows host may have - Sysmon,
 * Microsoft Defender and PowerShell - which Security Events reads for
 * what an attack leaves (Utils/SecurityEvent/LogParsers/WindowsEventLogParser).
 * A host without one runs all the same: ignore_channel_errors keeps the
 * collector going and logs a warning, where a channel that does not exist
 * would otherwise stop it and send nothing at all.
 */
export const WINDOWS_SECURITY_TOOL_CHANNELS: ReadonlyArray<{
  receiver: string;
  channel: string;
}> = [
  {
    receiver: "windows_event_log/sysmon",
    channel: "Microsoft-Windows-Sysmon/Operational",
  },
  {
    receiver: "windows_event_log/defender",
    channel: "Microsoft-Windows-Windows Defender/Operational",
  },
  {
    receiver: "windows_event_log/powershell",
    channel: "Microsoft-Windows-PowerShell/Operational",
  },
];

const WINDOWS_SECURITY_TOOL_RECEIVERS: string = `  # Sysmon, Microsoft Defender and PowerShell, where the host has them: a
  # host without one keeps running, and the collector logs a warning.
${WINDOWS_SECURITY_TOOL_CHANNELS.map(
  (tool: { receiver: string; channel: string }): string => {
    return `  ${tool.receiver}:
    channel: ${tool.channel}
    start_at: end
    ignore_channel_errors: true`;
  },
).join("\n\n")}`;

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

${WINDOWS_SECURITY_TOOL_RECEIVERS}

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
${WINDOWS_SECURITY_TOOL_CHANNELS.map(
  (tool: { receiver: string; channel: string }): string => {
    return `        - ${tool.receiver}`;
  },
).join("\n")}
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
