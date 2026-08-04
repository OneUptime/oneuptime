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
 */

export const ERROR_CUSTOM_EVENT_TAG: string = "oneuptime.error";

/* Stacks are truncated: a full stack from a bundled SPA can be tens of KB. */
const MAX_STACK_LENGTH: number = 4000;
const MAX_MESSAGE_LENGTH: number = 1000;

/*
 * Per-page cap. A page that throws in a requestAnimationFrame loop would
 * otherwise fill every chunk with the same error and crowd out the DOM
 * events that make the recording worth watching.
 */
const MAX_ERRORS_RECORDED: number = 100;

export interface RecordedError {
  kind: "error" | "unhandledrejection";
  message: string;
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
  stack?: string;
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
   * cross-origin "Script error." noise, and anything the application's
   * ignoreErrorPatterns match.
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
}

/*
 * Matches an absolute http(s) URL inside free-form text. Terminated on
 * whitespace and on the closing parenthesis that both V8 and SpiderMonkey put
 * around a stack frame's location.
 */
const URL_IN_TEXT: RegExp = /https?:\/\/[^\s)'"]+/g;

export default class ErrorRecorder {
  private readonly options: ErrorRecorderOptions;
  private recordedCount: number = 0;
  private started: boolean = false;

  private readonly errorListener: (event: ErrorEvent) => void;
  private readonly rejectionListener: (event: PromiseRejectionEvent) => void;

  public constructor(options: ErrorRecorderOptions) {
    this.options = options;

    this.errorListener = (event: ErrorEvent): void => {
      this.handle({
        kind: "error",
        message: event.message || "",
        ...(typeof event.filename === "string" && event.filename
          ? { source: event.filename }
          : {}),
        ...(typeof event.lineno === "number"
          ? { lineNumber: event.lineno }
          : {}),
        ...(typeof event.colno === "number"
          ? { columnNumber: event.colno }
          : {}),
        ...ErrorRecorder.readStack(event.error),
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
     * the bubble path stops propagation.
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
   * Record one error, replayed from a buffer the loader stub filled before
   * this module existed. occurredAtUnixMs is the ORIGINAL wall-clock time,
   * so the trigger decision and the emitted payload describe when the
   * error actually happened rather than when the recorder finished
   * loading.
   */
  public record(error: RecordedError, occurredAtUnixMs?: number): void {
    this.handle(error, occurredAtUnixMs);
  }

  private handle(error: RecordedError, occurredAtUnixMs?: number): void {
    if (this.recordedCount >= MAX_ERRORS_RECORDED) {
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

    const atUnixMs: number = occurredAtUnixMs ?? Date.now();

    /*
     * The trigger decision runs on the RAW error, before masking: an
     * ignore pattern written against "ResizeObserver loop limit exceeded"
     * must not silently stop matching because the masking transform
     * rewrote the message.
     */
    const isTriggerWorthy: boolean =
      !ErrorRecorder.isUnactionableCrossOriginError(error) &&
      !this.matchesIgnorePattern(error);

    const payload: Record<string, unknown> = { ...masked };

    if (occurredAtUnixMs !== undefined) {
      /* Replayed from before recording started; carry the honest time. */
      payload["occurredAtUnixMs"] = occurredAtUnixMs;
    }

    this.options.emitCustomEvent(ERROR_CUSTOM_EVENT_TAG, payload);
    this.options.onError(atUnixMs, masked, isTriggerWorthy);
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

    return message === "script error." || message === "script error";
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

  public getRecordedCount(): number {
    return this.recordedCount;
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
