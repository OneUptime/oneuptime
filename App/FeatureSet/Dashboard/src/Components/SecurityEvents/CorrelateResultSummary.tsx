import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import useTranslateValue from "Common/UI/Utils/Translation";
import SecurityEventSeverityPill, {
  getSeverityColor,
} from "./SecurityEventSeverityPill";
import {
  CorrelationGraphNode,
  CorrelationGraphSummary,
} from "../../Utils/CorrelationGraph";

/*
 * What sits above and below the correlation graph: a strip of four numbers
 * that answers "how big is this, and where should I look first?" before
 * anyone reads the canvas, and the key that explains the canvas itself.
 *
 * The strip deliberately never repeats the result sentence or the cap
 * notice ("matching events", "lower bounds") — those live once in the
 * results header, and tests find them by their text.
 */

type TranslateFunction = (value: string) => string;

/*
 * Class cards with no severity use this accent, so the legend's
 * "No severity" dot matches what the graph draws.
 */
const NO_SEVERITY_COLOR: string = "var(--ou-chart-series-neutral, #64748b)";

// The same indigo as the centre card, in both themes.
const FILTER_ACCENT_COLOR: string = "#4f46e5";

/*
 * Fatal shares Critical's colour, so it needs no dot of its own.
 * Informational gets one: it is a real severity, drawn in its own grey,
 * which in dark mode differs from an unrated class.
 */
const LEGEND_SEVERITIES: Array<OcsfSeverity> = [
  OcsfSeverity.Critical,
  OcsfSeverity.High,
  OcsfSeverity.Medium,
  OcsfSeverity.Low,
  OcsfSeverity.Informational,
];

const useTranslate: () => TranslateFunction = (): TranslateFunction => {
  const { translateString } = useTranslateValue();

  return (value: string): string => {
    return translateString(value) || value;
  };
};

interface StatTileProps {
  testId: string;
  label: string;
  icon: IconProp;
  value: ReactNode;
  hint: ReactNode;
  isWarning?: boolean | undefined;
}

const StatTile: FunctionComponent<StatTileProps> = (
  props: StatTileProps,
): ReactElement => {
  return (
    <div
      data-testid={props.testId}
      className={`min-w-0 rounded-lg border px-3 py-2.5 ${
        props.isWarning
          ? "border-amber-200 bg-amber-50"
          : "border-gray-200 bg-gray-50"
      }`}
    >
      <dt className="flex items-start justify-between gap-2 text-xs font-medium text-gray-500">
        <span className="min-w-0 break-words">{props.label}</span>
        {/* The label already names the tile; the icon is decoration. */}
        <div aria-hidden="true" className="shrink-0">
          <Icon icon={props.icon} className="h-4 w-4 text-indigo-500" />
        </div>
      </dt>
      <dd className="mt-1 flex min-h-[2rem] items-center text-2xl font-semibold tracking-tight tabular-nums text-gray-900">
        {props.value}
      </dd>
      {/*
       * A flex row rather than a clipped block, so the worst-class button
       * can truncate on its own without clipping its focus ring.
       */}
      <dd
        className={`mt-0.5 flex min-w-0 items-baseline gap-1 text-xs ${
          props.isWarning ? "text-amber-700" : "text-gray-500"
        }`}
      >
        {props.hint}
      </dd>
    </div>
  );
};

export interface CorrelateResultStatsProps {
  eventCount: number;
  isTruncated: boolean;
  summary: CorrelationGraphSummary;
  isStale: boolean;
  onSelectNode: (id: string) => void;
}

export const CorrelateResultStats: FunctionComponent<
  CorrelateResultStatsProps
> = (props: CorrelateResultStatsProps): ReactElement => {
  const t: TranslateFunction = useTranslate();
  const summary: CorrelationGraphSummary = props.summary;
  const worstClass: CorrelationGraphNode | undefined = summary.worstClass;
  const dropped: number = summary.droppedObservableCount;

  return (
    <dl
      data-testid="correlate-stats"
      className={`grid grid-cols-2 gap-3 border-b border-gray-200 px-4 py-3 md:px-5 xl:grid-cols-4 ${
        props.isStale ? "opacity-60" : ""
      }`}
    >
      <StatTile
        testId="correlate-stat-events"
        label={t("Events")}
        icon={IconProp.ShieldExclamation}
        value={`${props.eventCount}${props.isTruncated ? "+" : ""}`}
        isWarning={props.isTruncated}
        hint={
          <span className="min-w-0 break-words">
            {props.isTruncated
              ? t("Search limit reached")
              : t("In the selected window")}
          </span>
        }
      />
      <StatTile
        testId="correlate-stat-classes"
        label={t("Event classes")}
        icon={IconProp.Layers}
        value={summary.classCount}
        hint={
          <span className="min-w-0 break-words">
            {`${summary.highRiskClassCount} ${t("critical or high")}`}
          </span>
        }
      />
      <StatTile
        testId="correlate-stat-observables"
        label={t("Co-occurring observables")}
        icon={IconProp.Fingerprint}
        value={summary.observableCount}
        isWarning={dropped > 0}
        hint={
          <span className="min-w-0 break-words">
            {dropped > 0
              ? `${dropped} ${t("less frequent not shown")}`
              : t("All shown")}
          </span>
        }
      />
      <StatTile
        testId="correlate-stat-severity"
        label={t("Highest severity")}
        icon={IconProp.Alert}
        value={
          worstClass ? (
            <SecurityEventSeverityPill
              severityName={worstClass.worstSeverity}
            />
          ) : (
            <span className="text-base">—</span>
          )
        }
        hint={
          worstClass ? (
            <>
              {/*
               * The space is not drawn inside the flex row, but it keeps the
               * read-out and copied text from running together.
               */}
              <span className="shrink-0">{t("Found in")}</span>{" "}
              <button
                type="button"
                data-testid="correlate-stat-worst-class"
                title={worstClass.label}
                disabled={props.isStale}
                className="min-w-0 truncate rounded-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default"
                onClick={() => {
                  props.onSelectNode(worstClass.id);
                }}
              >
                {worstClass.label}
              </button>
            </>
          ) : (
            <span className="min-w-0 break-words">
              {t("No severity recorded")}
            </span>
          )
        }
      />
    </dl>
  );
};

interface LegendDotProps {
  testId: string;
  color: string;
  label: string;
}

const LegendDot: FunctionComponent<LegendDotProps> = (
  props: LegendDotProps,
): ReactElement => {
  return (
    <span data-testid={props.testId} className="inline-flex items-center gap-1">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: props.color }}
      />
      {props.label}
    </span>
  );
};

export interface CorrelateGraphLegendProps {
  droppedObservableCount: number;
}

export const CorrelateGraphLegend: FunctionComponent<
  CorrelateGraphLegendProps
> = (props: CorrelateGraphLegendProps): ReactElement => {
  const t: TranslateFunction = useTranslate();

  return (
    <div
      data-testid="correlate-legend"
      className="space-y-2 border-t border-gray-200 px-4 py-3 text-xs text-gray-600 md:px-5"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <ul
          role="list"
          aria-label={t("Graph key")}
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
        >
          <li
            data-testid="correlate-legend-filter"
            className="inline-flex items-center gap-1.5"
          >
            <span
              aria-hidden="true"
              className="h-3 w-5 shrink-0 rounded"
              style={{ backgroundColor: FILTER_ACCENT_COLOR }}
            />
            {t("Your filter")}
          </li>
          <li
            data-testid="correlate-legend-class"
            className="inline-flex items-center gap-1.5"
          >
            <span
              aria-hidden="true"
              className="relative h-3 w-5 shrink-0 overflow-hidden rounded-sm border border-gray-300 bg-white"
            >
              <span
                className="absolute inset-y-0 left-0"
                style={{ width: 3, backgroundColor: NO_SEVERITY_COLOR }}
              />
            </span>
            {t("Event class")}
          </li>
          <li
            data-testid="correlate-legend-observable"
            className="inline-flex items-center gap-1.5"
          >
            <span
              aria-hidden="true"
              className="h-3 w-5 shrink-0 rounded-full border border-gray-300 bg-white"
            />
            {t("Co-occurring observable")}
          </li>
          <li
            data-testid="correlate-legend-severity"
            className="inline-flex flex-wrap items-center gap-x-3 gap-y-1"
          >
            <span className="text-gray-500">{t("Worst severity:")}</span>
            {LEGEND_SEVERITIES.map((severity: OcsfSeverity): ReactElement => {
              // OCSF names match the pills, which are not translated either.
              return (
                <LegendDot
                  key={severity}
                  testId={`correlate-legend-severity-${severity.toLowerCase()}`}
                  color={getSeverityColor(severity).toString()}
                  label={severity}
                />
              );
            })}
            <LegendDot
              testId="correlate-legend-severity-none"
              color={NO_SEVERITY_COLOR}
              label={t("No severity")}
            />
          </li>
        </ul>
        <p className="text-gray-500">
          {t(
            "Numbers are event counts; thicker lines mean more shared events. Hold Ctrl and scroll, or pinch, to zoom.",
          )}
        </p>
      </div>
      {props.droppedObservableCount > 0 && (
        <p
          role="status"
          data-testid="correlate-dropped-observables"
          className="text-amber-700"
        >
          {`${props.droppedObservableCount} ${t(
            "less frequent observables not drawn",
          )}`}
        </p>
      )}
    </div>
  );
};
