import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
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
import { LockedEntityKeyDisplayMap } from "../../../Utils/LockedEntityKeyChips";
import {
  POD_LOGS_OTHER_REQUESTS,
  PodLogWindow,
  TRACE_LOGS_LINKED_DESCRIPTION,
  TRACE_LOG_SCOPE_LABEL,
  TRACE_LOG_SCOPE_LINKED,
  TraceLogScope,
  buildTracePodEntityKeyDisplays,
  buildTracePodLogQuery,
  describeTracePodLogScope,
  getDefaultTraceLogScope,
  getPodLogWindow,
  getTracePodLogScopeLabel,
} from "../../../Utils/TracePodLogs";
import ExceptionInstanceTable from "../../Exceptions/ExceptionInstanceTable";
import ExceptionSegmentedControl from "../../Exceptions/ExceptionSegmentedControl";
import { InventoryEntityKeyDisplaySource } from "../../Inventory/InventoryTelemetryScope";
import DashboardLogsViewer from "../../Logs/LogsViewer";
import TraceScopedFlamegraph from "../TraceScopedFlamegraph";
import TraceProfilerLink from "./TraceProfilerLink";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";

export type CorrelatedSignalTab = "logs" | "exceptions" | "metrics" | "profile";

export interface ComponentProps {
  traceId: string;
  // The trace's wall-clock window; null until spans load.
  traceWindow: { startTime: Date; endTime: Date } | null;
  /*
   * The service of the trace's root span, and its name: the Profiler is
   * offered for it, around the trace's time, when it was profiled then.
   */
  rootServiceId?: string | null | undefined;
  rootServiceName?: string | null | undefined;
  /*
   * The pods the trace's spans ran in (their k8sPodEntityKey), at most
   * TRACE_POD_LIMIT, and how many the spans name in all. With any, the Logs
   * tab can also show what they wrote while the trace ran.
   */
  podEntityKeys?: Array<string> | undefined;
  podCount?: number | undefined;
}

// Server-enforced cap on POST /telemetry/metrics/for-trace.
const METRICS_FOR_TRACE_LIMIT: number = 500;
// Metric links widen the trace's window so near-instant traces still chart.
export const TRACE_METRIC_WINDOW_PADDING_MINUTES: number = 5;
const MAX_SAMPLED_METRIC_VALUES: number = 5;

/*
 * Whether to offer the Metrics tab. Metrics are read with their own
 * permission, not the trace one, so the tab is left out for somebody who
 * may read this trace but not metrics, rather than offered and then
 * refused. It asks what POST /telemetry/metrics/for-trace asks: the Metric
 * model's own read gate (PermissionGate.check) - one of its read
 * permissions or the Read All Operational Resources wildcard, held as an
 * allow, with no team block on any of them. Offered while the permission
 * snapshot is still loading: the server has the last word.
 */
function canOfferTraceMetrics(): boolean {
  if (!PermissionGate.hasPermissionSnapshot()) {
    return true;
  }

  return PermissionGate.check(new Metric(), ModelAction.Read).isAllowed;
}

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

  const translator: Translator = useTranslator();
  const [activeSignalTab, setActiveSignalTab] =
    useState<CorrelatedSignalTab>("logs");

  /*
   * The trace's metrics' columns as wide as a person makes them (Common's
   * Table/ColumnResize): a metric's name gives way, its readings never.
   */
  const metricColumns: ResizableColumns = useResizableColumns({
    tableKey: "trace-metrics-table",
    columns: [
      { id: "metric", cellNumber: 1 },
      { id: "sampledValues", cellNumber: 2 },
      { id: "min", cellNumber: 3 },
      { id: "max", cellNumber: 4 },
      { id: "spans", cellNumber: 5 },
    ],
  });
  const [exceptionCount, setExceptionCount] = useState<number | null>(null);

  /*
   * The Logs tab of a trace that ran in pods has two views: the logs linked
   * by its ID, and what its pods wrote while it ran. Null until the reader
   * picks one; until then the count of linked logs decides.
   */
  const [chosenLogScope, setChosenLogScope] = useState<TraceLogScope | null>(
    null,
  );
  // Logs carrying this trace's ID around it: null while counting, undefined if that failed.
  const [linkedLogCount, setLinkedLogCount] = useState<
    number | null | undefined
  >(null);
  // The pods' Inventory items, which name them in the viewer's chips.
  const [podInventoryItems, setPodInventoryItems] = useState<
    Array<InventoryEntityKeyDisplaySource>
  >([]);

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

  /*
   * Another trace starts from a clean slate. Not on the first mount: the
   * initial state already is one, and a reset that ran then - after the
   * first paint - could undo a tab the reader had already picked.
   */
  const shownTraceIdRef: React.MutableRefObject<string> =
    useRef<string>(traceId);

  useEffect(() => {
    if (shownTraceIdRef.current === traceId) {
      return;
    }
    shownTraceIdRef.current = traceId;

    setActiveSignalTab("logs");
    setExceptionCount(null);
    setChosenLogScope(null);
    setLinkedLogCount(null);
    setPodInventoryItems([]);
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

  // By value: the explorer hands over a new array as each batch of spans loads.
  const podEntityKeysKey: string = (props.podEntityKeys || []).join(",");
  const podEntityKeys: Array<string> = useMemo(() => {
    return podEntityKeysKey ? podEntityKeysKey.split(",") : [];
  }, [podEntityKeysKey]);
  const hasPods: boolean = podEntityKeys.length > 0;
  const podCount: number = Math.max(props.podCount || 0, podEntityKeys.length);
  const traceStartMs: number | undefined =
    props.traceWindow?.startTime.getTime();
  const traceEndMs: number | undefined = props.traceWindow?.endTime.getTime();

  /*
   * Whether any log carries this trace's ID, counted over the trace's window
   * padded as for the metric links: for a trace that ran in pods it decides
   * which view the Logs tab opens on. An eBPF trace's count is 0.
   */
  useEffect(() => {
    if (!hasPods || traceStartMs === undefined || traceEndMs === undefined) {
      return;
    }

    let cancelled: boolean = false;

    const countLinkedLogs: () => Promise<void> = async (): Promise<void> => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const count: number = await AnalyticsModelAPI.count<Log>(Log, {
          ...(projectId ? { projectId } : {}),
          traceId,
          time: new InBetween<Date>(
            OneUptimeDate.addRemoveMinutes(
              new Date(traceStartMs),
              -TRACE_METRIC_WINDOW_PADDING_MINUTES,
            ),
            OneUptimeDate.addRemoveMinutes(
              new Date(traceEndMs),
              TRACE_METRIC_WINDOW_PADDING_MINUTES,
            ),
          ),
        } as Query<Log>);
        if (!cancelled) {
          setLinkedLogCount(count);
        }
      } catch {
        if (!cancelled) {
          setLinkedLogCount(undefined);
        }
      }
    };

    void countLinkedLogs();

    return () => {
      cancelled = true;
    };
  }, [traceId, hasPods, traceStartMs, traceEndMs]);

  const logScope: TraceLogScope | null = hasPods
    ? chosenLogScope ||
      getDefaultTraceLogScope({
        podCount: podEntityKeys.length,
        linkedLogCount,
      })
    : "trace";

  const podLogWindow: PodLogWindow | null = useMemo(() => {
    if (traceStartMs === undefined || traceEndMs === undefined) {
      return null;
    }

    return getPodLogWindow({
      startTimeUnixNano: traceStartMs * 1000000,
      endTimeUnixNano: traceEndMs * 1000000,
    });
  }, [traceStartMs, traceEndMs]);

  const podLogQuery: Query<Log> | null = useMemo(() => {
    if (!podLogWindow) {
      return null;
    }

    return buildTracePodLogQuery({ podEntityKeys, window: podLogWindow });
  }, [podEntityKeys, podLogWindow]);

  const isPodLogViewShown: boolean =
    activeSignalTab === "logs" && logScope === "pods" && podLogQuery !== null;

  // The pods' names for the viewer's chips, once their view is shown.
  useEffect(() => {
    if (!isPodLogViewShown) {
      return;
    }

    let cancelled: boolean = false;

    const loadPodNames: () => Promise<void> = async (): Promise<void> => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const result: ListResult<InventoryItem> =
          await ModelAPI.getList<InventoryItem>({
            modelType: InventoryItem,
            query: {
              ...(projectId ? { projectId } : {}),
              entityKey: new Includes(podEntityKeys),
            } as Query<InventoryItem>,
            select: {
              entityKey: true,
              entityType: true,
              displayName: true,
              identifyingAttributes: true,
              descriptiveAttributes: true,
            },
            limit: podEntityKeys.length,
            skip: 0,
            sort: {},
          });
        if (!cancelled) {
          setPodInventoryItems(
            result.data.map(
              (item: InventoryItem): InventoryEntityKeyDisplaySource => {
                return {
                  entityKey: item.entityKey,
                  entityType: item.entityType,
                  displayName: item.displayName,
                  identifyingAttributes: item.identifyingAttributes,
                  descriptiveAttributes: item.descriptiveAttributes,
                };
              },
            ),
          );
        }
      } catch {
        // The chips keep naming the pods by their keys.
      }
    };

    void loadPodNames();

    return () => {
      cancelled = true;
    };
  }, [isPodLogViewShown, podEntityKeys]);

  const podEntityKeyDisplays: LockedEntityKeyDisplayMap = useMemo(() => {
    return buildTracePodEntityKeyDisplays({
      podEntityKeys,
      items: podInventoryItems,
    });
  }, [podEntityKeys, podInventoryItems]);

  const canReadMetrics: boolean = canOfferTraceMetrics();

  /*
   * Which tabs are offered: Metrics to who may read metrics, Profile only
   * when the trace was profiled. The tab list, the panels and the fallback
   * below all ask this one question.
   */
  const isTabOffered: (tab: CorrelatedSignalTab) => boolean = (
    tab: CorrelatedSignalTab,
  ): boolean => {
    if (tab === "metrics") {
      return canReadMetrics;
    }

    if (tab === "profile") {
      return profileSampleCount > 0;
    }

    return true;
  };

  const isActiveTabOffered: boolean = isTabOffered(activeSignalTab);

  /*
   * If a tab's gate closes while it is selected (a trace without profile
   * samples, or a permission snapshot that arrives without the metric
   * read), fall back to the default tab.
   */
  useEffect(() => {
    if (!isActiveTabOffered) {
      setActiveSignalTab("logs");
    }
  }, [isActiveTabOffered]);

  // Metrics tab: reverse exemplar lookup, fetched on first open only.
  useEffect(() => {
    // Never asked of the server by somebody it would refuse.
    if (!canReadMetrics) {
      return;
    }

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
    ...(isTabOffered("metrics")
      ? [
          {
            id: "metrics" as CorrelatedSignalTab,
            label: "Metrics",
            count: metricsFetched ? traceMetricSeries.length : null,
          },
        ]
      : []),
    ...(isTabOffered("profile")
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
          {props.traceWindow && props.rootServiceId ? (
            <TraceProfilerLink
              serviceId={props.rootServiceId}
              serviceName={props.rootServiceName || null}
              traceStart={props.traceWindow.startTime}
            />
          ) : (
            <></>
          )}
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
          <div data-testid="trace-logs">
            {hasPods && logScope !== null && (
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <p
                  className="max-w-3xl text-xs text-gray-500"
                  data-testid="trace-logs-scope-description"
                >
                  {logScope === "pods" ? (
                    <>
                      {describeTracePodLogScope({
                        translator,
                        podCount,
                        shownPodCount: podEntityKeys.length,
                        paddingMs: podLogWindow?.paddingMs || 0,
                      })}{" "}
                      {translator.translateText(POD_LOGS_OTHER_REQUESTS)}
                    </>
                  ) : (
                    translator.translateText(TRACE_LOGS_LINKED_DESCRIPTION)
                  )}
                </p>
                <ExceptionSegmentedControl<TraceLogScope>
                  label={TRACE_LOG_SCOPE_LABEL}
                  testId="trace-logs-scope"
                  value={logScope}
                  onChange={(scope: TraceLogScope) => {
                    setChosenLogScope(scope);
                  }}
                  options={[
                    { value: "trace", label: TRACE_LOG_SCOPE_LINKED },
                    {
                      value: "pods",
                      label: getTracePodLogScopeLabel(podEntityKeys.length),
                    },
                  ]}
                />
              </div>
            )}
            {logScope === null ? (
              <div className="flex h-32 items-center justify-center">
                <ComponentLoader />
              </div>
            ) : logScope === "pods" && podLogQuery ? (
              <DashboardLogsViewer
                // Another scope is another view: remount rather than merge.
                key="trace-pod-logs"
                id={"traces-pod-logs-viewer"}
                logQuery={podLogQuery}
                entityKeyDisplays={podEntityKeyDisplays}
                noLogsMessage={
                  podEntityKeys.length === 1
                    ? "This trace's pod wrote nothing while it ran."
                    : "This trace's pods wrote nothing while it ran."
                }
                enableRealtime={false}
              />
            ) : (
              <DashboardLogsViewer
                key="trace-linked-logs"
                id={"traces-logs-viewer"}
                noLogsMessage="Logs that carry this trace's ID appear here."
                traceIds={[traceId]}
                limit={LIMIT_PER_PROJECT}
                enableRealtime={false}
              />
            )}
          </div>
        )}

        {activeSignalTab === "exceptions" && (
          <ExceptionInstanceTable
            title="Exceptions for this Trace"
            description="Exception instances captured on this trace's spans."
            query={{ traceId: traceId } as Query<ExceptionInstance>}
            disableUrlState={true}
          />
        )}

        {activeSignalTab === "metrics" && isActiveTabOffered && (
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
                  {metricColumns.styles}
                  <table
                    className={`${metricColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200 text-xs`}
                    {...metricColumns.tableAttributes}
                  >
                    <thead className="bg-gray-50">
                      <tr>
                        <ResizableHeaderCell
                          scope="col"
                          className="px-3 py-2 text-left font-medium text-gray-500"
                          resize={metricColumns.getResize(
                            "metric",
                            "Metric",
                            ColumnWidthKind.Name,
                          )}
                        >
                          <span>{"Metric"}</span>
                        </ResizableHeaderCell>
                        <ResizableHeaderCell
                          scope="col"
                          className="px-3 py-2 text-left font-medium text-gray-500"
                          resize={metricColumns.getResize(
                            "sampledValues",
                            "Sampled values",
                            ColumnWidthKind.Text,
                          )}
                        >
                          <span>{"Sampled values"}</span>
                        </ResizableHeaderCell>
                        <ResizableHeaderCell
                          scope="col"
                          className="px-3 py-2 text-right font-medium text-gray-500"
                          resize={metricColumns.getResize(
                            "min",
                            "Min",
                            ColumnWidthKind.Whole,
                          )}
                        >
                          <span>{"Min"}</span>
                        </ResizableHeaderCell>
                        <ResizableHeaderCell
                          scope="col"
                          className="px-3 py-2 text-right font-medium text-gray-500"
                          resize={metricColumns.getResize(
                            "max",
                            "Max",
                            ColumnWidthKind.Whole,
                          )}
                        >
                          <span>{"Max"}</span>
                        </ResizableHeaderCell>
                        <ResizableHeaderCell
                          scope="col"
                          className="px-3 py-2 text-right font-medium text-gray-500"
                          resize={metricColumns.getResize(
                            "spans",
                            "Spans",
                            ColumnWidthKind.Whole,
                          )}
                        >
                          <span>{"Spans"}</span>
                        </ResizableHeaderCell>
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

        {activeSignalTab === "profile" && isActiveTabOffered && (
          <div data-testid="trace-profile">
            <p className="mb-3 text-xs text-gray-500">
              Flame graph built from the {profileSampleCount.toLocaleString()}{" "}
              profile sample{profileSampleCount === 1 ? "" : "s"} linked to the
              spans of this trace.
            </p>
            <TraceScopedFlamegraph traceId={traceId} />
          </div>
        )}
      </div>
    </section>
  );
};

export default TraceSignals;
