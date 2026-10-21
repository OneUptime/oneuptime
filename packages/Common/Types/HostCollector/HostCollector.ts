/*
 * Hosts that OneUptime installs and configures.
 *
 * One command on the host (install.sh on Linux and macOS, install.ps1 on
 * Windows, both served by every OneUptime under
 * /docs/static/scripts/host-collector/) installs two upstream programs from
 * the OpenTelemetry Collector releases:
 *
 *   - otelcol-contrib, the OpenTelemetry Collector that reads the host, and
 *   - opampsupervisor, which runs the collector and keeps it on the config
 *     OneUptime sends it over OpAMP (the OpenTelemetry Agent Management
 *     Protocol).
 *
 * The supervisor phones home to OneUptime (POST <OneUptime URL>/opamp/v1,
 * with the project's telemetry ingestion key in the x-oneuptime-token
 * header), and OneUptime answers with the config the host should run: the
 * first Collector Config of the project that applies to it, or OneUptime's
 * default for its operating system. The host reports which config it runs,
 * and whether it applied; a config that fails on a host is rolled back there
 * to the last one that worked.
 *
 * Plain values on purpose, so the Dashboard, the server and the tests read
 * the same ones.
 */

// Where the supervisor posts its AgentToServer messages (OpAMP over HTTP).
export const HOST_COLLECTOR_OPAMP_PATH: string = "/opamp/v1";

/*
 * Where every OneUptime serves the installers (the Docs feature set's static
 * folder), so a self-hosted OneUptime hands out the installer of its own
 * release.
 */
export const HOST_COLLECTOR_INSTALL_SCRIPT_PATH: string =
  "/docs/static/scripts/host-collector/install.sh";
export const HOST_COLLECTOR_WINDOWS_INSTALL_SCRIPT_PATH: string =
  "/docs/static/scripts/host-collector/install.ps1";

/*
 * The release of otelcol-contrib and of opampsupervisor the installers put
 * on a host. The installers carry the same number (HostCollectorInstallers
 * tests hold them to it), and so does the manual host guide
 * (AgentKind.HOST_COLLECTOR_VERSION).
 */
export const HOST_COLLECTOR_PINNED_VERSION: string = "0.161.0";

/*
 * The two values the installer gives the collector's environment, and every
 * config OneUptime sends refers to. A config never holds the key itself:
 * each host sends with the key it was installed with.
 */
export const HOST_COLLECTOR_URL_ENV: string = "ONEUPTIME_URL";
export const HOST_COLLECTOR_INGESTION_KEY_ENV: string =
  "ONEUPTIME_INGESTION_KEY";

// How a config refers to them.
export const HOST_COLLECTOR_URL_REFERENCE: string = `\${env:${HOST_COLLECTOR_URL_ENV}}`;
export const HOST_COLLECTOR_INGESTION_KEY_REFERENCE: string = `\${env:${HOST_COLLECTOR_INGESTION_KEY_ENV}}`;

// The exporter every config sends with, and where it sends to.
export const HOST_COLLECTOR_EXPORTER_ENDPOINT: string = `${HOST_COLLECTOR_URL_REFERENCE}/otlp`;

/*
 * The installer's --label key=value flags reach OneUptime as agent
 * description attributes named oneuptime.label.<key>, the same prefix the
 * collector's own telemetry uses for labels: a host installed with
 * --label env=production is labelled env:production.
 */
export const HOST_COLLECTOR_LABEL_ATTRIBUTE_PREFIX: string = "oneuptime.label.";

/*
 * The operating systems a Collector Config can be for, as OpenTelemetry's
 * os.type names them ("darwin" is macOS). Any: every host.
 */
export enum HostCollectorOsType {
  Any = "any",
  Linux = "linux",
  Windows = "windows",
  MacOS = "darwin",
}

// The three systems the installers run on, in the order the guide offers them.
export const HOST_COLLECTOR_INSTALLABLE_OS_TYPES: ReadonlyArray<HostCollectorOsType> =
  [
    HostCollectorOsType.Linux,
    HostCollectorOsType.Windows,
    HostCollectorOsType.MacOS,
  ];

// What people call each system. Product names, never translated.
export const HOST_COLLECTOR_OS_NAMES: Record<HostCollectorOsType, string> = {
  [HostCollectorOsType.Any]: "Any system",
  [HostCollectorOsType.Linux]: "Linux",
  [HostCollectorOsType.Windows]: "Windows",
  [HostCollectorOsType.MacOS]: "macOS",
};

/*
 * The system a host's os.type (as the collector reports it) names, or null
 * when it names none of the three: FreeBSD, AIX and other systems the
 * installers do not support.
 */
export function getHostCollectorOsType(
  osType: string | null | undefined,
): HostCollectorOsType | null {
  const value: string = (osType || "").trim().toLowerCase();

  if (value === "linux") {
    return HostCollectorOsType.Linux;
  }

  if (value === "windows") {
    return HostCollectorOsType.Windows;
  }

  if (value === "darwin" || value === "macos") {
    return HostCollectorOsType.MacOS;
  }

  return null;
}

export function isHostCollectorOsType(
  value: unknown,
): value is HostCollectorOsType {
  return (
    typeof value === "string" &&
    (Object.values(HostCollectorOsType) as Array<string>).includes(value)
  );
}

/*
 * Where a host stands with the config OneUptime sends it.
 *
 *   - Waiting: the supervisor has connected and has not said anything about
 *     a config yet (it is bootstrapping the collector).
 *   - Applying: it has the config and is starting the collector with it.
 *   - Applied: the collector runs the config.
 *   - Failed: the config did not start. The host went back to the last
 *     config that worked there, if it had one, and OneUptime does not send
 *     the failed one again until the config changes.
 */
export enum HostCollectorConfigStatus {
  Waiting = "waiting",
  Applying = "applying",
  Applied = "applied",
  Failed = "failed",
}

export function isHostCollectorConfigStatus(
  value: unknown,
): value is HostCollectorConfigStatus {
  return (
    typeof value === "string" &&
    (Object.values(HostCollectorConfigStatus) as Array<string>).includes(value)
  );
}

/*
 * The longest config OneUptime keeps and sends. Real collector configs are a
 * few kilobytes; this leaves room for long filelog include lists while
 * bounding what one request may store and every host must download.
 */
export const HOST_COLLECTOR_CONFIG_MAX_BYTES: number = 128 * 1024;

/*
 * The longest error a host's report may store: the supervisor appends the
 * tail of the collector's log to a failed start, which is plenty.
 */
export const HOST_COLLECTOR_ERROR_MAX_LENGTH: number = 4000;
