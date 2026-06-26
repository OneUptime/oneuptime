import { EnableProfiling } from "../EnvironmentConfig";
import logger, { LogAttributes } from "./Logger";
import GracefulShutdown, { ShutdownPriority } from "./GracefulShutdown";

/*
 * Type-only import: erased at compile time, so it emits NO runtime require.
 * @pyroscope/nodejs pulls in @datadog/pprof, whose native (node-gyp) binding loads
 * at require() time. When no prebuilt binary exists for the running Node ABI (e.g. a
 * newer Node major than the pprof build ships for), that require throws — so the module
 * must never be imported at the top level, or the throw takes down the whole process
 * before init() is even reached. We load it lazily and defensively inside init() instead.
 */
type PyroscopeModule = typeof import("@pyroscope/nodejs");

export default class Profiling {
  private static pyroscope: PyroscopeModule | null = null;

  public static init(data: { serviceName: string }): void {
    if (!EnableProfiling) {
      return;
    }

    const serverAddress: string | undefined = this.getServerAddress();
    const authToken: string | undefined = this.getAuthToken();

    const profilingLogAttributes: LogAttributes = {
      serviceName: data.serviceName,
    };

    if (!serverAddress) {
      logger.warn(
        "Profiling enabled but OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT not configured. Skipping profiling initialization.",
        profilingLogAttributes,
      );
      return;
    }

    let Pyroscope: PyroscopeModule;
    try {
      /*
       * Lazy load so the native pprof binding is only required when profiling is actually
       * enabled, and so a load failure (missing/incompatible prebuilt binary for the running
       * Node ABI) is caught here and degrades to "profiling disabled" instead of crashing
       * the server. Profiling is a best-effort, optional feature.
       */
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      Pyroscope = require("@pyroscope/nodejs") as PyroscopeModule;
    } catch (err) {
      logger.warn(
        "Profiling enabled but the profiler native module could not be loaded. Continuing without profiling.",
        profilingLogAttributes,
      );
      logger.warn(err, profilingLogAttributes);
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

      this.pyroscope = Pyroscope;

      logger.info(
        `Profiling initialized for service: ${data.serviceName} -> ${serverAddress}`,
        profilingLogAttributes,
      );
    } catch (err) {
      logger.error("Failed to initialize profiling:", profilingLogAttributes);
      logger.error(err, profilingLogAttributes);
      return;
    }

    // Stop the profiler last (Telemetry tier), alongside the OTEL flush.
    GracefulShutdown.registerHandler(
      "Profiling",
      ShutdownPriority.Telemetry,
      async (): Promise<void> => {
        try {
          if (this.pyroscope) {
            await this.pyroscope.stop();
          }
        } catch (err) {
          logger.error("Error stopping profiler:", profilingLogAttributes);
          logger.error(err, profilingLogAttributes);
        }
      },
    );
  }

  private static getServerAddress(): string | undefined {
    /*
     * Use the OTLP endpoint base URL as the Pyroscope server address.
     * The Pyroscope SDK will append /ingest to this URL.
     * The final URL will be /pyroscope/ingest, routed by nginx to the telemetry service.
     */
    const endpoint: string | undefined =
      process.env["OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"];

    if (!endpoint) {
      return undefined;
    }

    /*
     * Strip /otlp suffix if present and append /pyroscope
     * The Pyroscope SDK appends /ingest, so the final URL will be /pyroscope/ingest
     */
    let baseUrl: string = endpoint;
    if (baseUrl.endsWith("/otlp")) {
      baseUrl = baseUrl.substring(0, baseUrl.length - 5);
    }
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.substring(0, baseUrl.length - 1);
    }

    return `${baseUrl}/pyroscope`;
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
