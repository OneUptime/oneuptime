import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TimeRange from "Common/Types/Time/TimeRange";
import { JSONObject } from "Common/Types/JSON";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import { HistogramBucket } from "Common/UI/Components/LogsViewer/types";
import LogsHistogram from "Common/UI/Components/LogsViewer/components/LogsHistogram";
import Navigation from "Common/UI/Utils/Navigation";
import HintChip from "../Metrics/HintChip";
import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import ExplorerLink from "../Metrics/Utils/ExplorerLink";
import TelemetryCompanionSignalTabs from "./TelemetryCompanionSignalTabs";
import { buildLogsHistogramRequest } from "../Logs/LogsHistogramRequest";
import {
  fetchLogsHistogramRaw,
  fetchTopErrorPatterns,
} from "../Logs/LogsInsightsApi";
import {
  LogVolumeSummary,
  LogsInsightsScope,
  TopErrorPatternRow,
  buildErrorPatternLogsRoute,
  describeOccurrenceCount,
  summarizeSeverityBuckets,
} from "../../Utils/LogsInsights";
import {
  MetricScopeFilterExtraction,
  extractScopeFiltersFromQueryConfigs,
  formatDroppedScopeHint,
  resolveServiceIdsByNames,
} from "../../Utils/MetricsCrossSignalPivot";

export interface ComponentProps {
  /** What the user is investigating, e.g. `CPU by host · 12:01–12:14`. */
  title?: string | undefined;
  /** The pinned window under investigation (a zoom, a bucket, a spike). */
  window: InBetween<Date>;
  /**
   * The metric view scoped to what the user clicked (series labels and
   * filters already folded into the query configs' attributes).
   */
  metricViewData: MetricViewData;
  onClose: () => void;
}

const TOP_ERROR_PATTERN_LIMIT: number = 5;

/**
 * The in-context investigation panel: everything that happened in one
 * window, without leaving the page. A log-signal summary (volume by
 * severity + top error patterns), the metric charts pinned to the
 * window, and the companion logs/traces/exceptions tabs scoped the same
 * way — with escape hatches into the full explorers.
 */
const InvestigationDrawer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const windowStartMs: number = props.window.startValue.getTime();
  const windowEndMs: number = props.window.endValue.getTime();

  /*
   * Everything handed to the companion machinery MUST be referentially
   * stable — CompanionMetricsTab's discovery effect keys on spec
   * identity, and an inline-recreated query would put it in a refetch
   * loop.
   */
  const pinnedWindow: InBetween<Date> = useMemo(() => {
    return new InBetween<Date>(new Date(windowStartMs), new Date(windowEndMs));
  }, [windowStartMs, windowEndMs]);

  const pinnedViewData: MetricViewData = useMemo(() => {
    return {
      queryConfigs: props.metricViewData.queryConfigs,
      formulaConfigs: props.metricViewData.formulaConfigs || [],
      /*
       * Pinned on purpose — no rangeToken: an investigation window must
       * not re-anchor to "now" on refresh.
       */
      startAndEndDate: pinnedWindow,
    };
  }, [props.metricViewData, pinnedWindow]);

  const telemetryQuery: TelemetryQuery = useMemo(() => {
    return {
      telemetryType: TelemetryType.Metric,
      telemetryQuery: null,
      metricViewData: pinnedViewData,
    } as TelemetryQuery;
  }, [pinnedViewData]);

  const pinnedTimeRange: RangeStartAndEndDateTime = useMemo(() => {
    return {
      range: TimeRange.CUSTOM,
      startAndEndDate: pinnedWindow,
    };
  }, [pinnedWindow]);

  const extraction: MetricScopeFilterExtraction = useMemo(() => {
    return extractScopeFiltersFromQueryConfigs(
      pinnedViewData.queryConfigs || [],
    );
  }, [pinnedViewData]);

  // -- Log signal summary (volume + top error patterns) --

  const [logBuckets, setLogBuckets] = useState<Array<HistogramBucket> | null>(
    null,
  );
  const [errorPatterns, setErrorPatterns] =
    useState<Array<TopErrorPatternRow> | null>(null);

  useEffect(() => {
    let isCancelled: boolean = false;

    const fetchLogSignal: () => Promise<void> = async (): Promise<void> => {
      /*
       * Service names resolve to ids first (cached) so the log queries
       * scope by the primaryEntityId column the log rows actually store.
       */
      let serviceIds: Array<string> = [];
      if (extraction.serviceNames.length > 0) {
        const mapping: Dictionary<string> = await resolveServiceIdsByNames(
          extraction.serviceNames,
        );
        serviceIds = extraction.serviceNames
          .map((serviceName: string): string => {
            return mapping[serviceName] || "";
          })
          .filter((serviceId: string): boolean => {
            return serviceId !== "";
          });
      }

      if (isCancelled) {
        return;
      }

      const scope: LogsInsightsScope = {
        timeRange: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date(windowStartMs),
            new Date(windowEndMs),
          ),
        },
        ...(serviceIds.length > 0 ? { serviceIds } : {}),
      };

      const [buckets, patterns]: [
        Array<JSONObject>,
        Array<TopErrorPatternRow>,
      ] = await Promise.all([
        fetchLogsHistogramRaw(
          buildLogsHistogramRequest({
            timeRange: scope.timeRange,
            ...(serviceIds.length > 0 ? { serviceIds } : {}),
            /*
             * Unlike the pattern analysis, the histogram can carry the
             * metric view's attribute filters — logs tagged the same way
             * the metric rows are.
             */
            attributes:
              Object.keys(extraction.attributes).length > 0
                ? extraction.attributes
                : undefined,
            appliedFacetFilters: new Map<string, Set<string>>(),
          }),
        ).catch((): Array<JSONObject> => {
          return [];
        }),
        fetchTopErrorPatterns(scope, TOP_ERROR_PATTERN_LIMIT).catch(
          (): Array<TopErrorPatternRow> => {
            return [];
          },
        ),
      ]);

      if (isCancelled) {
        return;
      }

      setLogBuckets(buckets as unknown as Array<HistogramBucket>);
      setErrorPatterns(patterns);
    };

    void fetchLogSignal();

    return () => {
      isCancelled = true;
    };
  }, [windowStartMs, windowEndMs, extraction]);

  const logVolume: LogVolumeSummary | null = useMemo(() => {
    if (!logBuckets) {
      return null;
    }
    return summarizeSeverityBuckets(logBuckets as unknown as Array<JSONObject>);
  }, [logBuckets]);

  const droppedHint: string = formatDroppedScopeHint(
    extraction.droppedFilterKeys,
  );

  const scopeChips: Array<string> = useMemo(() => {
    const chips: Array<string> = [];
    for (const serviceName of extraction.serviceNames) {
      chips.push(`service = ${serviceName}`);
    }
    for (const key of Object.keys(extraction.attributes)) {
      chips.push(`${key} = ${extraction.attributes[key]}`);
    }
    return chips;
  }, [extraction]);

  const openPattern: (pattern: TopErrorPatternRow) => void = (
    pattern: TopErrorPatternRow,
  ): void => {
    const scope: LogsInsightsScope = {
      timeRange: pinnedTimeRange,
    };
    const route: ReturnType<typeof buildErrorPatternLogsRoute> =
      buildErrorPatternLogsRoute(pattern.pattern, scope, pattern.sampleBody);
    if (!route) {
      return;
    }
    // Navigation replaces the page under the drawer — close first.
    props.onClose();
    Navigation.navigate(route);
  };

  const openInExplorer: VoidFunction = (): void => {
    props.onClose();
    ExplorerLink.openInExplorer(pinnedViewData);
  };

  return (
    <SideOver
      title={props.title || "Investigate window"}
      description={OneUptimeDate.getInBetweenDatesAsFormattedString(
        pinnedWindow,
      )}
      size={SideOverSize.Large}
      onClose={props.onClose}
    >
      {/* One wrapper element — SideOver divides its children. */}
      <div className="space-y-5 py-5">
        {/* Scope strip */}
        <div className="flex flex-wrap items-center gap-1.5">
          {scopeChips.length > 0 ? (
            scopeChips.map((chip: string) => {
              return (
                <span
                  key={chip}
                  className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-600"
                >
                  {chip}
                </span>
              );
            })
          ) : (
            <span className="text-xs text-gray-500">
              Scoped by time window only — results cover the whole project.
            </span>
          )}
          {droppedHint ? (
            <HintChip variant="amber">{droppedHint}</HintChip>
          ) : null}
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            onClick={openInExplorer}
          >
            <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
            Open in Metric Explorer
          </button>
        </div>

        {/* Log signal summary */}
        <Card
          title="Log signal"
          description="Log volume and the loudest error patterns inside this window."
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: "Log lines",
                  value: logVolume ? logVolume.total.toLocaleString() : "…",
                },
                {
                  label: "Errors",
                  value: logVolume
                    ? logVolume.errorCount.toLocaleString()
                    : "…",
                },
                {
                  label: "Error rate",
                  value: logVolume
                    ? `${logVolume.errorRatePercent.toFixed(1)}%`
                    : "…",
                },
              ].map((stat: { label: string; value: string }) => {
                return (
                  <div
                    key={stat.label}
                    className="rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      {stat.label}
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
                      {stat.value}
                    </p>
                  </div>
                );
              })}
            </div>

            <LogsHistogram
              buckets={logBuckets || []}
              isLoading={logBuckets === null}
            />

            <div>
              <p className="text-xs font-medium text-gray-700">
                Top error patterns
              </p>
              {errorPatterns === null ? (
                <p className="mt-1 text-xs text-gray-400">Loading…</p>
              ) : errorPatterns.length === 0 ? (
                <p className="mt-1 text-xs text-gray-500">
                  No error-severity logs in this window.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {errorPatterns.map((pattern: TopErrorPatternRow) => {
                    return (
                      <li key={pattern.pattern}>
                        <button
                          type="button"
                          className="group flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                          title="Open these logs in the explorer"
                          onClick={() => {
                            openPattern(pattern);
                          }}
                        >
                          <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-red-700">
                            {pattern.count.toLocaleString()}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700 group-hover:text-gray-900">
                            {pattern.sampleBody || pattern.pattern}
                          </span>
                          <span className="hidden shrink-0 text-[11px] text-gray-400 sm:inline">
                            {describeOccurrenceCount(
                              pattern.count,
                              pinnedTimeRange,
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {scopeChips.length > 0 &&
              Object.keys(extraction.attributes).length > 0 ? (
                <p className="mt-1.5 text-[11px] text-gray-400">
                  Patterns are scoped by service and window; attribute filters
                  apply to the volume chart above.
                </p>
              ) : null}
            </div>
          </div>
        </Card>

        {/* Metrics + companion signals, all pinned to the window */}
        <TelemetryCompanionSignalTabs
          telemetryQuery={telemetryQuery}
          snapshotWindow={pinnedWindow}
          eventNoun="view"
          primarySignalElement={
            <EmbeddedMetricCard
              title="Metrics"
              description="The charts this investigation started from, pinned to the window."
              queryConfigs={pinnedViewData.queryConfigs}
              formulaConfigs={pinnedViewData.formulaConfigs}
              defaultTimeRange={pinnedTimeRange}
            />
          }
        />
      </div>
    </SideOver>
  );
};

export default InvestigationDrawer;
