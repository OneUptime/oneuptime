import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
  getIngestSurfaceReadableName,
} from "../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * The three key-state checks that every ingest entry point has to make, in
 * one place.
 *
 * TelemetryIngest (the Express middleware) runs these inline as part of a
 * longer chain that also covers the Origin allowlist and the per-key rate
 * limit, neither of which means anything off HTTP. Everything else that
 * accepts a TelemetryIngestionKey - the gRPC OTLP server, the MQTT broker,
 * and the two key-validation probes - is NOT an Express route and cannot use
 * that middleware, yet must answer these same three questions or a disabled
 * key keeps working on the pipe nobody remembered to update.
 *
 * The refusal SENTENCES are deliberately identical to the middleware's, so a
 * customer who moves the same key between HTTP, gRPC and MQTT reads the same
 * explanation each time rather than three differently-worded versions of one
 * problem. If you change wording here, change it there too.
 *
 * What this deliberately does NOT do is decide the transport-level response.
 * A refusal is a status code on HTTP, a CONNACK return code on MQTT, and a
 * silent success on gRPC (see GrpcServer for why); each caller owns that
 * translation because each transport's retry semantics are its own.
 */
export enum TelemetryIngestionKeyRefusalReason {
  Disabled = "disabled",
  Expired = "expired",
  SurfaceNotAllowedForBrowserKey = "surface-not-allowed-for-browser-key",
}

export interface TelemetryIngestionKeyRefusal {
  reason: TelemetryIngestionKeyRefusalReason;

  /*
   * Safe to return to whoever presented the key. It names the problem and
   * never the key, the project, the allowlist or the expiry timestamp - a
   * caller holding a dead credential is not entitled to a project's
   * configuration.
   */
  message: string;
}

export default class TelemetryIngestionKeyGuard {
  /**
   * Why this key may not write to this surface, or null when it may.
   *
   * Order matters and mirrors the middleware: the kill switch is checked
   * first so that switching a leaked key off is the one action guaranteed to
   * stop it whatever else is true of the key, then expiry, then the
   * browser-key surface rule.
   */
  public static getRefusal(data: {
    policy: TelemetryIngestionKeyPolicy;
    surface: TelemetryIngestSurface;
  }): TelemetryIngestionKeyRefusal | null {
    const policy: TelemetryIngestionKeyPolicy = data.policy;

    if (policy.isEnabled === false) {
      return {
        reason: TelemetryIngestionKeyRefusalReason.Disabled,
        message: "This telemetry ingestion key has been disabled.",
      };
    }

    if (policy.expiresAt && policy.expiresAt.getTime() <= Date.now()) {
      return {
        reason: TelemetryIngestionKeyRefusalReason.Expired,
        message: "This telemetry ingestion key expired.",
      };
    }

    if (
      policy.keyType === TelemetryIngestionKeyType.Browser &&
      !BROWSER_ALLOWED_INGEST_SURFACES.has(data.surface)
    ) {
      return {
        reason:
          TelemetryIngestionKeyRefusalReason.SurfaceNotAllowedForBrowserKey,
        message: `A browser ingestion key cannot be used for ${getIngestSurfaceReadableName(
          data.surface,
        )}. Use a server ingestion key.`,
      };
    }

    return null;
  }
}
