import { SessionReplayRecorderKind } from "../../../Types/Rum/SessionReplay";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { TelemetryIngestRefusalReason } from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
  MOBILE_ALLOWED_INGEST_SURFACES,
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
  // A Mobile key (issue #6457) off a mobile app's OTLP/HTTP surfaces.
  SurfaceNotAllowedForMobileKey = "surface-not-allowed-for-mobile-key",
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

/*
 * The reason a guard refusal is counted under against the key
 * (TelemetryIngestRefusalRecorder, issue #6378).
 */
export const TELEMETRY_INGEST_REFUSAL_REASON_FOR_KEY_REFUSAL: Readonly<
  Record<TelemetryIngestionKeyRefusalReason, TelemetryIngestRefusalReason>
> = {
  [TelemetryIngestionKeyRefusalReason.Disabled]:
    TelemetryIngestRefusalReason.KeyDisabled,
  [TelemetryIngestionKeyRefusalReason.Expired]:
    TelemetryIngestRefusalReason.KeyExpired,
  [TelemetryIngestionKeyRefusalReason.SurfaceNotAllowedForBrowserKey]:
    TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere,
  [TelemetryIngestionKeyRefusalReason.SurfaceNotAllowedForMobileKey]:
    TelemetryIngestRefusalReason.MobileKeyNotAllowedHere,
};

/*
 * What a Mobile key is told on a surface it may not use (issue #6457). The
 * HTTP guard (TelemetryIngest.getMobileKeyRefusalMessage) and this one say
 * the same: what the key sends, and which key to use instead.
 */
export function getMobileKeySurfaceRefusalMessage(
  surface: TelemetryIngestSurface | null,
): string {
  const readableSurfaceName: string = surface
    ? getIngestSurfaceReadableName(surface)
    : "this ingest endpoint";

  return `A mobile ingestion key cannot be used for ${readableSurfaceName}: it sends only a mobile app's OTLP traces, logs and metrics over HTTP, and its session replays. Use a server ingestion key here.`;
}

/*
 * Whether `appIdentifier` - the RUM application a session replay request
 * names - is the app a Mobile key is pinned to (issue #10540). A RUM
 * application is identified by its service.name, matched trimmed and
 * without case (RumApplicationService, SessionReplayGateCache), so this
 * matches the same way. No pin, or no identifier, is never a match.
 */
export function isMobileKeyPinnedToApp(data: {
  pinnedServiceName: string | null | undefined;
  appIdentifier: string | null | undefined;
}): boolean {
  const pinned: string = (data.pinnedServiceName || "").trim().toLowerCase();
  const named: string = (data.appIdentifier || "").trim().toLowerCase();

  return pinned.length > 0 && pinned === named;
}

export const MOBILE_KEY_SESSION_REPLAY_WEB_RECORDER_MESSAGE: string =
  "A mobile ingestion key can send session replays only from a React Native app's recorder. Use a browser ingestion key in a web page.";

export const MOBILE_KEY_SESSION_REPLAY_OTHER_APP_MESSAGE: string =
  "A mobile ingestion key can send session replays only for the app it is pinned to. Set the recorder's appIdentifier to the key's Pinned Service Name, or send with that app's own mobile ingestion key.";

/*
 * Why a Mobile key may not send this session replay request, or null when
 * it may (issue #10540). A Mobile key records its own app's sessions, so
 * one key serves a React Native app's telemetry and its recordings:
 *
 *   - only from the React Native recorder (`rn-view-tree`): a page's
 *     recorder sends with a Browser key, whose origins are checked;
 *   - only for the RUM application its pinned service name names: the
 *     recordings are filed under the application the request names, so a
 *     copy must not be able to name another one.
 *
 * The rest is the application's and the key's, as for any key: the
 * application's replay policy and allowed origins (its app:// identities),
 * its byte budgets and the key's rate limit. Never names the pinned app:
 * a caller holding a copy is not entitled to it.
 */
export function getMobileKeySessionReplayRefusalMessage(data: {
  pinnedServiceName: string | null | undefined;
  appIdentifier: string | null | undefined;
  recorderKind: SessionReplayRecorderKind | null;
}): string | null {
  if (data.recorderKind !== "rn-view-tree") {
    return MOBILE_KEY_SESSION_REPLAY_WEB_RECORDER_MESSAGE;
  }

  if (
    !isMobileKeyPinnedToApp({
      pinnedServiceName: data.pinnedServiceName,
      appIdentifier: data.appIdentifier,
    })
  ) {
    return MOBILE_KEY_SESSION_REPLAY_OTHER_APP_MESSAGE;
  }

  return null;
}

export default class TelemetryIngestionKeyGuard {
  /**
   * Why this key may not write to this surface, or null when it may.
   *
   * Order matters and mirrors the middleware: the kill switch is checked
   * first so that switching a leaked key off is the one action guaranteed to
   * stop it whatever else is true of the key, then expiry, then the
   * browser-key and mobile-key surface rules. gRPC and MQTT are never a
   * Mobile key's: it sends over HTTP only, where its rate limit runs. The
   * session replay probe admits one here, and then asks whether the app
   * it names is the key's (isMobileKeyPinnedToApp), as the HTTP guard does.
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

    /*
     * The sentence the HTTP guard sends for the same refusal
     * (getMobileKeyRefusalMessage), so a key moved between transports reads
     * the same explanation on both.
     */
    if (
      policy.keyType === TelemetryIngestionKeyType.Mobile &&
      !MOBILE_ALLOWED_INGEST_SURFACES.has(data.surface)
    ) {
      return {
        reason:
          TelemetryIngestionKeyRefusalReason.SurfaceNotAllowedForMobileKey,
        message: getMobileKeySurfaceRefusalMessage(data.surface),
      };
    }

    return null;
  }
}
