import React, { FunctionComponent, ReactElement, useMemo } from "react";
import Route from "Common/Types/API/Route";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import AppLink from "../../AppLink/AppLink";
import {
  formatReplayOffset,
  formatReplayOffsetPrecise,
  formatReplayWallClock,
} from "../ReplayTimeFormat";
import {
  ReplayBackendSignalKind,
  ReplayBackendSignalsSlot,
  ReplaySignal,
} from "./ReplaySignalTypes";
import {
  REPLAY_NETWORK_CAPTURE_CAP,
  REPLAY_SLOW_REQUEST_MS,
  ReplayClientErrorSignalDetail,
  ReplayConsoleSignalDetail,
  ReplayCustomSignalDetail,
  ReplayFrustrationSignalDetail,
  ReplayInteractionSignalDetail,
  ReplayLogSignalDetail,
  ReplayMarkerSignalDetail,
  ReplayNavigationSignalDetail,
  ReplayNetworkSignalDetail,
  ReplayPerformanceSignalDetail,
  ReplayServerErrorSignalDetail,
  ReplaySpanSignalDetail,
  ReplayTraceWaterfallSpan,
  buildErrorCounterpartIndex,
  findErrorAfterInteraction,
  findErrorLogsForTrace,
  formatPerformanceMeasure,
  formatSignalBytes,
  formatSignalDuration,
  formatVitalRating,
  indexTraceSignalsByTraceId,
  pairClientAndServerErrors,
} from "./ReplaySignals";

/*
 * The inline detail under a selected rail row, rendered by kind.
 *
 * Everything here comes from data the rail already holds: the signal's
 * own detail object plus cross-references into the merged list (the
 * trace that served a request, the error logs on that trace, the server
 * exception that mirrors a client error, the error that followed a
 * click). No request is made from a detail; where more data WOULD answer
 * the question (a request's backend when traces are not loaded yet) the
 * detail offers the one action that loads it, and otherwise says plainly
 * what it does not know ("bodies and headers are never recorded").
 */

export interface ReplayRailLinks {
  traceView: (traceId: string) => Route | null;
  spanView: (traceId: string, spanId: string) => Route | null;
  exceptionGroup: (fingerprint: string) => Route | null;
  /* The logs explorer scoped to this session, +-30s around the offset. */
  logsAtMoment: (offsetMs: number) => Route | null;
}

export interface ReplayRailDetailProps {
  signal: ReplaySignal;
  /* The merged list (recording + telemetry), for cross-references. */
  signals: Array<ReplaySignal>;
  /* Collapsed repeats of this row, when the list grouped them. */
  repeat?: { count: number; lastOffsetMs: number } | null | undefined;
  links: ReplayRailLinks;
  /* The Traces slot, so a request row can offer to load its backend. */
  spanSlot?: ReplayBackendSignalsSlot | null | undefined;
  onLoadBackend?: ((kind: ReplayBackendSignalKind) => void) | undefined;
  /*
   * Seek to a moment named by the detail (a waterfall span, a linked
   * error). Receives the target's own offset; the rail applies the
   * pre-roll so every seek in the product lands the same way.
   */
  onSeek: (offsetMs: number) => void;
  /* Select (and seek to) another row: the counterpart, the error after a click. */
  onSelectSignal: (signalId: string) => void;
  onShowOnStage?: ((x: number, y: number) => void) | undefined;
  /* "Logs for this trace": switch to Logs with trace:<id> in the box. */
  onFilterLogsByTrace?: ((traceId: string) => void) | undefined;
  onClose: () => void;
  startTimeUnixMs: number | null;
}

/* ---- Small building blocks. ---- */

const Fact: FunctionComponent<{
  label: string;
  children: React.ReactNode;
  mono?: boolean | undefined;
}> = (props: {
  label: string;
  children: React.ReactNode;
  mono?: boolean | undefined;
}): ReactElement => {
  return (
    <div className="flex gap-2 text-[11px] leading-5">
      <dt className="w-20 shrink-0 text-gray-400">{props.label}</dt>
      <dd
        className={`min-w-0 flex-1 break-words text-gray-700 ${
          props.mono ? "font-mono" : ""
        }`}
      >
        {props.children}
      </dd>
    </div>
  );
};

const LinkOut: FunctionComponent<{
  route: Route | null;
  label: string;
  testId?: string | undefined;
}> = (props: {
  route: Route | null;
  label: string;
  testId?: string | undefined;
}): ReactElement | null => {
  if (!props.route) {
    return null;
  }

  return (
    <AppLink
      to={props.route}
      className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
    >
      <span data-testid={props.testId}>{props.label}</span>
      <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
    </AppLink>
  );
};

const ActionButton: FunctionComponent<{
  label: string;
  onClick: () => void;
  testId?: string | undefined;
  icon?: IconProp | undefined;
}> = (props: {
  label: string;
  onClick: () => void;
  testId?: string | undefined;
  icon?: IconProp | undefined;
}): ReactElement => {
  return (
    <button
      type="button"
      data-testid={props.testId}
      className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
      onClick={props.onClick}
    >
      {props.icon && <Icon icon={props.icon} className="h-3 w-3" />}
      {props.label}
    </button>
  );
};

const Note: FunctionComponent<{ children: React.ReactNode }> = (props: {
  children: React.ReactNode;
}): ReactElement => {
  return <p className="text-[11px] text-gray-500">{props.children}</p>;
};

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/* ---- Per-kind bodies. ---- */

const ConsoleDetail: FunctionComponent<{ signal: ReplaySignal }> = (props: {
  signal: ReplaySignal;
}): ReactElement => {
  const detail: ReplayConsoleSignalDetail = props.signal
    .detail as ReplayConsoleSignalDetail;

  return (
    <div className="space-y-2">
      <dl>
        <Fact label="Level">{detail.level || "log"}</Fact>
      </dl>
      <CodeBlock
        code={detail.message || "(empty message)"}
        language="plaintext"
        maxHeight="12rem"
      />
    </div>
  );
};

const BackendForRequest: FunctionComponent<{
  traceId: string;
  signals: Array<ReplaySignal>;
  spanSlot: ReplayBackendSignalsSlot | null | undefined;
  onLoadBackend: ((kind: ReplayBackendSignalKind) => void) | undefined;
  onSelectSignal: (signalId: string) => void;
}> = (props: {
  traceId: string;
  signals: Array<ReplaySignal>;
  spanSlot: ReplayBackendSignalsSlot | null | undefined;
  onLoadBackend: ((kind: ReplayBackendSignalKind) => void) | undefined;
  onSelectSignal: (signalId: string) => void;
}): ReactElement => {
  const traceSignal: ReplaySignal | undefined = useMemo(() => {
    return indexTraceSignalsByTraceId(props.signals).get(props.traceId);
  }, [props.signals, props.traceId]);

  const errorLogs: Array<ReplaySignal> = useMemo(() => {
    return findErrorLogsForTrace(props.signals, props.traceId);
  }, [props.signals, props.traceId]);

  const status: ReplayBackendSignalsSlot["status"] | "unknown" =
    props.spanSlot?.status || "unknown";

  let body: ReactElement;

  if (traceSignal) {
    const trace: ReplaySpanSignalDetail =
      traceSignal.detail as ReplaySpanSignalDetail;

    body = (
      <dl data-testid="rail-backend-block">
        <Fact label="Root span" mono={true}>
          {trace.rootName}
        </Fact>
        {trace.serviceName && <Fact label="Service">{trace.serviceName}</Fact>}
        <Fact label="Duration">{formatSignalDuration(trace.durationMs)}</Fact>
        <Fact label="Status">
          {trace.hasError
            ? `error in ${trace.errorSpanCount} of ${trace.spanCount} spans`
            : "ok"}
        </Fact>
        <Fact label="Spans">
          {trace.spanCount}
          <button
            type="button"
            className="ml-2 text-indigo-600 hover:underline"
            onClick={(): void => {
              props.onSelectSignal(traceSignal.id);
            }}
          >
            open the waterfall
          </button>
        </Fact>
        {errorLogs.length > 0 && (
          <Fact label="Error logs">
            <ul className="space-y-0.5">
              {errorLogs.slice(0, 5).map((log: ReplaySignal): ReactElement => {
                return (
                  <li key={log.id}>
                    <button
                      type="button"
                      className="truncate text-left text-rose-700 hover:underline"
                      title={log.title}
                      onClick={(): void => {
                        props.onSelectSignal(log.id);
                      }}
                    >
                      {formatReplayOffset(log.offsetMs)} {log.title}
                    </button>
                  </li>
                );
              })}
              {errorLogs.length > 5 && (
                <li className="text-gray-400">
                  and {errorLogs.length - 5} more on this trace
                </li>
              )}
            </ul>
          </Fact>
        )}
      </dl>
    );
  } else if (status === "idle" || status === "unknown") {
    body = (
      <div className="flex items-center gap-2">
        <Note>Backend traces are not loaded yet.</Note>
        {props.onLoadBackend && (
          <ActionButton
            label="Load backend traces"
            testId="rail-load-traces"
            onClick={(): void => {
              props.onLoadBackend?.("span");
            }}
          />
        )}
      </div>
    );
  } else if (status === "loading") {
    body = <Note>Loading backend traces for this session.</Note>;
  } else if (status === "locked") {
    body = (
      <Note>
        Backend traces are locked
        {props.spanSlot?.lockedPermission
          ? `: your role lacks "${props.spanSlot.lockedPermission}"`
          : ""}
        .
      </Note>
    );
  } else if (status === "error") {
    body = (
      <Note>
        {props.spanSlot?.errorMessage || "Backend traces did not load."}
      </Note>
    );
  } else {
    body = (
      <Note>
        No span in the loaded traces carries trace {shortId(props.traceId)}; the
        backend either did not receive the traceparent or has not exported the
        span yet.
      </Note>
    );
  }

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-2">
      <div className="mb-1 text-[11px] font-semibold text-gray-700">
        Backend for this request
      </div>
      {body}
    </div>
  );
};

const NetworkDetail: FunctionComponent<{
  signal: ReplaySignal;
  signals: Array<ReplaySignal>;
  links: ReplayRailLinks;
  spanSlot: ReplayBackendSignalsSlot | null | undefined;
  onLoadBackend: ((kind: ReplayBackendSignalKind) => void) | undefined;
  onSelectSignal: (signalId: string) => void;
}> = (props: {
  signal: ReplaySignal;
  signals: Array<ReplaySignal>;
  links: ReplayRailLinks;
  spanSlot: ReplayBackendSignalsSlot | null | undefined;
  onLoadBackend: ((kind: ReplayBackendSignalKind) => void) | undefined;
  onSelectSignal: (signalId: string) => void;
}): ReactElement => {
  const detail: ReplayNetworkSignalDetail = props.signal
    .detail as ReplayNetworkSignalDetail;

  /*
   * The cap marker is not a request: it carries no method, url or timing,
   * and rendering the request facts for it printed a row of blanks.
   */
  if (detail.isCapMarker) {
    return (
      <Note>
        The recorder records at most {REPLAY_NETWORK_CAPTURE_CAP} requests per
        session. It reached that here, so requests after this moment are missing
        from the Network tab - the page kept making them.
      </Note>
    );
  }

  /*
   * The timing bar: full width is the slow threshold (1s), so a 220ms
   * request reads as a fifth of the bar and anything past 1s fills it.
   */
  const barPercent: number | null = isFiniteNumber(detail.durationMs)
    ? Math.min(
        100,
        Math.max(2, (detail.durationMs / REPLAY_SLOW_REQUEST_MS) * 100),
      )
    : null;
  /* Cancelled is neither green (it never finished) nor red (nothing failed). */
  const barClass: string = detail.aborted
    ? "bg-gray-400"
    : detail.isSlow
      ? "bg-orange-400"
      : props.signal.severity === "error"
        ? "bg-rose-400"
        : props.signal.severity === "warn"
          ? "bg-amber-400"
          : "bg-emerald-400";

  return (
    <div className="space-y-2">
      <dl>
        <Fact label="Request" mono={true}>
          {detail.method}{" "}
          {detail.origin && (
            <span className="text-gray-400">{detail.origin}</span>
          )}
          <span className="text-gray-900">{detail.path || detail.url}</span>
        </Fact>
        <Fact label="Status">
          {detail.aborted
            ? "cancelled by the page before a response (AbortController, or navigating away) - not a failure"
            : detail.failedBeforeResponse
              ? "failed before a response (offline, DNS or blocked by CORS)"
              : `HTTP ${detail.status}`}
        </Fact>
        <Fact label="Timing">
          {barPercent !== null && isFiniteNumber(detail.durationMs) ? (
            <div className="flex items-center gap-2">
              <div
                className="h-1.5 w-32 overflow-hidden rounded bg-gray-200"
                aria-hidden="true"
              >
                <div
                  className={`h-full ${barClass}`}
                  style={{ width: `${barPercent}%` }}
                />
              </div>
              <span>
                {formatSignalDuration(detail.durationMs)}
                {detail.isSlow ? " (slow)" : ""}
              </span>
            </div>
          ) : (
            "not measured"
          )}
        </Fact>
        <Fact label="Bytes">
          {isFiniteNumber(detail.responseBytes)
            ? `${formatSignalBytes(detail.responseBytes)} response`
            : "response size not measured"}
          {isFiniteNumber(detail.requestBytes)
            ? `, ${formatSignalBytes(detail.requestBytes)} request`
            : ""}
        </Fact>
        {detail.initiator && <Fact label="Initiator">{detail.initiator}</Fact>}
        {detail.traceId && (
          <Fact label="Trace" mono={true}>
            {detail.traceId}
          </Fact>
        )}
      </dl>

      <Note>Bodies and headers are never recorded.</Note>

      {detail.traceId && (
        <div className="flex flex-wrap gap-1.5">
          <LinkOut
            route={props.links.traceView(detail.traceId)}
            label="Open trace"
            testId="rail-link-trace"
          />
        </div>
      )}

      {detail.traceId && (
        <BackendForRequest
          traceId={detail.traceId}
          signals={props.signals}
          spanSlot={props.spanSlot}
          onLoadBackend={props.onLoadBackend}
          onSelectSignal={props.onSelectSignal}
        />
      )}
    </div>
  );
};

const NavigationDetail: FunctionComponent<{
  signal: ReplaySignal;
  signals: Array<ReplaySignal>;
  onSelectSignal: (signalId: string) => void;
}> = (props: {
  signal: ReplaySignal;
  signals: Array<ReplaySignal>;
  onSelectSignal: (signalId: string) => void;
}): ReactElement => {
  const detail: ReplayNavigationSignalDetail = props.signal
    .detail as ReplayNavigationSignalDetail;

  /*
   * The vitals for THIS page: performance rows between this navigation
   * and the next one, joined by time because the recorder reports a
   * vital once the page settles, not at the moment of the route change.
   */
  const vitals: Array<ReplaySignal> = useMemo(() => {
    const nextNavigation: ReplaySignal | undefined = props.signals.find(
      (candidate: ReplaySignal): boolean => {
        return (
          candidate.kind === "navigation" &&
          candidate.offsetMs > props.signal.offsetMs
        );
      },
    );
    const endMs: number = nextNavigation
      ? nextNavigation.offsetMs
      : Number.POSITIVE_INFINITY;

    return props.signals.filter((candidate: ReplaySignal): boolean => {
      return (
        candidate.kind === "performance" &&
        candidate.offsetMs >= props.signal.offsetMs &&
        candidate.offsetMs < endMs
      );
    });
  }, [props.signals, props.signal]);

  const kindLabel: string =
    detail.kind === "full-load"
      ? "full page load"
      : detail.kind === "popstate"
        ? "back / forward"
        : detail.kind === "hashchange"
          ? "hash change"
          : `history ${detail.kind}`;

  return (
    <dl>
      {detail.from && (
        <Fact label="From" mono={true}>
          {detail.from}
        </Fact>
      )}
      <Fact label="To" mono={true}>
        {detail.to}
      </Fact>
      <Fact label="Kind">{kindLabel}</Fact>
      {isFiniteNumber(detail.viewportWidth) &&
        isFiniteNumber(detail.viewportHeight) && (
          <Fact label="Viewport">
            {detail.viewportWidth}x{detail.viewportHeight}
          </Fact>
        )}
      <Fact label="Vitals">
        {vitals.length === 0 ? (
          "none reported for this page yet"
        ) : (
          <ul className="space-y-0.5">
            {vitals.map((vital: ReplaySignal): ReactElement => {
              return (
                <li key={vital.id}>
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={(): void => {
                      props.onSelectSignal(vital.id);
                    }}
                  >
                    {vital.title}
                    {vital.subtitle ? ` ${vital.subtitle}` : ""}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Fact>
    </dl>
  );
};

const InteractionDetail: FunctionComponent<{
  signal: ReplaySignal;
  signals: Array<ReplaySignal>;
  onSelectSignal: (signalId: string) => void;
  onShowOnStage: ((x: number, y: number) => void) | undefined;
}> = (props: {
  signal: ReplaySignal;
  signals: Array<ReplaySignal>;
  onSelectSignal: (signalId: string) => void;
  onShowOnStage: ((x: number, y: number) => void) | undefined;
}): ReactElement => {
  const isFrustration: boolean = props.signal.kind === "frustration";
  const interaction: ReplayInteractionSignalDetail = props.signal
    .detail as ReplayInteractionSignalDetail;
  const frustration: ReplayFrustrationSignalDetail = props.signal
    .detail as ReplayFrustrationSignalDetail;
  const x: number | null = isFiniteNumber(props.signal.detail["x"])
    ? (props.signal.detail["x"] as number)
    : null;
  const y: number | null = isFiniteNumber(props.signal.detail["y"])
    ? (props.signal.detail["y"] as number)
    : null;

  const errorAfter: ReplaySignal | null = useMemo(() => {
    return findErrorAfterInteraction(props.signals, props.signal);
  }, [props.signals, props.signal]);

  return (
    <div className="space-y-2">
      <dl>
        {isFrustration && (
          <Fact label="Signal">
            {frustration.kind === "rage-click"
              ? `rage click${
                  isFiniteNumber(frustration.clickCount)
                    ? `, ${frustration.clickCount} clicks`
                    : ""
                }`
              : frustration.kind === "dead-click"
                ? "dead click: nothing changed after it"
                : frustration.kind === "error-click"
                  ? "error click: an error followed it"
                  : frustration.kind === "refresh-rage"
                    ? `refresh rage${
                        isFiniteNumber(frustration.reloadCount)
                          ? `, ${frustration.reloadCount} reloads`
                          : ""
                      }`
                    : frustration.kind}
          </Fact>
        )}
        {!isFrustration && interaction.selector && (
          <Fact label="Selector" mono={true}>
            {interaction.selector}
          </Fact>
        )}
        {!isFrustration && interaction.text && (
          <Fact label="Text">{interaction.text}</Fact>
        )}
        {x !== null && y !== null && (
          <Fact label="Position">
            {x}, {y}
          </Fact>
        )}
        {!isFrustration && interaction.isCoordinateOnly && (
          <Fact label="Note">
            This recording predates click labels; only the coordinates were
            captured.
          </Fact>
        )}
        {errorAfter && (
          <Fact label="Then">
            <button
              type="button"
              className="text-left text-rose-700 hover:underline"
              data-testid="rail-error-after-click"
              onClick={(): void => {
                props.onSelectSignal(errorAfter.id);
              }}
            >
              error{" "}
              {formatSignalDuration(
                errorAfter.offsetMs - props.signal.offsetMs,
              )}{" "}
              after this click: {errorAfter.title}
            </button>
          </Fact>
        )}
      </dl>

      {props.onShowOnStage && x !== null && y !== null && (
        <ActionButton
          label="Show on stage"
          testId="rail-show-on-stage"
          icon={IconProp.CursorArrowRays}
          onClick={(): void => {
            props.onShowOnStage?.(x, y);
          }}
        />
      )}
    </div>
  );
};

const PerformanceDetail: FunctionComponent<{ signal: ReplaySignal }> = (props: {
  signal: ReplaySignal;
}): ReactElement => {
  const detail: ReplayPerformanceSignalDetail = props.signal
    .detail as ReplayPerformanceSignalDetail;

  return (
    <dl>
      {/* Never the raw enum: "long-task" is a wire value, not a word. */}
      <Fact label="Measure">{formatPerformanceMeasure(detail)}</Fact>
      {isFiniteNumber(detail.value) && (
        <Fact label="Value">
          {detail.metric === "CLS"
            ? detail.value
            : formatSignalDuration(detail.value)}
        </Fact>
      )}
      {isFiniteNumber(detail.durationMs) && (
        <Fact label="Duration">{formatSignalDuration(detail.durationMs)}</Fact>
      )}
      {isFiniteNumber(detail.budgetMs) && (
        <Fact label="Budget">
          {formatSignalDuration(detail.budgetMs)}
          {detail.isOverBudget ? " (over)" : " (within)"}
        </Fact>
      )}
      {detail.rating && (
        <Fact label="Rating">{formatVitalRating(detail.rating)}</Fact>
      )}
      {detail.url && (
        <Fact label="URL" mono={true}>
          {detail.url}
        </Fact>
      )}
    </dl>
  );
};

/*
 * The error kinds in words. "resource" and "unhandledrejection" are wire
 * values; the detail used to print whichever one it did not recognise.
 */
const CLIENT_ERROR_KIND_COPY: Record<
  ReplayClientErrorSignalDetail["kind"],
  string
> = {
  error: "uncaught error",
  unhandledrejection: "unhandled promise rejection",
  resource: "resource failed to load",
  unknown: "error",
};

const ErrorDetail: FunctionComponent<{
  signal: ReplaySignal;
  signals: Array<ReplaySignal>;
  links: ReplayRailLinks;
  onSelectSignal: (signalId: string) => void;
}> = (props: {
  signal: ReplaySignal;
  signals: Array<ReplaySignal>;
  links: ReplayRailLinks;
  onSelectSignal: (signalId: string) => void;
}): ReactElement => {
  const isClient: boolean = props.signal.kind === "client-error";
  const client: ReplayClientErrorSignalDetail = props.signal
    .detail as ReplayClientErrorSignalDetail;
  const server: ReplayServerErrorSignalDetail = props.signal
    .detail as ReplayServerErrorSignalDetail;

  const counterpart: ReplaySignal | null = useMemo(() => {
    const index: Map<string, string> = buildErrorCounterpartIndex(
      pairClientAndServerErrors(props.signals),
    );
    const counterpartId: string | undefined = index.get(props.signal.id);

    if (!counterpartId) {
      return null;
    }

    return (
      props.signals.find((candidate: ReplaySignal): boolean => {
        return candidate.id === counterpartId;
      }) || null
    );
  }, [props.signals, props.signal.id]);

  /*
   * A client error has no fingerprint of its own; when the server saw the
   * same failure, its group is the right place to send the viewer.
   */
  const fingerprint: string | null = isClient
    ? counterpart
      ? (counterpart.detail as ReplayServerErrorSignalDetail).fingerprint
      : null
    : server.fingerprint;
  const traceId: string | null = props.signal.links.traceId || null;
  const stack: string | null = isClient ? client.stack : server.stackTrace;

  return (
    <div className="space-y-2">
      <dl>
        {isClient && client.kind && !client.isCapMarker && (
          <Fact label="Kind">{CLIENT_ERROR_KIND_COPY[client.kind]}</Fact>
        )}
        {isClient && client.isCapMarker && (
          <Fact label="Kind">recorder notice</Fact>
        )}
        {!isClient && server.exceptionType && (
          <Fact label="Type" mono={true}>
            {server.exceptionType}
          </Fact>
        )}
        <Fact label="Message">
          {isClient ? client.message : server.message}
        </Fact>
        {isClient && client.kind === "resource" && client.tagName && (
          <Fact label="Element" mono={true}>
            &lt;{client.tagName}&gt;
          </Fact>
        )}
        {isClient && client.isRepeat && (
          <Fact label="Repeats">
            {client.occurrences !== null
              ? `seen ${client.occurrences} times so far this session`
              : "seen again after its first occurrence"}
          </Fact>
        )}
        {isClient && client.location && (
          <Fact label="Location" mono={true}>
            {client.location}
          </Fact>
        )}
        {isClient && !client.location && client.source && (
          <Fact label="Source" mono={true}>
            {client.source}
          </Fact>
        )}
        {!isClient && server.serviceName && (
          <Fact label="Service">{server.serviceName}</Fact>
        )}
        {!isClient && server.spanName && (
          <Fact label="Span" mono={true}>
            {server.spanName}
          </Fact>
        )}
        {counterpart && (
          <Fact label="Also">
            <button
              type="button"
              className="text-left text-indigo-700 hover:underline"
              data-testid="rail-error-counterpart"
              onClick={(): void => {
                props.onSelectSignal(counterpart.id);
              }}
            >
              {isClient
                ? "also reported server-side"
                : "also seen in the browser"}{" "}
              at {formatReplayOffsetPrecise(counterpart.offsetMs)}
            </button>
          </Fact>
        )}
      </dl>

      {isClient && client.isCapMarker ? (
        <Note>
          The recorder stopped recording new errors at its per-session cap;
          errors after this point are missing from this tab, and this row marks
          where that happened.
        </Note>
      ) : stack ? (
        <CodeBlock code={stack} language="plaintext" maxHeight="14rem" />
      ) : (
        <Note>
          {!isClient
            ? "No stack trace was reported with this exception."
            : client.kind === "resource"
              ? "A failed resource load has no stack: the element and its URL are all the browser reports. It is not counted as an error, so Next error steps past it."
              : "No stack trace reached the recorder for this error (cross-origin scripts hide theirs)."}
        </Note>
      )}

      <div className="flex flex-wrap gap-1.5">
        {fingerprint && (
          <LinkOut
            route={props.links.exceptionGroup(fingerprint)}
            label="Open exception group"
            testId="rail-link-exception-group"
          />
        )}
        {traceId && (
          <LinkOut
            route={props.links.traceView(traceId)}
            label="Open trace"
            testId="rail-link-trace"
          />
        )}
      </div>
    </div>
  );
};

const LogDetail: FunctionComponent<{
  signal: ReplaySignal;
  links: ReplayRailLinks;
  onFilterLogsByTrace: ((traceId: string) => void) | undefined;
}> = (props: {
  signal: ReplaySignal;
  links: ReplayRailLinks;
  onFilterLogsByTrace: ((traceId: string) => void) | undefined;
}): ReactElement => {
  const detail: ReplayLogSignalDetail = props.signal
    .detail as ReplayLogSignalDetail;

  return (
    <div className="space-y-2">
      <CodeBlock
        code={detail.body || "(empty log line)"}
        language="plaintext"
        maxHeight="12rem"
      />
      <dl>
        {detail.level && <Fact label="Level">{detail.level}</Fact>}
        {detail.serviceName && (
          <Fact label="Service">{detail.serviceName}</Fact>
        )}
        {detail.traceId && (
          <Fact label="Trace" mono={true}>
            {detail.traceId}
          </Fact>
        )}
        {detail.spanId && (
          <Fact label="Span" mono={true}>
            {detail.spanId}
          </Fact>
        )}
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <LinkOut
          route={props.links.logsAtMoment(props.signal.offsetMs)}
          label="Open in Logs explorer at this moment"
          testId="rail-link-logs-at-moment"
        />
        {detail.traceId && (
          <LinkOut
            route={props.links.traceView(detail.traceId)}
            label="Open trace"
            testId="rail-link-trace"
          />
        )}
        {detail.traceId && detail.spanId && (
          <LinkOut
            route={props.links.spanView(detail.traceId, detail.spanId)}
            label="Open span"
            testId="rail-link-span"
          />
        )}
        {detail.traceId && props.onFilterLogsByTrace && (
          <ActionButton
            label="Logs for this trace"
            testId="rail-logs-for-trace"
            onClick={(): void => {
              props.onFilterLogsByTrace?.(detail.traceId as string);
            }}
          />
        )}
      </div>
    </div>
  );
};

const TraceDetail: FunctionComponent<{
  signal: ReplaySignal;
  links: ReplayRailLinks;
  onSeek: (offsetMs: number) => void;
  onFilterLogsByTrace: ((traceId: string) => void) | undefined;
}> = (props: {
  signal: ReplaySignal;
  links: ReplayRailLinks;
  onSeek: (offsetMs: number) => void;
  onFilterLogsByTrace: ((traceId: string) => void) | undefined;
}): ReactElement => {
  const detail: ReplaySpanSignalDetail = props.signal
    .detail as ReplaySpanSignalDetail;
  const totalMs: number = Math.max(
    1,
    detail.durationMs,
    ...detail.spans.map((span: ReplayTraceWaterfallSpan): number => {
      return span.startOffsetMs + span.durationMs;
    }),
  );

  return (
    <div className="space-y-2">
      <dl>
        {detail.serviceName && (
          <Fact label="Service">{detail.serviceName}</Fact>
        )}
        <Fact label="Duration">{formatSignalDuration(detail.durationMs)}</Fact>
        <Fact label="Status">
          {detail.hasError
            ? `error in ${detail.errorSpanCount} of ${detail.spanCount} spans`
            : "ok"}
        </Fact>
        <Fact label="Trace" mono={true}>
          {detail.traceId}
        </Fact>
      </dl>

      <div
        className="space-y-px"
        role="list"
        aria-label="Trace waterfall"
        data-testid="rail-waterfall"
      >
        {detail.spans.map((span: ReplayTraceWaterfallSpan): ReactElement => {
          const leftPercent: number = Math.min(
            99,
            Math.max(0, (span.startOffsetMs / totalMs) * 100),
          );
          const widthPercent: number = Math.max(
            1,
            Math.min(100 - leftPercent, (span.durationMs / totalMs) * 100),
          );

          return (
            <div
              key={span.spanId}
              role="listitem"
              data-testid="rail-waterfall-span"
              data-depth={span.depth}
              className="flex items-center gap-2 rounded hover:bg-gray-50"
              style={{ paddingLeft: `${span.depth * 10}px` }}
            >
              <button
                type="button"
                className={`min-w-0 flex-1 truncate text-left font-mono text-[11px] ${
                  span.hasError ? "text-rose-700" : "text-gray-700"
                }`}
                title={`Seek to ${formatReplayOffsetPrecise(span.sessionOffsetMs)}`}
                aria-label={`Seek to span ${span.name} at ${formatReplayOffsetPrecise(
                  span.sessionOffsetMs,
                )}`}
                onClick={(): void => {
                  props.onSeek(span.sessionOffsetMs);
                }}
              >
                {span.name}
                {span.serviceName ? (
                  <span className="text-gray-400"> {span.serviceName}</span>
                ) : null}
              </button>
              <div
                className="relative h-1.5 w-24 shrink-0 rounded bg-gray-100"
                aria-hidden="true"
              >
                <div
                  className={`absolute top-0 h-full rounded ${
                    span.hasError ? "bg-rose-400" : "bg-indigo-400"
                  }`}
                  style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right font-mono text-[10px] text-gray-400">
                {formatSignalDuration(span.durationMs)}
              </span>
              <LinkOut
                route={props.links.spanView(detail.traceId, span.spanId)}
                label="open"
              />
            </div>
          );
        })}
      </div>

      {detail.isWaterfallTruncated && (
        <Note>
          Showing the first {detail.spans.length} of {detail.spanCount} spans;
          open the trace for the rest.
        </Note>
      )}

      <div className="flex flex-wrap gap-1.5">
        <LinkOut
          route={props.links.traceView(detail.traceId)}
          label="Open trace"
          testId="rail-link-trace"
        />
        {props.onFilterLogsByTrace && (
          <ActionButton
            label="Logs for this trace"
            testId="rail-logs-for-trace"
            onClick={(): void => {
              props.onFilterLogsByTrace?.(detail.traceId);
            }}
          />
        )}
      </div>
    </div>
  );
};

const CustomDetail: FunctionComponent<{ signal: ReplaySignal }> = (props: {
  signal: ReplaySignal;
}): ReactElement => {
  const detail: ReplayCustomSignalDetail = props.signal
    .detail as ReplayCustomSignalDetail;
  const keys: Array<string> = Object.keys(detail.properties || {});

  return (
    <dl>
      <Fact label="Event" mono={true}>
        {detail.name}
      </Fact>
      {keys.length === 0 ? (
        <Fact label="Properties">none</Fact>
      ) : (
        keys.map((key: string): ReactElement => {
          return (
            <Fact key={key} label={key} mono={true}>
              {detail.properties[key]}
            </Fact>
          );
        })
      )}
      {detail.propertyCount > keys.length && (
        <Fact label="Note">
          {detail.propertyCount - keys.length} more properties were not captured
          (per-event cap).
        </Fact>
      )}
    </dl>
  );
};

const MarkerDetail: FunctionComponent<{ signal: ReplaySignal }> = (props: {
  signal: ReplaySignal;
}): ReactElement => {
  const detail: ReplayMarkerSignalDetail = props.signal
    .detail as ReplayMarkerSignalDetail;

  switch (detail.markerKind) {
    case "visibility":
      return (
        <Note>
          The tab went {detail.visibilityState || "to another state"}; nothing
          is drawn while it is in the background.
        </Note>
      );
    case "identify":
      return (
        <Note>
          The page identified its user here
          {detail.hasTraits ? " with traits" : ""}; see Details for the label.
        </Note>
      );
    case "tags":
      return (
        <dl>
          {Object.keys(detail.tags || {}).map((key: string): ReactElement => {
            return (
              <Fact key={key} label={key} mono={true}>
                {(detail.tags as Record<string, string>)[key]}
              </Fact>
            );
          })}
        </dl>
      );
    case "click-dropped":
      return (
        <Note>
          {detail.droppedCount ?? "Some"} clicks in this chunk were not
          labelled: the per-chunk click cap was reached.
        </Note>
      );
    case "custom-dropped":
      return (
        <Note>
          {detail.droppedCount ?? "Some"} custom events in this chunk were
          dropped: the per-chunk cap was reached.
        </Note>
      );
    default:
      return <Note>{props.signal.title}</Note>;
  }
};

/* ---- The detail shell. ---- */

const ReplayRailDetail: FunctionComponent<ReplayRailDetailProps> = (
  props: ReplayRailDetailProps,
): ReactElement => {
  const signal: ReplaySignal = props.signal;
  const wallClock: string | null = formatReplayWallClock(
    props.startTimeUnixMs,
    signal.offsetMs,
  );

  let body: ReactElement;

  switch (signal.kind) {
    case "console":
      body = <ConsoleDetail signal={signal} />;
      break;
    case "network":
      body = (
        <NetworkDetail
          signal={signal}
          signals={props.signals}
          links={props.links}
          spanSlot={props.spanSlot}
          onLoadBackend={props.onLoadBackend}
          onSelectSignal={props.onSelectSignal}
        />
      );
      break;
    case "navigation":
      body = (
        <NavigationDetail
          signal={signal}
          signals={props.signals}
          onSelectSignal={props.onSelectSignal}
        />
      );
      break;
    case "interaction":
    case "frustration":
      body = (
        <InteractionDetail
          signal={signal}
          signals={props.signals}
          onSelectSignal={props.onSelectSignal}
          onShowOnStage={props.onShowOnStage}
        />
      );
      break;
    case "performance":
      body = <PerformanceDetail signal={signal} />;
      break;
    case "client-error":
    case "server-error":
      body = (
        <ErrorDetail
          signal={signal}
          signals={props.signals}
          links={props.links}
          onSelectSignal={props.onSelectSignal}
        />
      );
      break;
    case "log":
      body = (
        <LogDetail
          signal={signal}
          links={props.links}
          onFilterLogsByTrace={props.onFilterLogsByTrace}
        />
      );
      break;
    case "span":
      body = (
        <TraceDetail
          signal={signal}
          links={props.links}
          onSeek={props.onSeek}
          onFilterLogsByTrace={props.onFilterLogsByTrace}
        />
      );
      break;
    case "custom":
      body = <CustomDetail signal={signal} />;
      break;
    default:
      body = <MarkerDetail signal={signal} />;
      break;
  }

  return (
    <div data-testid="rail-detail" data-signal-kind={signal.kind}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[11px] text-gray-500">
          at {formatReplayOffsetPrecise(signal.offsetMs)}
          {wallClock ? ` (${wallClock})` : ""}
          {signal.alignment === "unanchored"
            ? " · server-stamped, unanchored"
            : signal.alignment === "anchored"
              ? " · anchored to the recording via traces"
              : ""}
          {props.repeat && props.repeat.count > 1
            ? ` · repeated ${props.repeat.count} times until ${formatReplayOffset(
                props.repeat.lastOffsetMs,
              )}`
            : ""}
        </div>
        <button
          type="button"
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close detail"
          onClick={props.onClose}
        >
          <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
        </button>
      </div>
      {body}
    </div>
  );
};

export default ReplayRailDetail;
