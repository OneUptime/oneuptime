import React, { FunctionComponent, ReactElement } from "react";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Service from "Common/Models/DatabaseModels/Service";
import { getSeverityTheme } from "Common/UI/Components/LogsViewer/components/severityTheme";
import { truncateErrorPattern } from "Common/Utils/Telemetry/LogErrorPattern";
import { TopErrorPatternRow } from "../../Utils/LogsInsights";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import { labelErrorPatternResources } from "./LogsResourceDisplay";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  describeLogsOccurrenceCount,
  describeLogsTimeRange,
} from "./LogsInsightsCopy";

/*
 * "Top Errors": the distinct error messages in the window, each with how
 * often it happened, when it started, when it last happened and how far it
 * has spread. This is the panel the Insights page exists for — the previous
 * page could tell you that 4% of your logs were errors but not which errors
 * those were.
 */

export interface ComponentProps {
  patterns: Array<TopErrorPatternRow>;
  timeRange: RangeStartAndEndDateTime;
  isLoading: boolean;
  /** Resolved names for the resource ids a pattern was seen on. */
  serviceNameById: Map<string, Service>;
  /*
   * Names the page resolved for resources its Service list cannot name (a
   * RUM application, host or cluster). Display only: the row's resourceIds
   * are left as they are.
   */
  resourceNames?: TelemetryEntityNameMap | undefined;
  selectedPattern?: string | undefined;
  onSelect: (pattern: TopErrorPatternRow) => void;
}

function formatTimestamp(date: Date | null, translator: Translator): string {
  if (!date) {
    return translator.translateText("unknown") as string;
  }

  return OneUptimeDate.getDateAsLocalFormattedString(date);
}

/*
 * How long the error has been happening. A pattern that started three
 * seconds before it last fired is a burst; one spanning the whole window is
 * chronic — and the two want very different responses.
 */
function formatSpan(
  row: TopErrorPatternRow,
  translator: Translator,
): string | null {
  if (!row.firstSeenAt || !row.lastSeenAt) {
    return null;
  }

  const spanMs: number = row.lastSeenAt.getTime() - row.firstSeenAt.getTime();

  if (spanMs < 60 * 1000) {
    return translator.translateText("within a minute") as string;
  }

  const minutes: number = Math.round(spanMs / (60 * 1000));

  if (minutes < 60) {
    return translator.translateTemplate("over {{count}} min", {
      count: minutes,
    });
  }

  const hours: number = Math.round(minutes / 60);

  if (hours < 48) {
    return translator.translateTemplate("over {{count}} hr", { count: hours });
  }

  return translator.translatePlural(
    { one: "over {{count}} day", other: "over {{count}} days" },
    Math.round(hours / 24),
  );
}

const TopErrorsPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const header: ReactElement = (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h3 className="text-base font-semibold text-gray-900">
          {translator.translateText("Top errors")}
        </h3>
        <p className="text-xs text-gray-500">
          {translator.translateTemplate(
            "Distinct error messages in {{range}}. Select one to see what else was happening around it.",
            { range: describeLogsTimeRange(props.timeRange, translator) },
          )}
        </p>
      </div>
    </div>
  );

  if (props.isLoading) {
    return (
      <div className="mb-5">
        {header}
        <div className="rounded-xl border border-gray-200 bg-white p-10">
          <ComponentLoader />
        </div>
      </div>
    );
  }

  if (props.patterns.length === 0) {
    return (
      <div className="mb-5">
        {header}
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
            <Icon
              icon={IconProp.CheckCircle}
              className="h-5 w-5 text-emerald-500"
            />
          </div>
          <h4 className="mt-4 text-sm font-semibold text-gray-900">
            {translator.translateTemplate("No errors in {{range}}", {
              range: describeLogsTimeRange(props.timeRange, translator),
            })}
          </h4>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            {translator.translateText(
              "Nothing at Error or Fatal severity was logged in this window. Widen the time range or clear the service filter to look further.",
            )}
          </p>
        </div>
      </div>
    );
  }

  const topCount: number = Math.max(
    ...props.patterns.map((row: TopErrorPatternRow): number => {
      return row.count;
    }),
    1,
  );

  return (
    <div className="mb-5">
      {header}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <ul className="divide-y divide-gray-100">
          {props.patterns.map(
            (row: TopErrorPatternRow, index: number): ReactElement => {
              const isSelected: boolean = props.selectedPattern === row.pattern;
              const sharePercent: number = Math.max(
                2,
                Math.round((row.count / topCount) * 100),
              );
              const span: string | null = formatSpan(row, translator);

              /*
               * The raw body reads far better than the normalized pattern,
               * so it is the headline; the pattern itself sits underneath as
               * the thing that actually did the grouping.
               */
              const headline: string = truncateErrorPattern(
                row.sampleBody || row.pattern,
                180,
              );

              /*
               * Same precedence as the drawer this row opens: the loaded
               * Service, then the resolver, then the id. The Service list
               * alone printed raw UUIDs for non-Service resources.
               */
              const resourceNames: Array<string> = labelErrorPatternResources({
                resourceIds: row.resourceIds,
                nameMap: props.resourceNames,
                getKnownName: (resourceId: string): string | undefined => {
                  return props.serviceNameById
                    .get(resourceId)
                    ?.name?.toString();
                },
              });

              return (
                <li key={row.pattern}>
                  <button
                    type="button"
                    onClick={() => {
                      props.onSelect(row);
                    }}
                    className={`w-full px-5 py-4 text-left transition-colors ${
                      isSelected ? "bg-indigo-50/60" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-xs font-semibold text-gray-500">
                        {index + 1}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {row.severities.map(
                            (severity: string): ReactElement => {
                              return (
                                <span
                                  key={severity}
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                                    getSeverityTheme(severity).badgeClass
                                  }`}
                                >
                                  {severity}
                                </span>
                              );
                            },
                          )}
                          <span className="text-sm font-semibold text-gray-900">
                            {describeLogsOccurrenceCount(
                              row.count,
                              props.timeRange,
                              translator,
                            )}
                          </span>
                          {span && (
                            <span className="text-xs text-gray-400">
                              {span}
                            </span>
                          )}
                        </div>

                        <p className="mt-1 break-words font-mono text-sm text-gray-800">
                          {headline}
                        </p>

                        <p
                          className="mt-1 break-words font-mono text-xs text-gray-400"
                          title={row.pattern}
                        >
                          {truncateErrorPattern(row.pattern, 160)}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                          <span>
                            {translator.translatePlural(
                              {
                                one: "{{count}} source",
                                other: "{{count}} sources",
                              },
                              row.resourceCount,
                            )}
                            {resourceNames.length > 0
                              ? ` · ${resourceNames.join(", ")}`
                              : ""}
                          </span>
                          {row.traceCount > 0 && (
                            <span>
                              {translator.translatePlural(
                                {
                                  one: "{{count}} trace",
                                  other: "{{count}} traces",
                                },
                                row.traceCount,
                              )}
                            </span>
                          )}
                          <span>
                            {translator.translateTemplate(
                              "last seen {{time}}",
                              {
                                time: formatTimestamp(
                                  row.lastSeenAt,
                                  translator,
                                ),
                              },
                            )}
                          </span>
                          <span>
                            {translator.translateTemplate(
                              "first seen {{time}}",
                              {
                                time: formatTimestamp(
                                  row.firstSeenAt,
                                  translator,
                                ),
                              },
                            )}
                          </span>
                        </div>

                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-rose-400 to-red-500"
                            style={{ width: `${sharePercent}%` }}
                          />
                        </div>
                      </div>

                      <Icon
                        icon={IconProp.ChevronRight}
                        className="mt-1 h-4 w-4 flex-shrink-0 text-gray-300"
                      />
                    </div>
                  </button>
                </li>
              );
            },
          )}
        </ul>
      </div>
    </div>
  );
};

export default TopErrorsPanel;
