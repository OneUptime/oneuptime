import {
  BrowserOpenTelemetryExporterOtlpEndpoint,
  BrowserOpenTelemetryExporterOtlpIngestionKey,
  DisableTelemetry,
} from "../../Config";
import URL from "../../../Types/API/URL";

/*
 * Mutable, module-level bag of attributes stamped onto every browser span.
 * Populated by `Telemetry.setGlobalAttributes` once the signed-in user and
 * the project being viewed are known (RUM context).
 *
 * It lives here rather than with the SDK, which loads later. The SDK is handed
 * this object itself and reads it as each span starts, so what is set before
 * init, while the SDK loads or after it has started reaches the next span.
 */
const globalSpanAttributes: { [key: string]: string } = {};

export default class Telemetry {
  /**
   * Set RUM attributes that should be attached to every browser span from now
   * on (e.g. userId, projectId). Safe to call before or after `init`, and
   * before or after the SDK has loaded; empty values are ignored.
   */
  public static setGlobalAttributes(attributes: {
    userId?: string | undefined;
    projectId?: string | undefined;
    [key: string]: string | undefined;
  }): void {
    for (const key in attributes) {
      const value: string | undefined = attributes[key];

      if (value) {
        globalSpanAttributes[key] = value;
      }
    }
  }

  /**
   * Trace the page's requests, where this installation has browser telemetry
   * configured.
   *
   * The SDK is about 90 KB of script, in a file of its own
   * (BrowserTelemetrySdk). It is fetched from here and only when it will run, so
   * a page with telemetry off downloads none of it and nothing patches its fetch
   * or XMLHttpRequest. The page does not wait for it, and so a request that
   * starts before it has arrived goes out as usual and has no span: on the
   * Dashboard, the first requests a page makes.
   *
   * Settles once the SDK has started or could not. It never rejects, and
   * nothing but a test needs to wait for it.
   */
  public static async init(data: { serviceName: string }): Promise<void> {
    if (DisableTelemetry) {
      return;
    }

    if (
      BrowserOpenTelemetryExporterOtlpEndpoint &&
      BrowserOpenTelemetryExporterOtlpIngestionKey
    ) {
      try {
        (await import("./BrowserTelemetrySdk")).default({
          serviceName: data.serviceName,
          tracesUrl: URL.fromString(
            BrowserOpenTelemetryExporterOtlpEndpoint.toString() + "/v1/traces",
          ).toString(),
          headers: {
            "x-oneuptime-token": BrowserOpenTelemetryExporterOtlpIngestionKey,
          },
          globalAttributes: globalSpanAttributes,
        });
      } catch {
        /*
         * It did not load - an ad blocker, a lost connection, a file a deploy
         * has since replaced - or would not start. This page sends no spans,
         * which is no reason to trouble the person using it.
         */
      }
    }
  }
}
