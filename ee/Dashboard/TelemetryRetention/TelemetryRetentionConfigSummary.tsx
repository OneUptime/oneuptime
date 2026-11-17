import React, { FunctionComponent, ReactElement } from "react";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import LogSeverity from "Common/Types/Log/LogSeverity";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  config?: TelemetryRetentionConfig | null | undefined;
}

const SPAN_STATUS_LABEL: Record<SpanStatus, string> = {
  [SpanStatus.Unset]: translationKey("Unset"),
  [SpanStatus.Ok]: translationKey("Ok"),
  [SpanStatus.Error]: translationKey("Error"),
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

// A number of days, in the form the reader's language gives the count.
const DAYS: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};

// The same, with the count drawn apart from its unit (a slot).
const DAYS_WITH_COUNT: PluralTemplate = {
  one: "{{days}} day",
  other: "{{days}} days",
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
  const translator: Translator = useTranslator();
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
              {translator.translateText(title)}
            </h4>
            <Pill
              text={isCustomized ? "Custom" : "Default"}
              tone={isCustomized ? PillTone.Info : PillTone.Neutral}
              isDotHidden={true}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            {translator.translateText(hint)}
          </p>
        </div>
        <div className="text-right whitespace-nowrap shrink-0">
          {hasDefault ? (
            <>
              {/*
               * The count large and its unit small, in the order and the
               * form the reader's language says them: "5 Tage", "۵ روز".
               */}
              <div className="text-lg font-semibold text-gray-900 dark:text-slate-100 leading-tight">
                <TranslatedSentence
                  template={DAYS_WITH_COUNT}
                  count={defaultDays as number}
                  slots={{
                    days: <>{translator.formatNumber(defaultDays as number)}</>,
                  }}
                  renderText={(text: string): ReactElement => {
                    return (
                      <span className="text-sm font-normal text-gray-500 dark:text-slate-400">
                        {text}
                      </span>
                    );
                  }}
                />
              </div>
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-500">
                {translator.translateText("Default")}
              </div>
            </>
          ) : (
            <div className="max-w-[7rem] whitespace-normal text-xs italic text-gray-500 dark:text-slate-500">
              {translator.translateText("Uses default retention")}
            </div>
          )}
        </div>
      </div>
      {hasOverrides ? (
        <div className="mt-3 border-t border-gray-100 dark:border-slate-800 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500 mb-2">
            {translator.translateText("Specific overrides")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {overrides.map((o: PillarOverride) => {
              return (
                <span
                  key={o.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300"
                >
                  <span>{translator.translateText(o.label)}</span>
                  <span
                    aria-hidden="true"
                    className="text-indigo-300 dark:text-indigo-700"
                  >
                    <InlineSeparator markOnly />
                  </span>
                  <span className="font-normal">
                    {translator.translatePlural(DAYS, o.days)}
                  </span>
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
  const translator: Translator = useTranslator();
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
      title: translationKey("Logs"),
      hint: translationKey(
        "Log records, with optional per-severity overrides.",
      ),
      defaultDays: pickPositive(config?.logs?.default),
      overrides: sortOverridesByDaysDesc(logsOverrides),
    },
    {
      title: translationKey("Traces"),
      hint: translationKey(
        "Spans and exceptions, with optional per-status overrides.",
      ),
      defaultDays: pickPositive(config?.traces?.default),
      overrides: sortOverridesByDaysDesc(tracesOverrides),
    },
    {
      title: translationKey("Metrics"),
      hint: translationKey("Metric data points and aggregates."),
      defaultDays: pickPositive(config?.metrics?.default),
      overrides: [],
    },
    {
      title: translationKey("Profiles"),
      hint: translationKey("Profile samples and stack traces."),
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
            {translator.translateText("No overrides set.")}
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {translator.translateText(
              "Every telemetry type uses the default retention shown above.",
            )}
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
