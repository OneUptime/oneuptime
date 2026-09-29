import { afterEach, describe, expect, test, jest } from "@jest/globals";
import { JSONObject } from "../../Types/JSON";

interface EnvironmentConfigShape {
  getAllEnvVars: () => JSONObject;
  getFrontendEnvVars: () => JSONObject;
}

const MANAGED_KEYS: Array<string> = [
  "HOST",
  "PUBLIC_TEST_SETTING",
  "PRIVATE_TEST_SECRET",
  "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
  "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY",
  "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
  "PUBLIC_OTEL_EXPORTER_OTLP_HEADERS",
  "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_TRACES_HEADERS",
  "PUBLIC_OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_LOGS_HEADERS",
  "PUBLIC_OTEL_EXPORTER_OTLP_PROFILES_HEADERS",
  "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_VENDOR_SIGNAL_HEADERS",
  "PUBLIC_otel_exporter_otlp_traces_headers",
  "PUBLIC_OTEL_EXPORTER_OTLP_HEADER_COUNT",
  "PUBLIC_OTEL_EXPORTER_OTLP_HEADERS_ENABLED",
  "PUBLIC_OTEL_EXPORTER_OTLP_HEADER",
];

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

async function load(
  overrides: Record<string, string | undefined>,
): Promise<EnvironmentConfigShape> {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  jest.resetModules();

  return (await import(
    "../../Server/EnvironmentConfig"
  )) as unknown as EnvironmentConfigShape;
}

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe("frontend environment security boundary", () => {
  test("keeps backend OTLP endpoint and headers out of the frontend snapshot", async () => {
    const config: EnvironmentConfigShape = await load({
      OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://collector.internal.example:4318",
      OPENTELEMETRY_EXPORTER_OTLP_HEADERS:
        "authorization=Bearer server-secret;x-oneuptime-token=server-key",
    });

    const frontend: JSONObject = config.getFrontendEnvVars();

    expect(frontend).not.toHaveProperty("OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT");
    expect(frontend).not.toHaveProperty("OPENTELEMETRY_EXPORTER_OTLP_HEADERS");
    expect(JSON.stringify(frontend)).not.toContain("server-secret");
    expect(JSON.stringify(frontend)).not.toContain("server-key");
  });

  test("still exposes ordinary explicitly allowed frontend settings", async () => {
    const config: EnvironmentConfigShape = await load({
      HOST: "status.example.com",
    });

    expect(config.getFrontendEnvVars()).toMatchObject({
      HOST: "status.example.com",
    });
  });

  test("still exposes ordinary PUBLIC_ settings", async () => {
    const config: EnvironmentConfigShape = await load({
      PUBLIC_TEST_SETTING: "safe-for-every-visitor",
    });

    expect(config.getFrontendEnvVars()).toMatchObject({
      PUBLIC_TEST_SETTING: "safe-for-every-visitor",
    });
  });

  test.each([
    "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
    "PUBLIC_OTEL_EXPORTER_OTLP_HEADERS",
    "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_TRACES_HEADERS",
    "PUBLIC_OTEL_EXPORTER_OTLP_METRICS_HEADERS",
    "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_LOGS_HEADERS",
    "PUBLIC_OTEL_EXPORTER_OTLP_PROFILES_HEADERS",
    "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_VENDOR_SIGNAL_HEADERS",
    "PUBLIC_otel_exporter_otlp_traces_headers",
  ])(
    "rejects generic and signal-specific OTLP header alias %s",
    async (key: string) => {
      const secret: string = `authorization=Bearer secret-for-${key}`;
      const config: EnvironmentConfigShape = await load({ [key]: secret });
      const frontend: JSONObject = config.getFrontendEnvVars();

      expect(frontend).not.toHaveProperty(key);
      expect(JSON.stringify(frontend)).not.toContain(secret);
    },
  );

  test.each([
    "PUBLIC_OTEL_EXPORTER_OTLP_HEADER_COUNT",
    "PUBLIC_OTEL_EXPORTER_OTLP_HEADERS_ENABLED",
    "PUBLIC_OTEL_EXPORTER_OTLP_HEADER",
  ])(
    "does not over-match harmless near-miss public setting %s",
    async (key: string) => {
      const value: string = `non-secret-value-for-${key}`;
      const config: EnvironmentConfigShape = await load({ [key]: value });

      expect(config.getFrontendEnvVars()).toHaveProperty(key, value);
    },
  );

  test("exposes only the separately named browser telemetry settings", async () => {
    const config: EnvironmentConfigShape = await load({
      OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://server-collector.internal:4318",
      OPENTELEMETRY_EXPORTER_OTLP_HEADERS: "authorization=Bearer server-secret",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://browser-collector.example.com:4318",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY:
        "origin-bound-browser-key",
    });

    expect(config.getFrontendEnvVars()).toMatchObject({
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://browser-collector.example.com:4318",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY:
        "origin-bound-browser-key",
    });
    expect(config.getFrontendEnvVars()).not.toHaveProperty(
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
    );
  });

  test("does not include unrelated unallowlisted secrets", async () => {
    const config: EnvironmentConfigShape = await load({
      PRIVATE_TEST_SECRET: "do-not-publish-me",
    });

    expect(config.getFrontendEnvVars()).not.toHaveProperty(
      "PRIVATE_TEST_SECRET",
    );
  });

  test("omits unset telemetry settings", async () => {
    const config: EnvironmentConfigShape = await load({});
    const frontend: JSONObject = config.getFrontendEnvVars();

    expect(frontend).not.toHaveProperty("OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT");
    expect(frontend).not.toHaveProperty("OPENTELEMETRY_EXPORTER_OTLP_HEADERS");
    expect(frontend).not.toHaveProperty(
      "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
    );
    expect(frontend).not.toHaveProperty(
      "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY",
    );
  });

  test("never publishes backend telemetry names even when Compose supplies blank values", async () => {
    const config: EnvironmentConfigShape = await load({
      OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT: "",
      OPENTELEMETRY_EXPORTER_OTLP_HEADERS: "",
    });

    expect(config.getFrontendEnvVars()).not.toHaveProperty(
      "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
    );
    expect(config.getFrontendEnvVars()).not.toHaveProperty(
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
    );
  });

  test("preserves explicitly configured blank browser values without confusing them with server settings", async () => {
    const config: EnvironmentConfigShape = await load({
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT: "",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY: "",
    });

    expect(config.getFrontendEnvVars()).toMatchObject({
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT: "",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY: "",
    });
  });

  test("does not remove or mutate backend telemetry configuration in process.env", async () => {
    const serverEndpoint: string = "https://collector.internal:4318";
    const serverHeaders: string =
      "authorization=Bearer unchanged-secret;x-tenant=production";
    const config: EnvironmentConfigShape = await load({
      OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT: serverEndpoint,
      OPENTELEMETRY_EXPORTER_OTLP_HEADERS: serverHeaders,
    });

    config.getFrontendEnvVars();

    expect(config.getAllEnvVars()).toMatchObject({
      OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT: serverEndpoint,
      OPENTELEMETRY_EXPORTER_OTLP_HEADERS: serverHeaders,
    });
    expect(process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"]).toBe(
      serverHeaders,
    );
  });

  test("returns a fresh snapshot so a caller cannot mutate process.env", async () => {
    const config: EnvironmentConfigShape = await load({
      HOST: "oneuptime.example.com",
    });

    const first: JSONObject = config.getFrontendEnvVars();
    first["HOST"] = "attacker.example.com";

    expect(config.getFrontendEnvVars()["HOST"]).toBe("oneuptime.example.com");
    expect(process.env["HOST"]).toBe("oneuptime.example.com");
  });
});
