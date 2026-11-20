import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  RUM_CLIENT_KIND_MOBILE,
  RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
} from "../../../Types/Rum/RumClientKind";

/*
 * WHAT A MOBILE KEY WRITES IS ITS APP'S MOBILE RUM, AND NOTHING ELSE
 * (issue #6457).
 *
 * A Mobile ingestion key is compiled into an app, so it must be assumed
 * copied: anyone who has the app can pull it out and send what they like
 * with it. The ingest guard holds it to a mobile app's OTLP traces, logs and
 * metrics over HTTP, and PinServiceName files all of it under the app the
 * key is pinned to. What is left is the rest of each resource: the
 * attributes ingest reads to decide WHAT the telemetry describes. A copy
 * that sent `host.name`, `k8s.cluster.name`, `cloud.resource_id` or one of
 * OneUptime's own routing attributes (`oneuptime.database.server.id`) would
 * file it under a host, a cluster, a cloud resource or a database the app
 * has nothing to do with, and auto-discovery would add them to the project.
 *
 * So every resource a Mobile key writes keeps only what a mobile app says
 * about itself - its service, its device, its OS, its SDK, its app and
 * deployment, and the `oneuptime.label.*` labels the setup guide documents -
 * and is stamped as a mobile client (RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE),
 * which getRumClientType reads first. It is filed as the pinned app's
 * mobile RUM whatever else it carried: never a backend Service, a Host or
 * any other resource. An ALLOWLIST, so an attribute ingest learns to route
 * by later is dropped from a Mobile key's data until someone adds it here.
 *
 * Only the resource is touched. A span's, a log's or a data point's own
 * attributes are the app's data and stay as sent.
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
 * The resource attributes a mobile app's SDK sets about itself: OpenTelemetry
 * Android (`device.*`, `os.*`, `android.*`, `rum.*`), opentelemetry-swift
 * (`device.*`, `os.*`), the JavaScript SDK in React Native (`telemetry.*`),
 * what an app adds (`app.*`, `session.*`, `deployment.*`, `user_agent.*`)
 * and the labels the guide documents. Matched by prefix, ignoring case.
 */
export const MOBILE_RUM_RESOURCE_ATTRIBUTE_PREFIXES: ReadonlyArray<string> = [
  "service.",
  "device.",
  "os.",
  "telemetry.",
  "app.",
  "android.",
  "ios.",
  "rum.",
  "session.",
  "deployment.",
  "user_agent.",
  "oneuptime.label.",
];

export default class PinMobileRumResource {
  /*
   * Keep only a mobile app's own attributes on every resource of `body`, and
   * stamp it as a mobile client, in place. Returns how many resource blocks
   * were rewritten.
   */
  public static pinInPlace(body: JSONObject): number {
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
        if (this.pinResourceBlock(resourceBlock)) {
          rewrittenCount++;
        }
      }
    }

    return rewrittenCount;
  }

  // Whether a resource attribute is one a mobile app says about itself.
  public static isMobileAppAttributeKey(key: unknown): boolean {
    if (typeof key !== "string") {
      return false;
    }

    const normalized: string = key.trim().toLowerCase();

    // Ingest's own stamp is set below, never kept as sent.
    if (normalized === RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE) {
      return false;
    }

    return MOBILE_RUM_RESOURCE_ATTRIBUTE_PREFIXES.some(
      (prefix: string): boolean => {
        return normalized.startsWith(prefix);
      },
    );
  }

  /*
   * One { resource, scope* } envelope. A malformed `resource` or
   * `attributes` is replaced, as PinServiceName does: skipping it would let
   * `"resource": "x"` through with whatever the decoder falls back to.
   */
  private static pinResourceBlock(
    resourceBlock: JSONValue | undefined,
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
          this.isMobileAppAttributeKey((attribute as JSONObject)["key"])
        ) {
          attributes.push(attribute as JSONValue);
        }
      }
    }

    attributes.push({
      key: RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
      value: {
        stringValue: RUM_CLIENT_KIND_MOBILE,
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
