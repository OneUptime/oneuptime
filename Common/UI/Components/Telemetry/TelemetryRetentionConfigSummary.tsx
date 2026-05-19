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

const TelemetryRetentionConfigSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const config: TelemetryRetentionConfig | null | undefined = props.config;

  if (
    !config ||
    (!config.logs && !config.traces && !config.metrics && !config.profiles)
  ) {
    return (
      <span className="text-sm text-gray-500 dark:text-slate-400">
        Using umbrella default for all pillars.
      </span>
    );
  }

  const renderPillar: (
    title: string,
    defaultDays: number | null | undefined,
    overrides: Array<{ label: string; days: number | null | undefined }>,
  ) => ReactElement | null = (
    title: string,
    defaultDays: number | null | undefined,
    overrides: Array<{ label: string; days: number | null | undefined }>,
  ): ReactElement | null => {
    const hasDefault: boolean =
      typeof defaultDays === "number" && defaultDays > 0;
    const visibleOverrides: Array<{ label: string; days: number }> = overrides
      .filter((o: { label: string; days: number | null | undefined }) => {
        return typeof o.days === "number" && o.days > 0;
      })
      .map((o: { label: string; days: number | null | undefined }) => {
        return { label: o.label, days: o.days as number };
      });

    if (!hasDefault && visibleOverrides.length === 0) {
      return null;
    }

    return (
      <div key={title} className="mb-2">
        <span className="text-sm font-medium text-gray-900 dark:text-slate-100">
          {title}:
        </span>{" "}
        <span className="text-sm text-gray-700 dark:text-slate-300">
          {hasDefault ? `${defaultDays} day(s)` : "inherits umbrella default"}
        </span>
        {visibleOverrides.length > 0 ? (
          <ul className="ml-4 text-xs text-gray-600 dark:text-slate-400 list-disc">
            {visibleOverrides.map((o: { label: string; days: number }) => {
              return (
                <li key={o.label}>
                  {o.label}: {o.days} day(s)
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      {renderPillar(
        "Logs",
        config.logs?.default,
        Object.entries(config.logs?.bySeverity || {}).map(
          ([severity, days]: [string, number | null | undefined]) => {
            return { label: severity as LogSeverity, days: days };
          },
        ),
      )}
      {renderPillar(
        "Traces",
        config.traces?.default,
        Object.entries(config.traces?.byStatus || {}).map(
          ([statusKey, days]: [string, number | null | undefined]) => {
            const status: SpanStatus = Number(statusKey) as SpanStatus;
            return { label: SPAN_STATUS_LABEL[status] || statusKey, days };
          },
        ),
      )}
      {renderPillar("Metrics", config.metrics?.default, [])}
      {renderPillar("Profiles", config.profiles?.default, [])}
    </div>
  );
};

export default TelemetryRetentionConfigSummary;
