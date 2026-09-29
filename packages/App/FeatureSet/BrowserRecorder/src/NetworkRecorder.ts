/*
 * fetch and XMLHttpRequest instrumentation.
 *
 * Three jobs: the 5xx upload trigger, the trace context that ties a
 * recording to the backend telemetry it produced, and the "was the page
 * doing anything at all" signal the dead-click detector needs.
 *
 * What is recorded: method, scrubbed URL, status, duration, request and
 * response SIZE in bytes, which primitive issued it, and whether the page
 * aborted it. What is never recorded: request or response bodies, and the
 * Authorization and Cookie headers - never recorded or inspected; a
 * request's headers are copied only to re-send it with traceparent /
 * tracestate added. A body is measured for its byte length only, and only
 * for shapes whose length can be read without consuming them.
 *
 * What is ADDED to the page's requests, and only ever these two headers:
 *
 * - Same-origin (the application's "Same-origin trace propagation" policy,
 *   on by default, and only while the session is uploading): a
 *   `traceparent`, unless the request has one or a tracer inside our
 *   wrapper will add one, and `tracestate: oneuptime=sid:<session id>`,
 *   unless the request has a tracestate. Never to a POST to an
 *   OpenTelemetry export path (see OTLP_EXPORT_PATH). A same-origin
 *   request is never CORS-preflighted, so no allowlist is needed, and a
 *   stock OpenTelemetry backend carries tracestate onto every span it
 *   exports - which is how ingest stamps backend spans with the session
 *   without customer code.
 * - Origins the customer listed in Trace propagation origins: a
 *   `traceparent` only, exactly as before; each entry is a statement that
 *   the API behind it allows that one header cross-origin.
 *
 * Patching global network primitives on someone else's page is the riskiest
 * thing this recorder does, so every wrapper calls through to the original,
 * never swallows a rejection, and sends the page's own arguments untouched
 * whenever adding a header could not be done safely.
 */

import { SessionReplayCustomEventTag } from "Common/Types/Rum/SessionReplayCustomEvents";
import { buildSessionTraceStateMember } from "Common/Utils/Rum/SessionTraceState";
import { utf8ByteLength } from "./Chunker";
import { debugLog, debugWarn } from "./Debug";

export const NETWORK_CUSTOM_EVENT_TAG: string =
  SessionReplayCustomEventTag.Network;

/*
 * Per-SESSION cap so a polling app cannot fill the payload with network
 * rows. Reset by resetForNewSession() when the recorder rolls the session
 * over: a rotated session is a fresh recording and earns a fresh budget.
 */
export const MAX_REQUESTS_RECORDED: number = 500;

/* W3C traceparent: 00-<32 hex trace id>-<16 hex span id>-<2 hex flags>. */
const TRACEPARENT_PATTERN: RegExp =
  /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i;

/* An http(s) origin; everything else ("null", "file://") has none to share. */
const HTTP_ORIGIN_PATTERN: RegExp = /^https?:\/\//i;

/*
 * The only session id shape a header may carry. The id comes from
 * localStorage, which any script on the page can write, and a value with a
 * ',' or '=' in it would add tracestate members of its own.
 */
const SESSION_ID_PATTERN: RegExp = /^[0-9a-f]{32}$/;

/*
 * The paths an OpenTelemetry exporter posts to (OTLP/HTTP). A page that
 * proxies its browser exporter through its own origin must not have those
 * requests annotated: each export would become a forced-sampled backend
 * trace stamped with the session, filling the replay's Traces tab with the
 * telemetry pipeline's own traffic. An OTLP/HTTP export is always a POST,
 * so only a POST is skipped: a GET /api/v1/logs is the app's own endpoint
 * (an audit-log page), and its backend spans should link like any other.
 */
const OTLP_EXPORT_PATH: RegExp = /\/v1\/(traces|logs|metrics)\/?$/;

/*
 * The fields the agent checks below read. Any of them may be missing or
 * shaped differently at runtime; that throws inside the caller's try, and a
 * check that throws is a no.
 */
interface AgentGlobal {
  getInitConfiguration: () => { allowedTracingUrls: Array<unknown> };
  getInternalContext: () => unknown;
  init: { distributed_tracing: { enabled: unknown } };
  initializedAgents: Record<string, AgentGlobal>;
  isActive: () => unknown;
  serviceFactory: {
    getService: (name: string) => { get: (key: string) => unknown };
  };
}

interface TracingUrlOption {
  match?: unknown;
  propagatorTypes?: Array<string> | null;
}

/*
 * Browser agents that put their own traceparent on same-origin requests
 * without wrapping fetch the shimmer way (see isInstrumented). Adding ours
 * as well would give an XHR two traceparent values, which no backend can
 * parse, so the recorder stands down on traceparent for one of them - but
 * only while it is configured to trace THIS request. Each defines its global
 * whether or not it traces, and a request left to an agent that adds no
 * traceparent reaches the backend with a tracestate alone, which no W3C
 * propagator reads: nothing links. Each check gets the agent's global and
 * the request's absolute URL, and is asked at request time, because agents
 * load and initialise late.
 */
type AgentCheck = (agent: AgentGlobal, href: string) => unknown;

const PROPAGATING_AGENTS: Array<[string, AgentCheck]> = [
  /*
   * Datadog RUM traces only the URLs in allowedTracingUrls (empty by
   * default), matched its own way - a string by prefix, a RegExp by test, a
   * function by calling it, an entry that throws skipped - and the FIRST
   * matching entry's propagatorTypes (absent: the default, which includes
   * tracecontext) decide whether a traceparent goes out. The async stub and
   * an SDK not yet initialised have no config, and have patched nothing.
   *
   * And only for a session it tracks. The init configuration is readable
   * whether or not Datadog started, but its tracer injects nothing before
   * start, before consent (trackingConsent "not-granted"), after a failed
   * init, or for a session sessionSampleRate left untracked - exactly the
   * cases where getInternalContext() is undefined (and the stub has none).
   *
   * A tracked session that traceSampleRate leaves out (under the default
   * traceContextInjection "sampled") gets no traceparent from Datadog
   * either. Datadog decides that per session from a hash of its id; that
   * is not replicated here, so the recorder stands down for it too and
   * such a request does not link. Guessing wrong the other way would put
   * two traceparent values on an XHR, which breaks the page's request.
   */
  [
    "DD_RUM",
    (agent: AgentGlobal, href: string): unknown => {
      /* Missing on the async stub: the call throws, which is a no. */
      if (!agent.getInternalContext()) {
        return false;
      }

      for (const entry of agent.getInitConfiguration().allowedTracingUrls) {
        const option: TracingUrlOption =
          entry && typeof entry === "object" && !(entry instanceof RegExp)
            ? (entry as TracingUrlOption)
            : { match: entry };
        const match: unknown = option.match;
        let matched: unknown = false;

        try {
          matched =
            typeof match === "function"
              ? match(href)
              : match instanceof RegExp
                ? match.test(href)
                : typeof match === "string" && href.indexOf(match) === 0;
        } catch {
          /* Skipped, as Datadog skips it. */
        }

        if (matched) {
          return (
            !option.propagatorTypes ||
            option.propagatorTypes.indexOf("tracecontext") >= 0
          );
        }
      }

      return false;
    },
  ],

  /*
   * New Relic adds a traceparent only with distributed tracing on. The CDN
   * snippet configures NREUM.init; the npm agent (@newrelic/browser-agent)
   * leaves NREUM.init empty and keeps its configuration on the instance it
   * registers in NREUM.initializedAgents, so both are read. A page runs
   * one agent, rarely two: the walk is bounded all the same.
   */
  [
    "NREUM",
    (agent: AgentGlobal): unknown => {
      const configured: Array<AgentGlobal> = [agent];

      try {
        for (const key of Object.keys(agent.initializedAgents).slice(0, 4)) {
          configured.push(agent.initializedAgents[key] as AgentGlobal);
        }
      } catch {
        /* No npm agent registered. */
      }

      for (const candidate of configured) {
        try {
          if (candidate.init.distributed_tracing.enabled) {
            return true;
          }
        } catch {
          /* This one has no distributed tracing configuration. */
        }
      }

      return false;
    },
  ],

  /*
   * Elastic APM adds a traceparent only while active, with distributedTracing
   * on (its default), and under the W3C header name: with the legacy
   * distributedTracingHeaderName "elastic-apm-traceparent" the value goes
   * out under a header no W3C propagator reads. The agent has no getConfig;
   * its configuration lives in its ConfigService. A configuration that
   * cannot be read counts as Elastic's defaults, which trace.
   */
  [
    "elasticApm",
    (agent: AgentGlobal): unknown => {
      if (!agent.isActive()) {
        return false;
      }

      let tracing: unknown = true;
      let header: unknown = null;

      try {
        const config: { get: (key: string) => unknown } =
          agent.serviceFactory.getService("ConfigService");

        tracing = config.get("distributedTracing");
        header = config.get("distributedTracingHeaderName");
      } catch {
        /* Elastic's defaults: on, under "traceparent". */
      }

      return (
        tracing !== false &&
        (header === null ||
          header === undefined ||
          String(header).toLowerCase() === "traceparent")
      );
    },
  ],
];

export type RequestInitiator = "fetch" | "xhr";

export interface RecordedRequest {
  method: string;
  url: string;
  status: number;
  durationMs: number;

  /*
   * BYTES, from Content-Length when the server sent one, otherwise the
   * UTF-8 length of a text response. fetch and XHR used to report in
   * different units (header bytes vs UTF-16 code units of responseText),
   * so the same endpoint showed two different sizes depending on which
   * client the page used. 0 means "no body or not measurable".
   */
  responseBytes: number;

  /* status === 0 || status >= 500. An aborted request is NOT an error. */
  isError: boolean;

  /*
   * Trace id this request carried — read from a traceparent the host
   * page's own instrumentation set, or minted here when injection is on
   * for the request's origin. In the payload (not only the envelope's
   * traceIds rollup) so the DevTools panel can link one request row to
   * one backend trace.
   */
  traceId?: string;

  /* Which primitive issued the request. */
  initiator?: RequestInitiator;

  /*
   * Size of the request body in bytes, when its shape allows reading a
   * length without consuming it (string, ArrayBuffer, typed array, Blob,
   * URLSearchParams). Absent for streams and FormData; 0 for no body.
   */
  requestBytes?: number;

  /*
   * The PAGE cancelled this request (AbortController, xhr.abort(), a
   * navigation that tore it down). A cancelled typeahead or a React
   * StrictMode double-effect is not a failed request, and rendering it as
   * one taught viewers to ignore the red rows; status stays 0 because no
   * response ever arrived, and isError is false.
   */
  aborted?: boolean;

  /*
   * ONE marker entry emitted when the per-session cap is first reached,
   * so the rail can show where network capture stopped rather than the
   * list simply ending. Never counts against the cap.
   */
  isCapMarker?: boolean;
}

export interface NetworkRecorderOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;

  /*
   * `traceId` is the id for the envelope's traceIds rollup, which is not
   * always the request's own: a trace id MINTED on the same-origin path
   * stays on `request` (clock anchoring and "Backend for this request" use
   * it) but is passed here as null. The rollup is what the session list
   * counts as "N traces", and a same-origin endpoint with no tracing
   * behind it would otherwise advertise traces that open empty; backend
   * spans that really exist are stamped with the session at ingest.
   */
  onRequestComplete: (
    atUnixMs: number,
    request: RecordedRequest,
    traceId: string | null,
  ) => void;

  /* Any network activity at all, used to disqualify a dead click. */
  onActivity: (atUnixMs: number) => void;

  /* The per-session cap was hit; the recorder raises a fidelity notice. */
  onCapReached?: (cap: number) => void;

  scrubUrl: (url: string) => string;

  /*
   * The recorder's own chunk POSTs must not be recorded. Without this, every
   * flush creates a network event that lands in the next chunk, which
   * creates another flush - a feedback loop that never converges.
   */
  isSelfRequest: (url: string) => boolean;

  /*
   * CROSS-origin APIs whose requests get a GENERATED traceparent header
   * when the host page did not set one itself - and no other header.
   * Adding a header turns a simple cross-origin request into a
   * preflighted one, so each entry is the customer's explicit statement
   * that the API behind that origin allows traceparent in its CORS
   * policy. Entries that do not parse as URLs are dropped. The page's own
   * origin needs no entry: see sameOriginTracePropagation.
   */
  tracePropagationOrigins?: Array<string>;

  /*
   * The application's "Same-origin trace propagation" policy. When on,
   * requests to the page's OWN origin carry a traceparent and a tracestate
   * member naming the replay session (Common/Utils/Rum/SessionTraceState)
   * while getSessionIdForPropagation allows it. Absent or false is the
   * behaviour from before the policy existed, exactly.
   */
  sameOriginTracePropagation?: boolean;

  /*
   * The session id a same-origin request may carry, read at request time,
   * or null when it may carry nothing - before consent, after a revoke or
   * a stop, and while the session is not uploading. It gates the WHOLE
   * same-origin path, traceparent included: a minted traceparent is
   * sampled, which makes the backend keep the trace, and that is worth
   * forcing only for a session that will have a recording to show it
   * beside.
   */
  getSessionIdForPropagation?: () => string | null;
}

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/* The arguments one fetch goes out with, and what it carries. */
interface FetchAnnotation {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
  traceId: string | null;

  /* See RequestOutcome.minted. */
  minted: boolean;

  /* We added same-origin headers; a network failure trips the breaker. */
  sameOrigin: boolean;
}

/* What headersToAdd decided for one request. */
interface HeadersToAdd {
  pairs: Array<[string, string]>;

  /* The traceparent it minted, if it minted one. */
  minted: GeneratedTraceParent | null;
}

interface XhrState {
  method: string;
  url: string;
  startedAtMs: number;
  traceId: string | null;

  /*
   * The page called setRequestHeader("traceparent", ...) itself — with
   * ANY value, parseable or not. Injection must then stand down: adding
   * a second traceparent puts two headers on the wire, and neither the
   * page's backend nor ours could parse the combined value.
   */
  hasPageTraceParent: boolean;

  /* The same, for tracestate: the page's own is never added to. */
  hasPageTraceState: boolean;

  /* See RequestOutcome.minted. */
  minted: boolean;

  /* We added same-origin headers; a network failure trips the breaker. */
  sameOrigin: boolean;

  /*
   * A loadend listener for THIS state is registered. XHR objects are
   * legally reusable and send() can be called in error states; without
   * this latch every send() would stack another listener.
   */
  armed: boolean;

  /* xhr.abort() fired for this request; loadend then reports status 0. */
  aborted: boolean;

  /*
   * open(method, url, false): a synchronous request, whose network error is
   * THROWN from send() with no loadend at all.
   */
  sync: boolean;

  /*
   * The page's own xhr.timeout expired (axios's timeout, for one); loadend
   * reports status 0 for that too, and it is no reason to trip the breaker.
   */
  timedOut: boolean;

  /* Byte length of the body handed to send(), when measurable. */
  requestBytes: number | null;
}

/* Everything record() needs to build one RecordedRequest. */
interface RequestOutcome {
  method: string;
  rawUrl: string;
  status: number;
  durationMs: number;
  responseBytes: number;
  traceId: string | null;
  initiator: RequestInitiator;
  requestBytes: number | null;
  aborted: boolean;

  /*
   * traceId was MINTED here on the same-origin path, so it is kept off
   * the envelope rollup (see NetworkRecorderOptions.onRequestComplete).
   */
  minted: boolean;
}

export interface GeneratedTraceParent {
  /* The 32-hex trace id alone, as stored on the session envelope. */
  traceId: string;

  /*
   * The 16-hex parent id. It names a browser span that is never exported,
   * so it rides in our tracestate member as `p` and ingest can repair the
   * backend entry span that points at it.
   */
  parentId: string;

  /* The full "00-<traceId>-<parentId>-01" header value. */
  header: string;
}

export default class NetworkRecorder {
  private readonly options: NetworkRecorderOptions;

  /*
   * Allowlist entries normalised to lowercase origins ("https://host:port")
   * once, at construction. An entry like "https://api.example.com/v2" is
   * reduced to its origin; one that does not parse at all is dropped, so a
   * typo in the dashboard disables injection for that entry rather than
   * producing a comparison that can never match anything.
   */
  private readonly injectOrigins: Array<string>;

  private recordedCount: number = 0;
  private capReported: boolean = false;
  private started: boolean = false;

  /*
   * The page's own origin, lowercase, while same-origin propagation is on
   * AND the document really has that origin (see readPageOrigin); null
   * otherwise. Resolved once, in start().
   */
  private pageOrigin: string | null = null;

  /*
   * The redirect breaker (see tripSameOrigin). Once set, same-origin
   * propagation stays off for the rest of this page load.
   */
  private sameOriginTripped: boolean = false;

  /*
   * The first stand-down for a vendor agent (see PROPAGATING_AGENTS) has
   * been logged. Once per page load: the question it answers is "why does
   * this request carry a tracestate and no traceparent", not how often.
   */
  private agentStandDownLogged: boolean = false;

  /*
   * The fetch / XHR send we wrapped is itself a tracer's wrapper, which
   * will add a traceparent of its own. Read once, from the UNBOUND
   * originals: bind() does not copy the markers.
   */
  private fetchPropagates: boolean = false;
  private xhrPropagates: boolean = false;

  private originalFetch: FetchFunction | null = null;

  /*
   * The wrappers this instance installed. stop() restores the originals only
   * while ours are still the ones in place: the artifact loads
   * asynchronously, so a page whose OpenTelemetry FetchInstrumentation or
   * error SDK patched fetch AFTER us would have had its patch silently
   * removed - and stop() is reached on its own at the 480-chunk cap, on a
   * breaker trip and on a server stop directive, not only when the page asks.
   * When the chain has moved on, our wrapper stays and passes through
   * without recording (see the `started` checks in record and
   * propagationFor).
   */
  private installedFetch: unknown = null;
  private installedXhrOpen: unknown = null;
  private installedXhrSend: unknown = null;
  private installedXhrSetRequestHeader: unknown = null;

  private originalXhrOpen:
    | ((method: string, url: string | URL) => void)
    | null = null;
  private originalXhrSend: ((body?: unknown) => void) | null = null;
  private originalXhrSetRequestHeader:
    | ((name: string, value: string) => void)
    | null = null;

  /*
   * Per-request state keyed on the XHR object itself. A WeakMap so an
   * abandoned request cannot keep its own state alive.
   */
  private readonly xhrState: WeakMap<XMLHttpRequest, XhrState> = new WeakMap<
    XMLHttpRequest,
    XhrState
  >();

  public constructor(options: NetworkRecorderOptions) {
    this.options = options;
    this.injectOrigins = NetworkRecorder.normaliseOrigins(
      options.tracePropagationOrigins || [],
    );
  }

  public start(windowRef: Window = window): void {
    if (this.started) {
      return;
    }

    this.started = true;

    const policy: boolean = this.options.sameOriginTracePropagation === true;

    this.pageOrigin = policy ? NetworkRecorder.readPageOrigin(windowRef) : null;

    /*
     * The one line that says whether this page's own requests will carry
     * the session to the backend - the question behind every "the Traces
     * tab is empty" ticket, and not answerable from the Network tab of a
     * session that is not uploading yet.
     */
    debugLog(
      "same-origin-propagation",
      this.pageOrigin
        ? "Same-origin requests carry trace context while the session uploads."
        : "Same-origin trace propagation is off.",
      {
        enabled: this.pageOrigin !== null,
        reason: this.pageOrigin
          ? "on"
          : policy
            ? "opaque-origin"
            : "policy-off",
      },
    );

    this.patchFetch(windowRef);
    this.patchXhr(windowRef);
  }

  public stop(windowRef: Window = window): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    if (
      this.originalFetch &&
      (windowRef.fetch as unknown) === this.installedFetch
    ) {
      windowRef.fetch = this.originalFetch as typeof windowRef.fetch;
    }

    this.originalFetch = null;
    this.installedFetch = null;

    const xhrPrototype: Record<string, unknown> | null =
      NetworkRecorder.getXhrPrototype(windowRef);

    if (!xhrPrototype) {
      return;
    }

    if (
      this.originalXhrOpen &&
      xhrPrototype["open"] === this.installedXhrOpen
    ) {
      xhrPrototype["open"] = this.originalXhrOpen;
    }

    if (
      this.originalXhrSend &&
      xhrPrototype["send"] === this.installedXhrSend
    ) {
      xhrPrototype["send"] = this.originalXhrSend;
    }

    if (
      this.originalXhrSetRequestHeader &&
      xhrPrototype["setRequestHeader"] === this.installedXhrSetRequestHeader
    ) {
      xhrPrototype["setRequestHeader"] = this.originalXhrSetRequestHeader;
    }

    this.originalXhrOpen = null;
    this.originalXhrSend = null;
    this.originalXhrSetRequestHeader = null;
    this.installedXhrOpen = null;
    this.installedXhrSend = null;
    this.installedXhrSetRequestHeader = null;
  }

  private patchFetch(windowRef: Window): void {
    if (typeof windowRef.fetch !== "function") {
      return;
    }

    const original: FetchFunction = windowRef.fetch.bind(
      windowRef,
    ) as FetchFunction;

    this.originalFetch = windowRef.fetch as unknown as FetchFunction;
    this.fetchPropagates = NetworkRecorder.isInstrumented(this.originalFetch);

    /* No init means no second argument, exactly as the page called it. */
    const send: (
      input: RequestInfo | URL,
      init: RequestInit | undefined,
    ) => Promise<Response> = (
      input: RequestInfo | URL,
      init: RequestInit | undefined,
    ): Promise<Response> => {
      return init === undefined ? original(input) : original(input, init);
    };

    /*
     * Send one annotation's arguments, then read back what a tracer INSIDE
     * our wrapper put on them. OpenTelemetry's FetchInstrumentation is
     * loaded first, so the async recorder wraps outside it, and it sets its
     * traceparent on the arguments we hand it: it replaces init.headers
     * with a Headers of its own, or sets the header on a Request in place.
     * Read back after the synchronous call, that is the id really on the
     * wire - treated as the page's own.
     *
     * fetch(url) is fetch(url, {}), but such a tracer builds a PRIVATE
     * options object for a call without one (`args[1] || {}`), so a string
     * or URL call is handed an empty init we keep. Never beside a Request:
     * the tracer would then build a new Request we never see, instead of
     * setting the header on this one in place.
     */
    const dispatch: (annotation: FetchAnnotation) => Promise<Response> = (
      annotation: FetchAnnotation,
    ): Promise<Response> => {
      if (
        this.fetchPropagates &&
        (annotation.init === undefined || annotation.init === null) &&
        (typeof annotation.input === "string" ||
          annotation.input instanceof URL)
      ) {
        annotation.init = {};
      }

      const promise: Promise<Response> = send(
        annotation.input,
        annotation.init,
      );

      if (annotation.traceId === null) {
        annotation.traceId = NetworkRecorder.readTraceId(
          annotation.input,
          annotation.init,
        );
      }

      return promise;
    };

    /*
     * An arrow function rather than a `function` expression: the wrapper does
     * not need its own `this`, and closing over the instance lexically avoids
     * aliasing `this` into a local.
     */
    windowRef.fetch = ((
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url: string = NetworkRecorder.readUrl(input);
      const method: string = NetworkRecorder.readMethod(input, init);
      const startedAtMs: number = Date.now();

      const requestBytes: number | null = NetworkRecorder.measureBody(
        init ? init.body : undefined,
      );

      /*
       * Everything that reads or rebuilds the page's arguments is inside
       * this try: whatever throws, the request goes out exactly as the
       * page built it.
       */
      let sent: FetchAnnotation;

      try {
        sent = this.annotateFetch(input, init, url, method, windowRef);
      } catch {
        sent = {
          input: input,
          init: init,
          traceId: null,
          minted: false,
          sameOrigin: false,
        };
      }

      const promise: Promise<Response> = dispatch(sent);

      if (this.options.isSelfRequest(url)) {
        return promise;
      }

      /*
       * Only a request with nothing to replay can be retried by the
       * breaker without the page noticing: GET or HEAD, no body.
       */
      const retryable: boolean =
        (method === "GET" || method === "HEAD") && requestBytes === 0;

      const settle: (
        pending: Promise<Response>,
        annotation: FetchAnnotation,
      ) => Promise<Response> = (
        pending: Promise<Response>,
        annotation: FetchAnnotation,
      ): Promise<Response> => {
        return pending.then(
          (response: Response): Response => {
            this.record({
              method: method,
              rawUrl: url,
              status: response.status,
              durationMs: Date.now() - startedAtMs,
              responseBytes: NetworkRecorder.readContentLength(response),
              traceId: annotation.traceId,
              initiator: "fetch",
              requestBytes: requestBytes,
              aborted: false,
              minted: annotation.minted,
            });

            return response;
          },
          (error: unknown): Promise<Response> => {
            /*
             * The page's own AbortSignal.timeout() - a slow endpoint is
             * not a header problem, and it is still the failure the user
             * waited for. Anything else on an aborted signal is the page
             * cancelling its own request (see wasAborted).
             */
            const timedOut: boolean =
              NetworkRecorder.errorName(error) === "TimeoutError";
            const aborted: boolean =
              !timedOut && NetworkRecorder.wasAborted(error, input, init);

            if (
              annotation.sameOrigin &&
              this.tripSameOrigin(!timedOut && !aborted, retryable) &&
              retryable
            ) {
              /*
               * Once more with the page's own arguments, settled - and
               * recorded - as the one request the page made, with the
               * trace id read back from THIS attempt: ours is gone, and
               * a tracer inside our wrapper sets a new one.
               */
              const retry: FetchAnnotation = {
                input: input,
                init: init,
                traceId: null,
                minted: false,
                sameOrigin: false,
              };

              return settle(dispatch(retry), retry);
            }

            /*
             * status 0 is the honest representation of a request that
             * never got a response. Re-thrown unchanged so the host page's
             * own error handling is untouched.
             */
            this.record({
              method: method,
              rawUrl: url,
              status: 0,
              durationMs: Date.now() - startedAtMs,
              responseBytes: 0,
              traceId: annotation.traceId,
              initiator: "fetch",
              requestBytes: requestBytes,
              aborted: aborted,
              minted: annotation.minted,
            });

            throw error;
          },
        );
      };

      return settle(promise, sent);
    }) as typeof windowRef.fetch;

    this.installedFetch = windowRef.fetch as unknown;
  }

  /*
   * The arguments one fetch goes out with, and the trace id it carries.
   * The page's own arguments come back untouched whenever nothing is
   * added, and whenever something about the request cannot be read or
   * merged safely: a request that goes out un-annotated loses one
   * correlation, a request rebuilt wrongly loses the page's data.
   */
  private annotateFetch(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    url: string,
    method: string,
    windowRef: Window,
  ): FetchAnnotation {
    const untouched: FetchAnnotation = {
      input: input,
      init: init,
      traceId: NetworkRecorder.readTraceId(input, init),
      minted: false,
      sameOrigin: false,
    };

    /*
     * A no-cors request drops every header that is not CORS-safelisted, so
     * ours would never reach the wire while the recorder reported an id as
     * sent.
     */
    if (this.options.isSelfRequest(url) || (init && init.mode === "no-cors")) {
      return untouched;
    }

    const sessionId: string | null = this.propagationFor(
      url,
      method,
      windowRef,
    );

    if (sessionId === null) {
      return untouched;
    }

    /*
     * A Request object carries its own headers, and an init.headers would
     * REPLACE them, so one is annotated only by rebuilding it - on the
     * same-origin path, with no init beside it. new Request(request, ...)
     * proxies the original's body rather than reading it, and throws for a
     * used one (the caller then sends the page's call as it is). Listed
     * cross-origin APIs keep the older rule: a Request is never annotated.
     */
    const requestConstructor: unknown = (
      windowRef as unknown as Record<string, unknown>
    )["Request"];

    const isRequest: boolean =
      sessionId !== "" &&
      init === undefined &&
      typeof requestConstructor === "function" &&
      input instanceof (requestConstructor as typeof Request) &&
      (input as Request).mode !== "no-cors";

    if (!isRequest && typeof input !== "string" && !(input instanceof URL)) {
      return untouched;
    }

    const headers: unknown = isRequest
      ? new Headers((input as Request).headers)
      : init && init.headers;

    const pageTraceParent: string | null | undefined =
      NetworkRecorder.readHeader(headers, "traceparent");

    const pageTraceState: string | null | undefined =
      NetworkRecorder.readHeader(headers, "tracestate");

    /* Headers we cannot read without consuming them are never added to. */
    if (pageTraceParent === undefined || pageTraceState === undefined) {
      return untouched;
    }

    const added: HeadersToAdd = this.headersToAdd(
      sessionId,
      pageTraceParent !== null,
      pageTraceState !== null,
      this.fetchPropagates,
      url,
      windowRef,
    );

    if (added.pairs.length === 0) {
      return untouched;
    }

    const annotation: FetchAnnotation = {
      input: input,
      init: init,
      traceId: added.minted ? added.minted.traceId : untouched.traceId,
      minted: added.minted !== null && sessionId !== "",
      sameOrigin: sessionId !== "",
    };

    if (isRequest) {
      const request: Request = input as Request;

      for (const pair of added.pairs) {
        (headers as Headers).set(pair[0], pair[1]);
      }

      /*
       * Any non-empty init resets the copy's referrer to the client and
       * its policy to the document default, so a page's no-referrer (or
       * its own same-origin referrer) would silently become the full page
       * URL as Referer. Both round-trip: "about:client" is the client, ""
       * is no-referrer.
       */
      annotation.input = new (requestConstructor as typeof Request)(request, {
        headers: headers as Headers,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
      });

      return annotation;
    }

    const merged: RequestInit | null = NetworkRecorder.withHeaders(
      init,
      added.pairs,
    );

    if (!merged) {
      return untouched;
    }

    annotation.init = merged;

    return annotation;
  }

  /*
   * The headers one request gets, given what it already carries. "" is a
   * listed cross-origin API: a minted traceparent and nothing else,
   * whoever else is tracing the page, as always. A session id is the
   * same-origin path: a traceparent unless the request has one or a tracer
   * inside our wrapper will add one (two values on one XHR are
   * unparseable, and that tracer's browser span should stay the parent),
   * plus our tracestate member unless the request has a tracestate -
   * carrying the minted parent id as `p` only when the traceparent is
   * ours. The visitor id is never in either. On a stand-down the tracestate
   * is still added: the tracer that adds the traceparent runs after us.
   */
  private headersToAdd(
    sessionId: string,
    hasTraceParent: boolean,
    hasTraceState: boolean,
    innerPropagates: boolean,
    url: string,
    windowRef: Window,
  ): HeadersToAdd {
    const added: HeadersToAdd = { pairs: [], minted: null };

    if (
      !hasTraceParent &&
      !(
        sessionId &&
        (innerPropagates || this.hasPropagatingAgent(url, windowRef))
      )
    ) {
      added.minted = NetworkRecorder.generateTraceParent();

      if (added.minted) {
        added.pairs.push(["traceparent", added.minted.header]);
      }
    }

    if (sessionId && !hasTraceState) {
      added.pairs.push([
        "tracestate",
        buildSessionTraceStateMember(
          sessionId,
          added.minted ? added.minted.parentId : null,
        ),
      ]);
    }

    return added;
  }

  private patchXhr(windowRef: Window): void {
    const prototype: Record<string, unknown> | null =
      NetworkRecorder.getXhrPrototype(windowRef);

    if (!prototype) {
      return;
    }

    const originalOpen: unknown = prototype["open"];
    const originalSend: unknown = prototype["send"];
    const originalSetHeader: unknown = prototype["setRequestHeader"];

    if (
      typeof originalOpen !== "function" ||
      typeof originalSend !== "function"
    ) {
      return;
    }

    this.originalXhrOpen = originalOpen as (
      method: string,
      url: string | URL,
    ) => void;
    this.originalXhrSend = originalSend as (body?: unknown) => void;
    this.xhrPropagates = NetworkRecorder.isInstrumented(originalSend);

    if (typeof originalSetHeader === "function") {
      this.originalXhrSetRequestHeader = originalSetHeader as (
        name: string,
        value: string,
      ) => void;
    }

    /*
     * The patched methods DO need their own `this` (it is the XMLHttpRequest),
     * so they stay `function` expressions and reach the recorder through these
     * lexically bound helpers instead of an alias.
     */
    const xhrState: WeakMap<XMLHttpRequest, XhrState> = this.xhrState;

    const isSelfRequest: (url: string) => boolean = (url: string): boolean => {
      return this.options.isSelfRequest(url);
    };

    /*
     * Called from patchedSend, i.e. with the XHR in OPENED state — the
     * only state in which setRequestHeader is legal — and once per open().
     * The original setRequestHeader is used directly so the patched one
     * does not take our own headers for the page's, and each call is
     * try/caught because a page that calls send() in a strange state
     * should get its own exception from send(), never one from us.
     */
    const annotateXhr: (xhr: XMLHttpRequest, state: XhrState) => void = (
      xhr: XMLHttpRequest,
      state: XhrState,
    ): void => {
      const setHeader: ((name: string, value: string) => void) | null =
        this.originalXhrSetRequestHeader;

      const sessionId: string | null = setHeader
        ? this.propagationFor(state.url, state.method, windowRef)
        : null;

      if (!setHeader || sessionId === null) {
        return;
      }

      const added: HeadersToAdd = this.headersToAdd(
        sessionId,
        state.hasPageTraceParent,
        state.hasPageTraceState,
        this.xhrPropagates,
        state.url,
        windowRef,
      );

      for (const pair of added.pairs) {
        try {
          setHeader.apply(xhr, pair);
        } catch {
          /* Header not set; the request proceeds without it. */
          continue;
        }

        if (pair[0] === "traceparent" && added.minted) {
          state.traceId = added.minted.traceId;
          state.minted = sessionId !== "";
        }

        state.sameOrigin = sessionId !== "";
      }
    };

    /*
     * One request's end, however it ended: the breaker, then the record.
     * The state is spent here, so a request is recorded once even if a
     * synchronous send both fired loadend and threw. A re-open()ed XHR
     * replaces its state object; a stale listener from an earlier send
     * must not record its old method/url/traceId against the new request's
     * response (and its startedAtMs would span both requests, feeding a
     * fictitious duration to the slow-request trigger).
     */
    const finishXhr: (
      xhr: XMLHttpRequest,
      state: XhrState,
      status: number,
    ) => void = (
      xhr: XMLHttpRequest,
      state: XhrState,
      status: number,
    ): void => {
      if (xhrState.get(xhr) !== state) {
        return;
      }

      xhrState.delete(xhr);

      /*
       * An XHR cannot be retried behind the page's back - its events have
       * already fired, or its exception has been thrown - so a failed
       * same-origin XHR only trips the breaker for the requests after it.
       */
      if (state.sameOrigin) {
        this.tripSameOrigin(
          status === 0 && !state.aborted && !state.timedOut,
          false,
        );
      }

      this.record({
        method: state.method,
        rawUrl: state.url,
        status: status,
        durationMs: Date.now() - state.startedAtMs,
        responseBytes: NetworkRecorder.readXhrResponseSize(xhr),
        traceId: state.traceId,
        initiator: "xhr",
        requestBytes: state.requestBytes,
        aborted: state.aborted,
        minted: state.minted,
      });
    };

    prototype["open"] = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: Array<unknown>
    ): void {
      xhrState.set(this, {
        method: (method || "GET").toUpperCase(),
        url: String(url),
        startedAtMs: Date.now(),
        traceId: null,
        hasPageTraceParent: false,
        hasPageTraceState: false,
        minted: false,
        sameOrigin: false,
        armed: false,
        aborted: false,
        sync: rest.length > 0 && !rest[0],
        timedOut: false,
        requestBytes: null,
      });

      (originalOpen as (...args: Array<unknown>) => void).apply(this, [
        method,
        url,
        ...rest,
      ]);
    };

    this.installedXhrOpen = prototype["open"];

    if (typeof originalSetHeader === "function") {
      prototype["setRequestHeader"] = function patchedSetRequestHeader(
        this: XMLHttpRequest,
        name: string,
        value: string,
      ): void {
        /*
         * Only the two trace context header NAMES are inspected, and only
         * traceparent's value is read. Every other header, in particular
         * Authorization and Cookie, is passed straight through unread.
         */
        const header: string =
          typeof name === "string" ? name.toLowerCase() : "";
        const state: XhrState | undefined = xhrState.get(this);

        if (state && header === "traceparent") {
          /*
           * Presence is recorded unconditionally; the parsed id only
           * when the value is well-formed. An unparseable page value
           * still suppresses injection (see XhrState.hasPageTraceParent)
           * — it just cannot be reported as a correlation id.
           */
          state.hasPageTraceParent = true;
          state.traceId = NetworkRecorder.parseTraceParent(value);
        } else if (state && header === "tracestate") {
          state.hasPageTraceState = true;
        }

        (originalSetHeader as (...args: Array<unknown>) => void).apply(this, [
          name,
          value,
        ]);
      };

      this.installedXhrSetRequestHeader = prototype["setRequestHeader"];
    }

    prototype["send"] = function patchedSend(
      this: XMLHttpRequest,
      ...args: Array<unknown>
    ): void {
      const state: XhrState | undefined = xhrState.get(this);
      const armed: boolean = Boolean(
        state && !state.armed && !isSelfRequest(state.url),
      );

      if (state && armed) {
        annotateXhr(this, state);

        state.armed = true;
        state.startedAtMs = Date.now();
        state.requestBytes = NetworkRecorder.measureBody(args[0]);

        /*
         * abort() fires "abort" and then "loadend" with status 0, which
         * is byte-for-byte what a network failure looks like from
         * loadend alone. The flag is what tells the two apart.
         */
        this.addEventListener(
          "abort",
          (): void => {
            if (xhrState.get(this) === state) {
              state.aborted = true;
            }
          },
          { once: true },
        );

        this.addEventListener(
          "timeout",
          (): void => {
            if (xhrState.get(this) === state) {
              state.timedOut = true;
            }
          },
          { once: true },
        );

        this.addEventListener(
          "loadend",
          (): void => {
            finishXhr(this, state, this.status);
          },
          { once: true },
        );
      }

      if (!state || !armed || !state.sync) {
        (originalSend as (...args: Array<unknown>) => void).apply(this, args);
        return;
      }

      /*
       * A synchronous request's network error is THROWN from send(),
       * before any readystatechange, error or loadend, so the listener
       * above never hears it. Caught here only to trip the breaker and
       * record the request; the page gets its own exception, unchanged.
       */
      try {
        (originalSend as (...args: Array<unknown>) => void).apply(this, args);
      } catch (error) {
        const name: unknown = NetworkRecorder.errorName(error);

        state.aborted = name === "AbortError";
        state.timedOut = name === "TimeoutError";
        finishXhr(this, state, 0);

        throw error;
      }
    };

    this.installedXhrSend = prototype["send"];
  }

  private record(outcome: RequestOutcome): void {
    /*
     * A wrapper that outlived stop() - because the page patched fetch after
     * us and we refused to break its chain - passes the request through and
     * records nothing.
     */
    if (!this.started) {
      return;
    }

    const atUnixMs: number = Date.now();

    this.options.onActivity(atUnixMs);

    if (this.recordedCount >= MAX_REQUESTS_RECORDED) {
      this.reportCapOnce();
      return;
    }

    this.recordedCount++;

    const request: RecordedRequest = {
      method: outcome.method,
      url: this.options.scrubUrl(outcome.rawUrl),
      status: outcome.status,
      durationMs: outcome.durationMs,
      responseBytes: outcome.responseBytes,

      /*
       * An aborted request never had a response, so status is 0 - but the
       * page chose that, and it is not a failure the user experienced.
       */
      isError:
        !outcome.aborted && (outcome.status === 0 || outcome.status >= 500),
      initiator: outcome.initiator,
    };

    /* Only present when there is one — absent beats null on the wire. */
    if (outcome.traceId) {
      request.traceId = outcome.traceId;
    }

    if (outcome.requestBytes !== null) {
      request.requestBytes = outcome.requestBytes;
    }

    if (outcome.aborted) {
      request.aborted = true;
    }

    this.options.emitCustomEvent(NETWORK_CUSTOM_EVENT_TAG, request);
    this.options.onRequestComplete(
      atUnixMs,
      request,
      outcome.minted ? null : outcome.traceId,
    );
  }

  /*
   * The first request past the cap becomes ONE marker in the stream, so the
   * Network tab shows where capture stopped instead of simply ending. Not
   * counted against the cap, emitted once per session, and never handed to
   * onRequestComplete: a marker is not a request and must not trigger.
   */
  private reportCapOnce(): void {
    if (this.capReported) {
      return;
    }

    this.capReported = true;

    const marker: RecordedRequest = {
      method: "",
      url: "",
      status: 0,
      durationMs: 0,
      responseBytes: 0,
      isError: false,
      isCapMarker: true,
    };

    this.options.emitCustomEvent(NETWORK_CUSTOM_EVENT_TAG, marker);

    if (this.options.onCapReached) {
      this.options.onCapReached(MAX_REQUESTS_RECORDED);
    }
  }

  /*
   * A rotated session is a fresh recording with its own cap. Without this
   * a long-lived SPA that burned the budget in session 1 had network rows
   * permanently dead for every later session on the same page load.
   */
  public resetForNewSession(): void {
    this.recordedCount = 0;
    this.capReported = false;
  }

  public hasReachedCap(): boolean {
    return this.recordedCount >= MAX_REQUESTS_RECORDED;
  }

  public getRecordedCount(): number {
    return this.recordedCount;
  }

  /*
   * Was this rejection the page cancelling its own request? fetch rejects
   * with a DOMException named AbortError for AbortController.abort() and
   * for a navigation tearing the request down.
   */
  public static isAbortError(error: unknown): boolean {
    return NetworkRecorder.errorName(error) === "AbortError";
  }

  /* A rejection's `name`, or undefined for one that is not an object. */
  private static errorName(error: unknown): unknown {
    return error && typeof error === "object"
      ? (error as Record<string, unknown>)["name"]
      : undefined;
  }

  /*
   * Did the page cancel this request? An AbortError says so, and so does
   * the request's own signal - init.signal when the init has one, else a
   * Request input's - being aborted by the time it failed: abort() with a
   * reason (controller.abort(new Error("route changed")), abort("unmount"))
   * rejects fetch with that reason itself, not with an AbortError.
   */
  private static wasAborted(
    error: unknown,
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ): boolean {
    if (NetworkRecorder.isAbortError(error)) {
      return true;
    }

    try {
      const signal: AbortSignal | null | undefined =
        init && init.signal !== undefined
          ? init.signal
          : (input as Request).signal;

      return Boolean(signal && signal.aborted);
    } catch {
      return false;
    }
  }

  /*
   * The redirect breaker. A same-origin request is never preflighted - but
   * one that answers with a 30x to ANOTHER origin keeps every header we
   * added, so the redirect target is asked to allow them in a preflight,
   * and a target that does not (a presigned storage URL, a CDN, a
   * short-link host) fails the request at the network level. The first
   * annotated request that fails that way switches same-origin
   * propagation off for the rest of this page load; the page's own abort
   * or timeout, and offline, are not that failure. Returns whether this
   * failure counted.
   */
  private tripSameOrigin(isNetworkFailure: boolean, retried: boolean): boolean {
    if (
      !isNetworkFailure ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    ) {
      return false;
    }

    if (!this.sameOriginTripped) {
      this.sameOriginTripped = true;

      debugWarn(
        "same-origin-propagation-tripped",
        "A same-origin request with trace headers failed; they are off for the rest of this page.",
        { retried: retried },
      );
    }

    return true;
  }

  /*
   * Byte length of a request body, WITHOUT consuming it. Only shapes that
   * expose a length are measured; a stream or a FormData (which would have
   * to be iterated, touching field names) yields null and the field is
   * omitted. No body at all is a measured 0.
   */
  public static measureBody(body: unknown): number | null {
    if (body === undefined || body === null) {
      return 0;
    }

    if (typeof body === "string") {
      return utf8ByteLength(body);
    }

    if (typeof ArrayBuffer !== "undefined") {
      if (body instanceof ArrayBuffer) {
        return body.byteLength;
      }

      if (ArrayBuffer.isView(body)) {
        return body.byteLength;
      }
    }

    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return body.size;
    }

    if (
      typeof URLSearchParams !== "undefined" &&
      body instanceof URLSearchParams
    ) {
      return utf8ByteLength(body.toString());
    }

    return null;
  }

  /*
   * What a request to this URL may carry. null: nothing. "": a minted
   * traceparent and nothing else - an origin listed in Trace propagation
   * origins. A session id: the same-origin set, when the request goes to
   * the page's own origin and is not a POST to an OpenTelemetry export path
   * (see OTLP_EXPORT_PATH), the policy is on, the breaker has not tripped
   * and the recorder hands out a session id right now; a listed origin
   * that is also the page's own gets the same-origin set whenever it is
   * available and the listed treatment otherwise.
   *
   * Relative URLs resolve against the DOCUMENT BASE URL — the same base
   * fetch and XHR themselves use, which a <base href> tag can point at a
   * different origin than the page's own. Resolving against location.href
   * instead would let a fetch("/api/x") on such a page match the page's
   * origin while the real request goes somewhere else — adding exactly the
   * preflight-breaking header this exists to prevent. Anything unparseable
   * answers null: when we cannot say where a header would go, we do not
   * add one.
   */
  private propagationFor(
    url: string,
    method: string,
    windowRef: Window,
  ): string | null {
    /*
     * A wrapper that outlived stop() must not annotate the page's requests
     * either: the recorder is no longer here to report the trace id, so the
     * header would only add a preflight for nothing.
     */
    if (!this.started) {
      return null;
    }

    try {
      const resolved: URL = NetworkRecorder.resolve(url, windowRef);

      /* Origins only make sense for http(s); blob:, data:, ws: never match. */
      if (resolved.protocol !== "https:" && resolved.protocol !== "http:") {
        return null;
      }

      const origin: string = resolved.origin.toLowerCase();

      if (
        origin === this.pageOrigin &&
        !this.sameOriginTripped &&
        !(method === "POST" && OTLP_EXPORT_PATH.test(resolved.pathname)) &&
        this.options.getSessionIdForPropagation
      ) {
        const sessionId: string | null =
          this.options.getSessionIdForPropagation();

        if (sessionId && SESSION_ID_PATTERN.test(sessionId)) {
          return sessionId;
        }
      }

      return this.injectOrigins.indexOf(origin) >= 0 ? "" : null;
    } catch {
      return null;
    }
  }

  /* A request URL resolved the way fetch and XHR resolve it; may throw. */
  private static resolve(url: string, windowRef: Window): URL {
    return new URL(
      url,
      (windowRef.document && windowRef.document.baseURI) ||
        windowRef.location.href,
    );
  }

  /*
   * The origin same-origin requests are compared against, or null when
   * this document has none that can be trusted. location.origin describes
   * the URL, not the document: a sandboxed iframe, or a page served with a
   * CSP `sandbox`, has an OPAQUE origin - its requests say `Origin: null`
   * and the browser treats every one of them as cross-origin, preflight
   * included - while location.origin still names the site. window.origin
   * is the document's own origin, so the two must agree. about:blank,
   * srcdoc and file: documents fail the http(s) test. Fails closed.
   */
  private static readPageOrigin(windowRef: Window): string | null {
    try {
      const origin: string = String(windowRef.location.origin);
      const documentOrigin: unknown = (
        windowRef as unknown as Record<string, unknown>
      )["origin"];

      if (
        HTTP_ORIGIN_PATTERN.test(origin) &&
        (typeof documentOrigin !== "string" || documentOrigin === origin)
      ) {
        return origin.toLowerCase();
      }
    } catch {
      /* A location that cannot be read is not one we propagate to. */
    }

    return null;
  }

  /*
   * Has a tracer wrapped this function? shimmer - which OpenTelemetry's
   * instrumentations and the agents built on them use - marks a wrapper
   * with `__wrapped` and keeps the function it wraps on `__original`;
   * Sentry's own wrapper keeps it on `__sentry_original__`. So the chain
   * is walked a few hops for a marked wrapper anywhere under ours.
   */
  private static isInstrumented(fn: unknown): boolean {
    try {
      let current: unknown = fn;

      for (let hop: number = 0; hop <= 5 && current; hop++) {
        const record: Record<string, unknown> = current as Record<
          string,
          unknown
        >;

        if (record["__wrapped"] === true) {
          return true;
        }

        current = record["__original"] || record["__sentry_original__"];
      }
    } catch {
      /* A hostile getter: nothing we can know, so nothing to stand down for. */
    }

    return false;
  }

  /*
   * Is a vendor agent configured to put its own traceparent on this
   * request (see PROPAGATING_AGENTS)? A check that throws - a shape we
   * cannot read, an async stub with no config yet - is a no. The first
   * stand-down is logged, naming the agent, because it is otherwise
   * invisible: DevTools shows our tracestate, and the traceparent is the
   * agent's to add.
   */
  private hasPropagatingAgent(url: string, windowRef: Window): boolean {
    for (const [name, check] of PROPAGATING_AGENTS) {
      try {
        const agent: unknown = (
          windowRef as unknown as Record<string, unknown>
        )[name];

        if (
          !agent ||
          !check(
            agent as AgentGlobal,
            NetworkRecorder.resolve(url, windowRef).href,
          )
        ) {
          continue;
        }
      } catch {
        continue;
      }

      if (!this.agentStandDownLogged) {
        this.agentStandDownLogged = true;

        debugLog(
          "same-origin-propagation",
          "Another tracing agent adds the traceparent to same-origin requests; the recorder adds only its tracestate.",
          { enabled: true, reason: "agent-stand-down", agent: name },
        );
      }

      return true;
    }

    return false;
  }

  private static normaliseOrigins(entries: Array<string>): Array<string> {
    const origins: Array<string> = [];

    for (const entry of entries) {
      if (typeof entry !== "string" || !entry) {
        continue;
      }

      try {
        const origin: string = new URL(entry).origin.toLowerCase();

        /* URL.origin is the literal string "null" for opaque origins. */
        if (origin && origin !== "null" && origins.indexOf(origin) < 0) {
          origins.push(origin);
        }
      } catch {
        /* Not a URL; dropped rather than string-matched loosely. */
      }
    }

    return origins;
  }

  /*
   * Mint a W3C traceparent. crypto.getRandomValues is the only randomness
   * source used - if it is unavailable, we inject nothing rather than
   * generating guessable ids. The sampled flag is 01 so the backend's
   * tracing actually keeps the trace this recording will point at, and
   * both ids are re-rolled from the pool if a segment lands all-zero,
   * which the spec forbids.
   */
  public static generateTraceParent(): GeneratedTraceParent | null {
    const cryptoObj: Crypto | undefined = (
      globalThis as unknown as Record<string, unknown>
    )["crypto"] as Crypto | undefined;

    if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
      return null;
    }

    const bytes: Uint8Array = new Uint8Array(24);

    try {
      cryptoObj.getRandomValues(bytes);
    } catch {
      return null;
    }

    /* trace-id = bytes 0..15, parent-id = bytes 16..23; neither may be 0. */
    if (
      bytes.slice(0, 16).every((b: number): boolean => {
        return b === 0;
      })
    ) {
      bytes[0] = 1;
    }

    if (
      bytes.slice(16).every((b: number): boolean => {
        return b === 0;
      })
    ) {
      bytes[16] = 1;
    }

    let hex: string = "";

    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, "0");
    }

    const traceId: string = hex.slice(0, 32);
    const parentId: string = hex.slice(32);

    return {
      traceId: traceId,
      parentId: parentId,
      header: `00-${traceId}-${parentId}-01`,
    };
  }

  /*
   * Return a COPY of the init with the given headers merged into
   * whichever HeadersInit shape it uses, or NULL when that cannot be done
   * safely — the caller then sends the request exactly as the page built
   * it, un-annotated. Only ever called for headers the request does not
   * carry, so "add" semantics are safe. The caller's own init and headers
   * are never mutated.
   *
   * Only a PLAIN init is copied. `{ ...init }` copies own enumerable
   * properties, and a Request or class instance passed as init keeps
   * method, body and headers behind prototype getters: its copy is an
   * empty object, which turns the page's POST into a bare GET. Plain means
   * a null prototype or an Object.prototype - this realm's, or another
   * realm's, which has a null prototype of its own and an own
   * hasOwnProperty. Any other chain (Object.create(defaults), even when
   * defaults has a null prototype) keeps what the spread would lose.
   *
   * The tricky headers shape is the iterable one: HeadersInit's sequence
   * branch accepts ANY iterable of pairs — a Map, a Headers from another
   * realm (which fails the same-realm instanceof). Spreading one of those
   * into a plain object copies its own enumerable properties, which is
   * the EMPTY SET — every header the page set would be silently stripped
   * from the request. Iterables are therefore merged through the Headers
   * constructor, which reads them exactly as fetch would. One-shot
   * iterators never get here (see readHeader).
   */
  private static withHeaders(
    init: RequestInit | undefined,
    added: Array<[string, string]>,
  ): RequestInit | null {
    if (init !== undefined && init !== null) {
      const prototype: unknown = Object.getPrototypeOf(init);

      if (
        typeof init !== "object" ||
        (prototype !== null &&
          (Object.getPrototypeOf(prototype) !== null ||
            !Object.prototype.hasOwnProperty.call(prototype, "hasOwnProperty")))
      ) {
        return null;
      }
    }

    const next: RequestInit = { ...init };
    const headers: unknown = next.headers;

    if (Array.isArray(headers)) {
      next.headers = [...headers, ...added];
    } else if (NetworkRecorder.isIterable(headers)) {
      if (typeof Headers === "undefined") {
        return null;
      }

      try {
        const merged: Headers = new Headers(headers as HeadersInit);

        for (const pair of added) {
          merged.set(pair[0], pair[1]);
        }

        next.headers = merged;
      } catch {
        /* An iterable Headers rejects — decline rather than guess. */
        return null;
      }
    } else if (
      headers === undefined ||
      headers === null ||
      typeof headers === "object"
    ) {
      next.headers = {
        ...(headers as Record<string, string>),
        ...Object.fromEntries(added),
      };
    } else {
      return null;
    }

    return next;
  }

  private static isIterable(value: unknown): boolean {
    return Boolean(
      value &&
        typeof value === "object" &&
        typeof (value as Record<symbol, unknown>)[Symbol.iterator] ===
          "function",
    );
  }

  /*
   * One header of any HeadersInit shape, by name, case-insensitively: its
   * value, null when it is absent, or undefined when the shape cannot be
   * read without risk. A one-shot iterator (a generator, map.entries())
   * is never touched - reading it would consume the page's headers before
   * fetch could, and the request would go out with none - and an iterable
   * that throws is unknowable. Callers add nothing to headers they cannot
   * see, and presence is what matters: a page-set value we cannot parse
   * (a future spec version, a vendor-lenient format) must still stop us
   * adding a second one, because appending ours produces a combined
   * header nobody can parse.
   */
  private static readHeader(
    headers: unknown,
    name: string,
  ): string | null | undefined {
    if (headers === undefined || headers === null) {
      return null;
    }

    if (typeof headers !== "object") {
      return undefined;
    }

    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      return headers.get(name);
    }

    const record: Record<string, unknown> = headers as Record<string, unknown>;

    if (typeof record["next"] === "function") {
      return undefined;
    }

    if (NetworkRecorder.isIterable(headers)) {
      try {
        for (const pair of headers as Iterable<Array<unknown>>) {
          const key: unknown = pair[0];

          if (typeof key === "string" && key.toLowerCase() === name) {
            return String(pair[1]);
          }
        }
      } catch {
        return undefined;
      }

      return null;
    }

    for (const key of Object.keys(record)) {
      if (key.toLowerCase() === name) {
        return String(record[key]);
      }
    }

    return null;
  }

  /*
   * XMLHttpRequest is a global, not a property of the Window interface in
   * lib.dom, so it is read through an index lookup. Returns null in an
   * environment without it (a worker, a very old browser) rather than
   * throwing at startup.
   */
  private static getXhrPrototype(
    windowRef: Window,
  ): Record<string, unknown> | null {
    const constructor: unknown = (
      windowRef as unknown as Record<string, unknown>
    )["XMLHttpRequest"];

    if (typeof constructor !== "function") {
      return null;
    }

    const prototype: unknown = (constructor as { prototype?: unknown })
      .prototype;

    if (!prototype || typeof prototype !== "object") {
      return null;
    }

    return prototype as Record<string, unknown>;
  }

  public static parseTraceParent(value: string): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const match: RegExpExecArray | null = TRACEPARENT_PATTERN.exec(
      value.trim(),
    );

    if (!match) {
      return null;
    }

    const traceId: string | undefined = match[1];

    return traceId === undefined ? null : traceId.toLowerCase();
  }

  /*
   * The trace id a request carries: init.headers wins when present, exactly
   * as fetch merges them, otherwise a Request input's own. Never throws;
   * null when there is none, or none that parses, or none we can read.
   */
  private static readTraceId(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ): string | null {
    try {
      return (
        NetworkRecorder.parseTraceParent(
          NetworkRecorder.readHeader(init && init.headers, "traceparent") || "",
        ) || NetworkRecorder.readTraceIdFromRequest(input)
      );
    } catch {
      return null;
    }
  }

  /*
   * A traceparent carried on a Request OBJECT. Only the header is read,
   * by name, through the Request's own Headers; nothing else on it is
   * touched, and a Request from another realm (no same-realm instanceof)
   * is still read as long as it quacks like one.
   */
  private static readTraceIdFromRequest(
    input: RequestInfo | URL,
  ): string | null {
    if (!input || typeof input !== "object" || input instanceof URL) {
      return null;
    }

    const headers: unknown = (input as unknown as Record<string, unknown>)[
      "headers"
    ];

    if (!headers || typeof headers !== "object") {
      return null;
    }

    const get: unknown = (headers as Record<string, unknown>)["get"];

    if (typeof get !== "function") {
      return null;
    }

    try {
      const value: unknown = (get as (name: string) => unknown).call(
        headers,
        "traceparent",
      );

      return typeof value === "string"
        ? NetworkRecorder.parseTraceParent(value)
        : null;
    } catch {
      return null;
    }
  }

  private static readUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof URL) {
      return input.href;
    }

    /*
     * Mirror native fetch's USVString coercion: fetch(null) requests the
     * URL "null" and returns a promise. The wrapper must not turn that
     * into a synchronous TypeError from a property read on null.
     */
    if (input === null || typeof input !== "object") {
      return String(input);
    }

    const record: Record<string, unknown> = input as unknown as Record<
      string,
      unknown
    >;

    const url: unknown = record["url"];

    return typeof url === "string" ? url : "";
  }

  private static readMethod(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): string {
    if (init && typeof init.method === "string" && init.method) {
      return init.method.toUpperCase();
    }

    if (input && typeof input === "object" && !(input instanceof URL)) {
      const method: unknown = (input as unknown as Record<string, unknown>)[
        "method"
      ];

      if (typeof method === "string" && method) {
        return method.toUpperCase();
      }
    }

    return "GET";
  }

  private static readContentLength(response: Response): number {
    if (!response.headers) {
      return 0;
    }

    const value: string | null = response.headers.get("content-length");

    if (!value) {
      return 0;
    }

    const parsed: number = Number.parseInt(value, 10);

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  /*
   * BYTES, the same unit fetch reports: Content-Length first (the server's
   * own number, also what a compressed response actually cost), then the
   * UTF-8 length of a text response. responseText is read for its length
   * only, and only when the response type makes that safe - touching it
   * on a non-text response throws in some browsers - and the value itself
   * is never emitted.
   */
  private static readXhrResponseSize(xhr: XMLHttpRequest): number {
    try {
      const header: string | null = xhr.getResponseHeader("content-length");

      if (header) {
        const parsed: number = Number.parseInt(header, 10);

        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }
    } catch {
      /* Header not exposed (a cross-origin response); measure the text. */
    }

    try {
      if (xhr.responseType === "" || xhr.responseType === "text") {
        return typeof xhr.responseText === "string"
          ? utf8ByteLength(xhr.responseText)
          : 0;
      }

      return 0;
    } catch {
      return 0;
    }
  }
}
