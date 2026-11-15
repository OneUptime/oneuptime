import {
  CodeSnippet,
  OTEL_SIGNALS,
  OtelLanguageSnippets,
  OtelSignal,
  OtelSignals,
  lines,
} from "./Shared";

/*
 * Java: the OpenTelemetry Java agent, at a pinned release, and the
 * command that starts the app with it. The agent instruments the
 * libraries the app uses, with no code change.
 *
 * Checked end to end with Java 25 (eclipse-temurin:25-jdk) and agent
 * 2.33.1: each variant, starting a jar that logs through
 * java.util.logging and makes one HTTP call, posted its signals to a
 * stand-in for /otlp/v1/<signal> (200) and nothing else, what was
 * buffered going out as the program ended.
 *
 * - otel.exporter.otlp.endpoint is the endpoint, to which the agent adds
 *   v1/<signal> for http/protobuf (OtlpConfigUtil): <YOUR_ONEUPTIME_URL> as
 *   it is.
 * - The agent sends traces, metrics and logs unless told not to: a
 *   snippet for one signal turns the others' exporters off.
 * - Logs: what Logback, Log4j and java.util.logging write, which the agent
 *   captures. System.out is not sent.
 *
 * Before, the install step downloaded the latest release, whatever it was.
 */

export const JAVA_AGENT_VERSION: string = "2.33.1";

// The agent's property for each signal's exporter.
const EXPORTER_PROPERTIES: Record<OtelSignal, string> = {
  traces: "otel.traces.exporter",
  metrics: "otel.metrics.exporter",
  logs: "otel.logs.exporter",
};

const install: (signals: OtelSignals) => CodeSnippet = (): CodeSnippet => {
  return {
    code: lines(
      `# The OpenTelemetry Java agent ${JAVA_AGENT_VERSION} (Java 8 or later)`,
      "curl -L -o opentelemetry-javaagent.jar \\",
      `  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${JAVA_AGENT_VERSION}/opentelemetry-javaagent.jar`,
    ),
    language: "bash",
  };
};

const config: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const off: Array<OtelSignal> = OTEL_SIGNALS.filter(
    (signal: OtelSignal): boolean => {
      return !signals[signal];
    },
  );

  return {
    code: lines(
      "# Start your app with the agent:",
      "java -javaagent:opentelemetry-javaagent.jar \\",
      "  -Dotel.service.name=my-service \\",
      "  -Dotel.exporter.otlp.protocol=http/protobuf \\",
      "  -Dotel.exporter.otlp.endpoint=<YOUR_ONEUPTIME_URL> \\",
      '  -Dotel.exporter.otlp.headers="x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>" \\',
      off.map((signal: OtelSignal): string => {
        return `  -D${EXPORTER_PROPERTIES[signal]}=none \\`;
      }),
      "  -jar my-app.jar",
      signals.traces && [
        "",
        "# Requests to and from your app, and its database calls, are traced as they are.",
      ],
      signals.metrics && [
        "",
        "# Requests to and from your app are measured as they are, and sent every minute.",
      ],
      signals.logs && [
        "",
        "# What Logback, Log4j and java.util.logging write is sent; System.out is not.",
      ],
    ),
    language: "bash",
  };
};

const JavaSnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default JavaSnippets;
