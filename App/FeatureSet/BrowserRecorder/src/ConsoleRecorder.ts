import { LOG_PREFIX } from "./Debug";

/*
 * console.error and console.warn only.
 *
 * Deliberately not console.log / info / debug: on a chatty application those
 * are the highest-volume text channel on the page and they routinely carry
 * whole API responses. Recording them would put more end-user data in the
 * payload than the DOM does, in a feature whose entire posture is mask first.
 *
 * Arguments go through the SAME masking transform as a text node, so a
 * MaskAllText application cannot leak through a console call.
 */

export const CONSOLE_CUSTOM_EVENT_TAG: string = "oneuptime.console";

/* Per-argument and per-message truncation, applied after masking. */
const MAX_ARGUMENT_LENGTH: number = 512;
const MAX_MESSAGE_LENGTH: number = 2048;

/*
 * Per-SESSION cap: a warn inside a render loop must not fill the payload.
 * Reset by resetForNewSession() when the recorder rolls the session over,
 * because a cap that outlived the session left every later session on a
 * long-lived tab with an empty Console tab and no explanation.
 */
export const MAX_CONSOLE_RECORDED: number = 100;

/*
 * Shallow object serialisation limits. Two levels, a handful of keys, short
 * strings: enough to read `{status: 500, body: {...}}` in the Console tab,
 * nowhere near enough to carry an API response.
 */
const MAX_SERIALISE_DEPTH: number = 2;
const MAX_SERIALISE_KEYS: number = 10;
const MAX_SERIALISE_STRING: number = 64;
const MAX_SERIALISE_LENGTH: number = 512;

/*
 * Keys whose values are never serialised, in any masking mode. Text masking
 * is a per-mode policy; a password in a console.error is not something any
 * mode should be able to opt into.
 */
const SENSITIVE_KEY_PATTERN: RegExp =
  /(password|passwd|secret|token|auth|cookie|session|credential|api[-_]?key|ssn|card|pan|cvv|cvc|iban|account)/i;

export type ConsoleLevel = "error" | "warn";

export interface RecordedConsoleEntry {
  level: ConsoleLevel;
  message: string;

  /*
   * Present, and true, on the one entry emitted when the per-session cap is
   * hit. The message is the explanation a viewer reads in the Console tab;
   * the flag is what code branches on.
   */
  isCapMarker?: boolean;
}

export interface ConsoleRecorderOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;

  /* Same transform used for DOM text nodes. */
  maskArgument: (value: string) => string;

  onConsole: (atUnixMs: number, entry: RecordedConsoleEntry) => void;

  /*
   * Called ONCE per session when the cap first drops an entry, so the
   * recorder can attach a fidelity notice to the chunk. Optional so the
   * wiring can land independently of this module.
   */
  onCapReached?: (cap: number) => void;
}

type ConsoleMethod = (...args: Array<unknown>) => void;

export default class ConsoleRecorder {
  private readonly options: ConsoleRecorderOptions;

  private recordedCount: number = 0;
  private capReported: boolean = false;
  private started: boolean = false;

  private originals: Map<ConsoleLevel, ConsoleMethod> = new Map<
    ConsoleLevel,
    ConsoleMethod
  >();

  public constructor(options: ConsoleRecorderOptions) {
    this.options = options;
  }

  public start(consoleRef: Console = console): void {
    if (this.started) {
      return;
    }

    this.started = true;

    const levels: Array<ConsoleLevel> = ["error", "warn"];
    const consoleRecord: Record<string, unknown> =
      consoleRef as unknown as Record<string, unknown>;

    for (const level of levels) {
      const original: unknown = consoleRecord[level];

      if (typeof original !== "function") {
        continue;
      }

      const originalMethod: ConsoleMethod = original as ConsoleMethod;

      this.originals.set(level, originalMethod);

      /*
       * Lexically bound rather than aliasing `this`: the wrapper itself has no
       * use for its own receiver, it just needs to reach the recorder.
       */
      const recordEntry: (args: Array<unknown>) => void = (
        args: Array<unknown>,
      ): void => {
        this.record(level, args);
      };

      consoleRecord[level] = function patchedConsole(
        ...args: Array<unknown>
      ): void {
        /*
         * The original runs FIRST and outside the try, so a bug in our
         * recording path can never swallow a customer's console output.
         */
        originalMethod.apply(consoleRef, args);

        try {
          recordEntry(args);
        } catch {
          /* Recording is best effort; the developer's console is not. */
        }
      };
    }
  }

  public stop(consoleRef: Console = console): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    const consoleRecord: Record<string, unknown> =
      consoleRef as unknown as Record<string, unknown>;

    this.originals.forEach(
      (original: ConsoleMethod, level: ConsoleLevel): void => {
        consoleRecord[level] = original;
      },
    );

    this.originals = new Map<ConsoleLevel, ConsoleMethod>();
  }

  /*
   * A rotated session starts with a fresh cap. Called by the recorder from
   * its rotation path alongside the other per-session resets.
   */
  public resetForNewSession(): void {
    this.recordedCount = 0;
    this.capReported = false;
  }

  private record(level: ConsoleLevel, args: Array<unknown>): void {
    /*
     * The recorder's own diagnostics. They go through the same patched
     * console.warn as everything else on the page, and recording them would
     * put OneUptime's log lines into the customer's replay and spend the cap
     * on them. Skipped before the cap is consulted, so they cost nothing.
     */
    if (ConsoleRecorder.isOwnDiagnostic(args)) {
      return;
    }

    if (this.recordedCount >= MAX_CONSOLE_RECORDED) {
      this.reportCapOnce();
      return;
    }

    this.recordedCount++;

    const parts: Array<string> = args.map((arg: unknown): string => {
      return this.options
        .maskArgument(ConsoleRecorder.describe(arg))
        .slice(0, MAX_ARGUMENT_LENGTH);
    });

    const entry: RecordedConsoleEntry = {
      level: level,
      message: parts.join(" ").slice(0, MAX_MESSAGE_LENGTH),
    };

    this.options.emitCustomEvent(CONSOLE_CUSTOM_EVENT_TAG, entry);
    this.options.onConsole(Date.now(), entry);
  }

  /*
   * The first entry past the cap becomes ONE marker in the stream, so the
   * Console tab shows where recording stopped and why instead of simply
   * ending. Not counted against the cap, and emitted once per session.
   */
  private reportCapOnce(): void {
    if (this.capReported) {
      return;
    }

    this.capReported = true;

    const entry: RecordedConsoleEntry = {
      level: "warn",
      message: `Console capture stopped after ${MAX_CONSOLE_RECORDED} entries in this session; later console output was not recorded.`,
      isCapMarker: true,
    };

    this.options.emitCustomEvent(CONSOLE_CUSTOM_EVENT_TAG, entry);
    this.options.onConsole(Date.now(), entry);

    if (this.options.onCapReached) {
      this.options.onCapReached(MAX_CONSOLE_RECORDED);
    }
  }

  public static isOwnDiagnostic(args: Array<unknown>): boolean {
    const first: unknown = args[0];

    return typeof first === "string" && first.startsWith(LOG_PREFIX);
  }

  public getRecordedCount(): number {
    return this.recordedCount;
  }

  public hasReachedCap(): boolean {
    return this.capReported;
  }

  /*
   * Describe an argument, shallowly.
   *
   * Strings, numbers and errors carry their content through (masked by the
   * caller). Plain objects and arrays are serialised two levels deep with
   * a small key budget and short strings, with sensitive-looking keys
   * redacted whatever the masking mode; anything deeper or larger is
   * summarised. Never JSON.stringify: that is how a recorder ends up
   * shipping an entire API response, a DOM subtree, or a circular structure
   * that throws.
   */
  public static describe(value: unknown): string {
    return ConsoleRecorder.describeValue(value, 0, []).slice(
      0,
      MAX_SERIALISE_LENGTH,
    );
  }

  private static describeValue(
    value: unknown,
    depth: number,
    ancestors: Array<unknown>,
  ): string {
    if (value === null) {
      return "null";
    }

    if (value === undefined) {
      return "undefined";
    }

    if (typeof value === "string") {
      return depth === 0
        ? value
        : JSON.stringify(ConsoleRecorder.truncate(value));
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return String(value);
    }

    if (value instanceof Error) {
      return `${value.name}: ${value.message}`;
    }

    if (typeof value === "function") {
      return "[Function]";
    }

    if (typeof value === "symbol") {
      return "[Symbol]";
    }

    if (typeof value !== "object") {
      return `[${typeof value}]`;
    }

    if (ancestors.includes(value)) {
      return "[Circular]";
    }

    /*
     * DOM nodes and platform objects are named, never walked: a walked
     * element would carry its text content through as attribute values.
     */
    if (typeof Node !== "undefined" && value instanceof Node) {
      return `[${value.nodeName}]`;
    }

    if (value instanceof Date) {
      return Number.isFinite(value.getTime())
        ? value.toISOString()
        : "[Invalid Date]";
    }

    if (value instanceof Map) {
      return `[Map(${value.size})]`;
    }

    if (value instanceof Set) {
      return `[Set(${value.size})]`;
    }

    if (Array.isArray(value)) {
      if (depth >= MAX_SERIALISE_DEPTH) {
        return `[Array(${value.length})]`;
      }

      const items: Array<string> = value
        .slice(0, MAX_SERIALISE_KEYS)
        .map((item: unknown): string => {
          return ConsoleRecorder.describeValue(item, depth + 1, [
            ...ancestors,
            value,
          ]);
        });

      if (value.length > MAX_SERIALISE_KEYS) {
        items.push(`… ${value.length - MAX_SERIALISE_KEYS} more`);
      }

      return `[${items.join(", ")}]`;
    }

    const constructorName: string =
      value.constructor && typeof value.constructor.name === "string"
        ? value.constructor.name
        : "Object";

    const isPlain: boolean =
      constructorName === "Object" || constructorName === "";

    if (!isPlain || depth >= MAX_SERIALISE_DEPTH) {
      return `[${constructorName || "Object"}]`;
    }

    let keys: Array<string> = [];

    try {
      keys = Object.keys(value);
    } catch {
      return "[Object]";
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;

    const fields: Array<string> = keys
      .slice(0, MAX_SERIALISE_KEYS)
      .map((key: string): string => {
        const shownKey: string = ConsoleRecorder.truncate(key);

        if (SENSITIVE_KEY_PATTERN.test(key)) {
          return `${shownKey}: [redacted]`;
        }

        let field: unknown = undefined;

        try {
          field = record[key];
        } catch {
          return `${shownKey}: [unreadable]`;
        }

        return `${shownKey}: ${ConsoleRecorder.describeValue(field, depth + 1, [
          ...ancestors,
          value,
        ])}`;
      });

    if (keys.length > MAX_SERIALISE_KEYS) {
      fields.push(`… ${keys.length - MAX_SERIALISE_KEYS} more`);
    }

    return `{${fields.join(", ")}}`;
  }

  private static truncate(text: string): string {
    return text.length > MAX_SERIALISE_STRING
      ? `${text.slice(0, MAX_SERIALISE_STRING)}…`
      : text;
  }
}
