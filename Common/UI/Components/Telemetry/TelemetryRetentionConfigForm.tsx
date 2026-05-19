import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TelemetryRetentionConfig from "../../../Types/Telemetry/TelemetryRetentionConfig";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import LogSeverity from "../../../Types/Log/LogSeverity";
import FieldLabelElement from "../Detail/FieldLabel";
import Input, { InputType } from "../Input/Input";

export interface ComponentProps {
  error?: string | undefined;
  onChange?: ((value: TelemetryRetentionConfig | null) => void) | undefined;
  value?: TelemetryRetentionConfig | undefined;
  initialValue?: TelemetryRetentionConfig | undefined;
}

const LOG_SEVERITIES: Array<LogSeverity> = [
  LogSeverity.Fatal,
  LogSeverity.Error,
  LogSeverity.Warning,
  LogSeverity.Information,
  LogSeverity.Debug,
  LogSeverity.Trace,
  LogSeverity.Unspecified,
];

const SPAN_STATUSES: Array<{ status: SpanStatus; label: string }> = [
  { status: SpanStatus.Error, label: "Error" },
  { status: SpanStatus.Ok, label: "Ok" },
  { status: SpanStatus.Unset, label: "Unset" },
];

const TelemetryRetentionConfigForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [config, setConfig] = useState<TelemetryRetentionConfig>(
    props.value || props.initialValue || {},
  );

  useEffect(() => {
    if (props.value) {
      setConfig(props.value);
    }
  }, [props.value]);

  const emit: (next: TelemetryRetentionConfig) => void = (
    next: TelemetryRetentionConfig,
  ): void => {
    setConfig(next);
    if (props.onChange) {
      const isEmpty: boolean =
        !next.logs && !next.traces && !next.metrics && !next.profiles;
      props.onChange(isEmpty ? null : next);
    }
  };

  const parsePositiveOrNull: (raw: string) => number | null = (
    raw: string,
  ): number | null => {
    if (!raw || raw.trim() === "") {
      return null;
    }
    const parsed: number = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.trunc(parsed);
  };

  const setPillarDefault: (
    pillar: keyof TelemetryRetentionConfig,
    value: number | null,
  ) => void = (
    pillar: keyof TelemetryRetentionConfig,
    value: number | null,
  ): void => {
    const next: TelemetryRetentionConfig = { ...config };
    const existing: { default?: number | null } | undefined = next[pillar] as
      | { default?: number | null }
      | undefined;
    const merged: Record<string, unknown> = {
      ...(existing || {}),
      default: value,
    };
    // If the only key is `default` and it's null, drop the pillar entirely.
    const keys: Array<string> = Object.keys(merged).filter((k: string) => {
      return (
        (merged as Record<string, unknown>)[k] !== null &&
        (merged as Record<string, unknown>)[k] !== undefined
      );
    });
    if (keys.length === 0) {
      delete next[pillar];
    } else {
      (next as Record<string, unknown>)[pillar] = merged;
    }
    emit(next);
  };

  const setLogSeverityValue: (
    severity: LogSeverity,
    value: number | null,
  ) => void = (severity: LogSeverity, value: number | null): void => {
    const next: TelemetryRetentionConfig = { ...config };
    const logs: NonNullable<TelemetryRetentionConfig["logs"]> = {
      ...(next.logs || {}),
    };
    const bySeverity: Partial<Record<LogSeverity, number | null>> = {
      ...(logs.bySeverity || {}),
    };
    if (value === null) {
      delete bySeverity[severity];
    } else {
      bySeverity[severity] = value;
    }
    if (Object.keys(bySeverity).length === 0) {
      delete logs.bySeverity;
    } else {
      logs.bySeverity = bySeverity;
    }
    if (Object.keys(logs).length === 0) {
      delete next.logs;
    } else {
      next.logs = logs;
    }
    emit(next);
  };

  const setSpanStatusValue: (
    status: SpanStatus,
    value: number | null,
  ) => void = (status: SpanStatus, value: number | null): void => {
    const next: TelemetryRetentionConfig = { ...config };
    const traces: NonNullable<TelemetryRetentionConfig["traces"]> = {
      ...(next.traces || {}),
    };
    const byStatus: Partial<Record<SpanStatus, number | null>> = {
      ...(traces.byStatus || {}),
    };
    if (value === null) {
      delete byStatus[status];
    } else {
      byStatus[status] = value;
    }
    if (Object.keys(byStatus).length === 0) {
      delete traces.byStatus;
    } else {
      traces.byStatus = byStatus;
    }
    if (Object.keys(traces).length === 0) {
      delete next.traces;
    } else {
      next.traces = traces;
    }
    emit(next);
  };

  const numberToString: (value: number | null | undefined) => string = (
    value: number | null | undefined,
  ): string => {
    return typeof value === "number" && value > 0 ? String(value) : "";
  };

  const renderPillarDefault: (
    pillar: keyof TelemetryRetentionConfig,
    label: string,
    description: string,
  ) => ReactElement = (
    pillar: keyof TelemetryRetentionConfig,
    label: string,
    description: string,
  ): ReactElement => {
    return (
      <div className="mb-4">
        <FieldLabelElement title={label} description={description} />
        <Input
          type={InputType.NUMBER}
          placeholder="Inherit umbrella default"
          value={numberToString(
            (config[pillar] as { default?: number | null } | undefined)
              ?.default,
          )}
          onChange={(raw: string) => {
            setPillarDefault(pillar, parsePositiveOrNull(raw));
          }}
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-gray-200 dark:border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">
          Logs
        </h3>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
          Retention in days for log records. Per-severity values override the
          logs default; leave blank to inherit.
        </p>
        {renderPillarDefault(
          "logs",
          "Logs default (days)",
          "Applies to log records whose severity has no specific override.",
        )}
        <div className="border-t border-gray-100 dark:border-slate-800 pt-3 mt-2">
          <p className="text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">
            Per-severity overrides
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {LOG_SEVERITIES.map((severity: LogSeverity) => {
              return (
                <div key={severity}>
                  <FieldLabelElement title={severity} />
                  <Input
                    type={InputType.NUMBER}
                    placeholder="Inherit logs default"
                    value={numberToString(config.logs?.bySeverity?.[severity])}
                    onChange={(raw: string) => {
                      setLogSeverityValue(severity, parsePositiveOrNull(raw));
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-gray-200 dark:border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">
          Traces
        </h3>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
          Retention in days for spans (and the exceptions captured on them).
          Per-status values override the traces default.
        </p>
        {renderPillarDefault(
          "traces",
          "Traces default (days)",
          "Applies to spans whose status has no specific override.",
        )}
        <div className="border-t border-gray-100 dark:border-slate-800 pt-3 mt-2">
          <p className="text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">
            Per-status overrides
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {SPAN_STATUSES.map(
              (entry: { status: SpanStatus; label: string }) => {
                return (
                  <div key={entry.label}>
                    <FieldLabelElement title={entry.label} />
                    <Input
                      type={InputType.NUMBER}
                      placeholder="Inherit traces default"
                      value={numberToString(
                        config.traces?.byStatus?.[entry.status],
                      )}
                      onChange={(raw: string) => {
                        setSpanStatusValue(
                          entry.status,
                          parsePositiveOrNull(raw),
                        );
                      }}
                    />
                  </div>
                );
              },
            )}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-gray-200 dark:border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">
          Metrics
        </h3>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
          Retention in days for metric data points.
        </p>
        {renderPillarDefault(
          "metrics",
          "Metrics default (days)",
          "Applies to all metric points. Leave blank to inherit the umbrella default.",
        )}
      </div>

      <div className="rounded-md border border-gray-200 dark:border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">
          Profiles
        </h3>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
          Retention in days for profile samples.
        </p>
        {renderPillarDefault(
          "profiles",
          "Profiles default (days)",
          "Applies to all profile samples. Leave blank to inherit the umbrella default.",
        )}
      </div>
    </div>
  );
};

export default TelemetryRetentionConfigForm;
