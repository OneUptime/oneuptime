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

/* Per-page cap: a warn inside a render loop must not fill the payload. */
const MAX_CONSOLE_RECORDED: number = 100;

export type ConsoleLevel = "error" | "warn";

export interface RecordedConsoleEntry {
  level: ConsoleLevel;
  message: string;
}

export interface ConsoleRecorderOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;

  /* Same transform used for DOM text nodes. */
  maskArgument: (value: string) => string;

  onConsole: (atUnixMs: number, entry: RecordedConsoleEntry) => void;
}

type ConsoleMethod = (...args: Array<unknown>) => void;

export default class ConsoleRecorder {
  private readonly options: ConsoleRecorderOptions;

  private recordedCount: number = 0;
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

  private record(level: ConsoleLevel, args: Array<unknown>): void {
    if (this.recordedCount >= MAX_CONSOLE_RECORDED) {
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

  public getRecordedCount(): number {
    return this.recordedCount;
  }

  /*
   * Describe an argument WITHOUT serialising it.
   *
   * JSON.stringify on a console argument is how recorders end up shipping an
   * entire API response, a DOM subtree, or a circular structure that throws.
   * Objects are reduced to their constructor name; only strings, numbers and
   * errors carry content through, and those are masked by the caller.
   */
  public static describe(value: unknown): string {
    if (value === null) {
      return "null";
    }

    if (value === undefined) {
      return "undefined";
    }

    if (typeof value === "string") {
      return value;
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

    if (Array.isArray(value)) {
      return `[Array(${value.length})]`;
    }

    const constructorName: string =
      value.constructor && typeof value.constructor.name === "string"
        ? value.constructor.name
        : "Object";

    return `[${constructorName}]`;
  }
}
