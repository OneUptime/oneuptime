/*
 * fetch and XMLHttpRequest instrumentation.
 *
 * Three jobs: the 5xx upload trigger, the traceparent correlation that ties
 * a recording to the spans it produced, and the "was the page doing anything
 * at all" signal the dead-click detector needs.
 *
 * What is recorded: method, scrubbed URL, status, duration, response size.
 * What is never recorded: request or response bodies, and the Authorization
 * and Cookie headers. Not "masked" - never read.
 *
 * Patching global network primitives on someone else's page is the riskiest
 * thing this recorder does, so every wrapper calls through to the original
 * inside a try/finally and never swallows a rejection.
 */

export const NETWORK_CUSTOM_EVENT_TAG: string = "oneuptime.network";

/* Per-page cap so a polling app cannot fill the payload with network rows. */
const MAX_REQUESTS_RECORDED: number = 500;

/* W3C traceparent: 00-<32 hex trace id>-<16 hex span id>-<2 hex flags>. */
const TRACEPARENT_PATTERN: RegExp =
  /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i;

export interface RecordedRequest {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  responseBytes: number;
  isError: boolean;

  /*
   * Trace id this request carried — read from a traceparent the host
   * page's own instrumentation set, or minted here when injection is on
   * for the request's origin. In the payload (not only the envelope's
   * traceIds rollup) so the DevTools panel can link one request row to
   * one backend trace.
   */
  traceId?: string;
}

export interface NetworkRecorderOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;

  onRequestComplete: (
    atUnixMs: number,
    request: RecordedRequest,
    traceId: string | null,
  ) => void;

  /* Any network activity at all, used to disqualify a dead click. */
  onActivity: (atUnixMs: number) => void;

  scrubUrl: (url: string) => string;

  /*
   * The recorder's own chunk POSTs must not be recorded. Without this, every
   * flush creates a network event that lands in the next chunk, which
   * creates another flush - a feedback loop that never converges.
   */
  isSelfRequest: (url: string) => boolean;

  /*
   * Origins whose requests get a GENERATED traceparent header when the
   * host page did not set one itself. Empty (the default) means never
   * inject — adding a header turns a simple cross-origin request into a
   * preflighted one, so each entry is the customer's explicit statement
   * that the API behind that origin allows traceparent in its CORS
   * policy. Entries that do not parse as URLs are dropped.
   */
  tracePropagationOrigins?: Array<string>;
}

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

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

  /*
   * A loadend listener for THIS state is registered. XHR objects are
   * legally reusable and send() can be called in error states; without
   * this latch every send() would stack another listener.
   */
  armed: boolean;
}

export interface GeneratedTraceParent {
  /* The 32-hex trace id alone, as stored on the session envelope. */
  traceId: string;

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
  private started: boolean = false;

  private originalFetch: FetchFunction | null = null;
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

    this.patchFetch(windowRef);
    this.patchXhr(windowRef);
  }

  public stop(windowRef: Window = window): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    if (this.originalFetch) {
      windowRef.fetch = this.originalFetch as typeof windowRef.fetch;
      this.originalFetch = null;
    }

    const xhrPrototype: Record<string, unknown> | null =
      NetworkRecorder.getXhrPrototype(windowRef);

    if (!xhrPrototype) {
      return;
    }

    if (this.originalXhrOpen) {
      xhrPrototype["open"] = this.originalXhrOpen;
      this.originalXhrOpen = null;
    }

    if (this.originalXhrSend) {
      xhrPrototype["send"] = this.originalXhrSend;
      this.originalXhrSend = null;
    }

    if (this.originalXhrSetRequestHeader) {
      xhrPrototype["setRequestHeader"] = this.originalXhrSetRequestHeader;
      this.originalXhrSetRequestHeader = null;
    }
  }

  private patchFetch(windowRef: Window): void {
    if (typeof windowRef.fetch !== "function") {
      return;
    }

    const original: FetchFunction = windowRef.fetch.bind(
      windowRef,
    ) as FetchFunction;

    this.originalFetch = windowRef.fetch as unknown as FetchFunction;

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

      let traceId: string | null = NetworkRecorder.readTraceIdFromInit(init);
      let effectiveInit: RequestInit | undefined = init;

      /*
       * Injection happens ONLY when all of these hold: the page did not
       * set a traceparent of its own — checked by header PRESENCE, not
       * parse success, because a future-version or vendor-lenient value
       * the page's backend accepts must never be clobbered or duplicated
       * by ours — the input is a string or URL (a Request object carries
       * its own header state, and rebuilding one to merge a header risks
       * dropping a one-shot body, so Request inputs are skipped, a
       * documented limit), it is not our own chunk POST, and the resolved
       * origin is explicitly allowlisted.
       */
      if (
        traceId === null &&
        (typeof input === "string" || input instanceof URL) &&
        !NetworkRecorder.hasTraceParentHeader(init) &&
        !this.options.isSelfRequest(url) &&
        this.shouldInjectFor(url, windowRef)
      ) {
        const generated: GeneratedTraceParent | null =
          NetworkRecorder.generateTraceParent();

        /*
         * withTraceParent declines (null) when it cannot merge the
         * header shape safely; in that case the request goes out exactly
         * as the page built it, un-annotated.
         */
        const merged: RequestInit | null = generated
          ? NetworkRecorder.withTraceParent(init, generated.header)
          : null;

        if (generated && merged) {
          effectiveInit = merged;
          traceId = generated.traceId;
        }
      }

      const promise: Promise<Response> =
        effectiveInit === undefined
          ? original(input)
          : original(input, effectiveInit);

      if (this.options.isSelfRequest(url)) {
        return promise;
      }

      return promise.then(
        (response: Response): Response => {
          this.record(
            method,
            url,
            response.status,
            Date.now() - startedAtMs,
            NetworkRecorder.readContentLength(response),
            traceId,
          );

          return response;
        },
        (error: unknown): never => {
          /*
           * status 0 is the honest representation of a request that never
           * got a response. Re-thrown unchanged so the host page's own
           * error handling is untouched.
           */
          this.record(method, url, 0, Date.now() - startedAtMs, 0, traceId);

          throw error;
        },
      );
    }) as typeof windowRef.fetch;
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
     * only state in which setRequestHeader is legal. The original
     * setRequestHeader is used directly so the patched one does not
     * re-parse our own header, and the whole thing is try/caught because
     * a page that calls send() in a strange state should get its own
     * exception from send(), never one from us.
     */
    const maybeInjectTraceParent: (
      xhr: XMLHttpRequest,
      state: XhrState,
    ) => void = (xhr: XMLHttpRequest, state: XhrState): void => {
      if (
        state.traceId !== null ||
        state.hasPageTraceParent ||
        !this.originalXhrSetRequestHeader ||
        isSelfRequest(state.url) ||
        !this.shouldInjectFor(state.url, windowRef)
      ) {
        return;
      }

      const generated: GeneratedTraceParent | null =
        NetworkRecorder.generateTraceParent();

      if (!generated) {
        return;
      }

      try {
        this.originalXhrSetRequestHeader.apply(xhr, [
          "traceparent",
          generated.header,
        ]);
        state.traceId = generated.traceId;
      } catch {
        /* Header not set; the request proceeds un-annotated. */
      }
    };

    const recordRequest: (
      method: string,
      url: string,
      status: number,
      durationMs: number,
      responseBytes: number,
      traceId: string | null,
    ) => void = (
      method: string,
      url: string,
      status: number,
      durationMs: number,
      responseBytes: number,
      traceId: string | null,
    ): void => {
      this.record(method, url, status, durationMs, responseBytes, traceId);
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
        armed: false,
      });

      (originalOpen as (...args: Array<unknown>) => void).apply(this, [
        method,
        url,
        ...rest,
      ]);
    };

    if (typeof originalSetHeader === "function") {
      prototype["setRequestHeader"] = function patchedSetRequestHeader(
        this: XMLHttpRequest,
        name: string,
        value: string,
      ): void {
        /*
         * Only traceparent is inspected. Every other header, in particular
         * Authorization and Cookie, is passed straight through unread.
         */
        if (typeof name === "string" && name.toLowerCase() === "traceparent") {
          const state: XhrState | undefined = xhrState.get(this);

          if (state) {
            /*
             * Presence is recorded unconditionally; the parsed id only
             * when the value is well-formed. An unparseable page value
             * still suppresses injection (see XhrState.hasPageTraceParent)
             * — it just cannot be reported as a correlation id.
             */
            state.hasPageTraceParent = true;
            state.traceId = NetworkRecorder.parseTraceParent(value);
          }
        }

        (originalSetHeader as (...args: Array<unknown>) => void).apply(this, [
          name,
          value,
        ]);
      };
    }

    prototype["send"] = function patchedSend(
      this: XMLHttpRequest,
      ...args: Array<unknown>
    ): void {
      const state: XhrState | undefined = xhrState.get(this);

      if (state && !isSelfRequest(state.url)) {
        maybeInjectTraceParent(this, state);

        if (!state.armed) {
          state.armed = true;
          state.startedAtMs = Date.now();

          this.addEventListener(
            "loadend",
            (): void => {
              /*
               * A re-open()ed XHR replaces its state object; a stale
               * listener from an earlier send must not record its old
               * method/url/traceId against the new request's response
               * (and its startedAtMs would span both requests, feeding
               * a fictitious duration to the slow-request trigger).
               */
              if (xhrState.get(this) !== state) {
                return;
              }

              recordRequest(
                state.method,
                state.url,
                this.status,
                Date.now() - state.startedAtMs,
                NetworkRecorder.readXhrResponseSize(this),
                state.traceId,
              );
            },
            { once: true },
          );
        }
      }

      (originalSend as (...args: Array<unknown>) => void).apply(this, args);
    };
  }

  private record(
    method: string,
    rawUrl: string,
    status: number,
    durationMs: number,
    responseBytes: number,
    traceId: string | null,
  ): void {
    const atUnixMs: number = Date.now();

    this.options.onActivity(atUnixMs);

    if (this.recordedCount >= MAX_REQUESTS_RECORDED) {
      return;
    }

    this.recordedCount++;

    const request: RecordedRequest = {
      method: method,
      url: this.options.scrubUrl(rawUrl),
      status: status,
      durationMs: durationMs,
      responseBytes: responseBytes,
      isError: status === 0 || status >= 500,
    };

    /* Only present when there is one — absent beats null on the wire. */
    if (traceId) {
      request.traceId = traceId;
    }

    this.options.emitCustomEvent(NETWORK_CUSTOM_EVENT_TAG, request);
    this.options.onRequestComplete(atUnixMs, request, traceId);
  }

  public getRecordedCount(): number {
    return this.recordedCount;
  }

  /*
   * Does this request's ORIGIN appear in the allowlist? Relative URLs
   * resolve against the DOCUMENT BASE URL — the same base fetch and XHR
   * themselves use, which a <base href> tag can point at a different
   * origin than the page's own. Resolving against location.href instead
   * would let a fetch("/api/x") on such a page match the page's
   * allowlisted origin while the real request goes somewhere that was
   * never allowlisted — injecting exactly the preflight-breaking header
   * the allowlist exists to prevent. Anything unparseable answers no:
   * when we cannot say where a header would go, we do not add one.
   */
  private shouldInjectFor(url: string, windowRef: Window): boolean {
    if (this.injectOrigins.length === 0) {
      return false;
    }

    try {
      const resolved: URL = new URL(
        url,
        (windowRef.document && windowRef.document.baseURI) ||
          windowRef.location.href,
      );

      /* Origins only make sense for http(s); blob:, data:, ws: never match. */
      if (resolved.protocol !== "https:" && resolved.protocol !== "http:") {
        return false;
      }

      return this.injectOrigins.indexOf(resolved.origin.toLowerCase()) >= 0;
    } catch {
      return false;
    }
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
      header: `00-${traceId}-${parentId}-01`,
    };
  }

  /*
   * Return a COPY of the init with traceparent merged into whichever
   * HeadersInit shape it uses, or NULL when the shape cannot be merged
   * safely — the caller then sends the request exactly as the page built
   * it, un-annotated. Only ever called when no traceparent is present,
   * so "add" semantics are safe. The caller's own init is never mutated.
   *
   * The tricky shape is the fourth one: HeadersInit's sequence branch
   * accepts ANY iterable of pairs — a Map, a Headers from another realm
   * (which fails the same-realm instanceof), a generator. Spreading one
   * of those into a plain object copies its own enumerable properties,
   * which is the EMPTY SET — every header the page set would be silently
   * stripped from the request. Iterables are therefore merged through the
   * Headers constructor, which consumes them exactly as fetch would.
   */
  private static withTraceParent(
    init: RequestInit | undefined,
    headerValue: string,
  ): RequestInit | null {
    const next: RequestInit = init ? { ...init } : {};
    const headers: HeadersInit | undefined = init ? init.headers : undefined;

    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      const merged: Headers = new Headers(headers);
      merged.set("traceparent", headerValue);
      next.headers = merged;
    } else if (Array.isArray(headers)) {
      next.headers = [...headers, ["traceparent", headerValue]];
    } else if (NetworkRecorder.isPairIterable(headers)) {
      if (typeof Headers === "undefined") {
        return null;
      }

      try {
        const merged: Headers = new Headers(headers as HeadersInit);
        merged.set("traceparent", headerValue);
        next.headers = merged;
      } catch {
        /* An iterable Headers rejects — decline rather than guess. */
        return null;
      }
    } else if (headers && typeof headers === "object") {
      next.headers = {
        ...(headers as Record<string, string>),
        traceparent: headerValue,
      };
    } else {
      next.headers = { traceparent: headerValue };
    }

    return next;
  }

  /*
   * The HeadersInit sequence branch: any non-array iterable of pairs.
   * Arrays are excluded because they have their own cheaper merge path.
   */
  private static isPairIterable(headers: HeadersInit | undefined): boolean {
    return Boolean(
      headers &&
        typeof headers === "object" &&
        !Array.isArray(headers) &&
        typeof (headers as unknown as Record<symbol, unknown>)[
          Symbol.iterator
        ] === "function",
    );
  }

  /*
   * Is a traceparent header PRESENT in the init, by name, regardless of
   * whether its value parses? Injection gates on this rather than on
   * readTraceIdFromInit's parse, because a page-set value we cannot parse
   * (a future spec version, a vendor-lenient format) must still suppress
   * injection — overwriting it destroys the page's own trace link, and
   * appending ours produces a combined header nobody can parse.
   */
  private static hasTraceParentHeader(init?: RequestInit): boolean {
    if (!init || !init.headers) {
      return false;
    }

    const headers: HeadersInit = init.headers;

    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      return headers.get("traceparent") !== null;
    }

    if (Array.isArray(headers) || NetworkRecorder.isPairIterable(headers)) {
      try {
        for (const pair of headers as Iterable<[unknown, unknown]>) {
          const name: unknown = Array.isArray(pair)
            ? pair[0]
            : (pair as unknown as Array<unknown>)[0];

          if (
            typeof name === "string" &&
            name.toLowerCase() === "traceparent"
          ) {
            return true;
          }
        }
      } catch {
        /* An iterable that throws mid-iteration: treat as present (skip). */
        return true;
      }

      return false;
    }

    if (typeof headers === "object") {
      for (const key of Object.keys(headers as Record<string, string>)) {
        if (key.toLowerCase() === "traceparent") {
          return true;
        }
      }
    }

    return false;
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

  private static readTraceIdFromInit(init?: RequestInit): string | null {
    if (!init || !init.headers) {
      return null;
    }

    const headers: HeadersInit = init.headers;

    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      const value: string | null = headers.get("traceparent");
      return value === null ? null : NetworkRecorder.parseTraceParent(value);
    }

    if (Array.isArray(headers) || NetworkRecorder.isPairIterable(headers)) {
      try {
        for (const pair of headers as Iterable<[unknown, unknown]>) {
          const name: unknown = pair ? pair[0] : undefined;
          const value: unknown = pair ? pair[1] : undefined;

          if (
            typeof name === "string" &&
            typeof value === "string" &&
            name.toLowerCase() === "traceparent"
          ) {
            return NetworkRecorder.parseTraceParent(value);
          }
        }
      } catch {
        return null;
      }

      return null;
    }

    const record: Record<string, string> = headers as Record<string, string>;

    for (const key of Object.keys(record)) {
      if (key.toLowerCase() === "traceparent") {
        const value: string | undefined = record[key];
        return value === undefined
          ? null
          : NetworkRecorder.parseTraceParent(value);
      }
    }

    return null;
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
   * responseText is read for its LENGTH only, and only when the response type
   * makes that safe. Touching responseText on a non-text response throws in
   * some browsers, and the value itself is never emitted.
   */
  private static readXhrResponseSize(xhr: XMLHttpRequest): number {
    try {
      if (xhr.responseType === "" || xhr.responseType === "text") {
        return typeof xhr.responseText === "string"
          ? xhr.responseText.length
          : 0;
      }

      return 0;
    } catch {
      return 0;
    }
  }
}
