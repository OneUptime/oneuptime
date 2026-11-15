/*
 * What every language's OpenTelemetry snippets share (OtelSdkSnippets hands
 * them out): the signals a snippet can set up, and how a snippet is written
 * from the lines each signal needs.
 *
 * A guide asks for the signals it is about: Send your first logs for logs,
 * Send your first metrics for metrics, traces (and exceptions, which travel
 * as span events) for traces, and a guide for a whole service for all three.
 * Each language writes the exporter of each signal asked for, on the App's
 * address for it (<YOUR_ONEUPTIME_URL>/v1/<signal>), and leaves the others
 * out (issue #7927: the logs and metrics guides handed out the traces code).
 *
 * React-free on purpose: the snippets are tested without the guide.
 */

export type OtelSignal = "traces" | "metrics" | "logs";

// In the order a snippet that sets up several writes them.
export const OTEL_SIGNALS: ReadonlyArray<OtelSignal> = [
  "traces",
  "metrics",
  "logs",
];

// Which signals a snippet sets up.
export type OtelSignals = Readonly<Record<OtelSignal, boolean>>;

export interface CodeSnippet {
  code: string;
  // The CodeBlock language it is highlighted as.
  language: string;
}

/*
 * One language's two steps: Install Dependencies, which installs exactly
 * what the code of Configure the SDK uses for those signals, and Configure
 * the SDK, which sets up those signals and no others.
 */
export interface OtelLanguageSnippets {
  install: (signals: OtelSignals) => CodeSnippet;
  config: (signals: OtelSignals) => CodeSnippet;
}

/*
 * A line, the parts of one part of a snippet, or false for a part the
 * snippet leaves out: `signals.logs && ["", "# Logs", ...]`.
 */
export type SnippetPart = string | false | ReadonlyArray<SnippetPart>;

const flatten: (part: SnippetPart) => Array<string> = (
  part: SnippetPart,
): Array<string> => {
  if (part === false) {
    return [];
  }

  return typeof part === "string" ? [part] : part.flatMap(flatten);
};

// The lines of a snippet, without the parts it leaves out.
export function lines(...parts: Array<SnippetPart>): string {
  return parts.flatMap(flatten).join("\n");
}

// The signals asked for, as a set of switches.
export function toOtelSignals(
  signals: OtelSignal | ReadonlyArray<OtelSignal>,
): OtelSignals {
  const asked: ReadonlyArray<OtelSignal> =
    typeof signals === "string" ? [signals] : signals;

  if (asked.length === 0) {
    throw new Error("A snippet sets up at least one signal.");
  }

  return {
    traces: asked.includes("traces"),
    metrics: asked.includes("metrics"),
    logs: asked.includes("logs"),
  };
}

// The signals a set of switches turns on, in OTEL_SIGNALS' order.
export function signalsOf(signals: OtelSignals): Array<OtelSignal> {
  return OTEL_SIGNALS.filter((signal: OtelSignal): boolean => {
    return signals[signal];
  });
}
