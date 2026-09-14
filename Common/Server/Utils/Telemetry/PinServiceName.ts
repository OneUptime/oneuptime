import { JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * Every top-level OTLP container that carries a `resource` block. Each is an
 * array of { resource, scopeSpans|scopeLogs|scopeMetrics|scopeProfiles }
 * envelopes.
 *
 * Profiles are in the list even though a Browser ingestion key cannot reach
 * the profiles surface at all (see BROWSER_ALLOWED_INGEST_SURFACES). Pinning
 * is not a browser-only feature: a Server key may set a pinned service name
 * too, and the dashboard field promises it applies to "everything the key
 * writes". Leaving one signal out would make that promise false in exactly
 * the quiet way nobody notices until they are reading a chart. The
 * containment argument for browser keys is unaffected either way.
 */
const RESOURCE_CONTAINER_KEYS: ReadonlyArray<string> = [
  "resourceSpans",
  "resourceLogs",
  "resourceMetrics",
  "resourceProfiles",
];

const SERVICE_NAME_ATTRIBUTE_KEY: string = "service.name";

/*
 * Rewrites `service.name` on every OTLP resource in a payload so telemetry
 * written with a given ingestion key can only ever land under the service that
 * key is pinned to.
 *
 * WHY THIS EXISTS: a Browser ingestion key is published in page source by
 * design - that is the whole point of the key class - so it must be assumed
 * scraped. Rate limits and the origin allowlist bound HOW MUCH forged data an
 * attacker can write and FROM WHERE, but neither stops them writing it under
 * `service.name: "payments-api"` and poisoning the dashboards, SLOs and alert
 * rules of a backend service that never emitted a byte of it. Pinning is the
 * control that makes the forged data self-identifying: it can only ever appear
 * as the browser service the customer named.
 *
 * WHY IT MUTATES IN PLACE: this runs on the ingest path over payloads that are
 * routinely megabytes of spans. Deep-cloning them to return a rewritten copy
 * would double peak heap on the hot path for no benefit - the caller owns the
 * body and has no use for the original.
 *
 * WHY NOTHING IN HERE THROWS: the input is attacker-controlled JSON that has
 * NOT been validated against the OTLP schema at this point, and this runs
 * inside a queue worker. A TypeError on a hostile shape would fail the whole
 * batch (and, worse, would be trivially reachable by anyone holding a scraped
 * key). Every shape check below therefore skips or repairs rather than raises.
 */
export default class PinServiceName {
  /*
   * Pin `serviceName` onto every resource block in `body`, in place.
   *
   * Returns the number of resource blocks rewritten, which the caller can log
   * or use to tell "we pinned nothing because the payload was empty" apart
   * from "we pinned nothing because the payload was malformed".
   */
  public static pinInPlace(body: JSONObject, serviceName: string): number {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return 0;
    }

    /*
     * An empty pin would stamp `service.name: ""` on everything, which is
     * strictly worse than not pinning: it destroys the customer's own service
     * attribution AND gives the attacker's data a shape indistinguishable
     * from it. Refuse to do that; the caller's policy layer is responsible for
     * not configuring a blank pin in the first place.
     */
    const pinnedServiceName: string =
      typeof serviceName === "string" ? serviceName.trim() : "";

    if (!pinnedServiceName) {
      return 0;
    }

    let rewrittenCount: number = 0;

    for (const containerKey of RESOURCE_CONTAINER_KEYS) {
      const container: JSONValue | undefined = body[containerKey];

      if (!Array.isArray(container)) {
        continue;
      }

      for (const resourceBlock of container) {
        if (this.pinResourceBlock(resourceBlock, pinnedServiceName)) {
          rewrittenCount++;
        }
      }
    }

    return rewrittenCount;
  }

  /*
   * Pin one { resource, scope* } envelope. Returns whether it was rewritten.
   *
   * A malformed `resource` or `attributes` is REPLACED rather than skipped.
   * That looks aggressive, but consider the alternative: a forged payload that
   * sends `"resource": "not-an-object"` would then pass through unpinned, and
   * the downstream decoder - which reads `resource?.attributes` defensively -
   * would happily ingest it with whatever service attribution it falls back
   * to. Skipping would hand the attacker a one-character bypass of the entire
   * control. The only thing we cannot repair is an envelope that is not an
   * object at all, because there is nowhere to write.
   */
  private static pinResourceBlock(
    resourceBlock: JSONValue | undefined,
    serviceName: string,
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
        /*
         * Keep every attribute that is not a service.name in its original
         * relative order, including entries we cannot parse - dropping those
         * would be an unrelated, invisible edit to the customer's data.
         */
        if (!this.isServiceNameAttribute(attribute)) {
          attributes.push(attribute as JSONValue);
        }
      }
    }

    /*
     * Appended last, and exactly once, so there is no ambiguity for a
     * consumer that takes either the first or the last match.
     */
    attributes.push({
      key: SERVICE_NAME_ATTRIBUTE_KEY,
      value: {
        stringValue: serviceName,
      },
    } as JSONValue);

    resource["attributes"] = attributes as JSONValue;

    return true;
  }

  /*
   * Matched case-insensitively and after trimming, which is deliberately
   * looser than the OTLP spec (attribute keys are case-sensitive there).
   *
   * Rationale: the ONLY consequence of over-matching here is that an exotic
   * key like "Service.Name" gets dropped, and no consumer in this codebase
   * reads that. The consequence of under-matching is a bypass, if any
   * consumer anywhere - now or later, ours or a customer's export - folds
   * case before looking up the service. Defence in depth wins that trade.
   */
  private static isServiceNameAttribute(attribute: JSONValue): boolean {
    if (
      !attribute ||
      typeof attribute !== "object" ||
      Array.isArray(attribute)
    ) {
      return false;
    }

    const key: JSONValue | undefined = (attribute as JSONObject)["key"];

    if (typeof key !== "string") {
      return false;
    }

    return key.trim().toLowerCase() === SERVICE_NAME_ATTRIBUTE_KEY;
  }
}
