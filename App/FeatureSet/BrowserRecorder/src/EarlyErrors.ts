/*
 * The pre-load error buffer.
 *
 * Nothing used to listen until the loader stub finished its config round
 * trip (up to 5s) and the ~70KB artifact downloaded, parsed and started —
 * so an uncaught error during page startup, the single most common and
 * most valuable failure class for an error-triggered replay product, fired
 * into a void: no trigger, no recording, no pre-roll.
 *
 * This module is bundled into the STUB, so it is written for minified
 * SIZE first — the loader has a hard 6KB raw budget the build enforces.
 * Records are held only in memory, never posted from here, and are handed
 * to the artifact's bootstrap — which replays them through ErrorRecorder's
 * masking path — or discarded the moment any privacy or policy gate says
 * no.
 */

export interface EarlyErrorRecord {
  kind: "error" | "unhandledrejection";
  message: string;
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
  stack?: string;
  /* Wall-clock capture time, so the replayed record keeps its honest time. */
  atUnixMs: number;
}

export interface EarlyErrorBuffer {
  /* Stop listening and hand over everything captured, exactly once. */
  drain: () => Array<EarlyErrorRecord>;

  /* Stop listening and forget everything. For the fail-closed exits. */
  discard: () => void;
}

/*
 * Small on purpose: this exists to catch THE startup crash, not to archive
 * a render loop that throws per frame. The artifact's own ErrorRecorder
 * takes over (with its larger cap) as soon as it starts.
 */
export const MAX_EARLY_ERRORS: number = 20;

/* Same bounds the ErrorRecorder applies, enforced at capture. */
const MAX_MESSAGE_LENGTH: number = 1000;
const MAX_STACK_LENGTH: number = 4000;

export function installEarlyErrorBuffer(
  windowRef: Window = window,
): EarlyErrorBuffer {
  const records: Array<EarlyErrorRecord> = [];

  const push: (record: EarlyErrorRecord, thrown: unknown) => void = (
    record: EarlyErrorRecord,
    thrown: unknown,
  ): void => {
    if (records.length >= MAX_EARLY_ERRORS) {
      return;
    }

    const stack: unknown =
      thrown && typeof thrown === "object"
        ? (thrown as Record<string, unknown>)["stack"]
        : undefined;

    if (typeof stack === "string" && stack) {
      record.stack = stack.slice(0, MAX_STACK_LENGTH);
    }

    record.message = record.message.slice(0, MAX_MESSAGE_LENGTH);
    records.push(record);
  };

  const errorListener: (event: ErrorEvent) => void = (
    event: ErrorEvent,
  ): void => {
    const record: EarlyErrorRecord = {
      kind: "error",
      message: event.message || "",
      atUnixMs: Date.now(),
    };

    if (typeof event.filename === "string" && event.filename) {
      record.source = event.filename;
    }

    if (typeof event.lineno === "number") {
      record.lineNumber = event.lineno;
    }

    if (typeof event.colno === "number") {
      record.columnNumber = event.colno;
    }

    push(record, event.error);
  };

  const rejectionListener: (event: PromiseRejectionEvent) => void = (
    event: PromiseRejectionEvent,
  ): void => {
    const reason: unknown = event.reason;

    /*
     * Only a short description, never a dump: a rejected fetch's reason
     * can carry a whole response body. The message-bearing branches cover
     * Error instances and error-shaped objects alike.
     */
    let message: string;

    if (typeof reason === "string") {
      message = reason;
    } else if (reason && typeof reason === "object") {
      const described: unknown = (reason as Record<string, unknown>)["message"];

      message =
        typeof described === "string" && described
          ? described
          : "Unhandled rejection";
    } else {
      message =
        reason === null || reason === undefined
          ? "Unhandled rejection"
          : String(reason);
    }

    push(
      { kind: "unhandledrejection", message: message, atUnixMs: Date.now() },
      reason,
    );
  };

  /*
   * Capture phase, and listeners are only ever ADDED — window.onerror is a
   * single assignable slot that belongs to whatever error tracker the
   * customer already runs. removeEventListener is naturally idempotent, so
   * no installed-flag is needed.
   */
  windowRef.addEventListener("error", errorListener, true);
  windowRef.addEventListener(
    "unhandledrejection",
    rejectionListener as EventListener,
    true,
  );

  const uninstall: () => void = (): void => {
    windowRef.removeEventListener("error", errorListener, true);
    windowRef.removeEventListener(
      "unhandledrejection",
      rejectionListener as EventListener,
      true,
    );
  };

  return {
    drain: (): Array<EarlyErrorRecord> => {
      uninstall();
      return records.splice(0, records.length);
    },
    discard: (): void => {
      uninstall();
      records.length = 0;
    },
  };
}
