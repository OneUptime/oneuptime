import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
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
      "value: {{ $.Values.openTelemetryExporter.headers }}",
    );
    expect(source).toContain(
      "- name: PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY",
    );
    expect(source).toContain(
      "value: {{ $.Values.browserOpenTelemetryExporter.browserIngestionKey }}",
    );
  });
});
