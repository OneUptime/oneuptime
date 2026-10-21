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
 * limit, neither of which means anything off HTTP. Other places that accept a
 * TelemetryIngestionKey cannot use that middleware - the gRPC OTLP server and
 * the MQTT broker are not Express routes, and the two key-validation probes
 * have to describe a refusal in their own JSON answer rather than let the
 * middleware end the request - yet must answer these same three questions or
 * a disabled key keeps working on the pipe nobody remembered to update.
 *
 * The refusal SENTENCES are deliberately identical to the middleware's, so a
 * customer who moves the same key between OTLP/HTTP and OTLP/gRPC reads the
 * same explanation on both: gRPC sends `message` back as its status details,
 * and the session replay probe returns it in its JSON body. MQTT cannot carry
 * it - an MQTT 3.1.1 CONNACK has no reason field - so the broker logs
 * `reason` and the device sees only a generic credential error. If you change
 * wording here, change it in the middleware too;
 * GrpcServerAuthStatusLive.test.ts compares the two and fails on drift.
 *
 * What this deliberately does NOT do is decide the transport-level response.
 * A refusal is an HTTP status, a non-retryable gRPC status (UNAUTHENTICATED
 * or PERMISSION_DENIED, mapped from the middleware's HTTP status - see
 * GrpcServer), or MQTT CONNACK return code 4; each caller owns that
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
