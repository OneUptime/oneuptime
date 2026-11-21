import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
  RumClientKind,
} from "../../../Types/Rum/RumClientKind";

/*
 * WHAT A PUBLIC KEY WRITES IS ITS PAGE'S OR ITS APP'S RUM, AND NOTHING ELSE
 * (issues #6457 and #10539).
 *
 * A Browser ingestion key sits in a web page's JavaScript and a Mobile one
 * is compiled into an app, so both must be assumed copied: anyone who has
 * the page or the app can pull the key out and send what they like with it.
 * A script outside a browser sends any Origin header it likes, so a Browser
 * key's allowed origins stop a page, not a copy. The ingest guard holds each
 * key to its surfaces, and PinServiceName files what it writes under the
 * key's pinned service name. What is left is the rest of each resource: the
 * attributes ingest reads to decide WHAT the telemetry describes. A copy
 * that sent `host.name`, `k8s.cluster.name`, `cloud.resource_id` or one of
 * OneUptime's own routing attributes (`oneuptime.database.server.id`) would
 * file it under a host, a cluster, a cloud resource or a database the page
 * or the app has nothing to do with, and auto-discovery would add them to
 * the project.
 *
 * So every resource a public key writes keeps only what a page or an app
 * says about itself, and is stamped as that kind of client
 * (RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE), which getRumClientType reads first:
 *
 *   - a Browser key's: its service, its browser, its user agent, its SDK,
 *     its deployment, its session, its visitor and the `oneuptime.label.*`
 *     labels, stamped "browser" - filed as a browser RUM application;
 *   - a Mobile key's: the same, with its device, its OS and its app in
 *     place of the browser, stamped "mobile" - filed as a mobile RUM
 *     application.
 *
 * It is filed as that RUM application whatever else it carried: never a
 * backend Service, a Host or any other resource, and the discovery that
 * reads rows (a database from CLIENT spans, a queue from messaging spans or
 * broker metrics, a cloud resource a datapoint names) reads no row of a
 * stamped resource. An ALLOWLIST, so an attribute ingest learns to route by
 * later is dropped from a public key's data until someone adds it here.
 *
 * Only the resource is touched. A span's, a log's or a data point's own
 * attributes are the page's or the app's data and stay as sent.
 *
 * Like PinServiceName: in place (payloads run to megabytes), and it never
 * throws on the attacker-controlled JSON it reads - a malformed shape is
 * repaired or skipped.
 */

const RESOURCE_CONTAINER_KEYS: ReadonlyArray<string> = [
  "resourceSpans",
  "resourceLogs",
  "resourceMetrics",
  "resourceProfiles",
];

/*
 * What any RUM client says about itself, a page or an app: its service, its
 * SDK (`telemetry.*`), its deployment, its session, its user agent, the
 * visitor it runs for (`user.*`, `enduser.*`: the exceptions list counts a
 * resource's user, ExceptionUserId) and the labels the setup guides
 * document. None of them names a host, a cluster, a cloud resource or a
 * database.
 */
export const RUM_CLIENT_RESOURCE_ATTRIBUTE_PREFIXES: ReadonlyArray<string> = [
  "service.",
  "telemetry.",
  "deployment.",
  "session.",
  "user_agent.",
  "user.",
  "enduser.",
  "oneuptime.label.",
];

/*
 * A web page's: the OpenTelemetry browser SDK's browserDetector sets
 * `browser.*` and `user_agent.original`, and its default resource the
 * service and `telemetry.sdk.*`.
 */
export const BROWSER_RUM_RESOURCE_ATTRIBUTE_PREFIXES: ReadonlyArray<string> = [
  ...RUM_CLIENT_RESOURCE_ATTRIBUTE_PREFIXES,
  "browser.",
];

/*
 * A mobile app's: OpenTelemetry Android (`device.*`, `os.*`, `android.*`,
 * `rum.*`), opentelemetry-swift (`device.*`, `os.*`), the JavaScript SDK in
 * React Native (`telemetry.*`) and what an app adds (`app.*`).
 */
export const MOBILE_RUM_RESOURCE_ATTRIBUTE_PREFIXES: ReadonlyArray<string> = [
  ...RUM_CLIENT_RESOURCE_ATTRIBUTE_PREFIXES,
  "device.",
  "os.",
  "app.",
  "android.",
  "ios.",
  "rum.",
];

// Keyed by RumClientKind: RUM_CLIENT_KIND_BROWSER and RUM_CLIENT_KIND_MOBILE.
export const RUM_CLIENT_RESOURCE_ATTRIBUTE_PREFIXES_BY_KIND: Readonly<
  Record<RumClientKind, ReadonlyArray<string>>
> = {
  browser: BROWSER_RUM_RESOURCE_ATTRIBUTE_PREFIXES,
  mobile: MOBILE_RUM_RESOURCE_ATTRIBUTE_PREFIXES,
};

export default class PinRumClientResource {
  /*
   * Keep only a `kind` client's own attributes on every resource of `body`,
   * and stamp it as that kind of client, in place. Returns how many
   * resource blocks were rewritten.
   */
  public static pinInPlace(body: JSONObject, kind: RumClientKind): number {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return 0;
    }

    let rewrittenCount: number = 0;

    for (const containerKey of RESOURCE_CONTAINER_KEYS) {
      const container: JSONValue | undefined = body[containerKey];

      if (!Array.isArray(container)) {
        continue;
      }

      for (const resourceBlock of container) {
        if (this.pinResourceBlock(resourceBlock, kind)) {
          rewrittenCount++;
        }
      }
    }

    return rewrittenCount;
  }

  /*
   * Whether a resource attribute is one a `kind` client says about itself.
   * Matched by prefix, ignoring case and surrounding space.
   */
  public static isClientAttributeKey(
    key: unknown,
    kind: RumClientKind,
  ): boolean {
    if (typeof key !== "string") {
      return false;
    }

    const normalized: string = key.trim().toLowerCase();

    // Ingest's own stamp is set below, never kept as sent.
    if (normalized === RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE) {
      return false;
    }

    const prefixes: ReadonlyArray<string> | undefined =
      RUM_CLIENT_RESOURCE_ATTRIBUTE_PREFIXES_BY_KIND[kind];

    if (!prefixes) {
      return false;
    }

    return prefixes.some((prefix: string): boolean => {
      return normalized.startsWith(prefix);
    });
  }

  /*
   * One { resource, scope* } envelope. A malformed `resource` or
   * `attributes` is replaced, as PinServiceName does: skipping it would let
   * `"resource": "x"` through with whatever the decoder falls back to.
   */
  private static pinResourceBlock(
    resourceBlock: JSONValue | undefined,
    kind: RumClientKind,
  ): boolean {
    if (
      !resourceBlock ||
      typeof resourceBlock !== "object" ||
      Array.isArray(resourceBlock)
    ) {
      return false;
    }

    const block: JSONObject = resourceBlock as JSONObject;
    const existingResource: JSONValue | undefined = block["resource"];

    let resource: JSONObject;

    if (
      existingResource &&
      typeof existingResource === "object" &&
      !Array.isArray(existingResource)
    ) {
      resource = existingResource as JSONObject;
    } else {
      resource = {};
      block["resource"] = resource;
    }

    const existingAttributes: JSONValue | undefined = resource["attributes"];
    const attributes: Array<JSONValue> = [];

    if (Array.isArray(existingAttributes)) {
      for (const attribute of existingAttributes) {
        if (
          attribute &&
          typeof attribute === "object" &&
          !Array.isArray(attribute) &&
          this.isClientAttributeKey((attribute as JSONObject)["key"], kind)
        ) {
          attributes.push(attribute as JSONValue);
        }
      }
    }

    attributes.push({
      key: RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
      value: {
        stringValue: kind,
      },
    } as JSONValue);

    resource["attributes"] = attributes as JSONValue;

    /*
     * Entity references (OTLP Resource.entity_refs) are the other way a
     * resource says what it describes, and ingest trusts them over the
     * attributes: a copy could name a host or a cluster there instead.
     */
    if (Object.prototype.hasOwnProperty.call(resource, "entityRefs")) {
      delete resource["entityRefs"];
    }

    if (Object.prototype.hasOwnProperty.call(resource, "entity_refs")) {
      delete resource["entity_refs"];
    }

    return true;
  }
}
