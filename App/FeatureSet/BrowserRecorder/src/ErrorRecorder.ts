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
}

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
      masked.source = error.source;
    }

    if (error.lineNumber !== undefined) {
      masked.lineNumber = error.lineNumber;
    }

    if (error.columnNumber !== undefined) {
      masked.columnNumber = error.columnNumber;
    }

    if (error.stack !== undefined) {
      /*
       * The stack is NOT masked. It is frames and file paths, which is
       * exactly what makes it useful, and it is the one string in this
       * payload that is authored by the customer's own build rather than by
       * their end user.
       */
      masked.stack = error.stack.slice(0, MAX_STACK_LENGTH);
    }

    const atUnixMs: number = Date.now();

    this.options.emitCustomEvent(ERROR_CUSTOM_EVENT_TAG, masked);
    this.options.onError(atUnixMs, masked);
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
