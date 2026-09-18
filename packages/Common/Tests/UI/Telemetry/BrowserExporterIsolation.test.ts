import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const CONFIG_PATH: string = path.resolve(__dirname, "../../../UI/Config.ts");
const BROWSER_CONFIG_PATH: string = path.resolve(
  __dirname,
  "../../../UI/Utils/Telemetry/BrowserTelemetryConfig.ts",
);
const TELEMETRY_PATH: string = path.resolve(
  __dirname,
  "../../../UI/Utils/Telemetry/Telemetry.ts",
);

function codeWithoutComments(filePath: string): string {
  return fs
    .readFileSync(filePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
}

describe("browser exporter source isolation", () => {
  test("browser config never reads the generic server header variable", () => {
    const source: string = codeWithoutComments(BROWSER_CONFIG_PATH);

    expect(source).not.toContain('env("OPENTELEMETRY_EXPORTER_OTLP_HEADERS")');
    expect(source).not.toContain('env("OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT")');
  });

  test("browser config reads only the explicitly public telemetry names", () => {
    const source: string = codeWithoutComments(BROWSER_CONFIG_PATH);

    expect(source).toContain(
      '"PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY"',
    );
    expect(source).toContain('"PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"');
  });

  test("the main UI config delegates browser telemetry parsing to the isolated helper", () => {
    const source: string = codeWithoutComments(CONFIG_PATH);

    expect(source).toContain("getBrowserTelemetryConfig(env)");
    expect(source).toContain("BrowserTelemetryEnvironmentConfig.endpoint");
    expect(source).toContain(
      "BrowserTelemetryEnvironmentConfig.browserIngestionKey",
    );
  });

  test("the exporter sends the public key only in OneUptime's scoped token header", () => {
    const source: string = codeWithoutComments(TELEMETRY_PATH);

    expect(source).toContain('"x-oneuptime-token"');
    expect(source).toContain("BrowserOpenTelemetryExporterOtlpIngestionKey");
    expect(source).not.toContain("authorization");
  });

  test("the exporter cannot initialize with only the endpoint", () => {
    const source: string = codeWithoutComments(TELEMETRY_PATH);
    const condition: RegExp =
      /if\s*\(\s*BrowserOpenTelemetryExporterOtlpEndpoint\s*&&\s*BrowserOpenTelemetryExporterOtlpIngestionKey\s*\)/;

    expect(source).toMatch(condition);
  });

  test("browser telemetry source contains no generic server environment names", () => {
    const source: string = codeWithoutComments(TELEMETRY_PATH);

    expect(source).not.toContain("OPENTELEMETRY_EXPORTER_OTLP_HEADERS");
    expect(source).not.toContain("OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT");
  });
});
