import { TelemetryGuideLanguageKey } from "Common/Types/Telemetry/OpenTelemetryGuides";
import AngularSnippets from "./OtelSdkLanguages/Angular";
import CppSnippets from "./OtelSdkLanguages/Cpp";
import DotNetSnippets from "./OtelSdkLanguages/DotNet";
import ElixirSnippets from "./OtelSdkLanguages/Elixir";
import GoSnippets from "./OtelSdkLanguages/Go";
import JavaSnippets from "./OtelSdkLanguages/Java";
import NodeSnippets from "./OtelSdkLanguages/Node";
import PhpSnippets from "./OtelSdkLanguages/Php";
import PythonSnippets from "./OtelSdkLanguages/Python";
import ReactSnippets from "./OtelSdkLanguages/React";
import RubySnippets from "./OtelSdkLanguages/Ruby";
import RustSnippets from "./OtelSdkLanguages/Rust";
import {
  CodeSnippet,
  OTEL_SIGNALS,
  OtelLanguageSnippets,
  OtelSignal,
  toOtelSignals,
} from "./OtelSdkLanguages/Shared";
import SwiftSnippets from "./OtelSdkLanguages/Swift";

export { OTEL_SIGNALS };
export type { CodeSnippet, OtelSignal };

/*
 * THE OPENTELEMETRY SDK SNIPPETS the telemetry Setup Guide (and Send your
 * first traces, metrics, logs or exceptions) hands out per language: how to
 * install the SDK, and how to point its exporters at OneUptime.
 *
 * <YOUR_ONEUPTIME_URL> is the OTLP endpoint the guide's first step shows,
 * <scheme>://<HOST>/otlp. The App serves OTLP over HTTP under it, at
 * /v1/traces, /v1/metrics and /v1/logs. Nothing answers the endpoint
 * itself, nor /v1/<signal> at the server's root (issue #7885).
 *
 * An SDK takes the address one of two ways:
 *  - as the endpoint (OTEL_EXPORTER_OTLP_ENDPOINT, Java's
 *    otel.exporter.otlp.endpoint), to which it adds /v1/<signal> itself:
 *    <YOUR_ONEUPTIME_URL> as it is;
 *  - as an address given to an exporter in code, which it posts to as
 *    written: the signal's own URL, <YOUR_ONEUPTIME_URL>/v1/<signal>. Every
 *    other language's snippet does so (issue #7885).
 *
 * Each guide hands out the code for its own signal: Send your first logs
 * sets up logs, Send your first metrics metrics, traces and exceptions
 * traces, and a guide for a whole service all three (issue #7927). Each
 * snippet runs as handed out with the versions its install step pins: a
 * reader who pastes it where it says and runs the command it gives sends
 * data (issues #7469 and #7928).
 *
 * React-free on purpose: the snippets are tested without the guide.
 */

type Language = TelemetryGuideLanguageKey;

/*
 * Fills the placeholders the guide's snippets carry: the OTLP endpoint, the
 * Pyroscope server address (profiles) and the picked key's token.
 */
export function replacePlaceholders(
  code: string,
  otlpUrl: string,
  token: string,
  pyroscopeUrl: string,
): string {
  return code
    .replace(/<YOUR_ONEUPTIME_URL>/g, otlpUrl)
    .replace(/<YOUR_ONEUPTIME_PYROSCOPE_URL>/g, pyroscopeUrl)
    .replace(/<YOUR_ONEUPTIME_TOKEN>/g, token);
}

// --- OpenTelemetry code snippets per language and signal ---

/*
 * Each language's snippets, one file each in OtelSdkLanguages/. Each file
 * says what was run, with which versions, and how its SDK posts to the
 * address it is given.
 */
const LANGUAGE_SNIPPETS: Record<Language, OtelLanguageSnippets> = {
  node: NodeSnippets,
  python: PythonSnippets,
  go: GoSnippets,
  java: JavaSnippets,
  dotnet: DotNetSnippets,
  rust: RustSnippets,
  php: PhpSnippets,
  ruby: RubySnippets,
  elixir: ElixirSnippets,
  cpp: CppSnippets,
  swift: SwiftSnippets,
  react: ReactSnippets,
  angular: AngularSnippets,
};

/*
 * The Install Dependencies step: exactly what the Configure the SDK step
 * of the same language and signals uses.
 */
export function getOtelInstallSnippet(
  lang: Language,
  signals: OtelSignal | ReadonlyArray<OtelSignal>,
): CodeSnippet {
  return LANGUAGE_SNIPPETS[lang].install(toOtelSignals(signals));
}

/*
 * The Configure the SDK step: an exporter for each signal asked for, on
 * the App's address for it, and none for the others. The guide asks for
 * its own signal (issue #7927: the logs and metrics guides handed out the
 * traces code, which for most languages set up traces alone).
 */
export function getOtelConfigSnippet(
  lang: Language,
  signals: OtelSignal | ReadonlyArray<OtelSignal>,
): CodeSnippet {
  return LANGUAGE_SNIPPETS[lang].config(toOtelSignals(signals));
}

export function getEnvVarSnippet(): string {
  return `# Alternatively, configure via environment variables (works with any language):
export OTEL_SERVICE_NAME="my-service"
export OTEL_EXPORTER_OTLP_ENDPOINT="<YOUR_ONEUPTIME_URL>"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"`;
}
