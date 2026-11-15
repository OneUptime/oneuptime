import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignals,
  lines,
} from "./Shared";

/*
 * Python: telemetry.py, a module the app imports first, which sets up the
 * providers of the signals asked for. Run on its own (python telemetry.py)
 * it sends a first span, metric or log record, as the app would.
 *
 * Checked end to end on Python 3.14.10 (the python:3.14 image), each
 * variant installed into a new virtual environment with its own pip line:
 * python telemetry.py, and an app that imports it first, posted their
 * signals to a stand-in for /otlp/v1/<signal> (200) and nothing else.
 *
 * Each exporter is given its signal's own URL as endpoint=, which
 * opentelemetry-exporter-otlp-proto-http 1.45.1 posts to as written
 * (trace_exporter/__init__.py: `self._endpoint = endpoint or
 * _resolve_endpoint(...)`; only the OTEL_EXPORTER_OTLP_ENDPOINT fallback
 * gets /v1/<signal> added). Before, the snippet set up traces and metrics
 * for every guide, so the logs guide sent no logs (issue #7927), and it
 * installed opentelemetry-instrumentation, which it never used.
 *
 * Python's logging records are sent by opentelemetry-instrumentation-
 * logging: LoggingInstrumentor().instrument() adds its handler to the root
 * logger, for the logger provider set before it. SDK 1.45 deprecates its
 * own LoggingHandler, and the logs API is still in underscore modules
 * (opentelemetry._logs, opentelemetry.sdk._logs).
 *
 * TracerProvider, MeterProvider and LoggerProvider shut down at exit by
 * default (shutdown_on_exit=True, an atexit hook), which sends what they
 * still hold, the last metrics too; SIGTERM ends Python before atexit runs.
 * The SDK sets up nothing it is not given, so the signals not asked for
 * stay at the API's no-op providers and are sent nowhere.
 */

// The versions the snippets were checked with: OpenTelemetry Python 1.45.
export const PYTHON_PACKAGE_VERSIONS: Readonly<Record<string, string>> = {
  "opentelemetry-api": "1.45.1",
  "opentelemetry-sdk": "1.45.1",
  "opentelemetry-exporter-otlp-proto-http": "1.45.1",
  "opentelemetry-instrumentation-logging": "0.66b1",
};

const pinned: (name: string) => string = (name: string): string => {
  const version: string | undefined = PYTHON_PACKAGE_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return `${name}==${version}`;
};

const install: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const packages: Array<string> = [
    "opentelemetry-api",
    "opentelemetry-sdk",
    "opentelemetry-exporter-otlp-proto-http",
    ...(signals.logs ? ["opentelemetry-instrumentation-logging"] : []),
  ];

  return {
    code: lines(
      "# Python 3.10 to 3.14",
      `pip install ${packages.map(pinned).join(" \\\n  ")}`,
    ),
    language: "bash",
  };
};

// "span", "span and metric", "span, metric and log".
const listOf: (items: ReadonlyArray<string>) => string = (
  items: ReadonlyArray<string>,
): string => {
  return items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
    : items.join("");
};

const config: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const firstItems: Array<string> = [
    ...(signals.traces ? ["span"] : []),
    ...(signals.metrics ? ["metric"] : []),
    ...(signals.logs ? ["log"] : []),
  ];
  const apiModules: Array<string> = [
    ...(signals.metrics ? ["metrics"] : []),
    ...(signals.traces ? ["trace"] : []),
  ];

  return {
    code: lines(
      "# telemetry.py - import it first in your app (import telemetry), or run it",
      `# to send a first ${listOf(firstItems)}: python telemetry.py`,
      signals.logs && ["import logging", ""],
      apiModules.length > 0 &&
        `from opentelemetry import ${apiModules.join(", ")}`,
      signals.logs && "from opentelemetry._logs import set_logger_provider",
      signals.logs &&
        "from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter",
      signals.metrics &&
        "from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter",
      signals.traces &&
        "from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter",
      signals.logs && [
        "from opentelemetry.instrumentation.logging import LoggingInstrumentor",
        "from opentelemetry.sdk._logs import LoggerProvider",
        "from opentelemetry.sdk._logs.export import BatchLogRecordProcessor",
      ],
      signals.metrics && [
        "from opentelemetry.sdk.metrics import MeterProvider",
        "from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader",
      ],
      "from opentelemetry.sdk.resources import Resource",
      signals.traces && [
        "from opentelemetry.sdk.trace import TracerProvider",
        "from opentelemetry.sdk.trace.export import BatchSpanProcessor",
      ],
      "",
      'headers = {"x-oneuptime-token": "<YOUR_ONEUPTIME_TOKEN>"}',
      'resource = Resource.create({"service.name": "my-service"})',
      signals.traces && [
        "",
        "# The spans your code opens. To trace your framework's requests as well, add",
        "# its instrumentation: opentelemetry-instrumentation-flask, -django, ...",
        "span_exporter = OTLPSpanExporter(",
        '    endpoint="<YOUR_ONEUPTIME_URL>/v1/traces", headers=headers',
        ")",
        "tracer_provider = TracerProvider(resource=resource)",
        "tracer_provider.add_span_processor(BatchSpanProcessor(span_exporter))",
        "trace.set_tracer_provider(tracer_provider)",
      ],
      signals.metrics && [
        "",
        "# Sent every minute, and once more as the program exits.",
        "metric_exporter = OTLPMetricExporter(",
        '    endpoint="<YOUR_ONEUPTIME_URL>/v1/metrics", headers=headers',
        ")",
        "metric_reader = PeriodicExportingMetricReader(metric_exporter)",
        "metrics.set_meter_provider(",
        "    MeterProvider(resource=resource, metric_readers=[metric_reader])",
        ")",
      ],
      signals.logs && [
        "",
        "# What the logging module writes is sent; print() output is not.",
        "log_exporter = OTLPLogExporter(",
        '    endpoint="<YOUR_ONEUPTIME_URL>/v1/logs", headers=headers',
        ")",
        "logger_provider = LoggerProvider(resource=resource)",
        "logger_provider.add_log_record_processor(BatchLogRecordProcessor(log_exporter))",
        "set_logger_provider(logger_provider)",
        "LoggingInstrumentor().instrument()",
      ],
      "",
      "# What is still buffered is sent as Python exits. SIGTERM, which Docker and",
      "# Kubernetes stop a program with, skips that: in a long-running app, add",
      "#   signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))",
      "",
      'if __name__ == "__main__":',
      signals.traces && [
        '    with trace.get_tracer("my-service").start_as_current_span("checkout"):',
        "        pass",
      ],
      signals.metrics &&
        '    metrics.get_meter("my-service").create_counter("orders.placed").add(1)',
      signals.logs && [
        "    # The root logger's level is the one that counts: WARNING unless set.",
        "    logging.basicConfig(level=logging.INFO)",
        '    logging.getLogger("my-service").info("Hello, OneUptime")',
      ],
    ),
    language: "python",
  };
};

const PythonSnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default PythonSnippets;
