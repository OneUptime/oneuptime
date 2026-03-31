import Pyroscope from "@pyroscope/nodejs";
import { EnableProfiling } from "../EnvironmentConfig";
import logger from "./Logger";

export default class Profiling {
  public static init(data: { serviceName: string }): void {
    if (!EnableProfiling) {
      return;
    }

    const serverAddress: string | undefined = this.getServerAddress();
    const authToken: string | undefined = this.getAuthToken();

    if (!serverAddress) {
      logger.warn(
        "Profiling enabled but OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT not configured. Skipping profiling initialization.",
      );
      return;
    }

    try {
      Pyroscope.init({
        appName: data.serviceName,
        serverAddress: serverAddress,
        authToken: authToken,
        wall: {
          collectCpuTime: true,
        },
      });

      Pyroscope.start();

      logger.info(
        `Profiling initialized for service: ${data.serviceName} -> ${serverAddress}`,
      );
    } catch (err) {
      logger.error("Failed to initialize profiling:");
      logger.error(err);
    }

    process.on("SIGTERM", () => {
      Pyroscope.stop().catch((err: unknown) => {
        logger.error("Error stopping profiler:");
        logger.error(err);
      });
    });
  }

  private static getServerAddress(): string | undefined {
    /*
     * Use the OTLP endpoint base URL as the Pyroscope server address.
     * The Pyroscope SDK will append /ingest to this URL.
     * The Telemetry service has a Pyroscope-compatible /ingest endpoint.
     */
    const endpoint: string | undefined =
      process.env["OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"];

    if (!endpoint) {
      return undefined;
    }

    // Strip /otlp suffix if present, since Pyroscope SDK appends /ingest
    let baseUrl: string = endpoint;
    if (baseUrl.endsWith("/otlp")) {
      baseUrl = baseUrl.substring(0, baseUrl.length - 5);
    }
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.substring(0, baseUrl.length - 1);
    }

    return baseUrl;
  }

  private static getAuthToken(): string | undefined {
    /*
     * Extract the OneUptime token from OTLP headers
     * Format: "x-oneuptime-token=<value>;other-header=value"
     */
    const headersStr: string | undefined =
      process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"];

    if (!headersStr) {
      return undefined;
    }

    const parts: Array<string> = headersStr.split(";");
    for (const part of parts) {
      const [key, value]: Array<string | undefined> = part.split("=") as Array<
        string | undefined
      >;
      if (key === "x-oneuptime-token" && value) {
        return value;
      }
    }

    return undefined;
  }
}
