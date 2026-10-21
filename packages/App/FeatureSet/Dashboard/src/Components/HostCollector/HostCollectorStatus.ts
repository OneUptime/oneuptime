import {
  HostCollectorConfigStatus,
  HostCollectorOsType,
  getHostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import Dictionary from "Common/Types/Dictionary";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a host's page and the Hosts list say about the collector OneUptime
 * manages on it, from the columns the server keeps (HostCollectorAgent):
 * whether OneUptime manages it at all, which config it runs, and how that
 * went. One place, so the list's pill and the host's Collector page never
 * disagree.
 *
 * React-free: App tests read it.
 */

/*
 * How long a managed host may be quiet before it reads as not reporting.
 * Its supervisor reports every 30 seconds; OneUptime writes the last contact
 * of a host that reports nothing new every 5 minutes.
 */
export const HOST_COLLECTOR_SILENT_AFTER_MS: number = 15 * 60 * 1000;

export enum HostCollectorState {
  // Installed by hand, or not at all: OneUptime sends it no config.
  NotManaged = "not-managed",
  // Connected; the supervisor has not said anything about a config yet.
  Waiting = "waiting",
  Applying = "applying",
  Running = "running",
  // The config OneUptime sent did not start; the host runs the last that did.
  Failed = "failed",
  // Running the config, but the collector reports an error.
  Unhealthy = "unhealthy",
  // No word from the supervisor for a while.
  Silent = "silent",
}

export type HostCollectorTone =
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "neutral";

export interface HostCollectorStateView {
  state: HostCollectorState;
  // A short label for a pill: an English translation key.
  label: string;
  tone: HostCollectorTone;
}

const STATE_VIEWS: Record<HostCollectorState, HostCollectorStateView> = {
  [HostCollectorState.NotManaged]: {
    state: HostCollectorState.NotManaged,
    label: translationKey("Installed by hand"),
    tone: "neutral",
  },
  [HostCollectorState.Waiting]: {
    state: HostCollectorState.Waiting,
    label: translationKey("Connecting"),
    tone: "info",
  },
  [HostCollectorState.Applying]: {
    state: HostCollectorState.Applying,
    label: translationKey("Applying config"),
    tone: "info",
  },
  [HostCollectorState.Running]: {
    state: HostCollectorState.Running,
    label: translationKey("Running"),
    tone: "success",
  },
  [HostCollectorState.Failed]: {
    state: HostCollectorState.Failed,
    label: translationKey("Config failed"),
    tone: "danger",
  },
  [HostCollectorState.Unhealthy]: {
    state: HostCollectorState.Unhealthy,
    label: translationKey("Collector error"),
    tone: "warning",
  },
  [HostCollectorState.Silent]: {
    state: HostCollectorState.Silent,
    label: translationKey("Not reporting"),
    tone: "warning",
  },
};

// A sentence to translate: an English translation key and its values.
export interface HostCollectorTranslatableText {
  // An English translation key, with {{placeholders}} for `values`.
  template: string;
  values: Dictionary<string>;
}

// The columns of a host this reads.
export interface HostCollectorFields {
  collectorInstanceUid?: string | null | undefined;
  collectorLastContactAt?: Date | string | null | undefined;
  collectorConfigStatus?: string | null | undefined;
  isCollectorHealthy?: boolean | null | undefined;
}

export function isHostCollectorManaged(host: HostCollectorFields): boolean {
  return Boolean(host.collectorInstanceUid);
}

export function getHostCollectorState(
  host: HostCollectorFields,
  now: Date = new Date(),
): HostCollectorState {
  if (!isHostCollectorManaged(host)) {
    return HostCollectorState.NotManaged;
  }

  const lastContact: number | null = host.collectorLastContactAt
    ? new Date(host.collectorLastContactAt).getTime()
    : null;

  if (
    lastContact !== null &&
    !isNaN(lastContact) &&
    now.getTime() - lastContact > HOST_COLLECTOR_SILENT_AFTER_MS
  ) {
    return HostCollectorState.Silent;
  }

  switch (host.collectorConfigStatus) {
    case HostCollectorConfigStatus.Failed:
      return HostCollectorState.Failed;
    case HostCollectorConfigStatus.Applying:
      return HostCollectorState.Applying;
    case HostCollectorConfigStatus.Applied:
      return host.isCollectorHealthy === false
        ? HostCollectorState.Unhealthy
        : HostCollectorState.Running;
    default:
      return HostCollectorState.Waiting;
  }
}

export function getHostCollectorStateView(
  host: HostCollectorFields,
  now: Date = new Date(),
): HostCollectorStateView {
  return STATE_VIEWS[getHostCollectorState(host, now)];
}

/*
 * The one line of a collector's error that says what went wrong. A failed
 * start comes with the tail of the collector's log, whose last "Error: "
 * line is the reason ("cannot start pipelines: failed to start "systemd"
 * receiver: ..."); a config the collector refused to load says so after
 * the same marker. Anything else: its first line.
 *
 * indexOf and lastIndexOf, not a regular expression: the text comes from
 * the host, so this stays linear in its length.
 */
export const COLLECTOR_ERROR_SUMMARY_MAX_LENGTH: number = 300;

export function summarizeCollectorError(
  error: string | null | undefined,
): string | null {
  if (!error || !error.trim()) {
    return null;
  }

  const marker: string = "Error: ";
  const at: number = error.lastIndexOf(marker);
  let summary: string;

  if (at !== -1) {
    const lineEnd: number = error.indexOf("\n", at);
    summary = error.substring(
      at + marker.length,
      lineEnd === -1 ? error.length : lineEnd,
    );
  } else {
    const lineEnd: number = error.indexOf("\n");
    summary = lineEnd === -1 ? error : error.substring(0, lineEnd);
  }

  summary = summary.trim();

  if (summary.length > COLLECTOR_ERROR_SUMMARY_MAX_LENGTH) {
    summary = `${summary.substring(0, COLLECTOR_ERROR_SUMMARY_MAX_LENGTH)}…`;
  }

  return summary || null;
}

/*
 * The name of the config a host runs, for its page and the list: a
 * Collector Config's name, or OneUptime's default for its system.
 *
 * Only a default's name is looked up in the reader's language. A config's
 * name is what someone typed: a config named "Web servers" stays "Web
 * servers" in German, even though the form's placeholder of the same words
 * is translated.
 */
export function getHostCollectorConfigLabel(
  data: {
    configName?: string | null | undefined;
    osType?: string | null | undefined;
  },
  translator?: Pick<Translator, "translateTemplate"> | undefined,
): string {
  if (data.configName) {
    return data.configName;
  }

  const osType: HostCollectorOsType | null = getHostCollectorOsType(
    data.osType,
  );
  const defaultName: string =
    DEFAULT_CONFIG_NAMES[osType || HostCollectorOsType.Any];

  return translator ? translator.translateTemplate(defaultName) : defaultName;
}

// What the Dashboard calls each of OneUptime's defaults.
export const DEFAULT_CONFIG_NAMES: Record<HostCollectorOsType, string> = {
  [HostCollectorOsType.Linux]: translationKey("OneUptime default for Linux"),
  [HostCollectorOsType.Windows]: translationKey(
    "OneUptime default for Windows",
  ),
  [HostCollectorOsType.MacOS]: translationKey("OneUptime default for macOS"),
  [HostCollectorOsType.Any]: translationKey("OneUptime default"),
};

/*
 * Where the collector stands, in one sentence for the host's Collector
 * page. `configName` is the name of the config it runs, ready to show.
 */
export function describeHostCollectorState(data: {
  host: HostCollectorFields;
  configName: string;
  now?: Date | undefined;
}): HostCollectorTranslatableText {
  const config: string = data.configName;

  switch (getHostCollectorState(data.host, data.now)) {
    case HostCollectorState.NotManaged:
      return {
        template: translationKey(
          "OneUptime does not manage this host's collector. It was installed by hand, and its config.yaml is kept on the host.",
        ),
        values: {},
      };
    case HostCollectorState.Waiting:
      return {
        template: translationKey("Connected. The collector is starting."),
        values: {},
      };
    case HostCollectorState.Applying:
      return {
        template: translationKey("Starting the collector with {{config}}."),
        values: { config },
      };
    case HostCollectorState.Failed:
      return {
        template: translationKey(
          "{{config}} did not start on this host. The host runs the last config that worked there.",
        ),
        values: { config },
      };
    case HostCollectorState.Unhealthy:
      return {
        template: translationKey(
          "Running {{config}}, but the collector reports an error.",
        ),
        values: { config },
      };
    case HostCollectorState.Silent:
      return {
        template: translationKey(
          "No word from this host's collector for more than 15 minutes. Check that its service runs and that the host can reach OneUptime.",
        ),
        values: {},
      };
    default:
      return {
        template: translationKey(
          "The collector runs the config OneUptime sent it.",
        ),
        values: {},
      };
  }
}
