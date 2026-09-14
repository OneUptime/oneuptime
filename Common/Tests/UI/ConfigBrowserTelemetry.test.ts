import { describe, expect, test } from "@jest/globals";
import getBrowserTelemetryConfig, {
  BrowserTelemetryConfig,
} from "../../UI/Utils/Telemetry/BrowserTelemetryConfig";

function load(env: Record<string, string>): BrowserTelemetryConfig {
  return getBrowserTelemetryConfig((key: string): string => {
    return env[key] || "";
  });
}

describe("browser telemetry configuration", () => {
  test("ignores generic server OTLP endpoint and headers", () => {
    const config: BrowserTelemetryConfig = load({
      OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://server-collector.internal:4318",
      OPENTELEMETRY_EXPORTER_OTLP_HEADERS: "authorization=Bearer server-secret",
    });

    expect(config.endpoint).toBeNull();
    expect(config.browserIngestionKey).toBe("");
  });

  test("reads the separately named public browser endpoint and key", () => {
    const config: BrowserTelemetryConfig = load({
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://ingest.example.com:4318",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY:
        "origin-bound-browser-key",
    });

    expect(config.endpoint?.toString()).toBe(
      "https://ingest.example.com:4318/",
    );
    expect(config.browserIngestionKey).toBe("origin-bound-browser-key");
  });

  test("treats blank public browser settings as disabled", () => {
    const config: BrowserTelemetryConfig = load({
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT: "",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY: "",
    });

    expect(config.endpoint).toBeNull();
    expect(config.browserIngestionKey).toBe("");
  });

  test("does not fall back to the server endpoint when only a public key exists", () => {
    const config: BrowserTelemetryConfig = load({
      OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://server-collector.internal:4318",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY:
        "origin-bound-browser-key",
    });

    expect(config.endpoint).toBeNull();
    expect(config.browserIngestionKey).toBe("origin-bound-browser-key");
  });

  test("does not parse arbitrary generic authorization headers into browser state", () => {
    const config: BrowserTelemetryConfig = load({
      OPENTELEMETRY_EXPORTER_OTLP_HEADERS:
        "authorization=Bearer admin-secret;x-custom=private",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://ingest.example.com:4318",
    });

    expect(config.browserIngestionKey).toBe("");
  });
});
