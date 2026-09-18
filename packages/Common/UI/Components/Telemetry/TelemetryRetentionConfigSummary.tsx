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
  hint: string;
  defaultDays: number | null;
  overrides: Array<PillarOverride>;
}

const PillarCard: FunctionComponent<{ pillar: PillarRender }> = (props: {
  pillar: PillarRender;
}): ReactElement => {
  const { title, hint, defaultDays, overrides } = props.pillar;
  const hasDefault: boolean = defaultDays !== null;
  const hasOverrides: boolean = overrides.length > 0;
  const isCustomized: boolean = hasDefault || hasOverrides;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              {title}
            </h4>
            <span
              className={
                isCustomized
                  ? "inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900"
                  : "inline-flex items-center rounded-full bg-gray-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-700"
              }
            >
              {isCustomized ? "Custom" : "Default"}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            {hint}
          </p>
        </div>
        <div className="text-right whitespace-nowrap shrink-0">
          {hasDefault ? (
            <>
              <div className="text-lg font-semibold text-gray-900 dark:text-slate-100 leading-tight">
                {defaultDays}{" "}
                <span className="text-sm font-normal text-gray-500 dark:text-slate-400">
                  {(defaultDays as number) === 1 ? "day" : "days"}
                </span>
              </div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">
                Default
              </div>
            </>
          ) : (
            <div className="text-xs italic text-gray-400 dark:text-slate-500">
              Uses default
              <br />
              retention
            </div>
          )}
        </div>
      </div>
      {hasOverrides ? (
        <div className="mt-3 border-t border-gray-100 dark:border-slate-800 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-2">
            Specific overrides
          </p>
          <div className="flex flex-wrap gap-1.5">
            {overrides.map((o: PillarOverride) => {
              return (
                <span
                  key={o.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300"
                >
                  <span>{o.label}</span>
                  <span
                    aria-hidden="true"
                    className="text-indigo-300 dark:text-indigo-700"
                  >
                    ·
                  </span>
                  <span className="font-normal">{formatDays(o.days)}</span>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const sortOverridesByDaysDesc: (
  list: Array<PillarOverride>,
) => Array<PillarOverride> = (
  list: Array<PillarOverride>,
): Array<PillarOverride> => {
  return [...list].sort((a: PillarOverride, b: PillarOverride) => {
    return b.days - a.days;
  });
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
      hint: "Log records, with optional per-severity overrides.",
      defaultDays: pickPositive(config?.logs?.default),
      overrides: sortOverridesByDaysDesc(logsOverrides),
    },
    {
      title: "Traces",
      hint: "Spans and exceptions, with optional per-status overrides.",
      defaultDays: pickPositive(config?.traces?.default),
      overrides: sortOverridesByDaysDesc(tracesOverrides),
    },
    {
      title: "Metrics",
      hint: "Metric data points and aggregates.",
      defaultDays: pickPositive(config?.metrics?.default),
      overrides: [],
    },
    {
      title: "Profiles",
      hint: "Profile samples and stack traces.",
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
          <p className="text-sm font-medium text-gray-700 dark:text-slate-200">
            No overrides set.
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            Every telemetry type uses the default retention shown above.
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
