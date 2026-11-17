import React, { FunctionComponent, ReactElement } from "react";
import { getFigure } from "Common/UI/Components/EmptyFigure/EmptyFigure";
import { getValueOrQuietDash } from "Common/UI/Components/Table/TableEmptyValue";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import Card from "Common/UI/Components/Card/Card";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { describeWebVitalThresholds } from "Common/Types/Rum/WebVitals";
import { WebVital, formatDurationMsInLanguage } from "./telemetryMetrics";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getLineDirection } from "Common/UI/Utils/LineDirection";

export interface WebVitalsCardProps {
  vitals: Array<WebVital>;
  loading: boolean;
  // What the card as a whole shows, in an (i) beside its title.
  description?: string | undefined;
}

/* The parts of a vital that decide how it is shown and rated. */
export type RatedValue = Pick<WebVital, "value" | "unit" | "thresholds">;

/*
 * A vital's reading in the reader's language: an LCP's "2.50 s" is "2,50
 * Sek." in German and "۲٫۵۰ ثانیه" in Persian, a CLS "0.100" is "0,100"
 * and "۰٫۱۰۰" - English exactly as before.
 */
export const formatVital: (v: RatedValue, translator: Translator) => string = (
  v: RatedValue,
  translator: Translator,
): string => {
  if (v.value === null || !Number.isFinite(v.value)) {
    return EMPTY_VALUE_MARK;
  }
  if (v.unit === "ms") {
    return formatDurationMsInLanguage(v.value, translator);
  }
  return formatReaderFigure(v.value, {
    decimals: 3,
    language: translator.language,
  });
};

export const ratingClasses: (v: RatedValue) => {
  text: string;
  chip: string;
} = (v: RatedValue): { text: string; chip: string } => {
  if (v.value === null || !Number.isFinite(v.value)) {
    return { text: "text-gray-400", chip: "bg-gray-100 text-gray-400" };
  }
  if (v.value < v.thresholds.warn) {
    return {
      text: "text-emerald-600",
      chip: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
    };
  }
  if (v.value < v.thresholds.danger) {
    return {
      text: "text-amber-600",
      chip: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
    };
  }
  return {
    text: "text-red-600",
    chip: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  };
};

/*
 * The tooltip beside each vital: what it measures, then the limits the
 * Good / Needs work / Poor chip is judged against.
 */
export const describeWebVital: (v: WebVital) => string = (
  v: WebVital,
): string => {
  return [v.description, describeWebVitalThresholds(v)]
    .filter(Boolean)
    .join(" ");
};

export const ratingLabel: (v: RatedValue) => string = (
  v: RatedValue,
): string => {
  if (v.value === null || !Number.isFinite(v.value)) {
    return EMPTY_VALUE_MARK;
  }
  if (v.value < v.thresholds.warn) {
    return "Good";
  }
  if (v.value < v.thresholds.danger) {
    return "Needs work";
  }
  return "Poor";
};

const WebVitalsCard: FunctionComponent<WebVitalsCardProps> = (
  props: WebVitalsCardProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const anyReported: boolean = props.vitals.some((v: WebVital): boolean => {
    return v.value !== null && Number.isFinite(v.value);
  });

  return (
    <div className="mt-6">
      <Card
        title={
          props.description ? (
            <span className="inline-flex items-center gap-1.5">
              {translator.translateText("Core Web Vitals")}
              <InfoTooltip
                label="Core Web Vitals"
                text={props.description}
                iconClassName="h-4 w-4"
              />
            </span>
          ) : (
            "Core Web Vitals"
          )
        }
        description="Real-user performance (averaged over the selected range). Reported when your browser instrumentation emits web-vital metrics over OpenTelemetry."
      >
        {props.loading ? (
          <div className="-mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_: unknown, idx: number) => {
              return (
                <div
                  key={`wv-skeleton-${idx}`}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="h-3 w-12 rounded bg-gray-100 animate-pulse" />
                  <div className="mt-3 h-7 w-16 rounded bg-gray-100 animate-pulse" />
                </div>
              );
            })}
          </div>
        ) : !anyReported ? (
          <div className="-mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
            <div className="text-sm font-medium text-gray-700">
              {translator.translateText("No web vitals reported yet")}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {translator.translateText(
                "Instrument your browser app to emit LCP / INP / CLS / FCP / TTFB as OpenTelemetry metrics and they will appear here automatically.",
              )}
            </div>
          </div>
        ) : (
          <div className="-mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {props.vitals.map((v: WebVital): ReactElement => {
              const rc: { text: string; chip: string } = ratingClasses(v);
              return (
                <div
                  key={`wv-${v.key}`}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        {v.key}
                      </span>
                      <InfoTooltip
                        label={`${v.key.toUpperCase()} (${v.label})`}
                        text={describeWebVital(v)}
                      />
                    </div>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${rc.chip}`}
                    >
                      {getValueOrQuietDash(ratingLabel(v), { isSmall: true })}
                    </span>
                  </div>
                  <div className={`text-xl font-semibold ${rc.text}`}>
                    {/* "640 ms" on a page read from the right, not "ms 640". */}
                    <span
                      dir={getLineDirection(
                        formatVital(v, translator),
                        translator.language,
                      )}
                    >
                      {getFigure(formatVital(v, translator))}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 truncate">
                    {v.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default WebVitalsCard;
