import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignals,
  lines,
} from "./Shared";

/*
 * PHP: telemetry.php, beside vendor/, which the app requires first. It
 * sets up the providers of the signals asked for and registers them as
 * the globals; run on its own (php telemetry.php) it sends a first span,
 * metric or log record, as the app would.
 *
 * Checked end to end on PHP 8.5.12 (the php:8.5-cli image, with Composer
 * 2.11 from the composer:2 image): each variant's composer require in a
 * new project, then php telemetry.php, and an app that requires it first,
 * posted their signals to a stand-in for /otlp/v1/<signal> (200) and
 * nothing else; with Composer's two plugin prompts answered either way.
 *
 * Each exporter is given its signal's own URL, which exporter-otlp 1.4.0
 * posts to as written (OtlpHttpTransportFactory hands it to the SDK's
 * PsrTransportFactory, and PsrTransport::send() does createRequest('POST',
 * $this->endpoint)). Before, the snippet set up traces alone for every
 * guide (issue #7927), and installed open-telemetry/transport-http, which
 * does not exist, and called HttpTransportFactory, which neither does.
 *
 * The SDK sends through a PSR-18 client, found by php-http/discovery, and
 * requires one installed (psr/http-client-implementation): Guzzle, which
 * the website's PHP guide checked, is installed for it. The protobuf
 * encoding runs on google/protobuf, the pure PHP library the exporter
 * pulls in; the protobuf extension is optional (only faster), and so is
 * the opentelemetry extension, which only automatic instrumentation needs.
 *
 * Logs are Monolog's records, through the OpenTelemetry handler of
 * open-telemetry/opentelemetry-logger-monolog. Nothing runs in the
 * background in PHP: the batch processors and the metric reader send what
 * they hold when the providers shut down, which setAutoShutdown(true)
 * does as the script or request ends. Metrics are sent as deltas, since
 * each request counts from zero (the website's PHP guides do the same).
 */

// The versions the snippets were checked with: OpenTelemetry PHP SDK 1.15.
export const PHP_PACKAGE_VERSIONS: Readonly<Record<string, string>> = {
  "open-telemetry/api": "1.11.0",
  "open-telemetry/sdk": "1.15.0",
  "open-telemetry/exporter-otlp": "1.4.0",
  "guzzlehttp/guzzle": "8.3.1",
  "open-telemetry/opentelemetry-logger-monolog": "1.3.1",
  "monolog/monolog": "3.12.1",
};

const pinned: (name: string) => string = (name: string): string => {
  const version: string | undefined = PHP_PACKAGE_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return `${name}:${version}`;
};

const install: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const packages: Array<string> = [
    "open-telemetry/api",
    "open-telemetry/sdk",
    "open-telemetry/exporter-otlp",
    "guzzlehttp/guzzle",
    ...(signals.logs
      ? ["open-telemetry/opentelemetry-logger-monolog", "monolog/monolog"]
      : []),
  ];

  return {
    code: lines(
      "# PHP 8.2 or later. Guzzle is the HTTP client the exporter sends with (any",
      "# PSR-18 client will do). Composer may ask to trust two plugins of the SDK's,",
      "# php-http/discovery and tbachert/spi: either answer works.",
      `composer require ${packages.map(pinned).join(" \\\n  ")}`,
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
  const firstItems: string = listOf([
    ...(signals.traces ? ["span"] : []),
    ...(signals.metrics ? ["metric"] : []),
    ...(signals.logs ? ["log"] : []),
  ]);

  return {
    code: lines(
      "<?php",
      "// telemetry.php, beside vendor/ - require it first in your app:",
      "//   require __DIR__ . '/telemetry.php';",
      `// or run it to send a first ${firstItems}: php telemetry.php`,
      signals.logs && ["use Monolog\\Level;", "use Monolog\\Logger;"],
      (signals.traces || signals.logs) &&
        "use OpenTelemetry\\API\\Common\\Time\\Clock;",
      "use OpenTelemetry\\API\\Globals;",
      signals.traces &&
        "use OpenTelemetry\\API\\Trace\\Propagation\\TraceContextPropagator;",
      signals.logs && [
        "use OpenTelemetry\\Contrib\\Logs\\Monolog\\Handler as OpenTelemetryHandler;",
        "use OpenTelemetry\\Contrib\\Otlp\\LogsExporter;",
      ],
      signals.metrics && "use OpenTelemetry\\Contrib\\Otlp\\MetricExporter;",
      "use OpenTelemetry\\Contrib\\Otlp\\OtlpHttpTransportFactory;",
      signals.traces && "use OpenTelemetry\\Contrib\\Otlp\\SpanExporter;",
      "use OpenTelemetry\\SDK\\Common\\Attribute\\Attributes;",
      signals.logs && [
        "use OpenTelemetry\\SDK\\Logs\\LoggerProvider;",
        "use OpenTelemetry\\SDK\\Logs\\Processor\\BatchLogRecordProcessor;",
      ],
      signals.metrics && [
        "use OpenTelemetry\\SDK\\Metrics\\Data\\Temporality;",
        "use OpenTelemetry\\SDK\\Metrics\\MeterProvider;",
        "use OpenTelemetry\\SDK\\Metrics\\MetricReader\\ExportingReader;",
      ],
      "use OpenTelemetry\\SDK\\Resource\\ResourceInfo;",
      "use OpenTelemetry\\SDK\\Resource\\ResourceInfoFactory;",
      "use OpenTelemetry\\SDK\\Sdk;",
      signals.traces && [
        "use OpenTelemetry\\SDK\\Trace\\SpanProcessor\\BatchSpanProcessor;",
        "use OpenTelemetry\\SDK\\Trace\\TracerProvider;",
      ],
      "",
      "require_once __DIR__ . '/vendor/autoload.php';",
      "",
      "// OTLP over HTTP, in protobuf, with your token.",
      "$headers = ['x-oneuptime-token' => '<YOUR_ONEUPTIME_TOKEN>'];",
      "$transport = fn (string $url) => (new OtlpHttpTransportFactory())",
      "    ->create($url, 'application/x-protobuf', $headers);",
      "$resource = ResourceInfoFactory::defaultResource()",
      "    ->merge(ResourceInfo::create(Attributes::create(['service.name' => 'my-service'])));",
      signals.traces && [
        "",
        "// The spans your code opens. Your framework's and libraries' spans also need the",
        "// opentelemetry extension (from PECL) and their opentelemetry-auto-* packages.",
        "$tracerProvider = TracerProvider::builder()",
        "    ->setResource($resource)",
        "    ->addSpanProcessor(new BatchSpanProcessor(",
        "        new SpanExporter($transport('<YOUR_ONEUPTIME_URL>/v1/traces')),",
        "        Clock::getDefault(),",
        "    ))",
        "    ->build();",
      ],
      signals.metrics && [
        "",
        "// Each request (or script) counts from zero, and sends its counts as it ends.",
        "$meterProvider = MeterProvider::builder()",
        "    ->setResource($resource)",
        "    ->addReader(new ExportingReader(new MetricExporter(",
        "        $transport('<YOUR_ONEUPTIME_URL>/v1/metrics'),",
        "        Temporality::DELTA,",
        "    )))",
        "    ->build();",
      ],
      signals.logs && [
        "",
        "// Monolog's records, through the handler below. echo and error_log() are not sent.",
        "$loggerProvider = LoggerProvider::builder()",
        "    ->setResource($resource)",
        "    ->addLogRecordProcessor(new BatchLogRecordProcessor(",
        "        new LogsExporter($transport('<YOUR_ONEUPTIME_URL>/v1/logs')),",
        "        Clock::getDefault(),",
        "    ))",
        "    ->build();",
      ],
      "",
      "// Registered for your app's code (Globals), and shut down as the script or request",
      "// ends, which sends what is still buffered.",
      "Sdk::builder()",
      signals.traces && [
        "    ->setTracerProvider($tracerProvider)",
        "    ->setPropagator(TraceContextPropagator::getInstance())",
      ],
      signals.metrics && "    ->setMeterProvider($meterProvider)",
      signals.logs && "    ->setLoggerProvider($loggerProvider)",
      "    ->setAutoShutdown(true)",
      "    ->buildAndRegisterGlobal();",
      "",
      `// Run on its own, it sends a first ${firstItems}, as your app would:`,
      "if (get_included_files()[0] === __FILE__) {",
      signals.traces && [
        "    $tracer = Globals::tracerProvider()->getTracer('my-service');",
        "    $tracer->spanBuilder('checkout')->startSpan()->end();",
      ],
      signals.metrics && [
        "    $meter = Globals::meterProvider()->getMeter('my-service');",
        "    $meter->createCounter('orders.placed')->add(1);",
      ],
      signals.logs && [
        "    // Your Monolog logger, with OpenTelemetry's handler pushed on it:",
        "    $logger = new Logger('my-service');",
        "    $logger->pushHandler(new OpenTelemetryHandler(Globals::loggerProvider(), Level::Info));",
        "    $logger->info('Hello, OneUptime');",
      ],
      "}",
    ),
    language: "php",
  };
};

const PhpSnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default PhpSnippets;
