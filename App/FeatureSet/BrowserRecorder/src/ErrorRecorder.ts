/*
 * Uncaught errors and unhandled promise rejections.
 *
 * This is both an observability signal and THE trigger: in the default
 * capture mode nothing is uploaded until one of these fires, which is what
 * turns "a 10% chance a recording exists when an engineer looks" into
 * "nearly always, for the sessions that failed".
 *
 * Listeners are added, never anything replaced. window.onerror is a single
 * assignable slot and taking it would break whatever error tracker the
 * customer already has installed - including ours.
 *
 * Two things the first version got wrong, both of which made the trigger
 * fire for the wrong reasons or stop firing for the right ones:
 *
 *  - A capture-phase `error` listener on window also hears the NON-bubbling
 *    `error` event an <img>, <script> or <link> fires when its resource
 *    fails to load. That is a plain Event, not an ErrorEvent: no message, no
 *    filename, no stack. It was recorded as a JavaScript error with an empty
 *    message and, having no "Script error." signature to exclude it, it was
 *    trigger-worthy - so one broken image or one ad-blocked tag uploaded the
 *    session under the Error reason and burned the error cap on noise.
 *    Resource failures are now their own kind, and never a trigger.
 *
 *  - Nothing de-duplicated. A page throwing in a requestAnimationFrame loop
 *    spent the whole 100-error cap on one error inside two seconds, and the
 *    first NEW error after that - the one that explained the failure - was
 *    dropped with nothing to say so. Errors are fingerprinted; a repeat
 *    counts against its fingerprint, not the cap, and surfaces as a
 *    rate-limited repeat marker carrying the occurrence count.
 */

export const ERROR_CUSTOM_EVENT_TAG: string = "oneuptime.error";

/* Stacks are truncated: a full stack from a bundled SPA can be tens of KB. */
const MAX_STACK_LENGTH: number = 4000;
const MAX_MESSAGE_LENGTH: number = 1000;

/*
 * Per-SESSION cap on DISTINCT errors. Repeats of an already-recorded error
 * do not count. Reset by resetForNewSession() when the recorder rolls the
 * session over.
 */
export const MAX_ERRORS_RECORDED: number = 100;

/*
 * How often a repeating error may put a repeat marker into the stream. The
 * marker carries the running count, so a viewer sees "this threw 2,400
 * times" rather than 2,400 identical rows or, worse, nothing at all.
 */
export const REPEAT_MARKER_INTERVAL_MS: number = 5000;

/* How much of a stack's first frame line takes part in the fingerprint. */
const FINGERPRINT_FRAME_LENGTH: number = 200;

export type RecordedErrorKind = "error" | "unhandledrejection" | "resource";

export interface RecordedError {
  kind: RecordedErrorKind;
  message: string;
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
  stack?: string;

  /* For kind "resource": the element that failed to load, lower-case. */
  tagName?: string;
}

/*
 * The wire payload: the masked error plus what the fingerprinting adds.
 * Absent fields mean "a first occurrence, recorded while recording was
 * running", which is what every payload before this looked like.
 */
export interface RecordedErrorPayload extends RecordedError {
  occurredAtUnixMs?: number;

  /* Set on a repeat marker: how many times this fingerprint has occurred. */
  occurrences?: number;
  isRepeat?: boolean;

  /* Set on the single entry emitted when the per-session cap is hit. */
  isCapMarker?: boolean;
}

/*
 * Compiled ignore rules, plus how many pattern strings could not compile.
 * Kept as a struct so a recorder can self-report discarded patterns
 * instead of silently narrowing the customer's intent.
 */
export interface CompiledIgnorePatterns {
  patterns: Array<RegExp>;
  discardedCount: number;
}

/*
 * The config endpoint is the only source of these strings, but it is still
 * remote input: an unbounded list of pathological regexes evaluated on
 * every uncaught error would be a self-inflicted ReDoS on the customer's
 * page. Both the count and each pattern's length are capped.
 */
export const MAX_IGNORE_PATTERNS: number = 20;
export const MAX_IGNORE_PATTERN_LENGTH: number = 200;

export interface ErrorRecorderOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;

  /*
   * Called for every error observed, with the wall-clock time it happened.
   * isTriggerWorthy is false for errors that are recorded but must not
   * convert an error-triggered session into an upload: stackless
   * cross-origin "Script error." noise, resource load failures, and
   * anything the application's ignoreErrorPatterns match.
   *
   * Also called for each emitted repeat marker, with the verdict the first
   * occurrence got - a repeating error is still the same error.
   */
  onError: (
    atUnixMs: number,
    error: RecordedError,
    isTriggerWorthy: boolean,
  ) => void;

  /* Config-driven message/source patterns whose errors never trigger. */
  ignorePatterns?: Array<RegExp>;

  /*
   * Error messages routinely quote user data ("could not save order for
   * alice@example.com"), so they go through the same masking transform as a
   * text node rather than being treated as developer-authored strings.
   */
  maskMessage: (message: string) => string;

  /*
   * URL scrubbing is the one PII channel maskAllText does not cover, and it
   * reaches this module through two doors that are easy to miss.
   *
   * For an error thrown from an inline script the browser sets
   * ErrorEvent.filename to the DOCUMENT's URL, query string included - so an
   * uncaught error on /reset-password?token=... would otherwise post the live
   * token. Stack frames carry the same URLs. Every other URL in this package
   * (Meta href, route changes, network events, entryUrl) goes through
   * UrlScrubber; these two now do as well.
   */
  scrubUrl: (url: string) => string;

  /*
   * Called ONCE per session when the cap first drops a distinct error, so
   * the recorder can attach a fidelity notice to the chunk. Optional so the
   * wiring can land independently of this module.
   */
  onCapReached?: (cap: number) => void;
}

/*
 * Matches an absolute http(s) URL inside free-form text. Terminated on
 * whitespace and on the closing parenthesis that both V8 and SpiderMonkey put
 * around a stack frame's location.
 */
const URL_IN_TEXT: RegExp = /https?:\/\/[^\s)'"]+/g;

interface FingerprintRecord {
  occurrences: number;
  lastMarkerAtMs: number;
  masked: RecordedError;
  isTriggerWorthy: boolean;
}

export default class ErrorRecorder {
  private readonly options: ErrorRecorderOptions;
  private recordedCount: number = 0;
  private capReported: boolean = false;
  private started: boolean = false;

  /* Everything recorded this session, keyed by fingerprint. */
  private fingerprints: Map<string, FingerprintRecord> = new Map<
    string,
    FingerprintRecord
  >();

  private readonly errorListener: (event: Event) => void;
  private readonly rejectionListener: (event: PromiseRejectionEvent) => void;

  public constructor(options: ErrorRecorderOptions) {
    this.options = options;

    this.errorListener = (event: Event): void => {
      const resource: RecordedError | null =
        ErrorRecorder.describeResourceFailure(event);

      if (resource) {
        this.handle(resource);
        return;
      }

      const errorEvent: ErrorEvent = event as ErrorEvent;

      this.handle({
        kind: "error",
        message: errorEvent.message || "",
        ...(typeof errorEvent.filename === "string" && errorEvent.filename
          ? { source: errorEvent.filename }
          : {}),
        ...(typeof errorEvent.lineno === "number"
          ? { lineNumber: errorEvent.lineno }
          : {}),
        ...(typeof errorEvent.colno === "number"
          ? { columnNumber: errorEvent.colno }
          : {}),
        ...ErrorRecorder.readStack(errorEvent.error),
      });
    };

    this.rejectionListener = (event: PromiseRejectionEvent): void => {
      this.handle({
        kind: "unhandledrejection",
        message: ErrorRecorder.describeRejection(event.reason),
        ...ErrorRecorder.readStack(event.reason),
      });
    };
  }

  public start(windowRef: Window = window): void {
    if (this.started) {
      return;
    }

    this.started = true;

    /*
     * Capture phase so an error is observed even when a listener earlier in
     * the bubble path stops propagation. This is also what delivers resource
     * load failures here - see the module header.
     */
    windowRef.addEventListener("error", this.errorListener, true);
    windowRef.addEventListener(
      "unhandledrejection",
      this.rejectionListener as EventListener,
      true,
    );
  }

  public stop(windowRef: Window = window): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    windowRef.removeEventListener("error", this.errorListener, true);
    windowRef.removeEventListener(
      "unhandledrejection",
      this.rejectionListener as EventListener,
      true,
    );
  }

  /*
   * A rotated session starts with a fresh cap and no memory of the previous
   * session's errors: an error that first happened hours ago is a first
   * occurrence again in a recording that starts now.
   */
  public resetForNewSession(): void {
    this.recordedCount = 0;
    this.capReported = false;
    this.fingerprints = new Map<string, FingerprintRecord>();
  }

  /*
   * Record one error, replayed from a buffer the loader stub filled before
   * this module existed. occurredAtUnixMs is the ORIGINAL wall-clock time,
   * so the trigger decision and the emitted payload describe when the
   * error actually happened rather than when the recorder finished
   * loading.
   */
  public record(error: RecordedError, occurredAtUnixMs?: number): void {
    this.handle(error, occurredAtUnixMs);
  }

  /*
   * A resource load failure, or null when the event is a real ErrorEvent.
   *
   * The `error` event of an <img>, <script>, <link>, <video>... does not
   * bubble, but a CAPTURE listener on window still hears it. Its target is
   * the element; a script error's target is the window. That, not the event
   * class, is the test: some engines deliver both as ErrorEvent.
   */
  private static describeResourceFailure(event: Event): RecordedError | null {
    const target: EventTarget | null = event.target;

    if (
      !target ||
      typeof Element === "undefined" ||
      !(target instanceof Element)
    ) {
      return null;
    }

    const tagName: string = (target.tagName || "").toLowerCase();

    const url: string =
      (target as Element).getAttribute("src") ||
      (target as Element).getAttribute("href") ||
      "";

    return {
      kind: "resource",
      message: `Resource failed to load: <${tagName || "element"}>`,
      tagName: tagName,
      ...(url ? { source: url } : {}),
    };
  }

  private handle(error: RecordedError, occurredAtUnixMs?: number): void {
    const atUnixMs: number = occurredAtUnixMs ?? Date.now();
    const fingerprint: string = ErrorRecorder.fingerprintOf(error);

    const known: FingerprintRecord | undefined =
      this.fingerprints.get(fingerprint);

    if (known) {
      this.handleRepeat(known, atUnixMs);
      return;
    }

    if (this.recordedCount >= MAX_ERRORS_RECORDED) {
      this.reportCapOnce(atUnixMs);
      return;
    }

    this.recordedCount++;

    const masked: RecordedError = {
      kind: error.kind,
      message: this.options
        .maskMessage(error.message)
        .slice(0, MAX_MESSAGE_LENGTH),
    };

    if (error.source !== undefined) {
      masked.source = this.options.scrubUrl(error.source);
    }

    if (error.lineNumber !== undefined) {
      masked.lineNumber = error.lineNumber;
    }

    if (error.columnNumber !== undefined) {
      masked.columnNumber = error.columnNumber;
    }

    if (error.tagName !== undefined) {
      masked.tagName = error.tagName;
    }

    if (error.stack !== undefined) {
      /*
       * The stack's TEXT is not masked: it is frames and file paths, which is
       * exactly what makes it useful, and it is the one string in this
       * payload authored by the customer's own build rather than by their end
       * user. Its URLs are scrubbed, though - a frame in an inline script is
       * attributed to the document URL, query string and all.
       *
       * Scrubbed before truncation so the cut lands in already-safe text
       * rather than in the middle of a query string.
       */
      masked.stack = this.scrubUrlsIn(error.stack).slice(0, MAX_STACK_LENGTH);
    }

    /*
     * The trigger decision runs on the RAW error, before masking: an
     * ignore pattern written against "ResizeObserver loop limit exceeded"
     * must not silently stop matching because the masking transform
     * rewrote the message.
     */
    const isTriggerWorthy: boolean =
      error.kind !== "resource" &&
      !ErrorRecorder.isUnactionableCrossOriginError(error) &&
      !this.matchesIgnorePattern(error);

    this.fingerprints.set(fingerprint, {
      occurrences: 1,
      lastMarkerAtMs: atUnixMs,
      masked: masked,
      isTriggerWorthy: isTriggerWorthy,
    });

    const payload: RecordedErrorPayload = { ...masked };

    if (occurredAtUnixMs !== undefined) {
      /* Replayed from before recording started; carry the honest time. */
      payload.occurredAtUnixMs = occurredAtUnixMs;
    }

    this.options.emitCustomEvent(ERROR_CUSTOM_EVENT_TAG, payload);
    this.options.onError(atUnixMs, masked, isTriggerWorthy);
  }

  /*
   * An error already recorded this session happened again. It costs
   * nothing against the cap; at most once per interval it puts a marker in
   * the stream carrying the running count, and reports through onError
   * with the verdict its first occurrence got.
   */
  private handleRepeat(known: FingerprintRecord, atUnixMs: number): void {
    known.occurrences++;

    if (atUnixMs - known.lastMarkerAtMs < REPEAT_MARKER_INTERVAL_MS) {
      return;
    }

    known.lastMarkerAtMs = atUnixMs;

    const payload: RecordedErrorPayload = {
      ...known.masked,
      isRepeat: true,
      occurrences: known.occurrences,
    };

    this.options.emitCustomEvent(ERROR_CUSTOM_EVENT_TAG, payload);
    this.options.onError(atUnixMs, known.masked, known.isTriggerWorthy);
  }

  /*
   * The first DISTINCT error past the cap becomes ONE marker in the stream,
   * so the Errors panel shows where recording stopped and why instead of
   * simply ending. Never a trigger, emitted once per session.
   */
  private reportCapOnce(atUnixMs: number): void {
    if (this.capReported) {
      return;
    }

    this.capReported = true;

    const marker: RecordedErrorPayload = {
      kind: "error",
      message: `Error capture stopped after ${MAX_ERRORS_RECORDED} distinct errors in this session; later errors were not recorded.`,
      isCapMarker: true,
    };

    this.options.emitCustomEvent(ERROR_CUSTOM_EVENT_TAG, marker);
    this.options.onError(atUnixMs, marker, false);

    if (this.options.onCapReached) {
      this.options.onCapReached(MAX_ERRORS_RECORDED);
    }
  }

  /*
   * What makes two errors "the same": kind, raw message, source location,
   * and the first stack frame. The message alone is not enough (two
   * components can throw "Cannot read properties of undefined") and the
   * whole stack is too much (column numbers drift across a minified
   * bundle's hot reloads). Computed on the RAW error - it never leaves the
   * page.
   */
  public static fingerprintOf(error: RecordedError): string {
    let frame: string = "";

    if (error.stack) {
      const lines: Array<string> = error.stack.split("\n");

      for (let index: number = 1; index < lines.length; index++) {
        const candidate: string = (lines[index] || "").trim();

        if (candidate) {
          frame = candidate.slice(0, FINGERPRINT_FRAME_LENGTH);
          break;
        }
      }
    }

    return [
      error.kind,
      error.message,
      error.source || "",
      error.lineNumber === undefined ? "" : String(error.lineNumber),
      error.columnNumber === undefined ? "" : String(error.columnNumber),
      error.tagName || "",
      frame,
    ].join("|");
  }

  /*
   * The opaque signature of an error thrown by a cross-origin script
   * loaded without crossorigin="anonymous": the browser hides everything
   * and reports the literal message "Script error." with no stack, no
   * filename, no line. Ads, tag managers and browser extensions produce
   * these chronically, and ONE such tag on a page converts error-triggered
   * capture into always-on upload — silently destroying the storage and
   * privacy bet the whole default rests on. The error is still recorded
   * (an engineer watching the session should see it happened); it just
   * cannot be the reason a recording uploads, because it is unactionable
   * by definition: there is nothing in it to fix.
   */
  private static isUnactionableCrossOriginError(error: RecordedError): boolean {
    if (error.kind !== "error") {
      return false;
    }

    if (error.stack || error.source) {
      return false;
    }

    const message: string = error.message.trim().toLowerCase();

    /*
     * An EMPTY message with no source and no stack is the same nothing by
     * another route: it is what a resource failure looks like after a
     * listener that did not classify it (the loader stub's pre-load buffer
     * records `event.message || ""`). There is nothing in it to fix, so it
     * cannot be the reason a recording uploads.
     */
    return (
      message === "" ||
      message === "script error." ||
      message === "script error"
    );
  }

  private matchesIgnorePattern(error: RecordedError): boolean {
    const patterns: Array<RegExp> | undefined = this.options.ignorePatterns;

    if (!patterns || patterns.length === 0) {
      return false;
    }

    for (const pattern of patterns) {
      /*
       * lastIndex reset defensively: a compiled pattern carrying the /g
       * flag would otherwise match every OTHER occurrence.
       */
      pattern.lastIndex = 0;

      if (pattern.test(error.message)) {
        return true;
      }

      if (error.source !== undefined) {
        pattern.lastIndex = 0;

        if (pattern.test(error.source)) {
          return true;
        }
      }
    }

    return false;
  }

  /*
   * Compile config-supplied pattern strings, dropping anything that does
   * not compile or exceeds the caps. Invalid patterns must not take the
   * recorder down — a customer typo in one pattern should cost that
   * pattern, not the whole feature.
   */
  public static compileIgnorePatterns(
    patternStrings: Array<string>,
  ): CompiledIgnorePatterns {
    const patterns: Array<RegExp> = [];
    let discardedCount: number = 0;

    for (const patternString of patternStrings.slice(0, MAX_IGNORE_PATTERNS)) {
      if (!patternString || patternString.length > MAX_IGNORE_PATTERN_LENGTH) {
        discardedCount++;
        continue;
      }

      try {
        patterns.push(new RegExp(patternString, "i"));
      } catch {
        discardedCount++;
      }
    }

    discardedCount += Math.max(0, patternStrings.length - MAX_IGNORE_PATTERNS);

    return { patterns: patterns, discardedCount: discardedCount };
  }

  private scrubUrlsIn(text: string): string {
    /*
     * The global regex is reset before use: a module-scope /g regex carries
     * lastIndex between calls, which would make the second error's stack
     * scrub from wherever the first one stopped.
     */
    URL_IN_TEXT.lastIndex = 0;

    return text.replace(URL_IN_TEXT, (url: string): string => {
      return this.options.scrubUrl(url);
    });
  }

  /* Distinct errors recorded this session. */
  public getRecordedCount(): number {
    return this.recordedCount;
  }

  /* Total occurrences seen this session, repeats included. */
  public getOccurrenceCount(): number {
    let total: number = 0;

    this.fingerprints.forEach((record: FingerprintRecord): void => {
      total += record.occurrences;
    });

    return total;
  }

  public hasReachedCap(): boolean {
    return this.capReported;
  }

  private static readStack(value: unknown): { stack?: string } {
    if (value && typeof value === "object") {
      const stack: unknown = (value as Record<string, unknown>)["stack"];

      if (typeof stack === "string" && stack) {
        return { stack: stack };
      }
    }

    return {};
  }

  /*
   * A rejection reason can be anything at all, including a DOM node or a
   * huge object. Only a short description is taken, and never a JSON dump,
   * because a rejected fetch's reason can carry a whole response body.
   */
  private static describeRejection(reason: unknown): string {
    if (reason === null || reason === undefined) {
      return "Unhandled rejection";
    }

    if (typeof reason === "string") {
      return reason;
    }

    if (reason instanceof Error) {
      return `${reason.name}: ${reason.message}`;
    }

    if (typeof reason === "object") {
      const message: unknown = (reason as Record<string, unknown>)["message"];

      if (typeof message === "string" && message) {
        return message;
      }

      return "Unhandled rejection with non-error reason";
    }

    return String(reason);
  }
}
