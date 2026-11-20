import { FilterType } from "../../Types/Monitor/CriteriaFilter";
import {
  ImportedAlertSeverity,
  ImportNote,
  ImportNoteKind,
} from "../../Types/ObservabilityImport/ObservabilityImport";
import RollingTime from "../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../Types/RollingTime/RollingTimeUtil";
import { translationKey } from "../../Types/Translator";
import { parsePromQLDuration } from "../PromQL/PromQLDuration";
import { splitPromQLMonitorComparison } from "../PromQL/PromQLMonitorExpression";
import { toPromQLLabelName } from "../PromQL/PromQLMetricNames";

/*
 * WHAT EVERY IMPORTED ALERT RULE NEEDS (issue #7697): how long it waits,
 * how severe it is, and what the alert it opens says - read the same way
 * from a Prometheus rule, a Grafana alert rule and a Datadog monitor.
 */

export const WINDOW_NEAREST: string = translationKey(
  "It waits {{source}} before it fires; OneUptime waits {{window}}, the nearest window it has.",
);

export const ALERT_TEXT_TEMPLATE_LEFT_OUT: string = translationKey(
  "The firing value and template logic in its alert's text are left out: OneUptime shows the value on the alert.",
);

export const RULE_FIRES_FOR_EVERY_SERIES: string = translationKey(
  "It fires for each series its expression returns, as Prometheus does.",
);

// Every window a monitor reads, shortest first.
const WINDOWS: Array<{ rollingTime: RollingTime; ms: number }> = Object.values(
  RollingTime,
)
  .map((rollingTime: RollingTime) => {
    return {
      rollingTime,
      ms: RollingTimeUtil.getWindowInMs(rollingTime),
    };
  })
  .sort(
    (
      a: { rollingTime: RollingTime; ms: number },
      b: { rollingTime: RollingTime; ms: number },
    ): number => {
      return a.ms - b.ms;
    },
  );

/*
 * The monitor's window for a rule that waits `ms`: the window of exactly
 * that length, else the nearest longer one, and a note saying so. Nothing
 * to wait is one minute: a check reads the minute it runs in.
 */
export const readImportWindow: (data: {
  ms: number;
  sourceText: string;
  notes: Array<ImportNote>;
}) => RollingTime = (data: {
  ms: number;
  sourceText: string;
  notes: Array<ImportNote>;
}): RollingTime => {
  if (!Number.isFinite(data.ms) || data.ms <= 60 * 1000) {
    return RollingTime.Past1Minute;
  }

  const exact: RollingTime | null = RollingTimeUtil.fromWindowInMs(data.ms);

  if (exact) {
    return exact;
  }

  const nearest: RollingTime =
    WINDOWS.find((window: { rollingTime: RollingTime; ms: number }): boolean => {
      return window.ms >= data.ms;
    })?.rollingTime || WINDOWS[WINDOWS.length - 1]!.rollingTime;

  data.notes.push({
    kind: ImportNoteKind.Approximation,
    text: WINDOW_NEAREST,
    values: { source: data.sourceText, window: nearest },
  });

  return nearest;
};

// A Prometheus duration ("5m", "1h30m") in milliseconds; 0 for none.
export const readPrometheusDuration: (text: string) => number = (
  text: string,
): number => {
  const value: string = (text || "").trim();

  if (!value || value === "0") {
    return 0;
  }

  return parsePromQLDuration(value) ?? Number.NaN;
};

// Words a severity label or priority is written in, as OneUptime ranks them.
const CRITICAL_WORDS: ReadonlySet<string> = new Set<string>([
  "critical",
  "crit",
  "page",
  "high",
  "error",
  "emergency",
  "fatal",
  "major",
  "p1",
  "p0",
  "sev1",
  "sev0",
  "1",
]);

export const readImportSeverity: (label: string | undefined) => ImportedAlertSeverity =
  (label: string | undefined): ImportedAlertSeverity => {
    const value: string = (label || "").trim().toLowerCase();

    if (!value) {
      return ImportedAlertSeverity.Critical;
    }

    return CRITICAL_WORDS.has(value)
      ? ImportedAlertSeverity.Critical
      : ImportedAlertSeverity.Warning;
  };

/*
 * An alert's text from a Prometheus or Grafana template: a series' label
 * ({{ $labels.instance }}, {{ .Labels.instance }}, {{ index $labels
 * "instance" }}) is OneUptime's {{instance}}, which an alert of a PromQL
 * monitor fills from the series it opened for. The firing value and Go
 * template logic ({{ $value }}, {{ if }}) are left out, and said.
 */
export const convertAlertTemplate: (data: {
  text: string;
  notes: Array<ImportNote>;
}) => string = (data: { text: string; notes: Array<ImportNote> }): string => {
  const text: string = data.text || "";
  let leftOut: boolean = false;

  const converted: string = text.replace(
    /\{\{-?\s*([^{}]*?)\s*-?\}\}/g,
    (_match: string, inner: string): string => {
      const label: RegExpMatchArray | null =
        inner.match(/^\$labels\.([A-Za-z_][A-Za-z0-9_]*)$/) ||
        inner.match(/^\.Labels\.([A-Za-z_][A-Za-z0-9_]*)$/) ||
        inner.match(/^index\s+\$labels\s+"([^"]+)"$/);

      if (label) {
        return `{{${toPromQLLabelName(label[1] || "")}}}`;
      }

      leftOut = true;
      return "";
    },
  );

  if (leftOut) {
    data.notes.push({ kind: ImportNoteKind.Info, text: ALERT_TEXT_TEMPLATE_LEFT_OUT });
  }

  return converted
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,:;])/g, "$1")
    .trim();
};

export interface ImportedComparison {
  promQL: string;
  filterType: FilterType;
  threshold: number;
}

/*
 * A Prometheus alert expression as a monitor's query and condition: one
 * that ends in a comparison with a number is the query and the condition
 * (`rate(x[5m]) > 0.1`); any other fires for each series it returns, as
 * Prometheus fires, so the query marks each with 1 and the condition is
 * "above 0".
 */
export const readPrometheusAlertExpression: (data: {
  expr: string;
  notes: Array<ImportNote>;
}) => ImportedComparison = (data: {
  expr: string;
  notes: Array<ImportNote>;
}): ImportedComparison => {
  const split: ReturnType<typeof splitPromQLMonitorComparison> =
    splitPromQLMonitorComparison(data.expr);

  if (split) {
    return {
      promQL: split.expression,
      filterType: split.filterType,
      threshold: split.threshold,
    };
  }

  data.notes.push({ kind: ImportNoteKind.Info, text: RULE_FIRES_FOR_EVERY_SERIES });

  return {
    promQL: `(${data.expr.trim()}) * 0 + 1`,
    filterType: FilterType.GreaterThan,
    threshold: 0,
  };
};

// A monitor's name, unique among those already taken: "Name", "Name 2"...
export const uniqueImportName: (data: {
  name: string;
  taken: Set<string>;
  maxLength: number;
}) => string = (data: {
  name: string;
  taken: Set<string>;
  maxLength: number;
}): string => {
  const base: string = (data.name || "").trim().slice(0, data.maxLength).trim();
  const takenLower: Set<string> = new Set<string>(
    Array.from(data.taken).map((name: string): string => {
      return name.toLowerCase();
    }),
  );

  if (base && !takenLower.has(base.toLowerCase())) {
    data.taken.add(base);
    return base;
  }

  for (let number: number = 2; number < 10_000; number++) {
    const suffix: string = ` ${number}`;
    const candidate: string = `${base.slice(0, data.maxLength - suffix.length).trim()}${suffix}`;

    if (!takenLower.has(candidate.toLowerCase())) {
      data.taken.add(candidate);
      return candidate;
    }
  }

  return base;
};
