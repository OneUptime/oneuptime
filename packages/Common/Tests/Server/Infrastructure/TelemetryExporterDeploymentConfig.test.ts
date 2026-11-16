import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import {
  AggregationTemporality,
  InstrumentType,
} from "@opentelemetry/sdk-metrics";
import { CAPTURE_MESSAGE_CONTENT_ENV_VAR } from "../../../Server/Utils/LLM/LLMCallTelemetry";

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const COMPOSE_PATH: string = path.join(REPO_ROOT, "docker-compose.base.yml");
const EXAMPLE_ENV_PATH: string = path.join(REPO_ROOT, "config.example.env");
const HELM_VALUES_PATH: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "oneuptime",
  "values.yaml",
);
const HELM_HELPERS_PATH: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "oneuptime",
  "templates",
  "_helpers.tpl",
);

interface ComposeConfig {
  "x-common-variables": Record<string, string>;
}

function readExampleEnvValue(name: string): string | undefined {
  const source: string = fs.readFileSync(EXAMPLE_ENV_PATH, "utf8");
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`^${name}=(.*)$`, "m"),
  );

  return match?.[1];
}

describe("telemetry exporter deployment configuration isolation", () => {
  test("Docker Compose passes backend settings under only backend names", () => {
    const compose: ComposeConfig = yaml.load(
      fs.readFileSync(COMPOSE_PATH, "utf8"),
    ) as ComposeConfig;
    const common: Record<string, string> = compose["x-common-variables"];

    expect(common["OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"]).toBe(
      "${OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT}",
    );
    expect(common["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"]).toBe(
      "${OPENTELEMETRY_EXPORTER_OTLP_HEADERS}",
    );
  });

  test("Docker Compose does not alias a server secret into either public setting", () => {
    const compose: ComposeConfig = yaml.load(
      fs.readFileSync(COMPOSE_PATH, "utf8"),
    ) as ComposeConfig;
    const common: Record<string, string> = compose["x-common-variables"];

    expect(common["PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"]).toBe(
      "${PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:-}",
    );
    expect(
      common["PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY"],
    ).toBe("${PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY:-}");
    expect(
      common["PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY"],
    ).not.toContain("OPENTELEMETRY_EXPORTER_OTLP_HEADERS");
  });

  test("the example configuration defaults every exporter channel to blank", () => {
    expect(readExampleEnvValue("OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT")).toBe(
      "",
    );
    expect(readExampleEnvValue("OPENTELEMETRY_EXPORTER_OTLP_HEADERS")).toBe("");
    expect(
      readExampleEnvValue("PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"),
    ).toBe("");
    expect(
      readExampleEnvValue(
        "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY",
      ),
    ).toBe("");
  });

  test("the example configuration labels backend headers as non-browser data", () => {
    const source: string = fs.readFileSync(EXAMPLE_ENV_PATH, "utf8");
    const serverSectionStart: number = source.indexOf(
      "# Server-side OpenTelemetry exporter configuration.",
    );
    const browserSectionStart: number = source.indexOf(
      "# Optional browser RUM exporter configuration.",
    );

    expect(serverSectionStart).toBeGreaterThan(-1);
    expect(browserSectionStart).toBeGreaterThan(serverSectionStart);
    expect(source.slice(serverSectionStart, browserSectionStart)).toContain(
      "never serialized into frontend env.js",
    );
    expect(source.slice(browserSectionStart)).toContain(
      "Never place a Server key",
    );
  });

  test("Helm values expose distinct server and browser configuration blocks", () => {
    const values: Record<string, unknown> = yaml.load(
      fs.readFileSync(HELM_VALUES_PATH, "utf8"),
    ) as Record<string, unknown>;

    expect(values).toHaveProperty("openTelemetryExporter");
    expect(values).toHaveProperty("browserOpenTelemetryExporter");
    expect(values["openTelemetryExporter"]).not.toBe(
      values["browserOpenTelemetryExporter"],
    );
  });

  test("Helm maps server and browser values to distinct environment names", () => {
    const source: string = fs.readFileSync(HELM_HELPERS_PATH, "utf8");

    expect(source).toContain("- name: OPENTELEMETRY_EXPORTER_OTLP_HEADERS");
    expect(source).toContain(
      'value: {{ include "oneuptime.envValue" $.Values.openTelemetryExporter.headers }}',
    );
    expect(source).toContain(
      "- name: PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY",
    );
    expect(source).toContain(
      'value: {{ include "oneuptime.envValue" $.Values.browserOpenTelemetryExporter.browserIngestionKey }}',
    );
  });
});

/*
 * OneUptime AI's prompts and answers hold incident details, logs and Ask AI
 * chats private to the person who asked. They go into OneUptime's own
 * telemetry only when the operator turns that on - never because an upgrade
 * added a setting, or a config.env lacks one.
 */
describe("OneUptime AI's prompts and answers stay out of its telemetry unless turned on", () => {
  const ENV_VAR: string = "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT";

  test("the server reads OpenTelemetry's own switch", () => {
    expect(CAPTURE_MESSAGE_CONTENT_ENV_VAR).toBe(ENV_VAR);
  });

  test("the example configuration ships it off", () => {
    expect(readExampleEnvValue(ENV_VAR)).toBe("false");
  });

  test("Docker Compose passes it on, off when config.env has no line for it", () => {
    const compose: ComposeConfig = yaml.load(
      fs.readFileSync(COMPOSE_PATH, "utf8"),
    ) as ComposeConfig;

    expect(compose["x-common-variables"][ENV_VAR]).toBe(
      "${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:-false}",
    );
  });

  test("Helm ships it off", () => {
    const values: Record<string, Record<string, unknown>> = yaml.load(
      fs.readFileSync(HELM_VALUES_PATH, "utf8"),
    ) as Record<string, Record<string, unknown>>;

    expect(values["openTelemetryExporter"]!["captureAiMessageContent"]).toBe(
      false,
    );
  });

  test("Helm sets the switch only when the value is turned on", () => {
    const source: string = fs.readFileSync(HELM_HELPERS_PATH, "utf8");

    expect(source).toContain(
      [
        "{{- if $.Values.openTelemetryExporter.captureAiMessageContent }}",
        `- name: ${ENV_VAR}`,
        '  value: "true"',
        "{{- end }}",
      ].join("\n"),
    );
  });
});

/*
 * How OneUptime's own metrics are sent (#6760): running totals, the
 * OpenTelemetry default, unless the operator asks for deltas, which a
 * OneUptime project reads exactly. One setting next to the exporter's
 * endpoint and headers - OPENTELEMETRY_EXPORTER_OTLP_METRICS_TEMPORALITY in
 * config.env, openTelemetryExporter.metricsTemporality in the Helm chart -
 * reaches every service as OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE,
 * which the OTLP metric exporter reads itself.
 */
describe("OneUptime's own metrics temporality", () => {
  const SETTING: string = "OPENTELEMETRY_EXPORTER_OTLP_METRICS_TEMPORALITY";
  const SDK_VARIABLE: string =
    "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE";
  const FROM_CONFIG: string = `\${${SETTING}:-}`;

  interface ComposeService {
    environment?: Record<string, string>;
  }

  interface ComposeFile {
    "x-common-variables": Record<string, string>;
    services: Record<string, ComposeService>;
  }

  const readCompose: () => ComposeFile = (): ComposeFile => {
    return yaml.load(fs.readFileSync(COMPOSE_PATH, "utf8")) as ComposeFile;
  };

  test("the example configuration ships it empty, which keeps the exporter's default", () => {
    expect(readExampleEnvValue(SETTING)).toBe("");

    const source: string = fs.readFileSync(EXAMPLE_ENV_PATH, "utf8");

    // Beside the exporter's endpoint and headers, in the server-side part.
    expect(source.indexOf(`\n${SETTING}=`)).toBeGreaterThan(
      source.indexOf("\nOPENTELEMETRY_EXPORTER_OTLP_HEADERS="),
    );
    expect(source.indexOf(`\n${SETTING}=`)).toBeLessThan(
      source.indexOf("# Optional browser RUM exporter configuration."),
    );
  });

  test("Docker Compose hands it to the SDK's own variable, empty when config.env has no line for it", () => {
    expect(readCompose()["x-common-variables"][SDK_VARIABLE]).toBe(FROM_CONFIG);
  });

  test("every Compose service that exports OneUptime's own telemetry gets it, from the same setting", () => {
    const services: Record<string, ComposeService> = readCompose().services;
    const exporting: Array<string> = Object.keys(services).filter(
      (name: string): boolean => {
        return Boolean(
          services[name]?.environment?.["OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"],
        );
      },
    );

    // The app, the probes, the global Runner and the rest, merged anchors included.
    expect(exporting).toEqual(
      expect.arrayContaining(["app", "probe-1", "probe-2", "global-runner"]),
    );

    for (const name of exporting) {
      expect({
        name,
        value: services[name]?.environment?.[SDK_VARIABLE],
      }).toEqual({ name, value: FROM_CONFIG });
    }
  });

  test("Helm sets the SDK's variable only when the value is set", () => {
    const source: string = fs.readFileSync(HELM_HELPERS_PATH, "utf8");

    expect(source).toContain(
      [
        "{{- if $.Values.openTelemetryExporter.metricsTemporality }}",
        `- name: ${SDK_VARIABLE}`,
        '  value: {{ include "oneuptime.envValue" $.Values.openTelemetryExporter.metricsTemporality }}',
        "{{- end }}",
      ].join("\n"),
    );

    const values: Record<string, Record<string, unknown>> = yaml.load(
      fs.readFileSync(HELM_VALUES_PATH, "utf8"),
    ) as Record<string, Record<string, unknown>>;

    expect(values["openTelemetryExporter"]).toHaveProperty(
      "metricsTemporality",
    );
    expect(values["openTelemetryExporter"]!["metricsTemporality"]).toBeNull();
  });

  /*
   * The exporter OneUptime builds is given no temporality, so the variable
   * decides: an empty one - what Compose passes for an empty setting - is the
   * exporter's default, cumulative, and delta turns counters and histograms
   * into deltas.
   */
  test.each([
    [undefined, "CUMULATIVE"],
    ["", "CUMULATIVE"],
    ["cumulative", "CUMULATIVE"],
    ["delta", "DELTA"],
  ])(
    "the OTLP metric exporter reads %p as %s",
    (value: string | undefined, expected: string) => {
      const saved: string | undefined = process.env[SDK_VARIABLE];

      try {
        if (value === undefined) {
          delete process.env[SDK_VARIABLE];
        } else {
          process.env[SDK_VARIABLE] = value;
        }

        const exporter: OTLPMetricExporter = new OTLPMetricExporter({
          url: "http://localhost/v1/metrics",
        });

        expect(
          [InstrumentType.COUNTER, InstrumentType.HISTOGRAM].map(
            (instrumentType: InstrumentType): AggregationTemporality => {
              return exporter.selectAggregationTemporality(instrumentType);
            },
          ),
        ).toEqual([
          AggregationTemporality[expected as "CUMULATIVE" | "DELTA"],
          AggregationTemporality[expected as "CUMULATIVE" | "DELTA"],
        ]);

        void exporter.shutdown();
      } finally {
        if (saved === undefined) {
          delete process.env[SDK_VARIABLE];
        } else {
          process.env[SDK_VARIABLE] = saved;
        }
      }
    },
  );
});
