import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Span, {
  SpanEvent,
  SpanEventType,
  SpanKind,
  SpanStatus,
} from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Service from "Common/Models/DatabaseModels/Service";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import SpanUtil from "../../Utils/SpanUtil";
import {
  SpanPanelLogQueryPlan,
  SpanPanelLogScope,
  buildExceptionsGroupRoute,
  buildSpanPanelLogQuery,
} from "../../Utils/TraceCorrelatedSignals";
import LlmSpanPanel from "./LlmSpanPanel";

export interface SpanDetailsPanelProps {
  span: Span;
  service?: Service | undefined;
  // Base route to the span's full trace (without the spanId highlight query).
  traceRoute?: Route | undefined;
  // Adds an `attributes.<key>:<value>` chip to the parent explorer's filters.
  onFilterByAttribute?: ((key: string, value: string) => void) | undefined;
}

interface AttributeEntry {
  key: string;
  value: string;
}

type PanelTabId = "details" | "logs" | "exceptions";

const LOG_FETCH_LIMIT: number = 200;

function getStatusLabel(status: number | undefined | null): string {
  if (status === SpanStatus.Error) {
    return "Error";
  }
  if (status === SpanStatus.Ok) {
    return "Ok";
  }
  return "Unset";
}

function getStatusColor(status: number | undefined | null): string {
  if (status === SpanStatus.Error) {
    return "#ef4444";
  }
  if (status === SpanStatus.Ok) {
    return "#10b981";
  }
  return "#9ca3af";
}

// Flatten (possibly nested) span attributes into sorted dotted key/value pairs.
function flattenAttributes(
  obj: JSONObject | undefined,
  prefix: string = "",
): Array<AttributeEntry> {
  if (!obj) {
    return [];
  }
  const out: Array<AttributeEntry> = [];
  for (const key of Object.keys(obj)) {
    const value: unknown = (obj as Record<string, unknown>)[key];
    const full: string = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenAttributes(value as JSONObject, full));
    } else {
      out.push({
        key: full,
        value: Array.isArray(value) ? JSON.stringify(value) : String(value),
      });
    }
  }
  return out.sort((left: AttributeEntry, right: AttributeEntry): number => {
    return left.key.localeCompare(right.key);
  });
}

const SpanDetailsPanel: FunctionComponent<SpanDetailsPanelProps> = (
  props: SpanDetailsPanelProps,
): ReactElement => {
  const { span, service } = props;

  // The list row carries a light span; attributes/events come from a lazy fetch.
  const [fullSpan, setFullSpan] = useState<Span | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<PanelTabId>("details");

  // Logs / Exceptions tabs fetch lazily on first open (see effects below).
  const [relatedLogs, setRelatedLogs] = useState<Array<Log>>([]);
  const [logsScope, setLogsScope] = useState<SpanPanelLogScope | null>(null);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  const [logsFetched, setLogsFetched] = useState<boolean>(false);
  const [exceptionInstances, setExceptionInstances] = useState<
    Array<ExceptionInstance>
  >([]);
  const [exceptionsLoading, setExceptionsLoading] = useState<boolean>(false);
  const [exceptionsFetched, setExceptionsFetched] = useState<boolean>(false);

  /*
   * Generation counters for the lazy tab fetches (same pattern as
   * TraceScopedFlamegraph's loadGenerationRef): each effect's cleanup bumps
   * its counter only when the tab/span actually changes or the panel
   * unmounts, so a stale response can never write state — and the effects'
   * own loading-state writes can never cancel the in-flight request.
   */
  const logsLoadGenerationRef: React.MutableRefObject<number> =
    useRef<number>(0);
  const exceptionsLoadGenerationRef: React.MutableRefObject<number> =
    useRef<number>(0);

  const spanIdStr: string = span.spanId?.toString() || "";
  const traceIdStr: string = span.traceId?.toString() || "";

  // Expanding a different row reuses the panel — reset the lazy tab state.
  useEffect(() => {
    setActiveTab("details");
    setRelatedLogs([]);
    setLogsScope(null);
    setLogsLoading(false);
    setLogsFetched(false);
    setExceptionInstances([]);
    setExceptionsLoading(false);
    setExceptionsFetched(false);
  }, [spanIdStr]);

  useEffect(() => {
    let cancelled: boolean = false;

    const loadDetail: () => Promise<void> = async (): Promise<void> => {
      if (!spanIdStr) {
        return;
      }
      setDetailLoading(true);
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const result: ListResult<Span> = await AnalyticsModelAPI.getList<Span>({
          modelType: Span,
          query: {
            ...(projectId ? { projectId } : {}),
            spanId: spanIdStr,
          },
          limit: 1,
          skip: 0,
          select: {
            attributes: true,
            events: true,
            statusMessage: true,
          } as Select<Span>,
          sort: {},
          requestOptions: {},
        });
        if (!cancelled) {
          setFullSpan(result.data[0] || null);
        }
      } catch {
        if (!cancelled) {
          setFullSpan(null);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [spanIdStr]);

  /*
   * Logs tab: fetched on first open only. The query prefers the tight
   * span-scoped read; when that yields nothing (span-tagged logs are the
   * exception, not the rule) it widens to the whole trace so the tab still
   * shows the surrounding request context.
   */
  useEffect(() => {
    if (activeTab !== "logs" || logsFetched) {
      return;
    }

    logsLoadGenerationRef.current += 1;
    const generation: number = logsLoadGenerationRef.current;

    const loadLogs: () => Promise<void> = async (): Promise<void> => {
      const plan: SpanPanelLogQueryPlan | null = buildSpanPanelLogQuery({
        spanId: spanIdStr,
        traceId: traceIdStr,
      });

      if (!plan) {
        setLogsFetched(true);
        return;
      }

      setLogsLoading(true);

      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        const fetchByPlan: (
          fetchPlan: SpanPanelLogQueryPlan,
        ) => Promise<Array<Log>> = async (
          fetchPlan: SpanPanelLogQueryPlan,
        ): Promise<Array<Log>> => {
          const result: ListResult<Log> = await AnalyticsModelAPI.getList<Log>({
            modelType: Log,
            query: {
              ...(projectId ? { projectId } : {}),
              ...fetchPlan.query,
            } as Query<Log>,
            limit: LOG_FETCH_LIMIT,
            skip: 0,
            select: {
              time: true,
              severityText: true,
              body: true,
              spanId: true,
              traceId: true,
            } as Select<Log>,
            sort: { time: SortOrder.Ascending } as Record<string, SortOrder>,
            requestOptions: {},
          });
          return result.data;
        };

        let rows: Array<Log> = await fetchByPlan(plan);
        let scope: SpanPanelLogScope = plan.scope;

        if (rows.length === 0 && plan.scope === "span" && traceIdStr) {
          const fallbackPlan: SpanPanelLogQueryPlan | null =
            buildSpanPanelLogQuery({ traceId: traceIdStr });
          if (fallbackPlan) {
            rows = await fetchByPlan(fallbackPlan);
            scope = fallbackPlan.scope;
          }
        }

        if (generation === logsLoadGenerationRef.current) {
          setRelatedLogs(rows);
          setLogsScope(scope);
        }
      } catch {
        if (generation === logsLoadGenerationRef.current) {
          setRelatedLogs([]);
          setLogsScope(null);
        }
      } finally {
        if (generation === logsLoadGenerationRef.current) {
          setLogsLoading(false);
          setLogsFetched(true);
        }
      }
    };

    void loadLogs();

    return () => {
      // Invalidate in-flight responses when the tab/span changes or on unmount.
      logsLoadGenerationRef.current += 1;
    };
  }, [activeTab, logsFetched, spanIdStr, traceIdStr]);

  // Exceptions tab: the same span-scoped ExceptionInstance read SpanViewer runs.
  useEffect(() => {
    if (activeTab !== "exceptions" || exceptionsFetched) {
      return;
    }

    exceptionsLoadGenerationRef.current += 1;
    const generation: number = exceptionsLoadGenerationRef.current;

    const loadExceptions: () => Promise<void> = async (): Promise<void> => {
      if (!spanIdStr) {
        setExceptionsFetched(true);
        return;
      }

      setExceptionsLoading(true);

      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const result: ListResult<ExceptionInstance> =
          await AnalyticsModelAPI.getList<ExceptionInstance>({
            modelType: ExceptionInstance,
            query: {
              ...(projectId ? { projectId } : {}),
              spanId: spanIdStr,
            } as Query<ExceptionInstance>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              message: true,
              exceptionType: true,
              stackTrace: true,
              fingerprint: true,
              attributes: true,
              time: true,
              timeUnixNano: true,
            } as Select<ExceptionInstance>,
            sort: { time: SortOrder.Descending } as Record<string, SortOrder>,
            requestOptions: {},
          });

        if (generation === exceptionsLoadGenerationRef.current) {
          setExceptionInstances(result.data);
        }
      } catch {
        if (generation === exceptionsLoadGenerationRef.current) {
          setExceptionInstances([]);
        }
      } finally {
        if (generation === exceptionsLoadGenerationRef.current) {
          setExceptionsLoading(false);
          setExceptionsFetched(true);
        }
      }
    };

    void loadExceptions();

    return () => {
      // Invalidate in-flight responses when the tab/span changes or on unmount.
      exceptionsLoadGenerationRef.current += 1;
    };
  }, [activeTab, exceptionsFetched, spanIdStr]);

  const durationNano: number = Number(span.durationUnixNano || 0);
  const divisibilityFactor: ReturnType<typeof SpanUtil.getDivisibilityFactor> =
    SpanUtil.getDivisibilityFactor(durationNano);
  const durationLabel: string = SpanUtil.getSpanDurationAsString({
    divisibilityFactor,
    spanDurationInUnixNano: durationNano,
  });

  const serviceName: string = service?.name || "unknown service";
  const serviceColor: string = service?.serviceColor?.toString() || "#64748b";

  const statusColor: string = getStatusColor(span.statusCode);
  const statusLabel: string = getStatusLabel(span.statusCode);

  const startTimeDate: Date | null = span.startTime
    ? OneUptimeDate.fromString(span.startTime as unknown as string)
    : null;
  const endTimeDate: Date | null = span.endTime
    ? OneUptimeDate.fromString(span.endTime as unknown as string)
    : null;

  const kindLabel: string = SpanUtil.getSpanKindFriendlyName(
    (span.kind as SpanKind) ?? SpanKind.Internal,
  );

  const statusMessage: string =
    (fullSpan?.statusMessage as unknown as string) ||
    (span.statusMessage as unknown as string) ||
    "";

  const attributeEntries: Array<AttributeEntry> = useMemo(() => {
    return flattenAttributes(fullSpan?.attributes as JSONObject | undefined);
  }, [fullSpan]);

  const attributesAsJson: string | null = useMemo(() => {
    if (attributeEntries.length === 0) {
      return null;
    }
    const flat: Record<string, string> = {};
    for (const entry of attributeEntries) {
      flat[entry.key] = entry.value;
    }
    return JSON.stringify(flat, null, 2);
  }, [attributeEntries]);

  // Exception events surfaced inline so error spans explain themselves.
  const exceptionMessages: Array<string> = useMemo(() => {
    const events: Array<SpanEvent> | undefined = fullSpan?.events;
    if (!events || events.length === 0) {
      return [];
    }
    return events
      .filter((event: SpanEvent): boolean => {
        return event.name === SpanEventType.Exception.toLowerCase();
      })
      .map((event: SpanEvent): string => {
        const attrs: JSONObject = (event.attributes as JSONObject) || {};
        return (
          attrs["exception.message"]?.toString() ||
          attrs["exception.type"]?.toString() ||
          "Exception"
        );
      });
  }, [fullSpan]);

  // Route to the full trace, highlighting this span via `?spanId=`.
  const fullTraceRoute: Route | undefined = useMemo(() => {
    if (!props.traceRoute) {
      return undefined;
    }
    const route: Route = new Route(props.traceRoute.toString());
    if (spanIdStr) {
      route.addQueryParams({ spanId: spanIdStr });
    }
    return route;
  }, [props.traceRoute, spanIdStr]);

  // Same trace/span link builders the logs product uses for its rows.
  const getLogRowRoute: (log: Log) => Route | undefined = (
    log: Log,
  ): Route | undefined => {
    const logTraceId: string | undefined = log.traceId?.toString();
    const logSpanId: string | undefined = log.spanId?.toString();

    if (!logTraceId) {
      return fullTraceRoute;
    }

    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.TRACE_VIEW]!,
      {
        modelId: logTraceId,
      },
    );

    if (!logSpanId) {
      return route;
    }

    const routeWithQuery: Route = new Route(route.toString());
    routeWithQuery.addQueryParams({ spanId: logSpanId });
    return routeWithQuery;
  };

  const getExceptionGroupRoute: (
    exception: ExceptionInstance,
  ) => Route | null = (exception: ExceptionInstance): Route | null => {
    if (!exception.fingerprint) {
      return null;
    }

    return buildExceptionsGroupRoute({
      exceptionsListRoute: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_UNRESOLVED]!,
      ),
      fingerprint: exception.fingerprint.toString(),
    });
  };

  const panelTabs: Array<{
    id: PanelTabId;
    label: string;
    count: number | null;
  }> = [
    { id: "details", label: "Details", count: null },
    {
      id: "logs",
      label: "Logs",
      count: logsFetched ? relatedLogs.length : null,
    },
    {
      id: "exceptions",
      label: "Exceptions",
      count: exceptionsFetched ? exceptionInstances.length : null,
    },
  ];

  const surfaceCardClass: string = "border-gray-200 bg-gray-50";
  const sectionHeaderClass: string =
    "text-[11px] uppercase tracking-wide text-gray-400";

  const overviewRows: Array<{ label: string; value: ReactElement | string }> = [
    { label: "Service", value: serviceName },
    { label: "Status", value: statusLabel },
    { label: "Duration", value: durationLabel },
    { label: "Span Kind", value: kindLabel },
    ...(startTimeDate
      ? [
          {
            label: "Start Time",
            value:
              OneUptimeDate.getDateAsUserFriendlyFormattedString(startTimeDate),
          },
        ]
      : []),
    ...(endTimeDate
      ? [
          {
            label: "End Time",
            value:
              OneUptimeDate.getDateAsUserFriendlyFormattedString(endTimeDate),
          },
        ]
      : []),
  ];

  return (
    <div className="border-b border-gray-100 bg-gray-50/60 px-5 py-4">
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-1 items-start gap-3">
            <span
              className="mt-1 h-3 w-3 flex-none rounded-full border border-gray-200"
              style={{ backgroundColor: serviceColor }}
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="truncate font-mono text-base font-semibold text-gray-900">
                  {span.name || "(unnamed span)"}
                </h3>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    backgroundColor: `${statusColor}1a`,
                    color: statusColor,
                  }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: statusColor }}
                  />
                  {statusLabel}
                </span>
              </div>
              <div className="font-mono text-xs text-gray-500">
                {serviceName} · {durationLabel}
              </div>
            </div>
          </div>

          {fullTraceRoute && (
            <Link
              to={fullTraceRoute}
              openInNewTab={false}
              className="inline-flex flex-none items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-100"
              title="Open this span in the full trace viewer"
            >
              See full trace
              <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {/* Correlated-signal tabs — Logs / Exceptions fetch on first open. */}
        <div className="mt-4 flex w-fit items-center space-x-1 rounded-lg bg-gray-100 p-0.5">
          {panelTabs.map(
            (tab: {
              id: PanelTabId;
              label: string;
              count: number | null;
            }): ReactElement => {
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    activeTab === tab.id
                      ? "bg-white text-gray-800 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== null && (
                    <span className="rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-500">
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            },
          )}
        </div>

        {activeTab === "logs" && (
          <div className="mt-4">
            {logsLoading ? (
              <div className="flex h-24 items-center justify-center">
                <ComponentLoader />
              </div>
            ) : relatedLogs.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">
                No logs found for this span or its trace.
              </div>
            ) : (
              <div className="space-y-2">
                {logsScope === "trace" && spanIdStr && (
                  <div className="text-[11px] text-gray-400">
                    No logs are tagged with this span — showing logs from the
                    whole trace.
                  </div>
                )}
                <ul className="max-h-80 space-y-1 overflow-auto">
                  {relatedLogs.map((log: Log, index: number): ReactElement => {
                    const severity: string =
                      (log.severityText as unknown as string) || "info";
                    const body: string = (log.body as unknown as string) || "";
                    const logTimeDate: Date | null = log.time
                      ? OneUptimeDate.fromString(log.time as unknown as string)
                      : null;
                    const logRoute: Route | undefined = getLogRowRoute(log);
                    const rowKey: string = `${
                      log.spanId?.toString() || "log"
                    }-${index}`;
                    const row: ReactElement = (
                      <div className="flex items-start gap-2 rounded-md border border-gray-100 bg-white px-2 py-1.5 font-mono text-[11px] hover:bg-gray-50">
                        <span className="w-16 flex-none truncate text-gray-400">
                          {severity}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-gray-700"
                          title={body}
                        >
                          {body}
                        </span>
                        {logTimeDate && (
                          <span className="flex-none text-gray-400">
                            {OneUptimeDate.getDateAsUserFriendlyFormattedString(
                              logTimeDate,
                            )}
                          </span>
                        )}
                      </div>
                    );
                    return (
                      <li key={rowKey}>
                        {logRoute ? (
                          <Link
                            to={logRoute}
                            openInNewTab={false}
                            className="block"
                          >
                            {row}
                          </Link>
                        ) : (
                          row
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === "exceptions" && (
          <div className="mt-4">
            {exceptionsLoading ? (
              <div className="flex h-24 items-center justify-center">
                <ComponentLoader />
              </div>
            ) : exceptionInstances.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">
                No exceptions were recorded on this span.
              </div>
            ) : (
              <ul className="space-y-2">
                {exceptionInstances.map(
                  (
                    exception: ExceptionInstance,
                    index: number,
                  ): ReactElement => {
                    const message: string =
                      exception.message ||
                      exception.exceptionType ||
                      "Exception";
                    const groupRoute: Route | null =
                      getExceptionGroupRoute(exception);
                    const exceptionTimeDate: Date | null = exception.time
                      ? OneUptimeDate.fromString(
                          exception.time as unknown as string,
                        )
                      : null;
                    return (
                      <li
                        key={index}
                        className="rounded-lg border border-red-100 bg-red-50 px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            {fullTraceRoute ? (
                              <Link
                                to={fullTraceRoute}
                                openInNewTab={false}
                                className="block truncate font-mono text-[12px] font-medium text-red-700 hover:underline"
                                title={message}
                              >
                                {message}
                              </Link>
                            ) : (
                              <span
                                className="block truncate font-mono text-[12px] font-medium text-red-700"
                                title={message}
                              >
                                {message}
                              </span>
                            )}
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-red-400">
                              {exception.exceptionType && (
                                <span className="font-mono">
                                  {exception.exceptionType}
                                </span>
                              )}
                              {exceptionTimeDate && (
                                <span>
                                  {OneUptimeDate.getDateAsUserFriendlyFormattedString(
                                    exceptionTimeDate,
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                          {groupRoute && (
                            <Link
                              to={groupRoute}
                              openInNewTab={true}
                              className="flex-none text-[11px] font-semibold text-red-600 hover:text-red-700 hover:underline"
                            >
                              View exception group
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  },
                )}
              </ul>
            )}
          </div>
        )}

        {activeTab === "details" && (
          <div className="mt-4 space-y-5 text-sm text-gray-700">
            {/* Overview */}
            <section className="space-y-3">
              <header className={sectionHeaderClass}>Overview</header>
              <dl
                className={`divide-y divide-gray-200 rounded-lg border ${surfaceCardClass} text-xs`}
              >
                {overviewRows.map(
                  (row: {
                    label: string;
                    value: ReactElement | string;
                  }): ReactElement => {
                    return (
                      <div
                        key={row.label}
                        className="flex items-center justify-between gap-4 px-3 py-2"
                      >
                        <dt className="text-gray-500">{row.label}</dt>
                        <dd className="truncate text-right font-medium text-gray-800">
                          {row.value}
                        </dd>
                      </div>
                    );
                  },
                )}
              </dl>
            </section>

            {/* IDs */}
            <section className="grid gap-4 md:grid-cols-2">
              {traceIdStr && (
                <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={sectionHeaderClass}>Trace ID</span>
                    <CopyTextButton
                      textToBeCopied={traceIdStr}
                      size="xs"
                      variant="ghost"
                      iconOnly={true}
                      title="Copy trace id"
                    />
                  </div>
                  <span
                    className="block max-w-full truncate font-mono text-xs text-gray-700"
                    title={traceIdStr}
                  >
                    {traceIdStr}
                  </span>
                </div>
              )}

              {spanIdStr && (
                <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={sectionHeaderClass}>Span ID</span>
                    <CopyTextButton
                      textToBeCopied={spanIdStr}
                      size="xs"
                      variant="ghost"
                      iconOnly={true}
                      title="Copy span id"
                    />
                  </div>
                  <span
                    className="block max-w-full truncate font-mono text-xs text-gray-700"
                    title={spanIdStr}
                  >
                    {spanIdStr}
                  </span>
                </div>
              )}
            </section>

            {/* Status message (errors) */}
            {statusMessage && (
              <section className="space-y-3">
                <header className={sectionHeaderClass}>Status Message</header>
                <div className="rounded-lg border border-red-100 bg-red-50 p-4 font-mono text-[13px] leading-6 text-red-700">
                  {statusMessage}
                </div>
              </section>
            )}

            {/* Exceptions */}
            {exceptionMessages.length > 0 && (
              <section className="space-y-3">
                <header className={sectionHeaderClass}>
                  Exceptions ({exceptionMessages.length})
                </header>
                <ul className="space-y-2">
                  {exceptionMessages.map(
                    (message: string, index: number): ReactElement => {
                      return (
                        <li
                          key={index}
                          className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700"
                        >
                          {message}
                        </li>
                      );
                    },
                  )}
                </ul>
              </section>
            )}

            {/* AI / LLM call (only renders for gen_ai.* spans) */}
            <LlmSpanPanel
              attributes={fullSpan?.attributes as JSONObject | undefined}
              events={fullSpan?.events}
              durationLabel={durationLabel}
            />

            {/* Attributes */}
            <section className="space-y-3">
              <header className="flex items-center justify-between">
                <span className={sectionHeaderClass}>Attributes</span>
                {attributesAsJson && (
                  <CopyTextButton
                    textToBeCopied={attributesAsJson}
                    size="xs"
                    variant="ghost"
                    iconOnly={false}
                    title="Copy attributes as JSON"
                  />
                )}
              </header>

              {detailLoading && attributeEntries.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">
                  Loading attributes…
                </div>
              ) : attributeEntries.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">
                  No attributes on this span.
                </div>
              ) : (
                <div
                  className={`max-h-80 overflow-auto rounded-lg border ${surfaceCardClass}`}
                >
                  <ul className="divide-y divide-gray-200">
                    {attributeEntries.map(
                      (entry: AttributeEntry): ReactElement => {
                        return (
                          <li
                            key={entry.key}
                            className="group flex items-start gap-3 px-3 py-2 hover:bg-white"
                          >
                            <span
                              className="w-56 flex-none truncate font-mono text-[12px] text-gray-500"
                              title={entry.key}
                            >
                              {entry.key}
                            </span>
                            <span
                              className="min-w-0 flex-1 break-all font-mono text-[12px] text-gray-800"
                              title={entry.value}
                            >
                              {entry.value || (
                                <span className="italic text-gray-400">
                                  empty
                                </span>
                              )}
                            </span>
                            <div className="flex flex-none items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                              {props.onFilterByAttribute && entry.value && (
                                <button
                                  type="button"
                                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600"
                                  title={`Filter by ${entry.key}: ${entry.value}`}
                                  onClick={() => {
                                    props.onFilterByAttribute!(
                                      entry.key,
                                      entry.value,
                                    );
                                  }}
                                >
                                  <Icon
                                    icon={IconProp.Filter}
                                    className="h-3.5 w-3.5"
                                  />
                                </button>
                              )}
                              <CopyTextButton
                                textToBeCopied={entry.value}
                                size="xs"
                                variant="ghost"
                                iconOnly={true}
                                title={`Copy ${entry.key}`}
                              />
                            </div>
                          </li>
                        );
                      },
                    )}
                  </ul>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpanDetailsPanel;
