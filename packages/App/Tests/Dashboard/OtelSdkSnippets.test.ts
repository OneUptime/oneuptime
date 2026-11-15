import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  TELEMETRY_GUIDE_LANGUAGE_KEYS,
  TelemetryGuideLanguageKey,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import {
  OTEL_SIGNALS,
  OtelSignal,
  getEnvVarSnippet,
  getOtelConfigSnippet,
  getOtelInstallSnippet,
  replacePlaceholders,
} from "../../FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkSnippets";
import {
  lines,
  signalsOf,
  toOtelSignals,
} from "../../FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkLanguages/Shared";
import { NODE_PACKAGE_VERSIONS } from "../../FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkLanguages/Node";
import { BROWSER_PACKAGE_VERSIONS } from "../../FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkLanguages/Browser";
import { RUST_CRATE_VERSIONS } from "../../FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkLanguages/Rust";
import { GO_MODULE_VERSIONS } from "../../FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkLanguages/Go";
import { JAVA_AGENT_VERSION } from "../../FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkLanguages/Java";
import { OPENTELEMETRY_CPP_VERSION } from "../../FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkLanguages/Cpp";
import { OPENTELEMETRY_SWIFT_VERSION } from "../../FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkLanguages/Swift";

/*
 * The Setup Guide's OpenTelemetry snippets, language by language and signal
 * by signal.
 *
 * Each guide asks for its own signal: Send your first logs for logs, Send
 * your first metrics for metrics, traces and exceptions for traces, a guide
 * for a whole service for all three. The logs and metrics guides handed out
 * the traces code, which for 10 of the 13 languages set up no logs (issue
 * #7927). Every language and signal has a row below that says where its
 * exporter is given its address and how its SDK uses it (each language's
 * file in OtelSdkLanguages/ says which source that was read in): a language
 * or a signal the guide gains fails here until it has its rows.
 *
 * The App serves OTLP over HTTP at <endpoint>/v1/traces, /v1/metrics and
 * /v1/logs, and at nothing else under it (issue #7885).
 */

type Language = TelemetryGuideLanguageKey;

// The signal sets the guides ask for: each one alone, and all three.
const VARIANTS: Array<ReadonlyArray<OtelSignal>> = [
  ["traces"],
  ["metrics"],
  ["logs"],
  OTEL_SIGNALS,
];

const nameOf: (signals: ReadonlyArray<OtelSignal>) => string = (
  signals: ReadonlyArray<OtelSignal>,
): string => {
  return signals.join("+");
};

/*
 * How an SDK uses an address:
 *  - "as written": an address given to an exporter in code is posted to as
 *    it is (OTLP/HTTP's per-signal URL);
 *  - "adds /v1/<signal>": the endpoint (OTEL_EXPORTER_OTLP_ENDPOINT and the
 *    SDKs' own names for it), to which the SDK adds each signal's path.
 */
type AddressUse = "as written" | "adds /v1/<signal>";

interface ExporterRow {
  // What sends, as the snippet writes it.
  exporter: string;
  // Reads the address the snippet gives it (group 1).
  address: RegExp;
  use: AddressUse;
  /*
   * One address for every signal (the Java agent's endpoint): its presence
   * says nothing about which signals are set up; `off` does.
   */
  sharedAddress?: boolean;
  /*
   * What turns the signal off where the SDK would set it up unasked
   * (NodeSDK, the Java agent, Ruby's and Elixir's SDKs, which otherwise send
   * it to localhost:4318): there when the signal is not asked for, not
   * there when it is.
   */
  off?: RegExp;
}

// `new <Exporter>({ url: '...' })`, as OpenTelemetry JS writes it.
const jsExporter: (constructor: string) => ExporterRow = (
  constructor: string,
): ExporterRow => {
  return {
    exporter: `${constructor}'s url`,
    address: new RegExp(`new ${constructor}\\(\\{\\s*url: '([^']*)'`),
    use: "as written",
  };
};

const ROWS: Record<Language, Record<OtelSignal, ExporterRow>> = {
  node: {
    traces: {
      ...jsExporter("OTLPTraceExporter"),
      off: /^ {2}spanProcessors: \[\],$/m,
    },
    metrics: {
      ...jsExporter("OTLPMetricExporter"),
      off: /^ {2}metricReaders: \[\],$/m,
    },
    logs: {
      ...jsExporter("OTLPLogExporter"),
      off: /^ {2}logRecordProcessors: \[\],$/m,
    },
  },
  python: {
    traces: {
      exporter: "OTLPSpanExporter(endpoint=)",
      address: /OTLPSpanExporter\(\s*endpoint="([^"]*)"/,
      use: "as written",
    },
    metrics: {
      exporter: "OTLPMetricExporter(endpoint=)",
      address: /OTLPMetricExporter\(\s*endpoint="([^"]*)"/,
      use: "as written",
    },
    logs: {
      exporter: "OTLPLogExporter(endpoint=)",
      address: /OTLPLogExporter\(\s*endpoint="([^"]*)"/,
      use: "as written",
    },
  },
  go: {
    traces: {
      exporter: "otlptracehttp.WithEndpointURL",
      address: /otlptracehttp\.WithEndpointURL\("([^"]*)"\)/,
      use: "as written",
    },
    metrics: {
      exporter: "otlpmetrichttp.WithEndpointURL",
      address: /otlpmetrichttp\.WithEndpointURL\("([^"]*)"\)/,
      use: "as written",
    },
    logs: {
      exporter: "otlploghttp.WithEndpointURL",
      address: /otlploghttp\.WithEndpointURL\("([^"]*)"\)/,
      use: "as written",
    },
  },
  java: {
    traces: {
      exporter: "-Dotel.exporter.otlp.endpoint",
      address: /-Dotel\.exporter\.otlp\.endpoint=(\S+)/,
      use: "adds /v1/<signal>",
      sharedAddress: true,
      off: /-Dotel\.traces\.exporter=none/,
    },
    metrics: {
      exporter: "-Dotel.exporter.otlp.endpoint",
      address: /-Dotel\.exporter\.otlp\.endpoint=(\S+)/,
      use: "adds /v1/<signal>",
      sharedAddress: true,
      off: /-Dotel\.metrics\.exporter=none/,
    },
    logs: {
      exporter: "-Dotel.exporter.otlp.endpoint",
      address: /-Dotel\.exporter\.otlp\.endpoint=(\S+)/,
      use: "adds /v1/<signal>",
      sharedAddress: true,
      off: /-Dotel\.logs\.exporter=none/,
    },
  },
  // With HttpProtobuf, an Endpoint set in code is the signal's whole URL.
  dotnet: {
    traces: {
      exporter: "WithTracing's AddOtlpExporter Endpoint",
      address:
        /\.WithTracing\([^;]*?\.AddOtlpExporter\(options =>\s*\{\s*options\.Endpoint = new Uri\("([^"]*)"\)/,
      use: "as written",
    },
    metrics: {
      exporter: "WithMetrics's AddOtlpExporter Endpoint",
      address:
        /\.WithMetrics\([^;]*?\.AddOtlpExporter\(options =>\s*\{\s*options\.Endpoint = new Uri\("([^"]*)"\)/,
      use: "as written",
    },
    logs: {
      exporter: "WithLogging's AddOtlpExporter Endpoint",
      address:
        /\.WithLogging\([^;]*?\.AddOtlpExporter\(options =>\s*\{\s*options\.Endpoint = new Uri\("([^"]*)"\)/,
      use: "as written",
    },
  },
  rust: {
    traces: {
      exporter: "SpanExporter's with_endpoint",
      address:
        /SpanExporter::builder\(\)\s*\.with_http\(\)\s*\.with_endpoint\("([^"]*)"\)/,
      use: "as written",
    },
    metrics: {
      exporter: "MetricExporter's with_endpoint",
      address:
        /MetricExporter::builder\(\)\s*\.with_http\(\)\s*\.with_endpoint\("([^"]*)"\)/,
      use: "as written",
    },
    logs: {
      exporter: "LogExporter's with_endpoint",
      address:
        /LogExporter::builder\(\)\s*\.with_http\(\)\s*\.with_endpoint\("([^"]*)"\)/,
      use: "as written",
    },
  },
  php: {
    traces: {
      exporter: "SpanExporter's transport",
      address: /new SpanExporter\(\s*\$transport\('([^']*)'\)/,
      use: "as written",
    },
    metrics: {
      exporter: "MetricExporter's transport",
      address: /new MetricExporter\(\s*\$transport\('([^']*)'\)/,
      use: "as written",
    },
    logs: {
      exporter: "LogsExporter's transport",
      address: /new LogsExporter\(\s*\$transport\('([^']*)'\)/,
      use: "as written",
    },
  },
  ruby: {
    traces: {
      exporter: "OTLP::Exporter.new(endpoint:)",
      address: /OTLP::Exporter\.new\(\s*endpoint: "([^"]*)"/,
      use: "as written",
      off: /^ENV\["OTEL_TRACES_EXPORTER"\] \|\|= "none"$/m,
    },
    metrics: {
      exporter: "OTLP::Metrics::MetricsExporter.new(endpoint:)",
      address: /OTLP::Metrics::MetricsExporter\.new\(\s*endpoint: "([^"]*)"/,
      use: "as written",
    },
    logs: {
      exporter: "OTLP::Logs::LogsExporter.new(endpoint:)",
      address: /OTLP::Logs::LogsExporter\.new\(\s*endpoint: "([^"]*)"/,
      use: "as written",
    },
  },
  // The signals' own settings; otlp_endpoint would get /v1/<signal> added.
  elixir: {
    traces: {
      exporter: "otlp_traces_endpoint",
      address: /otlp_traces_endpoint: "([^"]*)"/,
      use: "as written",
      off: /traces_exporter: :none/,
    },
    metrics: {
      exporter: "otlp_metrics_endpoint",
      address: /otlp_metrics_endpoint: "([^"]*)"/,
      use: "as written",
    },
    logs: {
      exporter: "otlp_logs_endpoint",
      address: /otlp_logs_endpoint: "([^"]*)"/,
      use: "as written",
    },
  },
  cpp: {
    traces: {
      exporter: "OtlpHttpExporterOptions.url",
      address: /traceOptions\.url = "([^"]*)"/,
      use: "as written",
    },
    metrics: {
      exporter: "OtlpHttpMetricExporterOptions.url",
      address: /metricOptions\.url = "([^"]*)"/,
      use: "as written",
    },
    logs: {
      exporter: "OtlpHttpLogRecordExporterOptions.url",
      address: /logOptions\.url = "([^"]*)"/,
      use: "as written",
    },
  },
  swift: {
    traces: {
      exporter: "OtlpHttpTraceExporter(endpoint:)",
      address: /OtlpHttpTraceExporter\(\s*endpoint: URL\(string: "([^"]*)"\)/,
      use: "as written",
    },
    metrics: {
      exporter: "OtlpHttpMetricExporter(endpoint:)",
      address: /OtlpHttpMetricExporter\(\s*endpoint: URL\(string: "([^"]*)"\)/,
      use: "as written",
    },
    logs: {
      exporter: "OtlpHttpLogExporter(endpoint:)",
      address: /OtlpHttpLogExporter\(\s*endpoint: URL\(string: "([^"]*)"\)/,
      use: "as written",
    },
  },
  react: {
    traces: jsExporter("OTLPTraceExporter"),
    metrics: jsExporter("OTLPMetricExporter"),
    logs: jsExporter("OTLPLogExporter"),
  },
  angular: {
    traces: jsExporter("OTLPTraceExporter"),
    metrics: jsExporter("OTLPMetricExporter"),
    logs: jsExporter("OTLPLogExporter"),
  },
};

// OTEL_EXPORTER_OTLP_ENDPOINT, under every language (Advanced).
const ENVIRONMENT_VARIABLES: ExporterRow = {
  exporter: "OTEL_EXPORTER_OTLP_ENDPOINT",
  address: /OTEL_EXPORTER_OTLP_ENDPOINT="([^"]*)"/,
  use: "adds /v1/<signal>",
};

interface Server {
  label: string;
  protocol: string;
  host: string;
}

const SERVERS: Array<Server> = [
  {
    label: "a self-hosted server at http://localhost:18811",
    protocol: "http",
    host: "localhost:18811",
  },
  {
    label: "an https server with no port",
    protocol: "https",
    host: "oneuptime.example.com",
  },
];

const KEY: string = "6b4a1d5c-0c5e-4a8f-9a30-1f1f2b7d1e11";

// The OTLP endpoint the guide shows, and fills <YOUR_ONEUPTIME_URL> with.
const otlpEndpointOf: (server: Server) => string = (server: Server): string => {
  return `${server.protocol}://${server.host}/otlp`;
};

const filled: (code: string, server: Server) => string = (
  code: string,
  server: Server,
): string => {
  return replacePlaceholders(
    code,
    otlpEndpointOf(server),
    KEY,
    `${server.protocol}://${server.host}/pyroscope`,
  );
};

// Where the SDK posts a signal, given the address the snippet gives it.
const postsTo: (
  address: string,
  use: AddressUse,
  signal: OtelSignal,
) => string = (
  address: string,
  use: AddressUse,
  signal: OtelSignal,
): string => {
  return use === "as written"
    ? address
    : `${address.replace(/\/$/, "")}/v1/${signal}`;
};

const addressIn: (code: string, row: ExporterRow) => string | null = (
  code: string,
  row: ExporterRow,
): string | null => {
  const match: RegExpMatchArray | null = code.match(row.address);

  return match ? match[1]! : null;
};

// Every place the snippet gives the server's address.
const countOf: (code: string, text: string) => number = (
  code: string,
  text: string,
): number => {
  return code.split(text).length - 1;
};

const configOf: (
  language: Language,
  signals: ReadonlyArray<OtelSignal>,
) => string = (
  language: Language,
  signals: ReadonlyArray<OtelSignal>,
): string => {
  return getOtelConfigSnippet(language, signals).code;
};

const installOf: (
  language: Language,
  signals: ReadonlyArray<OtelSignal>,
) => string = (
  language: Language,
  signals: ReadonlyArray<OtelSignal>,
): string => {
  return getOtelInstallSnippet(language, signals).code;
};

// Each language and signal set, for test.each.
const EVERY_VARIANT: Array<[Language, string, ReadonlyArray<OtelSignal>]> =
  TELEMETRY_GUIDE_LANGUAGE_KEYS.flatMap(
    (
      language: Language,
    ): Array<[Language, string, ReadonlyArray<OtelSignal>]> => {
      return VARIANTS.map(
        (
          signals: ReadonlyArray<OtelSignal>,
        ): [Language, string, ReadonlyArray<OtelSignal>] => {
          return [language, nameOf(signals), signals];
        },
      );
    },
  );

describe("each guide hands out the snippet of its own signal (issue #7927)", () => {
  test("every language the guide offers has a row for every signal", () => {
    expect(Object.keys(ROWS).sort()).toEqual(
      [...TELEMETRY_GUIDE_LANGUAGE_KEYS].sort(),
    );

    for (const language of TELEMETRY_GUIDE_LANGUAGE_KEYS) {
      expect([language, Object.keys(ROWS[language]).sort()]).toEqual([
        language,
        [...OTEL_SIGNALS].sort(),
      ]);
    }
  });

  test.each(EVERY_VARIANT)(
    "%s, %s: an exporter for each signal asked for, and none for the others",
    (language: Language, _name: string, signals: ReadonlyArray<OtelSignal>) => {
      const code: string = configOf(language, signals);

      for (const signal of OTEL_SIGNALS) {
        const row: ExporterRow = ROWS[language][signal];
        const asked: boolean = signals.includes(signal);
        const hasExporter: boolean = addressIn(code, row) !== null;

        // The exporter is there exactly when its signal is asked for.
        expect([language, signal, "exporter", hasExporter]).toEqual([
          language,
          signal,
          "exporter",
          row.sharedAddress ? true : asked,
        ]);

        // And where the SDK would set the signal up unasked, it is off.
        if (row.off) {
          expect([language, signal, "off", row.off.test(code)]).toEqual([
            language,
            signal,
            "off",
            !asked,
          ]);
        }
      }
    },
  );

  test.each([...TELEMETRY_GUIDE_LANGUAGE_KEYS])(
    "%s: the logs, metrics and traces guides hand out three different snippets",
    (language: Language) => {
      const snippets: Set<string> = new Set(
        OTEL_SIGNALS.map((signal: OtelSignal): string => {
          return configOf(language, [signal]);
        }),
      );

      expect([language, snippets.size]).toEqual([language, 3]);
    },
  );

  test("a signal may be asked for alone, as a string, or in any order", () => {
    for (const language of TELEMETRY_GUIDE_LANGUAGE_KEYS) {
      expect(getOtelConfigSnippet(language, "logs")).toEqual(
        getOtelConfigSnippet(language, ["logs"]),
      );
      expect(getOtelConfigSnippet(language, ["logs", "traces"])).toEqual(
        getOtelConfigSnippet(language, ["traces", "logs"]),
      );
      expect(getOtelInstallSnippet(language, ["metrics", "traces"])).toEqual(
        getOtelInstallSnippet(language, ["traces", "metrics"]),
      );
    }
  });

  test("a snippet for no signal at all is refused", () => {
    expect(() => {
      return getOtelConfigSnippet("node", []);
    }).toThrow("A snippet sets up at least one signal.");
  });
});

describe("every exporter posts where the App serves its signal", () => {
  describe.each(SERVERS)("$label", (server: Server) => {
    test.each(EVERY_VARIANT)(
      "%s, %s",
      (
        language: Language,
        _name: string,
        signals: ReadonlyArray<OtelSignal>,
      ) => {
        const code: string = filled(configOf(language, signals), server);
        const rows: Array<ExporterRow> = signals.map(
          (signal: OtelSignal): ExporterRow => {
            return ROWS[language][signal];
          },
        );

        // Each exporter posts its signal to the App's route for it.
        signals.forEach((signal: OtelSignal, index: number) => {
          const row: ExporterRow = rows[index]!;
          const address: string = addressIn(code, row) || "(not given)";

          expect([
            language,
            signal,
            row.exporter,
            postsTo(address, row.use, signal),
          ]).toEqual([
            language,
            signal,
            row.exporter,
            `${otlpEndpointOf(server)}/v1/${signal}`,
          ]);
        });

        // And the snippet gives the server's address nowhere else.
        const addresses: number = rows.some((row: ExporterRow): boolean => {
          return Boolean(row.sharedAddress);
        })
          ? 1
          : rows.length;

        expect([language, countOf(code, server.host)]).toEqual([
          language,
          addresses,
        ]);

        // Every placeholder is filled, and the key given.
        expect([language, code.match(/<YOUR_ONEUPTIME_[A-Z_]+>/g)]).toEqual([
          language,
          null,
        ]);
        expect([language, code.includes(KEY)]).toEqual([language, true]);
      },
    );

    test("the environment variables, under every language", () => {
      const code: string = filled(getEnvVarSnippet(), server);
      const address: string = addressIn(code, ENVIRONMENT_VARIABLES)!;

      for (const signal of OTEL_SIGNALS) {
        expect(postsTo(address, ENVIRONMENT_VARIABLES.use, signal)).toBe(
          `${otlpEndpointOf(server)}/v1/${signal}`,
        );
      }
      expect(countOf(code, server.host)).toBe(1);
      expect(code).toContain(`x-oneuptime-token=${KEY}`);
    });
  });

  test.each(EVERY_VARIANT)(
    "%s, %s: before the server's address is known, every address is the endpoint's placeholder",
    (language: Language, _name: string, signals: ReadonlyArray<OtelSignal>) => {
      const code: string = configOf(language, signals);

      for (const signal of signals) {
        const row: ExporterRow = ROWS[language][signal];

        expect([language, signal, addressIn(code, row)]).toEqual([
          language,
          signal,
          row.use === "as written"
            ? `<YOUR_ONEUPTIME_URL>/v1/${signal}`
            : "<YOUR_ONEUPTIME_URL>",
        ]);
      }
      // The key goes in the x-oneuptime-token header.
      expect([language, code.includes("<YOUR_ONEUPTIME_TOKEN>")]).toEqual([
        language,
        true,
      ]);
      expect([language, code.includes("x-oneuptime-token")]).toEqual([
        language,
        true,
      ]);
    },
  );

  test.each(EVERY_VARIANT)(
    "%s, %s: the service is named, so the guide can give it the service's own name",
    (language: Language, _name: string, signals: ReadonlyArray<OtelSignal>) => {
      const name: string =
        language === "react"
          ? "my-react-app"
          : language === "angular"
            ? "my-angular-app"
            : "my-service";

      expect([language, configOf(language, signals).includes(name)]).toEqual([
        language,
        true,
      ]);
    },
  );
});

/*
 * THE INSTALL STEP INSTALLS EXACTLY WHAT THE CODE USES (issues #7469 and
 * #7928): every package the code (and its commented examples) imports is
 * installed, and nothing installed goes unused. A plain-text check of the
 * two snippets, per language: what the install step names, and what the
 * code names.
 */
interface PackageCheck {
  installed: (install: string) => Array<string>;
  used: (config: string) => Array<string>;
}

const all: (text: string, pattern: RegExp) => Array<string> = (
  text: string,
  pattern: RegExp,
): Array<string> => {
  return [...text.matchAll(pattern)].map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
};

const uniqueSorted: (names: Array<string>) => Array<string> = (
  names: Array<string>,
): Array<string> => {
  return [...new Set(names)].sort();
};

// The first matching prefix's package; an unknown name fails, so the map grows with the code.
const byPrefix: (
  prefixes: Array<[string, string | null]>,
) => (name: string) => string | null = (
  prefixes: Array<[string, string | null]>,
): ((name: string) => string | null) => {
  return (name: string): string | null => {
    const found: [string, string | null] | undefined = prefixes.find(
      ([prefix]: [string, string | null]): boolean => {
        return name === prefix || name.startsWith(prefix);
      },
    );

    if (!found) {
      throw new Error(`No package for ${name}`);
    }

    return found[1];
  };
};

const packagesOf: (
  names: Array<string>,
  packageOf: (name: string) => string | null,
) => Array<string> = (
  names: Array<string>,
  packageOf: (name: string) => string | null,
): Array<string> => {
  return names.map(packageOf).filter((name: string | null): name is string => {
    return name !== null;
  });
};

// An npm package from an import specifier: @scope/name, or name.
const npmPackageOf: (specifier: string) => string | null = (
  specifier: string,
): string | null => {
  if (specifier.startsWith("node:") || specifier.startsWith(".")) {
    return null;
  }

  const parts: Array<string> = specifier.split("/");

  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
};

const npm: PackageCheck = {
  installed: (install: string): Array<string> => {
    return all(install, /(@?[a-z][\w./-]*)@\d/g);
  },
  used: (config: string): Array<string> => {
    return packagesOf(
      all(config, /(?:from |register\()'([^']+)'/g),
      npmPackageOf,
    );
  },
};

const PYTHON_MODULES: (name: string) => string | null = byPrefix([
  [
    "opentelemetry.exporter.otlp.proto.http",
    "opentelemetry-exporter-otlp-proto-http",
  ],
  [
    "opentelemetry.instrumentation.logging",
    "opentelemetry-instrumentation-logging",
  ],
  ["opentelemetry.sdk", "opentelemetry-sdk"],
  ["opentelemetry", "opentelemetry-api"],
  ["logging", null],
  ["signal", null],
  ["sys", null],
]);

const RUBY_REQUIRES: (name: string) => string | null = byPrefix([
  ["opentelemetry/sdk", "opentelemetry-sdk"],
  [
    "opentelemetry/exporter/otlp_metrics",
    "opentelemetry-exporter-otlp-metrics",
  ],
  ["opentelemetry/exporter/otlp_logs", "opentelemetry-exporter-otlp-logs"],
  ["opentelemetry/exporter/otlp", "opentelemetry-exporter-otlp"],
  ["opentelemetry/instrumentation/all", "opentelemetry-instrumentation-all"],
  [
    "opentelemetry/instrumentation/logger",
    "opentelemetry-instrumentation-logger",
  ],
  ["opentelemetry-metrics-sdk", "opentelemetry-metrics-sdk"],
  ["opentelemetry-logs-sdk", "opentelemetry-logs-sdk"],
]);

const PHP_NAMESPACES: (name: string) => string | null = byPrefix([
  ["OpenTelemetry\\API\\", "open-telemetry/api"],
  ["OpenTelemetry\\SDK\\", "open-telemetry/sdk"],
  ["OpenTelemetry\\Contrib\\Otlp\\", "open-telemetry/exporter-otlp"],
  [
    "OpenTelemetry\\Contrib\\Logs\\Monolog\\",
    "open-telemetry/opentelemetry-logger-monolog",
  ],
  ["Monolog\\", "monolog/monolog"],
]);

const SWIFT_MODULES: (name: string) => string | null = byPrefix([
  ["Foundation", null],
  ["OpenTelemetryApi", "OpenTelemetryApi"],
  ["OpenTelemetrySdk", "OpenTelemetrySdk"],
  // Both modules are the exporters' product's.
  ["OpenTelemetryProtocolExporterHttp", "OpenTelemetryProtocolExporterHTTP"],
  ["OpenTelemetryProtocolExporterCommon", "OpenTelemetryProtocolExporterHTTP"],
]);

// What a .NET call needs installed.
const DOTNET_CALLS: Array<[RegExp, string]> = [
  [/\.AddOpenTelemetry\(\)/, "OpenTelemetry.Extensions.Hosting"],
  [/\.AddOtlpExporter\(/, "OpenTelemetry.Exporter.OpenTelemetryProtocol"],
  [
    /\.AddAspNetCoreInstrumentation\(\)/,
    "OpenTelemetry.Instrumentation.AspNetCore",
  ],
  [/\.AddHttpClientInstrumentation\(\)/, "OpenTelemetry.Instrumentation.Http"],
];

// What an Elixir snippet's config and calls need installed.
const ELIXIR_USES: Array<[RegExp, string]> = [
  [/^config :opentelemetry,$/m, "opentelemetry"],
  [/OpenTelemetry\.Tracer/, "opentelemetry_api"],
  // The OTLP exporters, the experimental SDK's included (otel_exporter_otlp).
  [
    /config :opentelemetry_exporter,|:otel_exporter_\w+_otlp/,
    "opentelemetry_exporter",
  ],
  [
    /config :opentelemetry_experimental,|:otel_log_handler/,
    "opentelemetry_experimental",
  ],
  [/OpenTelemetryAPIExperimental/, "opentelemetry_api_experimental"],
];

const C_PLUS_PLUS_HEADERS: Array<[RegExp, string]> = [
  [/otlp_http_exporter_factory\.h/, "otlp_http_exporter"],
  [/otlp_http_metric_exporter_factory\.h/, "otlp_http_metric_exporter"],
  [/otlp_http_log_record_exporter_factory\.h/, "otlp_http_log_record_exporter"],
];

const matching: (
  code: string,
  uses: Array<[RegExp, string]>,
) => Array<string> = (
  code: string,
  uses: Array<[RegExp, string]>,
): Array<string> => {
  return uses
    .filter(([pattern]: [RegExp, string]): boolean => {
      return pattern.test(code);
    })
    .map(([, name]: [RegExp, string]): string => {
      return name;
    });
};

// Rust: the crates a path starts with, besides the names `use` brought in.
const rustCratesUsed: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  const imported: Set<string> = new Set(rustImportedNames(code));

  return all(code, /(?:^|[\s({&!])([a-z][a-z0-9_]*)::/gm).filter(
    (root: string): boolean => {
      return root !== "std" && !imported.has(root);
    },
  );
};

// Rust: the names each `use` line brings in (an `as _` trait brings in none).
const rustImportedNames: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  return all(code, /^use ([^;]+);/gm).flatMap((path: string): Array<string> => {
    const braces: RegExpMatchArray | null = path.match(/\{([^}]*)\}/);
    const names: Array<string> = braces
      ? braces[1]!.split(",")
      : [path.split("::").pop()!];

    return names
      .map((name: string): string => {
        return name.trim();
      })
      .filter((name: string): boolean => {
        return name.length > 0 && !name.endsWith(" as _");
      });
  });
};

// Go: each import path's module, the longest installed one it is under.
const goModulesUsed: (config: string, install: string) => Array<string> = (
  config: string,
  install: string,
): Array<string> => {
  const modules: Array<string> = PACKAGE_CHECKS.go.installed(install);
  const block: string = config.match(/import \(([^)]*)\)/)![1]!;

  return all(block, /"([^"]+)"/g)
    .filter((importPath: string): boolean => {
      // The standard library's paths have no dot in their first element.
      return importPath.split("/")[0]!.includes(".");
    })
    .map((importPath: string): string => {
      const module: string | undefined = modules
        .filter((candidate: string): boolean => {
          return (
            importPath === candidate || importPath.startsWith(`${candidate}/`)
          );
        })
        .sort((a: string, b: string): number => {
          return b.length - a.length;
        })[0];

      return module || `(not installed) ${importPath}`;
    });
};

const PACKAGE_CHECKS: Record<Language, PackageCheck> = {
  node: npm,
  react: npm,
  angular: npm,
  python: {
    installed: (install: string): Array<string> => {
      return all(install, /([a-z][\w-]*)==/g);
    },
    used: (config: string): Array<string> => {
      return packagesOf(
        all(config, /^\s*(?:#\s+)?(?:from|import) ([\w.]+)/gm),
        PYTHON_MODULES,
      );
    },
  },
  // Filled in by goModulesUsed, which needs the install step too.
  go: {
    installed: (install: string): Array<string> => {
      return all(install, /([a-z][\w./-]*)@v\d/g);
    },
    used: (): Array<string> => {
      return [];
    },
  },
  // The agent jar the install step downloads, and the one the command loads.
  java: {
    installed: (install: string): Array<string> => {
      return all(install, /-o (\S+)/g);
    },
    used: (config: string): Array<string> => {
      return all(config, /-javaagent:(\S+)/g);
    },
  },
  dotnet: {
    installed: (install: string): Array<string> => {
      return all(install, /dotnet add package (\S+)/g);
    },
    used: (config: string): Array<string> => {
      return matching(config, DOTNET_CALLS);
    },
  },
  rust: {
    installed: (install: string): Array<string> => {
      return all(install, /^([a-z][\w-]*) = /gm).map((name: string): string => {
        return name.replace(/-/g, "_");
      });
    },
    used: rustCratesUsed,
  },
  // Guzzle is the PSR-18 client the exporter sends with: nothing imports it.
  php: {
    installed: (install: string): Array<string> => {
      return all(install, /([a-z][\w-]*\/[\w-]+):\d/g);
    },
    used: (config: string): Array<string> => {
      return [
        ...packagesOf(all(config, /^use ([\w\\]+)/gm), PHP_NAMESPACES),
        "guzzlehttp/guzzle",
      ];
    },
  },
  ruby: {
    installed: (install: string): Array<string> => {
      return all(install, /^gem "([\w-]+)"/gm);
    },
    used: (config: string): Array<string> => {
      return packagesOf(all(config, /^require "([^"]+)"/gm), RUBY_REQUIRES);
    },
  },
  elixir: {
    installed: (install: string): Array<string> => {
      return all(install, /\{:(\w+), "/g);
    },
    used: (config: string): Array<string> => {
      return matching(config, ELIXIR_USES);
    },
  },
  cpp: {
    installed: (install: string): Array<string> => {
      return all(install, /opentelemetry-cpp::(\w+)/g);
    },
    used: (config: string): Array<string> => {
      return matching(config, C_PLUS_PLUS_HEADERS);
    },
  },
  swift: {
    installed: (install: string): Array<string> => {
      return all(install, /\.product\(name: "(\w+)"/g);
    },
    used: (config: string): Array<string> => {
      return packagesOf(all(config, /^import (\w+)/gm), SWIFT_MODULES);
    },
  },
};

describe("each install step installs exactly what its code uses (issues #7469 and #7928)", () => {
  test("every language has a check", () => {
    expect(Object.keys(PACKAGE_CHECKS).sort()).toEqual(
      [...TELEMETRY_GUIDE_LANGUAGE_KEYS].sort(),
    );
  });

  test.each(EVERY_VARIANT)(
    "%s, %s",
    (language: Language, _name: string, signals: ReadonlyArray<OtelSignal>) => {
      const install: string = installOf(language, signals);
      const config: string = configOf(language, signals);
      const used: Array<string> =
        language === "go"
          ? goModulesUsed(config, install)
          : PACKAGE_CHECKS[language].used(config);

      expect([
        language,
        uniqueSorted(PACKAGE_CHECKS[language].installed(install)),
      ]).toEqual([language, uniqueSorted(used)]);
      // An install step that names nothing would pass the check above.
      expect([language, used.length > 0]).toEqual([language, true]);
    },
  );

  test("the check fails on a package the code imports that is not installed", () => {
    const install: string = installOf("node", ["logs"]);
    const config: string = `${configOf("node", ["logs"])}\nimport pino from 'pino';`;

    expect(uniqueSorted(npm.installed(install))).not.toEqual(
      uniqueSorted(npm.used(config)),
    );
  });

  test("the check fails on a package installed that the code does not use", () => {
    const install: string = `${installOf("ruby", ["traces"])}\ngem "opentelemetry-logs-sdk", "0.8.1"`;

    expect(uniqueSorted(PACKAGE_CHECKS.ruby.installed(install))).not.toEqual(
      uniqueSorted(PACKAGE_CHECKS.ruby.used(configOf("ruby", ["traces"]))),
    );
  });
});

/*
 * Every install step pins versions that the snippets were run with, in the
 * ecosystem's own form, and never "latest": the code is written for one
 * API, and the next major one changes it (#7469: sdk-logs 3.x took its
 * exporter in an options object, and the snippet's 2.x call sent nothing).
 */
const EXACT_PINS: Record<Language, RegExp> = {
  node: /@opentelemetry\/[\w-]+@\d+\.\d+\.\d+/g,
  react: /@opentelemetry\/[\w-]+@\d+\.\d+\.\d+/g,
  angular: /@opentelemetry\/[\w-]+@\d+\.\d+\.\d+/g,
  python: /[\w-]+==\d+\.\d+(\.\d+|b\d+)/g,
  go: /@v\d+\.\d+\.\d+/g,
  java: /\/releases\/download\/v\d+\.\d+\.\d+\//g,
  dotnet: /--version \d+\.\d+\.\d+/g,
  rust: /"\d+\.\d+\.\d+"/g,
  php: /:\d+\.\d+\.\d+/g,
  ruby: /, "\d+\.\d+\.\d+"/g,
  elixir: /, "\d+\.\d+\.\d+"\}/g,
  cpp: /GIT_TAG v\d+\.\d+\.\d+/g,
  swift: /from: "\d+\.\d+\.\d+"/g,
};

describe("the install steps pin the versions the snippets were run with", () => {
  test.each(EVERY_VARIANT)(
    "%s, %s: every package at an exact version",
    (language: Language, _name: string, signals: ReadonlyArray<OtelSignal>) => {
      const install: string = installOf(language, signals);
      const packages: number = uniqueSorted(
        PACKAGE_CHECKS[language].installed(install),
      ).length;
      const pins: number = (install.match(EXACT_PINS[language]) || []).length;

      expect([language, install.includes("latest")]).toEqual([language, false]);
      // Swift and C++ pin their one release; the rest pin each package.
      expect([language, pins]).toEqual([
        language,
        language === "swift"
          ? 2
          : language === "cpp" || language === "java"
            ? 1
            : packages,
      ]);
    },
  );

  test.each<[string, Readonly<Record<string, string>>]>([
    ["Node.js", NODE_PACKAGE_VERSIONS],
    ["the browser", BROWSER_PACKAGE_VERSIONS],
  ])(
    "%s: one OpenTelemetry JS release, its SDK at one version and its 0.x packages at another",
    (_label: string, versions: Readonly<Record<string, string>>) => {
      // The contrib repository's packages have versions of their own.
      const contrib: Array<string> = [
        "@opentelemetry/auto-instrumentations-node",
        "@opentelemetry/instrumentation-document-load",
      ];
      const released: Array<[string, string]> = Object.entries(versions).filter(
        ([name]: [string, string]): boolean => {
          return !contrib.includes(name) && name !== "@opentelemetry/api";
        },
      );
      const experimental: Set<string> = new Set(
        released
          .filter(([, version]: [string, string]): boolean => {
            return version.startsWith("0.");
          })
          .map(([, version]: [string, string]): string => {
            return version;
          }),
      );
      const stable: Set<string> = new Set(
        released
          .filter(([, version]: [string, string]): boolean => {
            return !version.startsWith("0.");
          })
          .map(([, version]: [string, string]): string => {
            return version;
          }),
      );

      expect([...experimental]).toEqual(["0.301.2"]);
      expect([...stable]).toEqual(["3.1.1"]);
      expect(versions["@opentelemetry/api"]).toBe("1.10.0");
    },
  );

  test("Node.js and the browser pin the same OpenTelemetry JS release", () => {
    for (const [name, version] of Object.entries(BROWSER_PACKAGE_VERSIONS)) {
      if (NODE_PACKAGE_VERSIONS[name]) {
        expect([name, NODE_PACKAGE_VERSIONS[name]]).toEqual([name, version]);
      }
    }
  });

  test("Go: one release of the otel modules, at or after WithEndpointURL (v1.23.0)", () => {
    const stable: Array<string> = Object.entries(GO_MODULE_VERSIONS)
      .filter(([name, version]: [string, string]): boolean => {
        return (
          name.startsWith("go.opentelemetry.io/otel") &&
          version.startsWith("v1.")
        );
      })
      .map(([, version]: [string, string]): string => {
        return version;
      });

    expect(new Set(stable).size).toBe(1);

    const [major, minor] = stable[0]!.slice(1).split(".").map(Number);

    expect(major! > 1 || (major === 1 && minor! >= 23)).toBe(true);
  });

  /*
   * opentelemetry-otlp 0.27 replaced new_exporter()/new_pipeline() with the
   * builders the code calls. The opentelemetry crates move together, and
   * tracing-opentelemetry's minor is theirs plus one (#7928).
   */
  test("Rust: the opentelemetry crates at one version with the builder API, and tracing-opentelemetry beside them", () => {
    const minorOf: (crate: string) => number = (crate: string): number => {
      const match: RegExpMatchArray | null = (
        RUST_CRATE_VERSIONS[crate] || ""
      ).match(/^0\.(\d+)\.\d+$/);

      if (!match) {
        throw new Error(`No 0.x pin for ${crate}`);
      }

      return Number(match[1]);
    };

    const otlp: number = minorOf("opentelemetry-otlp");

    expect(otlp).toBeGreaterThanOrEqual(27);
    for (const crate of [
      "opentelemetry",
      "opentelemetry_sdk",
      "opentelemetry-appender-tracing",
    ]) {
      expect([crate, RUST_CRATE_VERSIONS[crate]]).toEqual([
        crate,
        RUST_CRATE_VERSIONS["opentelemetry-otlp"],
      ]);
    }
    expect(minorOf("tracing-opentelemetry")).toBe(otlp + 1);
  });

  test("Java: the agent of a named release, the one the command loads", () => {
    const install: string = installOf("java", ["traces"]);

    expect(install).toContain(
      `/releases/download/v${JAVA_AGENT_VERSION}/opentelemetry-javaagent.jar`,
    );
    expect(install).not.toContain("releases/latest");
  });

  test("C++ and Swift: the releases the code was built against", () => {
    expect(installOf("cpp", ["traces"])).toContain(
      `GIT_TAG v${OPENTELEMETRY_CPP_VERSION}`,
    );
    expect(
      installOf("swift", ["traces"]).split(
        `from: "${OPENTELEMETRY_SWIFT_VERSION}"`,
      ).length - 1,
    ).toBe(2);
  });
});

describe("Node.js: instrumentation.mjs runs as handed out (issue #7469)", () => {
  test.each(VARIANTS.map(nameOf))(
    "%s: an ES module, loaded with --import, so a CommonJS app and an ES module app both load it",
    (name: string) => {
      const code: string = configOf(
        "node",
        name.split("+") as Array<OtelSignal>,
      );
      const [first, second] = code.split("\n");

      expect(first).toBe("// instrumentation.mjs - load it before your app:");
      expect(second).toBe("//   node --import ./instrumentation.mjs app.js");
      // tracing.ts under --require stopped at its first import.
      expect(code).not.toContain("--require");
      expect(code).not.toContain("tracing.ts");
      // The ES module hook, for packages an ES module app imports.
      expect(code).toContain(
        "register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);",
      );
      // A script that ends sends what is buffered.
      expect(code).toContain("process.once('beforeExit', stop);");
    },
  );

  test("processors and readers are given an options object, as SDK 3.x takes them", () => {
    const code: string = configOf("node", OTEL_SIGNALS);

    expect(code).toContain(
      "new BatchLogRecordProcessor({\n      exporter: new OTLPLogExporter({",
    );
    expect(code).toContain(
      "new PeriodicExportingMetricReader({\n      exporter: new OTLPMetricExporter({",
    );
    // SDK 2.x's call, which 3.x reads as options with no exporter.
    expect(code).not.toMatch(/new BatchLogRecordProcessor\(\s*new /);
    // sdk-node 0.301 takes metricReaders, not metricReader.
    expect(code).toContain("metricReaders: [");
    expect(code).not.toMatch(/metricReader:/);
  });

  test("the logs snippet says console.log is not sent, and shows what is", () => {
    const code: string = configOf("node", ["logs"]);

    expect(code).toContain(
      "// What pino, winston and bunyan write is sent. console.log lines are not:",
    );
    expect(code).toContain(
      "//   import { logs, SeverityNumber } from '@opentelemetry/api';",
    );
    // OneUptime reads a record's severity from its number.
    expect(code).toContain("//     severityNumber: SeverityNumber.INFO,");
  });
});

describe("Rust: src/main.rs runs as handed out (issue #7928)", () => {
  test.each(VARIANTS.map(nameOf))(
    "%s: a whole program on the current builder API, with no async runtime to guess",
    (name: string) => {
      const signals: Array<OtelSignal> = name.split("+") as Array<OtelSignal>;
      const code: string = configOf("rust", signals);
      const install: string = installOf("rust", signals);

      expect(code.split("\n")[0]).toBe("// src/main.rs - cargo run");
      expect(code).toContain(
        "fn main() -> Result<(), Box<dyn std::error::Error>> {",
      );
      // opentelemetry-otlp 0.26's API, removed in 0.27.
      expect(code).not.toMatch(/new_exporter|new_pipeline|install_batch/);
      // The blocking client runs on the processors' own threads.
      expect(`${code}\n${install}`).not.toMatch(/tokio/i);
      // TLS, for an https server such as OneUptime Cloud.
      expect(install).toContain(
        'opentelemetry-otlp = { version = "0.33.1", features = ["reqwest-rustls"] }',
      );

      // Each provider shuts down before main returns.
      for (const signal of signals) {
        const provider: string = {
          traces: "tracer_provider",
          metrics: "meter_provider",
          logs: "logger_provider",
        }[signal];

        expect(code).toContain(`    ${provider}.shutdown()?;\n`);
      }
    },
  );

  /*
   * The trait a `use` brings in for its methods, which the code calls:
   * without the call, rustc warns that the import is unused.
   */
  const TRAIT_METHODS: Record<string, string> = {
    SubscriberExt: ".with(",
    SubscriberInitExt: ".init()",
    Layer: ".with_filter(",
    WithExportConfig: ".with_endpoint(",
    WithHttpConfig: ".with_headers(",
  };

  test.each(VARIANTS.map(nameOf))(
    "%s: every name a `use` brings in is used",
    (name: string) => {
      const code: string = configOf(
        "rust",
        name.split("+") as Array<OtelSignal>,
      );
      const body: string = code
        .split("\n")
        .filter((line: string): boolean => {
          return !line.startsWith("use ");
        })
        .join("\n");

      for (const imported of rustImportedNames(code)) {
        const call: string | undefined = TRAIT_METHODS[imported];
        const used: boolean = call
          ? body.includes(call)
          : new RegExp(`\\b${imported}\\b`).test(body);

        expect([name, imported, used]).toEqual([name, imported, true]);
      }
    },
  );

  test("the unused-import check fails on the tracing_subscriber import the snippet carried before", () => {
    const code: string = `use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};\n${configOf("rust", ["metrics"])}`;
    const body: string = code
      .split("\n")
      .filter((line: string): boolean => {
        return !line.startsWith("use ");
      })
      .join("\n");

    expect(body.includes(TRAIT_METHODS["SubscriberExt"]!)).toBe(false);
    // And the crate is not installed for metrics.
    expect(
      PACKAGE_CHECKS.rust.installed(installOf("rust", ["metrics"])),
    ).not.toContain("tracing_subscriber");
    expect(rustCratesUsed(code)).toContain("tracing_subscriber");
  });

  test("the app's tracing spans and events are what is sent", () => {
    const code: string = configOf("rust", OTEL_SIGNALS);

    expect(code).toContain("tracing_opentelemetry::layer()");
    expect(code).toContain("OpenTelemetryTracingBridge::new(&logger_provider)");
    // What the SDK says about itself is kept out of what it sends.
    expect(code).toContain(
      'EnvFilter::new("info,opentelemetry=off,hyper=off,reqwest=off")',
    );
  });
});

describe("React and Angular: OpenTelemetry JS 3.x", () => {
  test.each<[Language, string]>([
    ["react", "src/main.tsx"],
    ["angular", "src/main.ts"],
  ])(
    "%s: providers take their processors and readers as they are built",
    (language: Language, entry: string) => {
      const code: string = configOf(language, OTEL_SIGNALS);

      // Gone since 2.0.
      expect(code).not.toContain("addSpanProcessor");
      expect(code).not.toMatch(/new Resource\(/);
      expect(code).not.toContain("@opentelemetry/sdk-trace-web");
      expect(code).toContain("spanProcessors: [");
      expect(code).toContain("resourceFromAttributes(");
      expect(code).toContain(entry);
      // The token ships to every visitor.
      expect(code).toContain(
        "// It must be a Browser ingestion key, never a Server one.",
      );
    },
  );
});

describe("Swift: the packages and calls the current release has", () => {
  test("the API and SDK from opentelemetry-swift-core, the exporters from opentelemetry-swift", () => {
    const install: string = installOf("swift", OTEL_SIGNALS);

    expect(install).toContain(
      '.product(name: "OpenTelemetryApi", package: "opentelemetry-swift-core"),',
    );
    expect(install).toContain(
      '.product(name: "OpenTelemetryProtocolExporterHTTP", package: "opentelemetry-swift"),',
    );
    // A product that does not exist.
    expect(install).not.toContain("OtlpHttpSpanExporting");
  });

  test("metrics have a view and a flush, without which the SDK sends none", () => {
    const code: string = configOf("swift", ["metrics"]);

    expect(code).toContain(
      'selector: InstrumentSelector.builder().setInstrument(name: ".*").build(),',
    );
    expect(code.indexOf("meterProvider.forceFlush()")).toBeLessThan(
      code.indexOf("meterProvider.shutdown()"),
    );
  });
});

describe("logs come from the language's own logging, as the guide says", () => {
  // What the logs snippet sends from, and what it says is not sent.
  const LOGGING: Record<Language, [RegExp, RegExp]> = {
    node: [/pino, winston and bunyan/, /console\.log lines are not/],
    python: [
      /LoggingInstrumentor\(\)\.instrument\(\)/,
      /print\(\) output is not/,
    ],
    go: [/otelslog\.NewLogger/, /fmt\.Println output is not/],
    java: [/Logback, Log4j and java\.util\.logging/, /System\.out is not/],
    dotnet: [/ILogger/, /Console\.WriteLine is not sent/],
    rust: [/OpenTelemetryTracingBridge/, /println! is not sent/],
    php: [/OpenTelemetryHandler/, /echo and error_log\(\) are not sent/],
    ruby: [/OpenTelemetry::Instrumentation::Logger/, /puts is not/],
    elixir: [/:otel_log_handler/, /IO\.puts is not/],
    cpp: [/GetLogger\("my-service"\)->Info\(/, /std::cout is not/],
    swift: [/\.logRecordBuilder\(\)/, /print is not/],
    react: [
      /logs\.getLogger\('my-react-app'\)\.emit\(/,
      /console\.log lines are not sent/,
    ],
    angular: [
      /logs\.getLogger\('my-angular-app'\)\.emit\(/,
      /console\.log lines are not sent/,
    ],
  };

  test.each([...TELEMETRY_GUIDE_LANGUAGE_KEYS])("%s", (language: Language) => {
    const code: string = configOf(language, ["logs"]);
    const [sends, notSent] = LOGGING[language];

    expect([language, sends.test(code)]).toEqual([language, true]);
    expect([language, notSent.test(code)]).toEqual([language, true]);
  });
});

describe("the snippets' shared helpers", () => {
  test("lines leaves out the parts set to false, at any depth", () => {
    expect(lines("a", false, ["b", false, ["c", false]], [], "d")).toBe(
      "a\nb\nc\nd",
    );
  });

  test("toOtelSignals and signalsOf", () => {
    expect(toOtelSignals("logs")).toEqual({
      traces: false,
      metrics: false,
      logs: true,
    });
    expect(signalsOf(toOtelSignals(["logs", "traces"]))).toEqual([
      "traces",
      "logs",
    ]);
    expect(() => {
      return toOtelSignals([]);
    }).toThrow();
  });
});

/*
 * The docs' OpenTelemetry page has a Node.js tab of its own (configured by
 * the environment variables), with the same two calls the Setup Guide's
 * snippet had (#7469): a log processor given its exporter as its options,
 * which SDK 3.x reads as no exporter, so no log was ever sent, and
 * `metricReader`, which sdk-node 0.301 no longer reads. It pins the Setup
 * Guide's versions, in every language the docs are in.
 */
describe("the docs' Node.js tab says what the Setup Guide's says", () => {
  const contentDirectory: string = path.resolve(
    __dirname,
    "../../FeatureSet/Docs/Content",
  );
  const nodeTabOf: (locale: string) => string = (locale: string): string => {
    const page: string = fs.readFileSync(
      path.join(contentDirectory, locale, "telemetry/open-telemetry.md"),
      "utf8",
    );

    return page.slice(
      page.indexOf("@tab Node.js"),
      page.indexOf("@tab Python"),
    );
  };
  const locales: Array<string> = fs
    .readdirSync(contentDirectory)
    .filter((locale: string): boolean => {
      return fs.existsSync(
        path.join(contentDirectory, locale, "telemetry/open-telemetry.md"),
      );
    });

  test("the page is in more than English, and each language's tab is English's", () => {
    expect(locales.length).toBeGreaterThan(1);
    for (const locale of locales) {
      expect([locale, nodeTabOf(locale).match(/```[\s\S]*?```/g)]).toEqual([
        locale,
        nodeTabOf("en").match(/```[\s\S]*?```/g),
      ]);
    }
  });

  test("processors and readers are given an options object, as SDK 3.x takes them", () => {
    const tab: string = nodeTabOf("en");

    expect(tab).toContain(
      "new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() }),",
    );
    expect(tab).toContain(
      "new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),",
    );
    expect(tab).toContain("metricReaders: [");
    expect(tab).not.toMatch(/new BatchLogRecordProcessor\(\s*new /);
    expect(tab).not.toMatch(/metricReader:/);
  });

  test("its install line pins each package at the Setup Guide's version", () => {
    const install: string = nodeTabOf("en").match(/npm install[^`]*/)![0];
    const pins: Array<[string, string]> = [
      ...install.matchAll(/(@opentelemetry\/[\w-]+)@(\d+\.\d+\.\d+)/g),
    ].map((match: RegExpMatchArray): [string, string] => {
      return [match[1]!, match[2]!];
    });

    expect(pins.length).toBe(7);
    expect(install.match(/@opentelemetry\/[\w-]+/g)!.length).toBe(pins.length);
    for (const [name, version] of pins) {
      expect([name, version]).toEqual([name, NODE_PACKAGE_VERSIONS[name]]);
    }
  });
});

describe("the addresses are the ones a server serves", () => {
  const read: (relativePath: string) => string = (
    relativePath: string,
  ): string => {
    return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
  };

  test.each([...OTEL_SIGNALS])(
    "the App serves %s at /otlp/v1/<signal>, which the ingress sends it as it is",
    (signal: OtelSignal) => {
      expect(read("../../FeatureSet/Telemetry/API/OTelIngest.ts")).toContain(
        `"/otlp/v1/${signal}"`,
      );
      expect(read("../../../Nginx/default.conf.template")).toContain(
        "location /otlp {",
      );
    },
  );
});
