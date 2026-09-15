import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span, { SpanLink } from "Common/Models/AnalyticsModels/Span";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SpanSelfTime } from "Common/Utils/Traces/CriticalPath";
import { APP_API_URL } from "Common/UI/Config";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import LlmSpanDisplayUtil from "../../../Utils/LlmSpanDisplay";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { resolveReplayMomentRouteForSession } from "../../../Utils/RumSessionLookup";
import SpanUtil from "../../../Utils/SpanUtil";
import {
  ProfilePresenceGate,
  buildExceptionsGroupRoute,
  buildTraceFlamegraphRequest,
  getProfilePresenceGate,
} from "../../../Utils/TraceCorrelatedSignals";
import {
  AttributeEntry,
  SpanEventRow,
  SpanTiming,
  TraceServiceInfo,
  buildAttributeSearchQuery,
  buildSpanEventRows,
  buildSpanShareUrl,
  filterAttributeEntries,
  flattenSpanAttributes,
  formatDurationNano,
  formatOffsetNano,
  formatPercent,
  getSpanTiming,
  pluralize,
} from "../../../Utils/TraceDetailPresentation";
import { WaterfallSpan } from "../../../Utils/TraceWaterfall";
import { makeSpanSignalId } from "../../SessionReplay/Rail/ReplaySignalTypes";
import LlmSpanPanel from "../LlmSpanPanel";
import TraceScopedFlamegraph from "../TraceScopedFlamegraph";

export interface ComponentProps {
  traceId: string;
  span: WaterfallSpan;
  service: TraceServiceInfo;
  parentSpan: WaterfallSpan | null;
  parentService: TraceServiceInfo | null;
  childCount: number;
  selfTime: SpanSelfTime | undefined;
  traceStartUnixNano: number;
  traceDurationUnixNano: number;
  isOnCriticalPath: boolean;
  onClose: () => void;
  onSelectSpan: (spanId: string) => void;
  onZoomToSpan: () => void;
}

type PanelTab =
  | "attributes"
  | "events"
  | "logs"
  | "exceptions"
  | "links"
  | "profile"
  | "ai";

const LOG_LIMIT: number = 200;
const EXCEPTION_LIMIT: number = 50;
const ATTRIBUTE_FILTER_THRESHOLD: number = 8;

function getSeverityClassName(severity: string): string {
  const value: string = severity.toLowerCase();
  if (
    value.startsWith("err") ||
    value.startsWith("fatal") ||
    value.startsWith("crit")
  ) {
    return "bg-red-50 text-red-700";
  }
  if (value.startsWith("warn")) {
    return "bg-amber-50 text-amber-700";
  }
  if (value.startsWith("debug") || value.startsWith("trace")) {
    return "bg-gray-100 text-gray-600";
  }
  return "bg-sky-50 text-sky-700";
}

/*
 * Everything about one span, docked beside the waterfall: timing against the
 * trace, its place in the tree, and tabs for attributes, events, logs,
 * exceptions, links, profile samples and LLM details. The light waterfall row
 * renders the header at once; the full span and every tab load lazily.
 */
const TraceSpanPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { span } = props;
  const spanId: string = span.spanId;

  const [fullSpan, setFullSpan] = useState<Span | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState<boolean>(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("attributes");
  const [attributeFilter, setAttributeFilter] = useState<string>("");

  const [logs, setLogs] = useState<Array<Log>>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  const [logsFetched, setLogsFetched] = useState<boolean>(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const [exceptions, setExceptions] = useState<Array<ExceptionInstance>>([]);
  const [exceptionsLoading, setExceptionsLoading] = useState<boolean>(false);
  const [exceptionsFetched, setExceptionsFetched] = useState<boolean>(false);
  const [exceptionsError, setExceptionsError] = useState<string | null>(null);

  const [profileSampleCount, setProfileSampleCount] = useState<number>(0);
  const [replayRoute, setReplayRoute] = useState<Route | null>(null);

  /*
   * Generation counters for the lazy tab fetches, bumped only when the span
   * changes or the panel unmounts, so a stale response never writes state and
   * a loading-state write never cancels the request that set it.
   */
  const logsLoadGenerationRef: React.MutableRefObject<number> =
    useRef<number>(0);
  const exceptionsLoadGenerationRef: React.MutableRefObject<number> =
    useRef<number>(0);

  // A different span reuses the panel: reset everything it loaded.
  useEffect(() => {
    setFullSpan(null);
    setIsDetailLoading(true);
    setDetailError(null);
    setActiveTab("attributes");
    setAttributeFilter("");
    setLogs([]);
    setLogsLoading(false);
    setLogsFetched(false);
    setLogsError(null);
    setExceptions([]);
    setExceptionsLoading(false);
    setExceptionsFetched(false);
    setExceptionsError(null);
    setProfileSampleCount(0);
    setReplayRoute(null);
  }, [spanId]);

  useEffect(() => {
    let cancelled: boolean = false;

    const loadSpan: () => Promise<void> = async (): Promise<void> => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const result: ListResult<Span> = await AnalyticsModelAPI.getList<Span>({
          modelType: Span,
          query: {
            ...(projectId ? { projectId } : {}),
            traceId: props.traceId,
            spanId,
          } as Query<Span>,
          select: {
            attributes: true,
            events: true,
            links: true,
            statusMessage: true,
            sessionId: true,
            startTime: true,
          } as Select<Span>,
          limit: 1,
          skip: 0,
          sort: {},
          requestOptions: {},
        });
        if (!cancelled) {
          setFullSpan(result.data[0] || null);
        }
      } catch (err) {
        if (!cancelled) {
          setDetailError(API.getFriendlyMessage(err));
        }
      } finally {
        if (!cancelled) {
          setIsDetailLoading(false);
        }
      }
    };

    void loadSpan();

    return () => {
      cancelled = true;
    };
  }, [props.traceId, spanId]);

  // The Profile tab only exists when this span has profile samples.
  useEffect(() => {
    let cancelled: boolean = false;

    const checkProfile: () => Promise<void> = async (): Promise<void> => {
      const requestBody: JSONObject | null = buildTraceFlamegraphRequest({
        traceId: props.traceId,
        spanIds: [spanId],
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
        if (cancelled || response instanceof HTTPErrorResponse) {
          return;
        }
        const gate: ProfilePresenceGate = getProfilePresenceGate(
          response.data as JSONObject,
        );
        setProfileSampleCount(gate.sampleCount);
      } catch {
        // No samples to show; the tab stays hidden.
      }
    };

    void checkProfile();

    return () => {
      cancelled = true;
    };
  }, [props.traceId, spanId]);

  const sessionId: string = fullSpan?.sessionId?.toString() || "";

  // "Watch session at this span" for spans recorded inside a RUM session.
  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let cancelled: boolean = false;

    const resolve: () => Promise<void> = async (): Promise<void> => {
      try {
        const route: Route | undefined =
          await resolveReplayMomentRouteForSession({
            sessionId,
            at: Math.floor(span.startTimeUnixNano / 1000000),
            signal: makeSpanSignalId(spanId),
            rail: "traces",
          });
        if (!cancelled) {
          setReplayRoute(route || null);
        }
      } catch {
        // Without a recording there is simply no replay link.
      }
    };

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [sessionId, spanId, span.startTimeUnixNano]);

  useEffect(() => {
    if (activeTab !== "logs" || logsFetched) {
      return;
    }

    logsLoadGenerationRef.current += 1;
    const generation: number = logsLoadGenerationRef.current;

    const loadLogs: () => Promise<void> = async (): Promise<void> => {
      setLogsLoading(true);
      setLogsError(null);
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const result: ListResult<Log> = await AnalyticsModelAPI.getList<Log>({
          modelType: Log,
          query: {
            ...(projectId ? { projectId } : {}),
            traceId: props.traceId,
            spanId,
          } as Query<Log>,
          select: {
            time: true,
            severityText: true,
            body: true,
            spanId: true,
            traceId: true,
          } as Select<Log>,
          sort: { time: SortOrder.Ascending } as Record<string, SortOrder>,
          limit: LOG_LIMIT,
          skip: 0,
          requestOptions: {},
        });
        if (generation === logsLoadGenerationRef.current) {
          setLogs(result.data);
        }
      } catch (err) {
        if (generation === logsLoadGenerationRef.current) {
          setLogsError(API.getFriendlyMessage(err));
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
      logsLoadGenerationRef.current += 1;
    };
  }, [activeTab, logsFetched, spanId, props.traceId]);

  useEffect(() => {
    if (activeTab !== "exceptions" || exceptionsFetched) {
      return;
    }

    exceptionsLoadGenerationRef.current += 1;
    const generation: number = exceptionsLoadGenerationRef.current;

    const loadExceptions: () => Promise<void> = async (): Promise<void> => {
      setExceptionsLoading(true);
      setExceptionsError(null);
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const result: ListResult<ExceptionInstance> =
          await AnalyticsModelAPI.getList<ExceptionInstance>({
            modelType: ExceptionInstance,
            query: {
              ...(projectId ? { projectId } : {}),
              spanId,
            } as Query<ExceptionInstance>,
            select: {
              message: true,
              exceptionType: true,
              stackTrace: true,
              fingerprint: true,
              time: true,
              escaped: true,
            } as Select<ExceptionInstance>,
            sort: { time: SortOrder.Descending } as Record<string, SortOrder>,
            limit: EXCEPTION_LIMIT,
            skip: 0,
            requestOptions: {},
          });
        if (generation === exceptionsLoadGenerationRef.current) {
          setExceptions(result.data);
        }
      } catch (err) {
        if (generation === exceptionsLoadGenerationRef.current) {
          setExceptionsError(API.getFriendlyMessage(err));
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
      exceptionsLoadGenerationRef.current += 1;
    };
  }, [activeTab, exceptionsFetched, spanId]);

  const timing: SpanTiming = getSpanTiming({
    span,
    selfTime: props.selfTime,
    traceStartUnixNano: props.traceStartUnixNano,
    traceDurationUnixNano: props.traceDurationUnixNano,
  });

  const attributes: Array<AttributeEntry> = useMemo(() => {
    return flattenSpanAttributes(
      fullSpan?.attributes as JSONObject | undefined,
    );
  }, [fullSpan]);

  const filteredAttributes: Array<AttributeEntry> = useMemo(() => {
    return filterAttributeEntries(attributes, attributeFilter);
  }, [attributes, attributeFilter]);

  const events: Array<SpanEventRow> = useMemo(() => {
    return buildSpanEventRows({
      events: fullSpan?.events,
      spanStartUnixNano: span.startTimeUnixNano,
      traceStartUnixNano: props.traceStartUnixNano,
    });
  }, [fullSpan, span.startTimeUnixNano, props.traceStartUnixNano]);

  const links: Array<SpanLink> = fullSpan?.links || [];

  const isLlmSpan: boolean = useMemo(() => {
    if (!fullSpan) {
      return false;
    }
    return LlmSpanDisplayUtil.parse({
      attributes: fullSpan.attributes as JSONObject | undefined,
      events: fullSpan.events,
    }).isLlmSpan;
  }, [fullSpan]);

  // A tab that disappears (no profile samples, not an LLM span) falls back.
  useEffect(() => {
    if (
      (activeTab === "profile" && profileSampleCount === 0) ||
      (activeTab === "ai" && !isLlmSpan && !isDetailLoading)
    ) {
      setActiveTab("attributes");
    }
  }, [activeTab, profileSampleCount, isLlmSpan, isDetailLoading]);

  const statusMessage: string = fullSpan?.statusMessage?.toString() || "";
  const exceptionEventCount: number = events.filter((event: SpanEventRow) => {
    return event.isException;
  }).length;

  const shareUrl: string =
    typeof window !== "undefined"
      ? buildSpanShareUrl(window.location.href, spanId)
      : "";

  const tabs: Array<{ id: PanelTab; label: string; count: number | null }> = [
    {
      id: "attributes",
      label: "Attributes",
      count: isDetailLoading ? null : attributes.length,
    },
    {
      id: "events",
      label: "Events",
      count: isDetailLoading ? null : events.length,
    },
    { id: "logs", label: "Logs", count: logsFetched ? logs.length : null },
    {
      id: "exceptions",
      label: "Exceptions",
      count: exceptionsFetched ? exceptions.length : null,
    },
    {
      id: "links",
      label: "Links",
      count: isDetailLoading ? null : links.length,
    },
    ...(profileSampleCount > 0
      ? [
          {
            id: "profile" as PanelTab,
            label: "Profile",
            count: profileSampleCount,
          },
        ]
      : []),
    ...(isLlmSpan ? [{ id: "ai" as PanelTab, label: "LLM", count: null }] : []),
  ];

  const getAttributeSearchRoute: (entry: AttributeEntry) => Route = (
    entry: AttributeEntry,
  ): Route => {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.TRACES] as Route,
    );
    return new Route(route.toString()).addQueryParams({
      search: encodeURIComponent(
        buildAttributeSearchQuery(entry.key, entry.value),
      ),
    });
  };

  const renderEmpty: (message: string) => ReactElement = (
    message: string,
  ): ReactElement => {
    return (
      <div className="rounded-md border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-500">
        {message}
      </div>
    );
  };

  const renderLoader: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex h-24 items-center justify-center">
        <ComponentLoader />
      </div>
    );
  };

  const renderTab: () => ReactElement = (): ReactElement => {
    if (
      isDetailLoading &&
      (activeTab === "attributes" ||
        activeTab === "events" ||
        activeTab === "links")
    ) {
      return renderLoader();
    }

    if (
      detailError &&
      (activeTab === "attributes" ||
        activeTab === "events" ||
        activeTab === "links")
    ) {
      return (
        <div
          className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700"
          role="alert"
        >
          {detailError}
        </div>
      );
    }

    switch (activeTab) {
      case "attributes":
        if (attributes.length === 0) {
          return renderEmpty("This span has no attributes.");
        }
        return (
          <div className="space-y-2">
            {attributes.length > ATTRIBUTE_FILTER_THRESHOLD && (
              <div className="relative">
                <Icon
                  icon={IconProp.Search}
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="search"
                  value={attributeFilter}
                  placeholder={`Filter ${attributes.length} attributes`}
                  aria-label="Filter attributes"
                  className="w-full rounded-md border border-gray-200 py-1.5 pl-8 pr-2 text-xs placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setAttributeFilter(event.target.value);
                  }}
                />
              </div>
            )}
            {filteredAttributes.length === 0 ? (
              renderEmpty("No attributes match this filter.")
            ) : (
              <dl
                className="divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200"
                data-testid="span-attributes"
              >
                {filteredAttributes.map(
                  (entry: AttributeEntry): ReactElement => {
                    return (
                      <div
                        key={entry.key}
                        className="group grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-1.5 text-xs hover:bg-gray-50"
                      >
                        <dt className="break-words font-mono text-gray-500">
                          {entry.key}
                        </dt>
                        <dd className="flex min-w-0 items-start justify-between gap-2">
                          <span className="min-w-0 break-words font-mono text-gray-900">
                            {entry.value}
                          </span>
                          <span className="flex flex-none items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            <CopyTextButton
                              textToBeCopied={entry.value}
                              iconOnly={true}
                              size="xs"
                              title={`Copy ${entry.key}`}
                            />
                            <Link
                              to={getAttributeSearchRoute(entry)}
                              className="rounded border border-gray-200 p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                              title="Find traces with this attribute value"
                            >
                              <Icon
                                icon={IconProp.Search}
                                className="h-3.5 w-3.5"
                              />
                            </Link>
                          </span>
                        </dd>
                      </div>
                    );
                  },
                )}
              </dl>
            )}
          </div>
        );

      case "events":
        if (events.length === 0) {
          return renderEmpty("No events were recorded on this span.");
        }
        return (
          <ol className="space-y-2" data-testid="span-events">
            {events.map((event: SpanEventRow, index: number): ReactElement => {
              return (
                <li
                  key={`${event.name}-${index}`}
                  className={`rounded-md border px-3 py-2 ${event.isException ? "border-red-200 bg-red-50/60" : "border-gray-200 bg-white"}`}
                >
                  <details>
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span
                          className={`block break-words text-xs font-medium ${event.isException ? "text-red-700" : "text-gray-900"}`}
                        >
                          {event.isException ? "Exception: " : ""}
                          {event.title}
                        </span>
                        {event.attributes.length > 0 && (
                          <span className="text-[11px] text-gray-500">
                            {pluralize(event.attributes.length, "attribute")}
                          </span>
                        )}
                      </span>
                      <span
                        className="flex-none rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-gray-600"
                        title={`${formatOffsetNano(event.offsetFromTraceStartUnixNano)} from the start of the trace`}
                      >
                        {formatOffsetNano(event.offsetFromSpanStartUnixNano)}
                      </span>
                    </summary>
                    {event.attributes.length > 0 && (
                      <dl className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                        {event.attributes.map(
                          (entry: AttributeEntry): ReactElement => {
                            return (
                              <div
                                key={entry.key}
                                className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 text-[11px]"
                              >
                                <dt className="break-words font-mono text-gray-500">
                                  {entry.key}
                                </dt>
                                <dd className="break-words font-mono text-gray-900">
                                  {entry.value}
                                </dd>
                              </div>
                            );
                          },
                        )}
                      </dl>
                    )}
                  </details>
                </li>
              );
            })}
          </ol>
        );

      case "logs":
        if (logsLoading || !logsFetched) {
          return renderLoader();
        }
        if (logsError) {
          return (
            <div
              className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700"
              role="alert"
            >
              {logsError}
            </div>
          );
        }
        if (logs.length === 0) {
          return renderEmpty(
            "No logs were written inside this span. The trace's logs are listed below the waterfall.",
          );
        }
        return (
          <ul className="space-y-1" data-testid="span-logs">
            {logs.map((log: Log, index: number): ReactElement => {
              const severity: string = log.severityText?.toString() || "INFO";
              const time: Date | null = log.time
                ? OneUptimeDate.fromString(log.time as unknown as string)
                : null;
              return (
                <li
                  key={index}
                  className="flex items-start gap-2 rounded-md border border-gray-100 bg-white px-2 py-1.5 font-mono text-[11px]"
                >
                  <span
                    className={`flex-none rounded px-1 font-semibold uppercase ${getSeverityClassName(severity)}`}
                  >
                    {severity}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-gray-800">
                    {log.body?.toString() || ""}
                  </span>
                  {time && (
                    <span className="flex-none text-gray-400">
                      {OneUptimeDate.getLocalTimeString(time, {
                        includeSeconds: true,
                      })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        );

      case "exceptions":
        if (exceptionsLoading || !exceptionsFetched) {
          return renderLoader();
        }
        if (exceptionsError) {
          return (
            <div
              className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700"
              role="alert"
            >
              {exceptionsError}
            </div>
          );
        }
        if (exceptions.length === 0) {
          return renderEmpty("No exceptions were recorded on this span.");
        }
        return (
          <ul className="space-y-2" data-testid="span-exceptions">
            {exceptions.map(
              (exception: ExceptionInstance, index: number): ReactElement => {
                const groupRoute: Route | null = exception.fingerprint
                  ? buildExceptionsGroupRoute({
                      exceptionsListRoute: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.EXCEPTIONS_UNRESOLVED]!,
                      ),
                      fingerprint: exception.fingerprint.toString(),
                    })
                  : null;
                return (
                  <li
                    key={index}
                    className="rounded-md border border-red-200 bg-red-50/60 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {exception.exceptionType && (
                          <div className="font-mono text-[11px] font-semibold text-red-700">
                            {exception.exceptionType}
                          </div>
                        )}
                        <div className="break-words text-xs text-gray-900">
                          {exception.message || "Exception"}
                        </div>
                      </div>
                      {groupRoute && (
                        <Link
                          to={groupRoute}
                          openInNewTab={true}
                          className="flex-none text-[11px] font-medium text-red-700 hover:underline"
                        >
                          View exception
                        </Link>
                      )}
                    </div>
                    {exception.stackTrace && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-red-700">
                          Stack trace
                        </summary>
                        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre rounded bg-white p-2 font-mono text-[11px] text-gray-800">
                          {exception.stackTrace.replace(/\\n/g, "\n")}
                        </pre>
                      </details>
                    )}
                  </li>
                );
              },
            )}
          </ul>
        );

      case "links":
        if (links.length === 0) {
          return renderEmpty("This span does not link to other spans.");
        }
        return (
          <ul className="space-y-2" data-testid="span-links">
            {links.map((link: SpanLink, index: number): ReactElement => {
              const route: Route = new Route(
                RouteUtil.populateRouteParams(RouteMap[PageMap.TRACE_VIEW]!, {
                  modelId: link.traceId,
                }).toString(),
              ).addQueryParams({ spanId: link.spanId });
              const linkAttributes: Array<AttributeEntry> =
                flattenSpanAttributes(link.attributes);
              return (
                <li
                  key={index}
                  className="rounded-md border border-gray-200 px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 space-y-0.5 font-mono text-[11px] text-gray-700">
                      <div className="truncate">trace {link.traceId}</div>
                      <div className="truncate">span {link.spanId}</div>
                    </div>
                    <Link
                      to={route}
                      className="flex-none font-medium text-indigo-600 hover:underline"
                    >
                      {link.traceId === props.traceId
                        ? "Show span"
                        : "Open trace"}
                    </Link>
                  </div>
                  {linkAttributes.length > 0 && (
                    <dl className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                      {linkAttributes.map(
                        (entry: AttributeEntry): ReactElement => {
                          return (
                            <div
                              key={entry.key}
                              className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 text-[11px]"
                            >
                              <dt className="break-words font-mono text-gray-500">
                                {entry.key}
                              </dt>
                              <dd className="break-words font-mono text-gray-900">
                                {entry.value}
                              </dd>
                            </div>
                          );
                        },
                      )}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        );

      case "profile":
        return (
          <TraceScopedFlamegraph traceId={props.traceId} spanIds={[spanId]} />
        );

      case "ai":
        return (
          <LlmSpanPanel
            attributes={fullSpan?.attributes as JSONObject | undefined}
            events={fullSpan?.events}
            durationLabel={formatDurationNano(span.durationUnixNano)}
          />
        );

      default:
        return <></>;
    }
  };

  return (
    <aside
      className="flex h-full min-h-0 flex-col overflow-hidden bg-white"
      aria-label="Span details"
      data-testid="trace-span-panel"
    >
      <header className="border-b border-gray-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: props.service.color }}
                  aria-hidden="true"
                />
                {props.service.name}
              </span>
              {span.kind && (
                <span>· {SpanUtil.getSpanKindFriendlyName(span.kind)}</span>
              )}
            </div>
            <h3
              className="mt-1 break-words text-sm font-semibold leading-snug text-gray-900"
              data-testid="span-panel-title"
            >
              {span.name || "(unnamed span)"}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                  span.isError
                    ? "bg-red-50 text-red-700 ring-red-600/20"
                    : "bg-gray-50 text-gray-600 ring-gray-500/15"
                }`}
                data-testid="span-panel-status"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${span.isError ? "bg-red-500" : "bg-emerald-500"}`}
                  aria-hidden="true"
                />
                {span.isError ? "Error" : "No error"}
              </span>
              {props.isOnCriticalPath && (
                <span className="inline-flex items-center rounded-full bg-gray-900 px-2 py-0.5 text-[11px] font-medium text-white">
                  On critical path
                </span>
              )}
              {exceptionEventCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                  {pluralize(exceptionEventCount, "exception")}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-none items-center gap-1">
            <CopyTextButton
              textToBeCopied={shareUrl}
              iconOnly={true}
              size="sm"
              title="Copy a link to this span"
            />
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close span details"
              data-testid="span-panel-close"
              onClick={props.onClose}
            >
              <Icon icon={IconProp.Close} className="h-4 w-4" />
            </button>
          </div>
        </div>
        {span.isError && statusMessage && (
          <div
            className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700"
            data-testid="span-panel-status-message"
          >
            {statusMessage}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section
          className="space-y-3 border-b border-gray-200 px-4 py-3"
          data-testid="span-panel-timing"
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-gray-500">Duration</dt>
              <dd className="font-semibold tabular-nums text-gray-900">
                {formatDurationNano(timing.durationUnixNano)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Self time</dt>
              <dd className="font-semibold tabular-nums text-gray-900">
                {formatDurationNano(timing.selfTimeUnixNano)}
                <span className="ml-1 font-normal text-gray-500">
                  {formatPercent(timing.selfTimePercent)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Starts</dt>
              <dd className="tabular-nums text-gray-900">
                {formatOffsetNano(timing.offsetUnixNano)}
                <span className="ml-1 text-gray-500">into the trace</span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Children</dt>
              <dd className="tabular-nums text-gray-900">
                {props.childCount.toLocaleString()}
              </dd>
            </div>
          </dl>
          <div
            className="relative h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
            title="Where this span sits in the trace"
          >
            <div
              className="absolute inset-y-0 rounded-full"
              style={{
                left: `${timing.leftPercent}%`,
                width: `max(${timing.widthPercent}%, 3px)`,
                backgroundColor: span.isError ? "#ef4444" : props.service.color,
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              onClick={props.onZoomToSpan}
              data-testid="span-panel-zoom"
            >
              <Icon
                icon={IconProp.MagnifyingGlassPlus}
                className="h-3.5 w-3.5"
              />
              Zoom to span
            </button>
            {replayRoute && (
              <Link
                to={replayRoute}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                title="Open the session recording at the moment this span started"
              >
                <Icon icon={IconProp.Film} className="h-3.5 w-3.5" />
                Watch session
              </Link>
            )}
          </div>
          <dl className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500">Span ID</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <code
                  className="truncate font-mono text-[11px] text-gray-800"
                  data-testid="span-panel-id"
                >
                  {spanId}
                </code>
                <CopyTextButton
                  textToBeCopied={spanId}
                  iconOnly={true}
                  size="xs"
                  title="Copy span ID"
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500">Parent</dt>
              <dd className="min-w-0 truncate text-right">
                {props.parentSpan ? (
                  <button
                    type="button"
                    className="max-w-full truncate font-medium text-indigo-600 hover:underline"
                    title={`Select ${props.parentSpan.name}`}
                    data-testid="span-panel-parent"
                    onClick={() => {
                      props.onSelectSpan(props.parentSpan!.spanId);
                    }}
                  >
                    {props.parentSpan.name || props.parentSpan.spanId}
                    {props.parentService &&
                    props.parentService.id !== props.service.id
                      ? ` · ${props.parentService.name}`
                      : ""}
                  </button>
                ) : span.parentSpanId ? (
                  <span
                    className="text-amber-700"
                    title={`Parent span ${span.parentSpanId} was not received`}
                  >
                    Missing ({span.parentSpanId.slice(0, 8)}…)
                  </span>
                ) : (
                  <span className="text-gray-500">None — root span</span>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-2">
          <div
            className="-mb-px flex flex-wrap gap-x-1"
            role="tablist"
            aria-label="Span details"
          >
            {tabs.map(
              (tab: {
                id: PanelTab;
                label: string;
                count: number | null;
              }): ReactElement => {
                const isActive: boolean = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    data-testid={`span-panel-tab-${tab.id}`}
                    className={`flex flex-none items-center gap-1 border-b-2 px-2 py-2 text-xs font-medium ${
                      isActive
                        ? "border-indigo-500 text-indigo-700"
                        : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800"
                    }`}
                    onClick={() => {
                      setActiveTab(tab.id);
                    }}
                  >
                    {tab.label}
                    {tab.count !== null && (
                      <span
                        className={`rounded-full px-1.5 text-[10px] tabular-nums ${isActive ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"}`}
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
        <div className="px-4 py-3" role="tabpanel">
          {renderTab()}
        </div>
      </div>
    </aside>
  );
};

export default TraceSpanPanel;
