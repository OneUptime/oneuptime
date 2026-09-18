import URL from "../../../Types/API/URL";

export interface BrowserTelemetryConfig {
  endpoint: URL | null;
  browserIngestionKey: string;
}

type ReadEnvironmentVariable = (key: string) => string;

/*
 * Kept independent from the large UI Config module so this security boundary
 * can be tested directly: backend OTLP names are intentionally not accepted
 * by this function at all.
 */
export default function getBrowserTelemetryConfig(
  readEnvironmentVariable: ReadEnvironmentVariable,
): BrowserTelemetryConfig {
  const endpoint: string = readEnvironmentVariable(
    "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  );

  return {
    endpoint: endpoint ? URL.fromString(endpoint) : null,
    browserIngestionKey: readEnvironmentVariable(
      "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY",
    ),
  };
}
