import { PromQLLabels } from "../PromQL/PromQLLabels";
import { lookupTable, writeOwnValue } from "../LookupTable";

/*
 * A log's labels in LogQL (issue #7700): what a stream selector, a label
 * filter and `sum by (...)` read.
 *
 * OneUptime stores a log's attributes beside its line: a Loki client's
 * stream labels and structured metadata under the names they have in Loki
 * (LokiPush), an OpenTelemetry log's attributes with dots, its resource's
 * under `resource.`. They read the way Loki 3 reads OpenTelemetry logs:
 *
 *   - a name's dots and dashes become underscores (`http.method` is
 *     `http_method`);
 *   - a resource attribute loses its `resource.` (`resource.service.name`
 *     is `service_name`, `resource.k8s.pod.name` is `k8s_pod_name`); the
 *     log's own attribute of the same name comes first;
 *   - `detected_level` is the log's level, as Loki 3 detects it, from its
 *     severity.
 */

export const LOGQL_SERVICE_NAME_LABEL: string = "service_name";
export const LOGQL_DETECTED_LEVEL_LABEL: string = "detected_level";

// The attribute a log's service name is stored under.
export const LOGQL_SERVICE_NAME_ATTRIBUTE: string = "resource.service.name";

const RESOURCE_PREFIX: string = "resource.";

const INVALID_LABEL_CHARACTERS: RegExp = /[^a-zA-Z0-9_]/g;

const STARTS_WITH_DIGIT: RegExp = /^[0-9]/;

// A name as a LogQL label: Loki's sanitizeLabelKey.
export const toLogQLLabelName: (name: string) => string = (
  name: string,
): string => {
  const label: string = name.replace(INVALID_LABEL_CHARACTERS, "_");

  return STARTS_WITH_DIGIT.test(label) ? `_${label}` : label;
};

// The label an attribute key is read as: a resource's without its prefix.
export const labelNameOfAttribute: (key: string) => string = (
  key: string,
): string => {
  return toLogQLLabelName(
    key.startsWith(RESOURCE_PREFIX) ? key.slice(RESOURCE_PREFIX.length) : key,
  );
};

/*
 * Loki 3's levels (detected_level): OpenTelemetry's severity numbers in
 * their ranges, else the words a severity is written in.
 */
export enum LogQLLevel {
  Trace = "trace",
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "error",
  Fatal = "fatal",
  Critical = "critical",
  Unknown = "unknown",
}

export const LOGQL_LEVEL_WORDS: ReadonlyMap<string, LogQLLevel> =
  lookupTable<LogQLLevel>({
    trace: LogQLLevel.Trace,
    debug: LogQLLevel.Debug,
    dbg: LogQLLevel.Debug,
    info: LogQLLevel.Info,
    information: LogQLLevel.Info,
    informational: LogQLLevel.Info,
    notice: LogQLLevel.Info,
    warn: LogQLLevel.Warn,
    warning: LogQLLevel.Warn,
    error: LogQLLevel.Error,
    err: LogQLLevel.Error,
    fatal: LogQLLevel.Fatal,
    panic: LogQLLevel.Fatal,
    critical: LogQLLevel.Critical,
    crit: LogQLLevel.Critical,
    alert: LogQLLevel.Critical,
    emergency: LogQLLevel.Critical,
    emerg: LogQLLevel.Critical,
  });

// OpenTelemetry's severity number ranges, 1 to 24.
export const LOGQL_LEVEL_OF_SEVERITY_NUMBER: ReadonlyArray<{
  from: number;
  to: number;
  level: LogQLLevel;
}> = [
  { from: 1, to: 4, level: LogQLLevel.Trace },
  { from: 5, to: 8, level: LogQLLevel.Debug },
  { from: 9, to: 12, level: LogQLLevel.Info },
  { from: 13, to: 16, level: LogQLLevel.Warn },
  { from: 17, to: 20, level: LogQLLevel.Error },
  { from: 21, to: 24, level: LogQLLevel.Fatal },
];

export const detectLogQLLevel: (data: {
  severityNumber?: number | undefined;
  severityText?: string | undefined;
}) => LogQLLevel = (data: {
  severityNumber?: number | undefined;
  severityText?: string | undefined;
}): LogQLLevel => {
  const number: number = Number(data.severityNumber);

  for (const range of LOGQL_LEVEL_OF_SEVERITY_NUMBER) {
    if (number >= range.from && number <= range.to) {
      return range.level;
    }
  }

  return (
    LOGQL_LEVEL_WORDS.get((data.severityText || "").trim().toLowerCase()) ||
    LogQLLevel.Unknown
  );
};

/*
 * A stored log's labels: every attribute with a value, resource attributes
 * first so the log's own win, and its detected level, unless the log was
 * sent with one.
 */
export const logQLLabelsOf: (data: {
  attributes: Record<string, unknown>;
  severityNumber?: number | undefined;
  severityText?: string | undefined;
}) => PromQLLabels = (data: {
  attributes: Record<string, unknown>;
  severityNumber?: number | undefined;
  severityText?: string | undefined;
}): PromQLLabels => {
  const labels: PromQLLabels = {};
  const keys: Array<string> = Object.keys(data.attributes).sort(
    (a: string, b: string): number => {
      const aResource: boolean = a.startsWith(RESOURCE_PREFIX);
      const bResource: boolean = b.startsWith(RESOURCE_PREFIX);

      if (aResource !== bResource) {
        return aResource ? -1 : 1;
      }

      return a < b ? -1 : a > b ? 1 : 0;
    },
  );

  for (const key of keys) {
    const raw: unknown = data.attributes[key];

    if (raw === null || raw === undefined) {
      continue;
    }

    const value: string =
      typeof raw === "string"
        ? raw
        : typeof raw === "object"
          ? JSON.stringify(raw)
          : String(raw);

    if (value.length === 0) {
      continue;
    }

    // A label may be named __proto__ too: written as its own key.
    writeOwnValue(labels, labelNameOfAttribute(key), value);
  }

  if (
    !Object.prototype.hasOwnProperty.call(labels, LOGQL_DETECTED_LEVEL_LABEL)
  ) {
    labels[LOGQL_DETECTED_LEVEL_LABEL] = detectLogQLLevel(data);
  }

  return labels;
};
