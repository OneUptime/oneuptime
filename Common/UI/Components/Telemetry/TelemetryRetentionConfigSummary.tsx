import React, { FunctionComponent, ReactElement } from "react";
import TelemetryRetentionConfig from "../../../Types/Telemetry/TelemetryRetentionConfig";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import LogSeverity from "../../../Types/Log/LogSeverity";

export interface ComponentProps {
  config?: TelemetryRetentionConfig | null | undefined;
}

const SPAN_STATUS_LABEL: Record<SpanStatus, string> = {
  [SpanStatus.Unset]: "Unset",
  [SpanStatus.Ok]: "Ok",
  [SpanStatus.Error]: "Error",
};

const LOG_SEVERITY_ORDER: Array<LogSeverity> = [
  LogSeverity.Fatal,
  LogSeverity.Error,
  LogSeverity.Warning,
  LogSeverity.Information,
  LogSeverity.Debug,
  LogSeverity.Trace,
  LogSeverity.Unspecified,
];

const SPAN_STATUS_ORDER: Array<SpanStatus> = [
  SpanStatus.Error,
  SpanStatus.Ok,
  SpanStatus.Unset,
];

const formatDays: (days: number) => string = (days: number): string => {
  return days === 1 ? "1 day" : `${days} days`;
};

const pickPositive: (value: number | null | undefined) => number | null = (
  value: number | null | undefined,
): number | null => {
  return typeof value === "number" && value > 0 ? value : null;
};

interface PillarOverride {
  label: string;
  days: number;
}

interface PillarRender {
  title: string;
  defaultDays: number | null;
  overrides: Array<PillarOverride>;
}

const PillarCard: FunctionComponent<{ pillar: PillarRender }> = (props: {
  pillar: PillarRender;
}): ReactElement => {
  const { title, defaultDays, overrides } = props.pillar;
  const hasDefault: boolean = defaultDays !== null;
  const hasOverrides: boolean = overrides.length > 0;
  const isInherited: boolean = !hasDefault && !hasOverrides;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 flex flex-col">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">
          {title}
        </span>
        <span
          className={
            hasDefault
              ? "text-sm font-medium text-gray-900 dark:text-slate-100 whitespace-nowrap"
              : "text-xs italic text-gray-400 dark:text-slate-500 whitespace-nowrap"
          }
        >
          {hasDefault ? formatDays(defaultDays as number) : "umbrella default"}
        </span>
      </div>
      {hasOverrides ? (
        <div className="flex flex-wrap gap-1.5">
          {overrides.map((o: PillarOverride) => {
            return (
              <span
                key={o.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300"
              >
                <span>{o.label}</span>
                <span aria-hidden="true" className="text-indigo-300 dark:text-indigo-700">
                  ·
                </span>
                <span className="font-normal">{formatDays(o.days)}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-400 dark:text-slate-500">
          {isInherited
            ? "Falls back to the umbrella default."
            : "No per-bucket overrides."}
        </p>
      )}
    </div>
  );
};

const TelemetryRetentionConfigSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const config: TelemetryRetentionConfig | null | undefined = props.config;

  const logsOverrides: Array<PillarOverride> = LOG_SEVERITY_ORDER.flatMap(
    (severity: LogSeverity): Array<PillarOverride> => {
      const days: number | null = pickPositive(
        config?.logs?.bySeverity?.[severity],
      );
      return days === null ? [] : [{ label: severity, days: days }];
    },
  );

  const tracesOverrides: Array<PillarOverride> = SPAN_STATUS_ORDER.flatMap(
    (status: SpanStatus): Array<PillarOverride> => {
      const days: number | null = pickPositive(
        config?.traces?.byStatus?.[status],
      );
      return days === null
        ? []
        : [{ label: SPAN_STATUS_LABEL[status], days: days }];
    },
  );

  const pillars: Array<PillarRender> = [
    {
      title: "Logs",
      defaultDays: pickPositive(config?.logs?.default),
      overrides: logsOverrides,
    },
    {
      title: "Traces",
      defaultDays: pickPositive(config?.traces?.default),
      overrides: tracesOverrides,
    },
    {
      title: "Metrics",
      defaultDays: pickPositive(config?.metrics?.default),
      overrides: [],
    },
    {
      title: "Profiles",
      defaultDays: pickPositive(config?.profiles?.default),
      overrides: [],
    },
  ];

  const anyConfigured: boolean = pillars.some((p: PillarRender) => {
    return p.defaultDays !== null || p.overrides.length > 0;
  });

  return (
    <div className="space-y-3">
      {!anyConfigured ? (
        <div className="rounded-md border border-dashed border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/40 px-4 py-3">
          <p className="text-sm text-gray-600 dark:text-slate-300">
            No per-pillar overrides set.
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
            Every pillar falls back to the umbrella retention default.
          </p>
        </div>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {pillars.map((pillar: PillarRender) => {
          return <PillarCard key={pillar.title} pillar={pillar} />;
        })}
      </div>
    </div>
  );
};

export default TelemetryRetentionConfigSummary;
