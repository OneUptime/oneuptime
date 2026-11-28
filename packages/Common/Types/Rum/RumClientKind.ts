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
 * The resource attribute ingest stamps on everything a public ingestion key
 * writes (PinRumClientResource): "mobile" on a Mobile key's (issue #6457),
 * "browser" on a Browser key's (issue #10539). Read before any other client
 * signal, so a public key's telemetry is its app's or its page's RUM
 * whatever its resource carried. Stored with the telemetry like any other
 * attribute, as `resource.oneuptime.rum.client.kind` on a row: the
 * discovery that reads rows reads no row that carries it. A sender that
 * sets it itself is filed as that kind of client, as one that sends
 * `device.id` or `browser.language` is.
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
 * How a reader of one resource's attributes answers the client test below:
 * a scalar attribute as text (null when absent or blank), a list attribute's
 * values, and whether the resource names a machine of its own - `host.name`,
 * `k8s.node.name` or `host.id`.
 */
export interface RumClientResourceReader {
  read: (key: string) => string | null;
  readList: (key: string) => Array<string>;
  hasHostIdentity: () => boolean;
}

/*
 * The kind of RUM client a resource is the telemetry of, or null for any
 * other resource - the one reading of a resource that ingest files a RUM
 * application by (OtelIngestBaseService.getRumClientType) and that the
 * Inventory's Host resolver keeps a device's own name by
 * (Server/Utils/Telemetry/TelemetryEntity), so the two never disagree on
 * what a client is:
 *
 *   1. the kind a public ingestion key stamped (RUM_CLIENT_KIND_RESOURCE_
 *      ATTRIBUTE), first, whatever else the resource carried;
 *   2. browser: `browser.platform`, `browser.language` or `browser.brands`,
 *      which only the browser SDK's browserDetector sets;
 *   3. mobile: `device.id` or `device.model.identifier`, which only a client
 *      SDK sets;
 *   4. mobile: `device.manufacturer` on a resource that names no machine.
 *      On its own it is no proof of a phone: an operator stamps a machine's
 *      make and model onto its collector's resource (issue #3866), often
 *      machine-wide through OTEL_RESOURCE_ATTRIBUTES, and a genuine mobile
 *      resource carries no host identity.
 */
export function getRumClientKindOfResource(
  reader: RumClientResourceReader,
): RumClientKind | null {
  const stampedClientKind: string | null = reader.read(
    RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
  );

  if (stampedClientKind === RUM_CLIENT_KIND_MOBILE) {
    return RUM_CLIENT_KIND_MOBILE;
  }

  if (stampedClientKind === RUM_CLIENT_KIND_BROWSER) {
    return RUM_CLIENT_KIND_BROWSER;
  }

  if (
    reader.read("browser.platform") ||
    reader.read("browser.language") ||
    reader.readList("browser.brands").length > 0
  ) {
    return RUM_CLIENT_KIND_BROWSER;
  }

  if (reader.read("device.id") || reader.read("device.model.identifier")) {
    return RUM_CLIENT_KIND_MOBILE;
  }

  if (reader.read("device.manufacturer") && !reader.hasHostIdentity()) {
    return RUM_CLIENT_KIND_MOBILE;
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
