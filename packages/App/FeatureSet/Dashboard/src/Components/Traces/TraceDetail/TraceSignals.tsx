import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Query from "Common/Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  CrossSignalQueryParams,
  TelemetryCrossSignalScope,
  toMetricsExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  ProfilePresenceGate,
  TraceCorrelatedMetricItem,
  TraceMetricSeries,
  buildTraceFlamegraphRequest,
  describeDroppedScopeFields,
  getProfilePresenceGate,
  groupMetricsForTrace,
} from "../../../Utils/TraceCorrelatedSignals";
import ExceptionInstanceTable from "../../Exceptions/ExceptionInstanceTable";
import DashboardLogsViewer from "../../Logs/LogsViewer";
import TraceScopedFlamegraph from "../TraceScopedFlamegraph";

export type CorrelatedSignalTab = "logs" | "exceptions" | "metrics" | "profile";

export interface ComponentProps {
  traceId: string;
  // The trace's wall-clock window; null until spans load.
  traceWindow: { startTime: Date; endTime: Date } | null;
}

// Server-enforced cap on POST /telemetry/metrics/for-trace.
const METRICS_FOR_TRACE_LIMIT: number = 500;
// Metric links widen the trace's window so near-instant traces still chart.
export const TRACE_METRIC_WINDOW_PADDING_MINUTES: number = 5;
const MAX_SAMPLED_METRIC_VALUES: number = 5;

export function formatTraceMetricValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 1000) {
    return Math.round(value).toLocaleString();
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  return value.toFixed(2);
}

/*
 * Every other signal this trace touched — its logs, the exceptions raised on
 * its spans, the metric datapoints that recorded it as an exemplar and, when
 * the trace was profiled, a flame graph of its samples.
 */
const TraceSignals: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { traceId } = props;

  const [activeSignalTab, setActiveSignalTab] =
    useState<CorrelatedSignalTab>("logs");
  const [exceptionCount, setExceptionCount] = useState<number | null>(null);

  /*
   * Profile-tab gate: sampleCount from POST /telemetry/profiles/
   * trace-presence, checked once per trace so the tab only exists when the
   * flame graph would have data.
   */
  const [profileSampleCount, setProfileSampleCount] = useState<number>(0);

  // Metrics tab: fetched lazily on first open.
  const [traceMetricSeries, setTraceMetricSeries] = useState<
    Array<TraceMetricSeries>
  >([]);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);
  const [metricsFetched, setMetricsFetched] = useState<boolean>(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  /*
   * Generation counter for the lazy metrics fetch (same pattern as
   * TraceScopedFlamegraph's loadGenerationRef): the effect's cleanup bumps
   * the counter only when the tab/trace actually changes or the card
   * unmounts, so a stale response can never write state — and the effect's
   * own loading-state writes can never cancel the in-flight request.
   */
  const metricsLoadGenerationRef: React.MutableRefObject<number> =
    useRef<number>(0);

  useEffect(() => {
    setActiveSignalTab("logs");
    setExceptionCount(null);
    setProfileSampleCount(0);
    setTraceMetricSeries([]);
    setMetricsLoading(false);
    setMetricsFetched(false);
    setMetricsError(null);
  }, [traceId]);

  /*
   * Checked eagerly per trace: the Profile tab must be gated up front. A
   * failed check hides the tab rather than crashing the card.
   */
  useEffect(() => {
    let cancelled: boolean = false;

    const checkProfilePresence: () => Promise<void> =
      async (): Promise<void> => {
        const requestBody: JSONObject | null = buildTraceFlamegraphRequest({
          traceId,
        });

        if (!requestBody) {
          return;
        }

        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.post<JSONObject>({
              url: URL.fromString(APP_API_URL.toString()).addRoute(
                "/telemetry/profiles/trace-presence",
              ),
              data: requestBody,
              headers: ModelAPI.getCommonHeaders(),
            });

          if (cancelled) {
            return;
          }

          if (response instanceof HTTPErrorResponse) {
            throw response;
          }

          const gate: ProfilePresenceGate = getProfilePresenceGate(
            response.data as JSONObject,
          );
          setProfileSampleCount(gate.sampleCount);
        } catch {
          if (!cancelled) {
            setProfileSampleCount(0);
          }
        }
      };

    void checkProfilePresence();

    return () => {
      cancelled = true;
    };
  }, [traceId]);

  // The Exceptions tab label carries a count, so it is read up front.
  useEffect(() => {
    let cancelled: boolean = false;

    const countExceptions: () => Promise<void> = async (): Promise<void> => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const count: number = await AnalyticsModelAPI.count<ExceptionInstance>(
          ExceptionInstance,
          {
            ...(projectId ? { projectId } : {}),
            traceId,
          } as Query<ExceptionInstance>,
        );
        if (!cancelled) {
          setExceptionCount(count);
        }
      } catch {
        if (!cancelled) {
          setExceptionCount(null);
        }
      }
    };

    void countExceptions();

    return () => {
      cancelled = true;
    };
  }, [traceId]);

  // If the gate closes while Profile is selected, fall back to the default tab.
  useEffect(() => {
    if (activeSignalTab === "profile" && profileSampleCount === 0) {
      setActiveSignalTab("logs");
    }
  }, [activeSignalTab, profileSampleCount]);

  // Metrics tab: reverse exemplar lookup, fetched on first open only.
  useEffect(() => {
    if (activeSignalTab !== "metrics" || metricsFetched) {
      return;
    }

    metricsLoadGenerationRef.current += 1;
    const generation: number = metricsLoadGenerationRef.current;

    const loadTraceMetrics: () => Promise<void> = async (): Promise<void> => {
      if (!traceId) {
        setMetricsFetched(true);
        return;
      }

      setMetricsLoading(true);
      setMetricsError(null);

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/metrics/for-trace",
            ),
            data: {
              traceId: traceId,
              limit: METRICS_FOR_TRACE_LIMIT,
            },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (generation !== metricsLoadGenerationRef.current) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const items: Array<TraceCorrelatedMetricItem> = ((
          response.data as JSONObject
        )["items"] || []) as unknown as Array<TraceCorrelatedMetricItem>;
        setTraceMetricSeries(groupMetricsForTrace(items));
      } catch (err) {
        if (generation === metricsLoadGenerationRef.current) {
          setMetricsError(API.getFriendlyMessage(err));
          setTraceMetricSeries([]);
        }
      } finally {
        if (generation === metricsLoadGenerationRef.current) {
          setMetricsLoading(false);
          setMetricsFetched(true);
        }
      }
    };

    void loadTraceMetrics();

    return () => {
      // Invalidate in-flight responses when the tab/trace changes or on unmount.
      metricsLoadGenerationRef.current += 1;
    };
  }, [activeSignalTab, metricsFetched, traceId]);

  /*
   * The scope every metric link carries: this trace over its padded window.
   * The serializer cannot express a trace filter in the metric explorer's
   * grammar; its `dropped` report is surfaced above the table so the
   * narrowing is never silent.
   */
  const metricScope: TelemetryCrossSignalScope | null = useMemo(() => {
    if (!props.traceWindow) {
      return null;
    }
    return {
      traceIds: [traceId],
      startTime: OneUptimeDate.addRemoveMinutes(
        props.traceWindow.startTime,
        -TRACE_METRIC_WINDOW_PADDING_MINUTES,
      ),
      endTime: OneUptimeDate.addRemoveMinutes(
        props.traceWindow.endTime,
        TRACE_METRIC_WINDOW_PADDING_MINUTES,
      ),
    };
  }, [props.traceWindow, traceId]);

  const metricLinkDroppedHints: Array<string> = useMemo(() => {
    if (!metricScope) {
      return [];
    }
    return describeDroppedScopeFields(
      toMetricsExplorerQueryParams(metricScope).dropped,
    );
  }, [metricScope]);

  const getMetricExplorerUrl: (metricName: string) => URL | null = (
    metricName: string,
  ): URL | null => {
    if (!metricScope) {
      return null;
    }

    const serialized: CrossSignalQueryParams = toMetricsExplorerQueryParams(
      metricScope,
      metricName,
    );

    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.METRIC_VIEW] as Route,
    );
    const currentUrl: URL = Navigation.getCurrentURL();
    const targetUrl: URL = new URL(
      currentUrl.protocol,
      currentUrl.hostname,
      route,
    );

    for (const paramName of Object.keys(serialized.params)) {
      targetUrl.addQueryParam(
        paramName,
        serialized.params[paramName] as string,
        true,
      );
    }

    return targetUrl;
  };

  const tabs: Array<{
    id: CorrelatedSignalTab;
    label: string;
    count: number | null;
  }> = [
    { id: "logs", label: "Logs", count: null },
    { id: "exceptions", label: "Exceptions", count: exceptionCount },
    {
      id: "metrics",
      label: "Metrics",
      count: metricsFetched ? traceMetricSeries.length : null,
    },
    ...(profileSampleCount > 0
      ? [
          {
            id: "profile" as CorrelatedSignalTab,
            label: "Profile samples",
            count: profileSampleCount,
          },
        ]
      : []),
  ];

  return (
    <section
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      id="trace-correlated-signals"
      data-testid="trace-signals"
    >
      <div className="flex flex-col gap-3 border-b border-gray-200 px-5 pt-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="pb-3 sm:pb-3">
          <h2 className="text-base font-semibold text-gray-900">
            Related signals
          </h2>
          <p className="text-xs text-gray-500">
            Logs, exceptions, metrics and profiles recorded during this trace.
          </p>
        </div>
        <div
          className="-mb-px flex gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Related signals"
        >
          {tabs.map(
            (tab: {
              id: CorrelatedSignalTab;
              label: string;
              count: number | null;
            }): ReactElement => {
              const isActive: boolean = activeSignalTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-testid={`trace-signal-tab-${tab.id}`}
                  onClick={() => {
                    setActiveSignalTab(tab.id);
                  }}
                  className={`flex flex-none items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium ${
                    isActive
                      ? "border-indigo-500 text-indigo-700"
                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800"
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== null && (
                    <span
                      className={`rounded-full px-1.5 text-xs tabular-nums ${
                        isActive
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tab.count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            },
          )}
        </div>
      </div>

      <div className="p-4" role="tabpanel">
        {activeSignalTab === "logs" && (
          <DashboardLogsViewer
            id={"traces-logs-viewer"}
            noLogsMessage="No logs found for this trace."
            traceIds={[traceId]}
            limit={LIMIT_PER_PROJECT}
            enableRealtime={false}
          />
        )}

        {activeSignalTab === "exceptions" && (
          <ExceptionInstanceTable
            title="Exceptions for this Trace"
            description="Exception instances captured on this trace's spans."
            query={{ traceId: traceId } as Query<ExceptionInstance>}
            disableUrlState={true}
          />
        )}

        {activeSignalTab === "metrics" && (
          <div data-testid="trace-metrics">
            {metricsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <ComponentLoader />
              </div>
            ) : metricsError ? (
              <ErrorMessage message={metricsError} />
            ) : traceMetricSeries.length === 0 ? (
              <ErrorMessage message="No metric datapoints reference this trace." />
            ) : (
              <div className="space-y-3">
                {metricLinkDroppedHints.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Metric links open the explorer over this trace&apos;s time
                    window (±{TRACE_METRIC_WINDOW_PADDING_MINUTES} min). Not
                    carried over: {metricLinkDroppedHints.join(", ")}.
                  </div>
                )}
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200 text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">
                          Metric
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">
                          Sampled values
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">
                          Min
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">
                          Max
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">
                          Spans
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {traceMetricSeries.map(
                        (series: TraceMetricSeries): ReactElement => {
                          const explorerUrl: URL | null = getMetricExplorerUrl(
                            series.name,
                          );
                          const sampledValues: string = series.points
                            .slice(-MAX_SAMPLED_METRIC_VALUES)
                            .map((point: TraceCorrelatedMetricItem): string => {
                              return formatTraceMetricValue(point.value);
                            })
                            .join(", ");
                          return (
                            <tr key={series.name}>
                              <td className="max-w-xs truncate px-3 py-2 font-mono text-gray-800">
                                {explorerUrl ? (
                                  <Link
                                    to={explorerUrl}
                                    openInNewTab={true}
                                    className="text-indigo-600 hover:text-indigo-700 hover:underline"
                                    title={`Open ${series.name} in the metric explorer over this trace's window`}
                                  >
                                    {series.name}
                                  </Link>
                                ) : (
                                  <span title={series.name}>{series.name}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-gray-600">
                                {sampledValues}
                                {series.points.length >
                                  MAX_SAMPLED_METRIC_VALUES && (
                                  <span className="ml-1 text-gray-400">
                                    (of {series.points.length})
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-600">
                                {formatTraceMetricValue(series.minValue)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-600">
                                {formatTraceMetricValue(series.maxValue)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-600">
                                {series.distinctSpanCount}
                              </td>
                            </tr>
                          );
                        },
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeSignalTab === "profile" && profileSampleCount > 0 && (
          <div data-testid="trace-profile">
            <p className="mb-3 text-xs text-gray-500">
              Flame graph built from the {profileSampleCount.toLocaleString()}{" "}
              profile sample{profileSampleCount === 1 ? "" : "s"} recorded
              during this trace.
            </p>
            <TraceScopedFlamegraph traceId={traceId} />
          </div>
        )}
      </div>
    </section>
  );
};

export default TraceSignals;
