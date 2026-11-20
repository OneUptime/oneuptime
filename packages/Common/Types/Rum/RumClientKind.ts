/*
 * WHETHER A RUM APPLICATION'S USERS RUN IT IN A BROWSER OR AS A MOBILE APP.
 *
 * Ingest decides it from the resource of the telemetry an application sends
 * (OtelIngestBaseService.getRumClientType) and records it on the application
 * (RumApplication.clientType):
 *
 *   - "browser": the resource carries `browser.platform`, `browser.language`
 *     or `browser.brands`, which only the OpenTelemetry browser SDK's
 *     browserDetector sets;
 *   - "mobile": it carries `device.id` or `device.model.identifier`, which
 *     only a client SDK sets (OpenTelemetry Android sets
 *     `device.model.identifier` on its own resource), or `device.manufacturer`
 *     on a resource with no host identity.
 *
 * Nobody types it: the column cannot be created or edited through the API, so
 * an application nothing has arrived from yet has none. Every page and every
 * recommendation reads it through here, so they agree on what an application
 * is: the Overview draws a mobile app's tiles, and Recommendations offer it the
 * mobile monitors.
 */

export type RumClientKind = "browser" | "mobile";

export const RUM_CLIENT_KIND_BROWSER: RumClientKind = "browser";
export const RUM_CLIENT_KIND_MOBILE: RumClientKind = "mobile";

/*
 * The resource attribute ingest stamps on everything a Mobile ingestion key
 * writes (issue #6457, PinMobileRumResource), set to "mobile". Read before
 * any other client signal, so a Mobile key's telemetry is its app's mobile
 * RUM whatever its resource carried. Stored with the telemetry like any
 * other attribute; a sender that sets it itself is filed as a mobile app,
 * as one that sends `device.id` is.
 */
export const RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE: string =
  "oneuptime.rum.client.kind";

/*
 * The kind ingest recorded, or null while it is not known: nothing has
 * arrived yet, or the value is not one ingest writes. Read case-insensitively
 * and trimmed, as the column is shown capitalised in places ("Browser").
 */
export function readRumClientKind(clientType: unknown): RumClientKind | null {
  if (typeof clientType !== "string") {
    return null;
  }

  const value: string = clientType.trim().toLowerCase();

  if (value === RUM_CLIENT_KIND_MOBILE) {
    return RUM_CLIENT_KIND_MOBILE;
  }

  if (value === RUM_CLIENT_KIND_BROWSER) {
    return RUM_CLIENT_KIND_BROWSER;
  }

  return null;
}

/*
 * The kind to draw an application as: browser until ingest has said it is a
 * mobile app. Every RUM application was drawn as a browser one before mobile
 * apps had pages of their own, and most are, so an application nothing has
 * arrived from keeps the pages it always had.
 */
export function getRumClientKind(clientType: unknown): RumClientKind {
  return readRumClientKind(clientType) === RUM_CLIENT_KIND_MOBILE
    ? RUM_CLIENT_KIND_MOBILE
    : RUM_CLIENT_KIND_BROWSER;
}
