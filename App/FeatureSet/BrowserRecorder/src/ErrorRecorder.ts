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

export interface ErrorRecorderOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;

  /* Called for every error observed, with the wall-clock time it happened. */
  onError: (atUnixMs: number, error: RecordedError) => void;

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

  private handle(error: RecordedError): void {
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

    const atUnixMs: number = Date.now();

    this.options.emitCustomEvent(ERROR_CUSTOM_EVENT_TAG, masked);
    this.options.onError(atUnixMs, masked);
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
