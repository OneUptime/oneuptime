import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  TELEMETRY_GUIDE_LANGUAGE_KEYS,
  TelemetryGuideLanguageKey,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import {
  getEnvVarSnippet,
  getOtelConfigSnippet,
  getOtelInstallSnippet,
  replacePlaceholders,
} from "../../FeatureSet/Dashboard/src/Components/Telemetry/OtelSdkSnippets";

/*
 * Where each language's OpenTelemetry snippet sends its data (issue #7885),
 * with the placeholders filled as the Setup Guide fills them: the OTLP
 * endpoint <scheme>://<host>/otlp and the picked key.
 *
 * The App serves OTLP over HTTP at <endpoint>/v1/traces, /v1/metrics and
 * /v1/logs, and at nothing else under it. Python's and .NET's exporters were
 * given the endpoint itself and posted to /otlp, which answers 404; Go's
 * WithEndpoint took the host alone and posted to https://<host>/v1/traces,
 * which no server block sends to the App.
 *
 * Every language has a row below, and every row says how its SDK uses each
 * address the snippet gives it, as the SDK's source does (the versions read
 * are in the comments). A language the guide gains fails here until it has
 * a row.
 */

type Signal = "traces" | "metrics" | "logs";

/*
 * How an SDK uses an address:
 *  - "as written": an address given to an exporter in code is posted to as
 *    it is (OTLP/HTTP's per-signal URL);
 *  - "adds /v1/<signal>": the endpoint (OTEL_EXPORTER_OTLP_ENDPOINT and the
 *    SDKs' own names for it), to which the SDK adds each signal's path.
 */
type AddressUse = "as written" | "adds /v1/<signal>";

interface ExporterAddress {
  // What sends, as the snippet writes it.
  exporter: string;
  // Reads the address the snippet gives it (group 1).
  address: RegExp;
  use: AddressUse;
  signals: Array<Signal>;
}

const traceUrl: (constructor: string) => ExporterAddress = (
  constructor: string,
): ExporterAddress => {
  return {
    exporter: `${constructor}'s url`,
    address: new RegExp(`new ${constructor}\\(\\{\\s*url: '([^']*)'`),
    use: "as written",
    signals: [
      constructor === "OTLPTraceExporter"
        ? "traces"
        : constructor === "OTLPMetricExporter"
          ? "metrics"
          : "logs",
    ],
  };
};

// .NET: one signal's AddOtlpExporter (read up to it), and the Endpoint it sets.
const dotnetEndpoint: (
  exporter: string,
  upToExporter: string,
  signal: Signal,
) => ExporterAddress = (
  exporter: string,
  upToExporter: string,
  signal: Signal,
): ExporterAddress => {
  return {
    exporter: `${exporter} Endpoint`,
    address: new RegExp(
      `${upToExporter}\\(options => \\{\\s*options\\.Endpoint = new Uri\\("([^"]*)"\\)`,
    ),
    // HttpProtobuf: an Endpoint set in code is the signal's URL (1.21.0's README).
    use: "as written",
    signals: [signal],
  };
};

const EXPORTERS: Record<TelemetryGuideLanguageKey, Array<ExporterAddress>> = {
  // @opentelemetry/exporter-*-otlp-proto: url is the signal's URL.
  node: [
    traceUrl("OTLPTraceExporter"),
    traceUrl("OTLPMetricExporter"),
    traceUrl("OTLPLogExporter"),
  ],
  // opentelemetry-exporter-otlp-proto-http 1.45.2: `endpoint or <env>`.
  python: [
    {
      exporter: "OTLPSpanExporter(endpoint=)",
      address: /OTLPSpanExporter\(\s*endpoint="([^"]*)"/,
      use: "as written",
      signals: ["traces"],
    },
    {
      exporter: "OTLPMetricExporter(endpoint=)",
      address: /OTLPMetricExporter\(\s*endpoint="([^"]*)"/,
      use: "as written",
      signals: ["metrics"],
    },
  ],
  // otlptracehttp v1.47.0: "The path of the provided URL is used as-is".
  go: [
    {
      exporter: "otlptracehttp.WithEndpointURL",
      address: /otlptracehttp\.WithEndpointURL\("([^"]*)"\)/,
      use: "as written",
      signals: ["traces"],
    },
  ],
  // The Java agent (OtlpConfigUtil, 1.68.0) adds v1/<signal> for http/protobuf.
  java: [
    {
      exporter: "-Dotel.exporter.otlp.endpoint",
      address: /-Dotel\.exporter\.otlp\.endpoint=(\S+)/,
      use: "adds /v1/<signal>",
      signals: ["traces", "metrics", "logs"],
    },
  ],
  dotnet: [
    dotnetEndpoint(
      "WithTracing's AddOtlpExporter",
      "\\.WithTracing\\([^;]*?\\.AddOtlpExporter",
      "traces",
    ),
    dotnetEndpoint(
      "WithMetrics's AddOtlpExporter",
      "\\.WithMetrics\\([^;]*?\\.AddOtlpExporter",
      "metrics",
    ),
    dotnetEndpoint(
      "logging.AddOtlpExporter",
      "logging\\.AddOtlpExporter",
      "logs",
    ),
  ],
  // opentelemetry-otlp 0.16 and later post to with_endpoint as written.
  rust: [
    {
      exporter: ".http().with_endpoint",
      address: /\.http\(\)\s*\.with_endpoint\("([^"]*)"\)/,
      use: "as written",
      signals: ["traces"],
    },
  ],
  php: [
    {
      exporter: "HttpTransportFactory's endpoint",
      address: /new HttpTransportFactory\(\)\)->create\(\s*'([^']*)'/,
      use: "as written",
      signals: ["traces"],
    },
  ],
  // opentelemetry-exporter-otlp 0.37.0: an endpoint given in code is URI(endpoint).
  ruby: [
    {
      exporter: "OTLP::Exporter.new(endpoint:)",
      address: /OTLP::Exporter\.new\(\s*endpoint: '([^']*)'/,
      use: "as written",
      signals: ["traces"],
    },
  ],
  // opentelemetry_exporter 1.11.0: otlp_endpoint gets v1/traces appended.
  elixir: [
    {
      exporter: "otlp_endpoint",
      address: /otlp_endpoint: "([^"]*)"/,
      use: "adds /v1/<signal>",
      signals: ["traces"],
    },
  ],
  cpp: [
    {
      exporter: "OtlpHttpExporterOptions.url",
      address: /opts\.url = "([^"]*)"/,
      use: "as written",
      signals: ["traces"],
    },
  ],
  swift: [
    {
      exporter: "OtlpHttpSpanExporter(endpoint:)",
      address: /OtlpHttpSpanExporter\(\s*endpoint: URL\(string: "([^"]*)"\)/,
      use: "as written",
      signals: ["traces"],
    },
  ],
  react: [traceUrl("OTLPTraceExporter")],
  angular: [traceUrl("OTLPTraceExporter")],
};

// OTEL_EXPORTER_OTLP_ENDPOINT, under every language (Advanced).
const ENVIRONMENT_VARIABLES: Array<ExporterAddress> = [
  {
    exporter: "OTEL_EXPORTER_OTLP_ENDPOINT",
    address: /OTEL_EXPORTER_OTLP_ENDPOINT="([^"]*)"/,
    use: "adds /v1/<signal>",
    signals: ["traces", "metrics", "logs"],
  },
];

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
const postsTo: (address: string, use: AddressUse, signal: Signal) => string = (
  address: string,
  use: AddressUse,
  signal: Signal,
): string => {
  return use === "as written"
    ? address
    : `${address.replace(/\/$/, "")}/v1/${signal}`;
};

/*
 * Each exporter's signal, the address the snippet gives it and where the
 * SDK posts it, beside where the App serves that signal.
 */
const sendsOf: (
  code: string,
  exporters: Array<ExporterAddress>,
  server: Server,
) => Array<Array<string>> = (
  code: string,
  exporters: Array<ExporterAddress>,
  server: Server,
): Array<Array<string>> => {
  return exporters.flatMap(
    (exporter: ExporterAddress): Array<Array<string>> => {
      const match: RegExpMatchArray | null = code.match(exporter.address);
      const address: string = match ? match[1]! : "(not in the snippet)";

      return exporter.signals.map((signal: Signal): Array<string> => {
        return [
          exporter.exporter,
          signal,
          postsTo(address, exporter.use, signal),
          `${otlpEndpointOf(server)}/v1/${signal}`,
        ];
      });
    },
  );
};

// Every place the snippet gives the server's address.
const countOf: (code: string, text: string) => number = (
  code: string,
  text: string,
): number => {
  return code.split(text).length - 1;
};

describe("every language's OpenTelemetry snippet posts where the App serves its signal", () => {
  test("every language the guide offers has a row", () => {
    expect(Object.keys(EXPORTERS).sort()).toEqual(
      [...TELEMETRY_GUIDE_LANGUAGE_KEYS].sort(),
    );
  });

  describe.each(SERVERS)("$label", (server: Server) => {
    test.each([...TELEMETRY_GUIDE_LANGUAGE_KEYS])(
      "%s",
      (language: TelemetryGuideLanguageKey) => {
        const code: string = filled(
          getOtelConfigSnippet(language).code,
          server,
        );
        const exporters: Array<ExporterAddress> = EXPORTERS[language];

        // Each exporter posts its signal to the App's route for it.
        for (const [exporter, signal, sent, served] of sendsOf(
          code,
          exporters,
          server,
        )) {
          expect([language, exporter, signal, sent]).toEqual([
            language,
            exporter,
            signal,
            served,
          ]);
        }

        // And the snippet gives the server's address nowhere else.
        expect([language, countOf(code, server.host)]).toEqual([
          language,
          exporters.length,
        ]);

        // Every placeholder is filled.
        expect([language, code.match(/<YOUR_ONEUPTIME_[A-Z_]+>/g)]).toEqual([
          language,
          null,
        ]);
        expect(code).toContain(KEY);
      },
    );

    test("the environment variables, under every language", () => {
      const code: string = filled(getEnvVarSnippet(), server);

      for (const [exporter, signal, sent, served] of sendsOf(
        code,
        ENVIRONMENT_VARIABLES,
        server,
      )) {
        expect([exporter, signal, sent]).toEqual([exporter, signal, served]);
      }
      expect(countOf(code, server.host)).toBe(1);
      expect(code).toContain(`x-oneuptime-token=${KEY}`);
    });
  });

  test("before the server's address is known, every address is the endpoint's placeholder", () => {
    for (const language of TELEMETRY_GUIDE_LANGUAGE_KEYS) {
      const code: string = getOtelConfigSnippet(language).code;

      for (const exporter of EXPORTERS[language]) {
        const match: RegExpMatchArray | null = code.match(exporter.address);

        expect([language, exporter.exporter, match ? match[1] : null]).toEqual([
          language,
          exporter.exporter,
          exporter.use === "as written"
            ? `<YOUR_ONEUPTIME_URL>/v1/${exporter.signals[0]}`
            : "<YOUR_ONEUPTIME_URL>",
        ]);
      }
    }
  });
});

describe("the install steps pull the versions those rules are for", () => {
  test("Go: the exporters with no pin, or one that has WithEndpointURL (v1.23.0 and later)", () => {
    const install: string = getOtelInstallSnippet("go").code;

    for (const exporter of ["otlptracehttp", "otlpmetrichttp"]) {
      const named: RegExpMatchArray | null = install.match(
        new RegExp(`/${exporter}(@v(\\d+)\\.(\\d+)\\.\\d+)?(?=\\s|$)`),
      );

      expect([exporter, Boolean(named)]).toEqual([exporter, true]);

      if (named![1]) {
        const major: number = Number(named![2]);
        const minor: number = Number(named![3]);

        expect([exporter, major > 1 || (major === 1 && minor >= 23)]).toEqual([
          exporter,
          true,
        ]);
      }
    }
  });

  /*
   * opentelemetry-otlp 0.15 added /v1/traces to with_endpoint; 0.16 and
   * later post to it as written. The code's install_batch returns the
   * TracerProvider, as it does from 0.17 on, and new_exporter/new_pipeline
   * are gone after 0.26. Its companions match it: tracing-opentelemetry's
   * opentelemetry, and the reqwest 0.12 it shares (whose default TLS the
   * exporter's https needs).
   */
  test("Rust: the opentelemetry-otlp its code is for, which posts with_endpoint as written", () => {
    const install: string = getOtelInstallSnippet("rust").code;
    const minorOf: (crate: string) => number = (crate: string): number => {
      const match: RegExpMatchArray | null = install.match(
        new RegExp(`^${crate} = (?:\\{ version = )?"0\\.(\\d+)"`, "m"),
      );

      if (!match) {
        throw new Error(`No ${crate} in:\n${install}`);
      }

      return Number(match[1]);
    };

    const otlp: number = minorOf("opentelemetry-otlp");

    expect(otlp).toBeGreaterThanOrEqual(17);
    expect(otlp).toBeLessThanOrEqual(26);
    expect(minorOf("opentelemetry")).toBe(otlp);
    expect(minorOf("opentelemetry_sdk")).toBe(otlp);
    expect(minorOf("tracing-opentelemetry")).toBe(otlp + 1);
    expect(minorOf("reqwest")).toBe(12);
  });
});

describe("the addresses are the ones a server serves", () => {
  const read: (relativePath: string) => string = (
    relativePath: string,
  ): string => {
    return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
  };

  const signals: Array<Signal> = ["traces", "metrics", "logs"];

  test.each(signals)(
    "the App serves %s at /otlp/v1/<signal>, which the ingress sends it as it is",
    (signal: Signal) => {
      expect(read("../../FeatureSet/Telemetry/API/OTelIngest.ts")).toContain(
        `"/otlp/v1/${signal}"`,
      );
      expect(read("../../../Nginx/default.conf.template")).toContain(
        "location /otlp {",
      );
    },
  );
});
