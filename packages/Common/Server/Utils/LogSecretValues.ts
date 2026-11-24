import { AsyncLocalStorage } from "async_hooks";
import { inspect } from "util";
import { JSONValue } from "../../Types/JSON";
import { REDACTED } from "./LogRedaction";
import MonitorSecretValueRedaction, {
  HiddenSecretValues,
} from "./Monitor/MonitorSecretValueRedaction";

/*
 * SECRET VALUES NO LOG LINE WRITES WHILE A PIECE OF WORK RUNS (OneUptime
 * issue #10875).
 *
 * A probe is handed each monitor step with the monitor's Text secrets filled
 * in: {{monitorSecrets.Token}} arrives in the URL, a header, the body or the
 * script as the value itself. Everything the probe logs while it runs the
 * check can carry it - the step's result at LOG_LEVEL=DEBUG (a response that
 * echoes the request, a script's error and log lines), the host a log line
 * names, an error a driver or a library throws - and the logger's own
 * redaction (LogRedaction) knows a secret only by the name of the field that
 * holds it or by a few shapes of its own. On a global probe that log is
 * OneUptime's.
 *
 * So the server hands the probe the values it filled into each step
 * (MonitorStep.secretValuesToHide), and the probe runs the check inside
 * run(). Every line the logger writes inside it - at every level, to the
 * console, the recent-log buffer and the OpenTelemetry exporter alike - is
 * written with each value hidden wherever it stands, in any form
 * MonitorSecretValueRedaction finds a value in: as it is or in any case,
 * percent-encoded, escaped in JSON or HTML, or in base64. That covers the
 * line's text, an error's message, stack and cause, an object's texts, keys
 * and numbers, and the line's attributes. [REDACTED] stands where a value
 * stood, and the rest of the line is kept, so it still says what happened.
 * A value shorter than MINIMUM_HIDDEN_SECRET_LENGTH is left alone, as it is
 * in what a check reports.
 *
 * A run is an asynchronous context: work awaited inside it, and the timers
 * and callbacks it starts, are inside it too; nothing else is. A run inside
 * another hides the values of both.
 *
 * The values are held in memory for the run, never written anywhere: not
 * to a log, not to a span or a log's attributes (TelemetryContext is
 * another store), not sent anywhere.
 */

interface HiddenValuesScope {
  // Every value the run hides, its outer runs' included.
  values: ReadonlyArray<string>;
  compiled: HiddenSecretValues;
}

const scopes: AsyncLocalStorage<HiddenValuesScope> =
  new AsyncLocalStorage<HiddenValuesScope>();

export default class LogSecretValues {
  /*
   * Runs `work` with these values hidden from every line logged inside it,
   * awaited work included, and returns what it returns. With no value long
   * enough to hide, `work` simply runs.
   */
  public static run<T>(
    values: Iterable<string | null | undefined> | null | undefined,
    work: () => T,
  ): T {
    const outer: HiddenValuesScope | undefined = scopes.getStore();
    const all: Array<string> = [...(outer?.values || [])];

    for (const value of Array.from(values || [])) {
      if (
        typeof value === "string" &&
        MonitorSecretValueRedaction.isLongEnoughToHide(value) &&
        !all.includes(value)
      ) {
        all.push(value);
      }
    }

    if (all.length === (outer?.values.length || 0)) {
      return work();
    }

    const compiled: HiddenSecretValues | null =
      MonitorSecretValueRedaction.compile(all);

    if (!compiled) {
      return work();
    }

    return scopes.run({ values: all, compiled: compiled }, work);
  }

  // Whether a line logged now has values hidden from it.
  public static isHiding(): boolean {
    return scopes.getStore() !== undefined;
  }

  /*
   * A text, such as a log attribute, with the values of the run under way
   * hidden; the same text outside a run, or when it holds none.
   */
  public static hideInText(text: string): string {
    const scope: HiddenValuesScope | undefined = scopes.getStore();

    if (!scope || typeof text !== "string") {
      return text;
    }

    return MonitorSecretValueRedaction.redactText(text, scope.compiled);
  }

  /*
   * A log body as the logger is about to write it, after its credentials
   * are taken out (Logger.redactBody), with the values of the run under
   * way hidden: a text as a text, an object as a copy (the same object when
   * it holds none), and an error as the error itself when neither it nor
   * what the console prints of it - its message, stack, cause and fields -
   * holds a value, or else as that text, the values hidden. Outside a run,
   * the body as it was. Never throws: a body that cannot be read for the
   * values is written as [REDACTED].
   */
  public static hideInBody(body: unknown): unknown {
    const scope: HiddenValuesScope | undefined = scopes.getStore();

    if (!scope) {
      return body;
    }

    try {
      if (typeof body === "string") {
        return MonitorSecretValueRedaction.redactText(body, scope.compiled);
      }

      if (body instanceof Error) {
        return LogSecretValues.hideInError(body, scope.compiled);
      }

      return MonitorSecretValueRedaction.redactAnyValue(
        body as JSONValue,
        scope.compiled,
      );
    } catch {
      return REDACTED;
    }
  }

  /*
   * An error, as the console would print it - a stack, then a cause, an
   * aggregate's errors and the fields an error carries - and as the other
   * sinks write it, by its message.
   */
  private static hideInError(
    error: Error,
    values: HiddenSecretValues,
  ): Error | string {
    const printed: string = inspect(error, { depth: 4 });
    const message: string = String(error.message ?? "");

    if (
      !MonitorSecretValueRedaction.holdsValue(printed, values) &&
      !MonitorSecretValueRedaction.holdsValue(message, values)
    ) {
      return error;
    }

    return MonitorSecretValueRedaction.redactText(printed, values);
  }
}
