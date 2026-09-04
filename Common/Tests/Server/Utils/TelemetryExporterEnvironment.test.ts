import { afterEach, describe, expect, test } from "@jest/globals";
import Telemetry from "../../../Server/Utils/Telemetry";

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("server telemetry exporter environment", () => {
  test("continues to read generic backend exporter headers", () => {
    process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"] =
      "authorization=Bearer server-secret;x-oneuptime-token=server-key";

    expect(Telemetry.getHeaders()).toEqual({
      authorization: "Bearer server-secret",
      "x-oneuptime-token": "server-key",
    });
  });

  test("does not treat the public Browser key as server authorization", () => {
    delete process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"];
    process.env["PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY"] =
      "public-browser-key";

    expect(Telemetry.getHeaders()).toEqual({});
  });

  test("returns no backend headers for an unset or blank value", () => {
    delete process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"];
    expect(Telemetry.getHeaders()).toEqual({});

    process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"] = "";
    expect(Telemetry.getHeaders()).toEqual({});
  });

  test("continues to read the generic backend exporter endpoint", () => {
    process.env["OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"] =
      "https://collector.internal:4318";

    expect(Telemetry.getOtlpEndpoint()?.toString()).toBe(
      "https://collector.internal:4318/",
    );
    expect(Telemetry.getOltpTracesEndpoint()?.toString()).toBe(
      "https://collector.internal:4318/v1/traces",
    );
  });

  test("does not use the public browser endpoint as the server endpoint", () => {
    delete process.env["OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"];
    process.env["PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"] =
      "https://browser-collector.example.com:4318";

    expect(Telemetry.getOtlpEndpoint()).toBeNull();
  });
});
