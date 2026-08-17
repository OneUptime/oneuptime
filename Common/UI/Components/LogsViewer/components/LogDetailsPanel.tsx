import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Log from "../../../../Models/AnalyticsModels/Log";
import Service from "../../../../Models/DatabaseModels/Service";
import Dictionary from "../../../../Types/Dictionary";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import CopyTextButton from "../../CopyTextButton/CopyTextButton";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import Link from "../../Link/Link";
import OneUptimeDate from "../../../../Types/Date";
import SeverityBadge from "./SeverityBadge";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../Utils/API/API";
import ModelAPI from "../../../Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI, {
  ListResult,
} from "../../../Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Query from "../../../../Types/BaseDatabase/Query";
import Sort from "../../../../Types/BaseDatabase/Sort";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { APP_API_URL } from "../../../Config";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../../Types/ObjectID";

type LogDetailTab = "details" | "context";

export type LogContextScope = "nearby" | "trace";

export interface LogDetailsPanelProps {
  log: Log;
  serviceMap: Dictionary<Service>;
  onClose?: () => void;
  getTraceRoute?:
    | ((traceId: string, log: Log) => Route | URL | undefined)
    | undefined;
  getSpanRoute?:
    | ((spanId: string, log: Log) => Route | URL | undefined)
    | undefined;
  /*
   * Async fallback for spanId-only logs: the sync builder needs a trace id
   * the row doesn't carry, so the destination is resolved once when the
   * panel expands (one Span lookup by span id) instead of per-row.
   */
  resolveSpanRoute?:
    | ((spanId: string, log: Log) => Promise<Route | URL | undefined>)
    | undefined;
  /*
   * Threaded like getTraceRoute. May return a promise because building the
   * session replay route can require a RumSession lookup (the log row only
   * carries the sessionId, not the rumApplicationId the route needs).
   */
  getSessionRoute?:
    | ((
        sessionId: string,
        log: Log,
      ) => Route | URL | undefined | Promise<Route | URL | undefined>)
    | undefined;
  variant?: "floating" | "embedded";
  projectId?: ObjectID | undefined;
  /*
   * Called when the user clicks "filter by" on an attribute row. The key is
   * the flat attribute key as stored in the data (e.g. `requestId`,
   * `oneuptime.service.id`); the value is the raw value. Wires into the
   * same path as picking a value from the search bar autocomplete.
   */
  onFilterByAttribute?: ((key: string, value: string) => void) | undefined;
}

interface AttributeEntry {
  key: string;
  value: string;
}

interface PreparedBody {
  isJson: boolean;
  pretty: string;
  compact: string;
  raw: string;
}

export interface ContextLog {
  id: string;
  time: string;
  severity: string;
  body: string;
  primaryEntityId: string;
}

const prepareBody: (body: string | undefined) => PreparedBody = (
  body: string | undefined,
): PreparedBody => {
  if (!body) {
    return {
      isJson: false,
      pretty: "",
      compact: "",
      raw: "",
    };
  }

  try {
    const parsed: unknown = JSON.parse(body);
    const pretty: string = JSON.stringify(parsed, null, 2);
    const compact: string = JSON.stringify(parsed);
    return {
      isJson: true,
      pretty,
      compact,
      raw: body,
    };
  } catch {
    return {
      isJson: false,
      pretty: body,
      compact: body,
      raw: body,
    };
  }
};

function parseContextRow(row: JSONObject): ContextLog {
  return {
    id: String(row["_id"] || ""),
    time: String(row["time"] || ""),
    severity: String(row["severityText"] || "Unspecified"),
    body: String(row["body"] || ""),
    primaryEntityId: String(row["primaryEntityId"] || ""),
  };
}

// Whole-trace context is one bounded fetch, not a paginated view.
const TRACE_CONTEXT_LIMIT: number = 100;

function toContextLog(log: Log): ContextLog {
  return {
    id: log.getColumnValue("_id")?.toString() || "",
    time: log.time ? OneUptimeDate.toString(log.time) : "",
    severity: log.severityText?.toString() || "Unspecified",
    body: log.body?.toString() || "",
    primaryEntityId: log.primaryEntityId?.toString() || "",
  };
}

/**
 * Split a trace's logs (sorted by time ascending) into the rows before and
 * after the currently-expanded log. The current row is matched by `_id` when
 * both sides carry one; rows that ARE the current log are excluded so the
 * panel doesn't render it twice. Without an id match, rows at exactly the
 * current timestamp land in `after` so they stay adjacent to the current row.
 */
export function splitTraceContextLogs(
  logs: Array<Log>,
  currentLogId: string,
  currentTime: Date | undefined,
): { before: Array<ContextLog>; after: Array<ContextLog> } {
  const before: Array<ContextLog> = [];
  const after: Array<ContextLog> = [];

  const currentTimeMs: number | null = currentTime
    ? OneUptimeDate.fromString(currentTime).getTime()
    : null;

  let currentSeen: boolean = false;

  for (const log of logs) {
    const contextLog: ContextLog = toContextLog(log);

    if (currentLogId && contextLog.id && contextLog.id === currentLogId) {
      currentSeen = true;
      continue;
    }

    if (currentSeen) {
      after.push(contextLog);
      continue;
    }

    if (currentTimeMs === null) {
      before.push(contextLog);
      continue;
    }

    const rowTimeMs: number = contextLog.time
      ? OneUptimeDate.fromString(contextLog.time).getTime()
      : NaN;

    if (!isNaN(rowTimeMs) && rowTimeMs < currentTimeMs) {
      before.push(contextLog);
    } else {
      after.push(contextLog);
    }
  }

  return { before, after };
}

const LogDetailsPanel: FunctionComponent<LogDetailsPanelProps> = (
  props: LogDetailsPanelProps,
): ReactElement => {
  const [activeTab, setActiveTab] = useState<LogDetailTab>("details");
  const [contextBefore, setContextBefore] = useState<Array<ContextLog>>([]);
  const [contextAfter, setContextAfter] = useState<Array<ContextLog>>([]);
  const [contextLoading, setContextLoading] = useState<boolean>(false);
  const [contextError, setContextError] = useState<string>("");
  const [contextLoaded, setContextLoaded] = useState<boolean>(false);
  const [contextScope, setContextScope] = useState<LogContextScope>("nearby");
  const [resolvedSpanRoute, setResolvedSpanRoute] = useState<
    Route | URL | undefined
  >(undefined);
  const [sessionRoute, setSessionRoute] = useState<Route | URL | undefined>(
    undefined,
  );

  /*
   * Bumped whenever the context view is retargeted (scope toggle, new log).
   * An in-flight fetch from the previous target must not mark the new one as
   * loaded — only the loading flag is always cleared, so the effect can kick
   * off the fetch for the new target.
   */
  const contextEpochRef: React.MutableRefObject<number> = useRef<number>(0);

  const variant: "floating" | "embedded" = props.variant || "floating";
  const primaryEntityId: string = props.log.primaryEntityId?.toString() || "";
  const service: Service | undefined = props.serviceMap[primaryEntityId];
  const serviceName: string =
    service?.name || primaryEntityId || "Unknown service";
  const serviceColor: string =
    (service?.serviceColor && service?.serviceColor.toString()) || "#64748b";

  const bodyDetails: PreparedBody = useMemo(() => {
    return prepareBody(props.log.body?.toString());
  }, [props.log.body]);

  const attributeEntries: Array<AttributeEntry> = useMemo(() => {
    const raw: Record<string, unknown> | undefined = props.log.attributes as
      | Record<string, unknown>
      | undefined;

    if (!raw) {
      return [];
    }

    return Object.keys(raw)
      .sort((left: string, right: string): number => {
        return left.localeCompare(right);
      })
      .map((key: string): AttributeEntry => {
        const rawValue: unknown = raw[key];
        const value: string =
          rawValue === null || rawValue === undefined
            ? ""
            : typeof rawValue === "string"
              ? rawValue
              : JSON.stringify(rawValue);
        return { key, value };
      });
  }, [props.log.attributes]);

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

  const traceId: string = props.log.traceId?.toString() || "";
  const spanId: string = props.log.spanId?.toString() || "";

  const traceRoute: Route | URL | undefined = useMemo(() => {
    if (!traceId || !props.getTraceRoute) {
      return undefined;
    }

    return props.getTraceRoute(traceId, props.log);
  }, [traceId, props]);

  const spanRoute: Route | URL | undefined = useMemo(() => {
    if (!spanId) {
      return undefined;
    }

    if (props.getSpanRoute) {
      return props.getSpanRoute(spanId, props.log);
    }

    if (props.getTraceRoute && traceId) {
      const baseRoute: Route | URL | undefined = props.getTraceRoute(
        traceId,
        props.log,
      );

      if (!baseRoute) {
        return undefined;
      }

      if (baseRoute instanceof Route) {
        const nextRoute: Route = new Route(baseRoute.toString());
        nextRoute.addQueryParams({ spanId });
        return nextRoute;
      }

      const nextUrl: URL = URL.fromURL(baseRoute);
      nextUrl.addQueryParam("spanId", spanId);
      return nextUrl;
    }

    return undefined;
  }, [spanId, props, traceId]);

  const sessionId: string = props.log.sessionId?.toString() || "";

  /*
   * Lazy resolutions run when the panel expands (it only mounts for the
   * selected row), never per table row. The stale flag guards against a
   * response landing after the user has moved on to a different log.
   */
  useEffect(() => {
    setResolvedSpanRoute(undefined);

    if (!spanId || spanRoute || !props.resolveSpanRoute) {
      return;
    }

    let isStale: boolean = false;

    const resolve: () => Promise<void> = async (): Promise<void> => {
      try {
        const route: Route | URL | undefined = await props.resolveSpanRoute!(
          spanId,
          props.log,
        );

        if (!isStale) {
          setResolvedSpanRoute(route);
        }
      } catch {
        // Leave the span id as plain text.
      }
    };

    void resolve();

    return () => {
      isStale = true;
    };
  }, [spanId, spanRoute, props.resolveSpanRoute, props.log]);

  useEffect(() => {
    setSessionRoute(undefined);

    if (!sessionId || !props.getSessionRoute) {
      return;
    }

    let isStale: boolean = false;

    const resolve: () => Promise<void> = async (): Promise<void> => {
      try {
        const route: Route | URL | undefined = await Promise.resolve(
          props.getSessionRoute!(sessionId, props.log),
        );

        if (!isStale) {
          setSessionRoute(route);
        }
      } catch {
        // Leave the session id as plain text.
      }
    };

    void resolve();

    return () => {
      isStale = true;
    };
  }, [sessionId, props.getSessionRoute, props.log]);

  const effectiveSpanRoute: Route | URL | undefined =
    spanRoute || resolvedSpanRoute;

  const loadContext: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      if (!props.projectId || !primaryEntityId || !props.log.time) {
        setContextError("Missing project or service information for context.");
        return;
      }

      const epoch: number = contextEpochRef.current;

      try {
        setContextLoading(true);
        setContextError("");

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/context",
            ),
            data: {
              logId: props.log.getColumnValue("_id")?.toString() || "",
              primaryEntityId: primaryEntityId,
              time: props.log.time
                ? OneUptimeDate.toString(props.log.time)
                : "",
              count: 5,
            },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const before: Array<JSONObject> =
          (response.data["before"] as Array<JSONObject>) || [];
        const after: Array<JSONObject> =
          (response.data["after"] as Array<JSONObject>) || [];

        if (contextEpochRef.current === epoch) {
          setContextBefore(before.map(parseContextRow));
          setContextAfter(after.map(parseContextRow));
          setContextLoaded(true);
        }
      } catch (err) {
        if (contextEpochRef.current === epoch) {
          setContextError(
            `Failed to load log context. ${API.getFriendlyErrorMessage(err as Error)}`,
          );
        }
      } finally {
        setContextLoading(false);
      }
    }, [props.projectId, primaryEntityId, props.log]);

  /*
   * "This trace" context goes through the standard analytics list query (the
   * same plumbing the logs table itself uses) rather than the
   * /telemetry/logs/context endpoint, which is scoped to one service around a
   * timestamp and has no trace dimension.
   */
  const loadTraceContext: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      if (!traceId) {
        setContextError("This log has no trace id.");
        return;
      }

      const epoch: number = contextEpochRef.current;

      try {
        setContextLoading(true);
        setContextError("");

        const listResult: ListResult<Log> =
          await AnalyticsModelAPI.getList<Log>({
            modelType: Log,
            query: { traceId: traceId } as Query<Log>,
            limit: TRACE_CONTEXT_LIMIT,
            skip: 0,
            select: {
              _id: true,
              time: true,
              body: true,
              severityText: true,
              primaryEntityId: true,
            },
            sort: { time: SortOrder.Ascending } as Sort<Log>,
          });

        const currentLogId: string =
          props.log.getColumnValue("_id")?.toString() || "";

        const { before, after } = splitTraceContextLogs(
          listResult.data,
          currentLogId,
          props.log.time,
        );

        if (contextEpochRef.current === epoch) {
          setContextBefore(before);
          setContextAfter(after);
          setContextLoaded(true);
        }
      } catch (err) {
        if (contextEpochRef.current === epoch) {
          setContextError(
            `Failed to load trace logs. ${API.getFriendlyErrorMessage(err as Error)}`,
          );
        }
      } finally {
        setContextLoading(false);
      }
    }, [traceId, props.log]);

  useEffect(() => {
    if (activeTab === "context" && !contextLoaded && !contextLoading) {
      if (contextScope === "trace") {
        void loadTraceContext();
      } else {
        void loadContext();
      }
    }
  }, [
    activeTab,
    contextLoaded,
    contextLoading,
    contextScope,
    loadContext,
    loadTraceContext,
  ]);

  // Reset context when log changes
  useEffect(() => {
    contextEpochRef.current += 1;
    setContextLoaded(false);
    setContextBefore([]);
    setContextAfter([]);
    setContextError("");
    setContextScope("nearby");
    setActiveTab("details");
  }, [props.log]);

  const handleContextScopeChange: (nextScope: LogContextScope) => void =
    useCallback(
      (nextScope: LogContextScope): void => {
        if (nextScope === contextScope) {
          return;
        }

        contextEpochRef.current += 1;
        setContextScope(nextScope);
        setContextLoaded(false);
        setContextBefore([]);
        setContextAfter([]);
        setContextError("");
      },
      [contextScope],
    );

  const containerClassName: string =
    variant === "embedded"
      ? "rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      : "rounded-lg border border-gray-200 bg-white p-5 shadow-md";

  const headerBorderClass: string = "border-gray-200";

  const surfaceCardClass: string = "border-gray-200 bg-gray-50";

  const smallBadgeClass: string =
    "inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-mono uppercase tracking-wide text-gray-600";

  const tabClass: (isActive: boolean) => string = (
    isActive: boolean,
  ): string => {
    return `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      isActive
        ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
        : "text-gray-600 hover:text-gray-800 hover:bg-gray-50 border border-transparent"
    }`;
  };

  const renderContextLogRow: (
    ctxLog: ContextLog,
    isCurrent: boolean,
  ) => ReactElement = (
    ctxLog: ContextLog,
    isCurrent: boolean,
  ): ReactElement => {
    const rowClass: string = isCurrent
      ? "border-l-2 border-l-indigo-500 bg-indigo-50"
      : "border-l-2 border-l-transparent hover:bg-gray-50";

    return (
      <div
        key={ctxLog.id || ctxLog.time}
        className={`flex items-start gap-3 px-3 py-2 ${rowClass}`}
      >
        <span className="flex-none whitespace-nowrap font-mono text-[11px] text-gray-400">
          {ctxLog.time
            ? OneUptimeDate.getDateAsUserFriendlyFormattedString(
                OneUptimeDate.fromString(ctxLog.time),
              )
            : "-"}
        </span>
        <SeverityBadge severity={ctxLog.severity} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700">
          {ctxLog.body.slice(0, 200) || "-"}
        </span>
      </div>
    );
  };

  return (
    <div className={containerClassName}>
      <div
        className={`flex flex-col gap-4 border-b ${headerBorderClass} pb-4 lg:flex-row lg:items-start lg:justify-between`}
      >
        <div className="flex flex-1 items-start gap-3">
          <span
            className="mt-1 h-3 w-3 flex-none rounded-full border border-gray-200"
            style={{ backgroundColor: serviceColor }}
            aria-hidden="true"
          />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-semibold text-gray-900">
                {serviceName}
              </h3>
              <SeverityBadge severity={props.log.severityText} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {props.log.time && (
                <span className={smallBadgeClass}>
                  <Icon icon={IconProp.Clock} className="h-3 w-3" />
                  {OneUptimeDate.getDateAsUserFriendlyFormattedString(
                    props.log.time,
                  )}
                </span>
              )}
              {traceId && (
                <span className={smallBadgeClass}>
                  <Icon icon={IconProp.Logs} className="h-3 w-3" />
                  Trace
                </span>
              )}
              {spanId && (
                <span className={smallBadgeClass}>
                  <Icon icon={IconProp.Terminal} className="h-3 w-3" />
                  Span
                </span>
              )}
            </div>
          </div>
        </div>

        {props.onClose && (
          <button
            type="button"
            onClick={props.onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-600"
            title="Close details"
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="mt-3 flex items-center gap-1">
        <button
          type="button"
          className={tabClass(activeTab === "details")}
          onClick={() => {
            setActiveTab("details");
          }}
        >
          Details
        </button>
        {props.projectId && (
          <button
            type="button"
            className={tabClass(activeTab === "context")}
            onClick={() => {
              setActiveTab("context");
            }}
          >
            Context
          </button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "details" && (
        <div className="mt-4 space-y-5 text-sm text-gray-700">
          <section className="space-y-3">
            <header className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400">
              <span>Log Body</span>
              <CopyTextButton
                textToBeCopied={bodyDetails.raw}
                size="xs"
                variant="ghost"
                iconOnly={false}
                title="Copy log body"
              />
            </header>

            <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
              {bodyDetails.isJson ? (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-gray-800">
                  {bodyDetails.pretty}
                </pre>
              ) : (
                <p className="whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-gray-800">
                  {bodyDetails.pretty || "-"}
                </p>
              )}
            </div>
          </section>

          {(traceId || spanId || sessionId) && (
            <section className="grid gap-4 md:grid-cols-2">
              {traceId && (
                <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
                  <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400">
                    <span>Trace ID</span>
                    <CopyTextButton
                      textToBeCopied={traceId}
                      size="xs"
                      variant="ghost"
                      iconOnly={true}
                      title="Copy trace id"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {traceRoute ? (
                      <Link
                        to={traceRoute}
                        className="max-w-full truncate font-mono text-xs text-indigo-600 hover:text-indigo-500"
                        title={`View trace ${traceId}`}
                      >
                        {traceId}
                      </Link>
                    ) : (
                      <span
                        className="max-w-full truncate font-mono text-xs text-gray-700"
                        title={traceId}
                      >
                        {traceId}
                      </span>
                    )}
                    {traceRoute && (
                      <Icon
                        icon={IconProp.ExternalLink}
                        className="h-4 w-4 flex-none text-indigo-400"
                      />
                    )}
                  </div>
                </div>
              )}

              {spanId && (
                <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
                  <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400">
                    <span>Span ID</span>
                    <CopyTextButton
                      textToBeCopied={spanId}
                      size="xs"
                      variant="ghost"
                      iconOnly={true}
                      title="Copy span id"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {effectiveSpanRoute ? (
                      <Link
                        to={effectiveSpanRoute}
                        className="max-w-full truncate font-mono text-xs text-indigo-600 hover:text-indigo-500"
                        title={`View span ${spanId}`}
                      >
                        {spanId}
                      </Link>
                    ) : (
                      <span
                        className="max-w-full truncate font-mono text-xs text-gray-700"
                        title={spanId}
                      >
                        {spanId}
                      </span>
                    )}
                    {effectiveSpanRoute && (
                      <Icon
                        icon={IconProp.ExternalLink}
                        className="h-4 w-4 flex-none text-indigo-400"
                      />
                    )}
                  </div>
                </div>
              )}

              {sessionId && (
                <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
                  <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400">
                    <span>Session</span>
                    <CopyTextButton
                      textToBeCopied={sessionId}
                      size="xs"
                      variant="ghost"
                      iconOnly={true}
                      title="Copy session id"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {sessionRoute ? (
                      <Link
                        to={sessionRoute}
                        className="max-w-full truncate font-mono text-xs text-indigo-600 hover:text-indigo-500"
                        title={`View session replay ${sessionId}`}
                      >
                        {sessionId}
                      </Link>
                    ) : (
                      <span
                        className="max-w-full truncate font-mono text-xs text-gray-700"
                        title={sessionId}
                      >
                        {sessionId}
                      </span>
                    )}
                    {sessionRoute && (
                      <Icon
                        icon={IconProp.ExternalLink}
                        className="h-4 w-4 flex-none text-indigo-400"
                      />
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {attributeEntries.length > 0 && (
            <section className="space-y-3">
              <header className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400">
                <span>Attributes</span>
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
              <div
                className={`max-h-80 overflow-auto rounded-lg border ${surfaceCardClass}`}
              >
                <ul className="divide-y divide-gray-200">
                  {attributeEntries.map((entry: AttributeEntry) => {
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
                            <span className="italic text-gray-400">empty</span>
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
                  })}
                </ul>
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === "context" && (
        <div className="mt-4 text-sm text-gray-700">
          {traceId && (
            <div className="mb-3 inline-flex rounded-md shadow-sm" role="group">
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-l-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  contextScope === "nearby"
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
                aria-pressed={contextScope === "nearby"}
                onClick={() => {
                  handleContextScopeChange("nearby");
                }}
              >
                Nearby (service + time)
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-r-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  contextScope === "trace"
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
                aria-pressed={contextScope === "trace"}
                onClick={() => {
                  handleContextScopeChange("trace");
                }}
              >
                This trace
              </button>
            </div>
          )}
          {contextLoading && (
            <div className="flex items-center justify-center py-8 text-xs text-gray-400">
              Loading surrounding logs...
            </div>
          )}
          {contextError && (
            <div className="rounded-md bg-red-50 p-3 text-xs text-red-600">
              {contextError}
            </div>
          )}
          {!contextLoading && !contextError && contextLoaded && (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {contextBefore.length === 0 && contextAfter.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-gray-400">
                  {contextScope === "trace"
                    ? "No other logs found for this trace."
                    : "No surrounding logs found for this service."}
                </div>
              )}
              {contextBefore.map((ctxLog: ContextLog) => {
                return renderContextLogRow(ctxLog, false);
              })}
              {renderContextLogRow(
                {
                  id: props.log.getColumnValue("_id")?.toString() || "current",
                  time: props.log.time ? props.log.time.toString() : "",
                  severity: props.log.severityText?.toString() || "Unspecified",
                  body: props.log.body || "",
                  primaryEntityId: primaryEntityId,
                },
                true,
              )}
              {contextAfter.map((ctxLog: ContextLog) => {
                return renderContextLogRow(ctxLog, false);
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LogDetailsPanel;
