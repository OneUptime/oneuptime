import { JSONObject, JSONValue } from "../../../Types/JSON";
import { AllResourceIdentityLabelKeys } from "./SeriesResourceLabels";

/*
 * ---------------------------------------------------------------------------
 * Attributes a monitor SCRIPT chose, on their way into ClickHouse
 * ---------------------------------------------------------------------------
 *
 * Custom code and synthetic monitors let a user's script name its own metric
 * dimensions:
 *
 *   oneuptime.captureMetric("api.queue.depth", 12, { region: "us-east-1" })
 *
 * Everything else that writes a metric row picks its own attribute keys from a
 * fixed vocabulary. This is the one writer where the KEY is user input, so it
 * is the one writer that needs a guard, and this module is it.
 *
 * Two classes of key are refused.
 *
 *  1. RESOURCE IDENTITY. A metric row is not just a datapoint — it is a claim
 *     about which resource the datapoint describes. `SeriesResourceLabels`
 *     lists the attribute names that carry that claim (`service.name`,
 *     `oneuptime.host.id`, `k8s.cluster.name`, ...), and the consumers take
 *     them at face value.
 *
 *     Two consequences, one immediate and one a step removed. Immediately, the
 *     resource detail pages scope their charts by the raw attribute rather
 *     than by the owning entity's id — Service > Metrics pins
 *     `resource.service.name = <the service's name>` — so a script stamping
 *     that key files its monitor's datapoints onto an unrelated Service's
 *     page. A step removed, ANY metric monitor grouped by one of these keys
 *     turns it into a series label, and from there `SeriesResourceLinker`
 *     attaches the named resource to every alert and incident that series
 *     opens, `AlertOwnerRuleEngineService` pages that resource's owners
 *     through owner inheritance, and `MonitorMaintenanceSuppression` silences
 *     the series for the duration of a maintenance window on it. (A custom
 *     code monitor's OWN alerts carry no series labels, so that second chain
 *     needs a metric monitor over the `custom.monitor.*` series — which is an
 *     ordinary thing for the same user to build.)
 *
 *     The blocklist is DERIVED from `AllResourceIdentityLabelKeys` so a key
 *     added to the read side cannot be forgotten here.
 *
 *     The whole `oneuptime.` and `resource.` namespaces go with them.
 *     `oneuptime.*` is what ingest stamps (ids, names, labels, custom fields);
 *     `resource.*` is the ClickHouse spelling of an OTel resource attribute,
 *     and a monitor metric has no OTel resource — so a script writing there is
 *     always impersonating something. Blocking the namespaces rather than the
 *     individual keys is what makes this hold for stamps added later.
 *
 *  2. PROTOTYPE-WALKING SEGMENTS. Dotted keys are read back as nested paths
 *     (`{{host.name}}` in an alert template walks `host` then `name`), so a
 *     segment of `__proto__` / `constructor` / `prototype` aims that walk at
 *     `Object.prototype`. `MonitorTemplateUtil` refuses to walk them, and this
 *     keeps them out of the store in the first place.
 *
 * Values are coerced rather than filtered. The sandbox hands over whatever
 * JSON the script passed, and the ClickHouse column is Map(String, String), so
 * a number or a boolean is a perfectly good dimension once stringified — which
 * is what the synthetic runtime already does in-sandbox. The custom code path
 * used to drop them on the floor server-side instead, so
 * `captureMetric("queue.depth", n, { shard: 3 })` silently recorded no `shard`
 * at all. Anything with no useful string form (objects, arrays, null, NaN,
 * Infinity) is still dropped.
 *
 * The caps match the synthetic runtime's in-sandbox caps exactly. They are
 * re-applied here because a probe is a separately deployed process: the server
 * must not take the probe's word for how much a script was allowed to write.
 */

/** Most attributes kept on one captured metric. Matches the synthetic runtime. */
export const MaxCapturedMetricAttributes: number = 50;

/** Longest attribute key kept. Matches the synthetic runtime. */
export const MaxCapturedMetricAttributeKeyLength: number = 200;

/** Longest attribute value kept. Matches the synthetic runtime. */
export const MaxCapturedMetricAttributeValueLength: number = 1000;

/*
 * The monitor's own identity, stamped by `buildMonitorMetricAttributes` and by
 * the custom-metric block itself. A script that could overwrite these would be
 * able to file its datapoints under a different monitor, or hide them from the
 * Custom Metrics tab.
 */
const MonitorIdentityAttributeKeys: ReadonlyArray<string> = [
  "monitorId",
  "projectId",
  "monitorName",
  "probeName",
  "probeId",
  "isCustomMetric",
];

/*
 * Namespace prefixes reserved for OneUptime's own stamps. `oneuptime.` covers
 * every id / name / label / customField stamp; `resource.` covers the
 * ClickHouse spelling of OTel resource attributes.
 */
const ReservedAttributeKeyPrefixes: ReadonlyArray<string> = [
  "oneuptime.",
  "resource.",
];

/*
 * Path segments that make a dotted key resolve to the object prototype when a
 * consumer walks it as a nested property path.
 */
const PrototypeWalkingKeySegments: ReadonlySet<string> = new Set<string>([
  "__proto__",
  "constructor",
  "prototype",
]);

const ReservedAttributeKeys: ReadonlySet<string> = new Set<string>([
  ...MonitorIdentityAttributeKeys,
  ...AllResourceIdentityLabelKeys,
]);

/** One captured metric's attributes after the guard has run. */
export interface SanitizedCapturedMetricAttributes {
  /** The attributes that survived, ready to merge into the metric row. */
  attributes: JSONObject;
  /**
   * Keys refused because they are reserved. Surfaced so the caller can tell
   * the user why an attribute they wrote is not on their chart — a silent drop
   * is indistinguishable from a bug in their script.
   */
  droppedReservedKeys: Array<string>;
}

export default class CapturedMetricAttributeUtil {
  /**
   * True when a monitor script must not be allowed to write this attribute
   * key, either because OneUptime owns its meaning or because reading it back
   * as a nested path would walk the object prototype.
   *
   * Compared case-sensitively, exactly as the read side compares
   * (`SeriesResourceLabels.collectLabelValues` does a plain lookup), so this
   * refuses precisely the spellings that would actually be honoured.
   */
  public static isReservedAttributeKey(key: string): boolean {
    if (ReservedAttributeKeys.has(key)) {
      return true;
    }

    for (const prefix of ReservedAttributeKeyPrefixes) {
      if (key.startsWith(prefix)) {
        return true;
      }
    }

    for (const segment of key.split(".")) {
      if (PrototypeWalkingKeySegments.has(segment)) {
        return true;
      }
    }

    return false;
  }

  /**
   * The attributes of one captured metric, filtered, coerced and capped.
   *
   * First key wins on a post-trim collision, so the result does not depend on
   * how the script happened to order two keys that differ only in whitespace.
   */
  public static sanitize(
    attributes: JSONObject | undefined | null,
  ): SanitizedCapturedMetricAttributes {
    const sanitized: JSONObject = {};
    const droppedReservedKeys: Array<string> = [];

    if (!attributes || typeof attributes !== "object") {
      return { attributes: sanitized, droppedReservedKeys };
    }

    let kept: number = 0;

    for (const rawKey of Object.keys(attributes)) {
      if (kept >= MaxCapturedMetricAttributes) {
        break;
      }

      /*
       * An empty or whitespace-only key would store as an attribute no filter
       * could ever select — the same thing MetricResourceAttributeUtil refuses
       * to form for labels and custom fields.
       */
      const key: string = rawKey
        .trim()
        .substring(0, MaxCapturedMetricAttributeKeyLength);

      if (key.length === 0) {
        continue;
      }

      if (this.isReservedAttributeKey(key)) {
        if (!droppedReservedKeys.includes(key)) {
          droppedReservedKeys.push(key);
        }
        continue;
      }

      if (sanitized[key] !== undefined) {
        continue;
      }

      const value: string | null = this.toAttributeValue(
        attributes[rawKey] as JSONValue,
      );

      if (value === null) {
        continue;
      }

      sanitized[key] = value;
      kept++;
    }

    return { attributes: sanitized, droppedReservedKeys };
  }

  /*
   * One attribute value as the string the Map(String, String) column stores.
   * Returns null for anything that carries no usable dimension — an object, an
   * array, null/undefined, or a non-finite number, which would record as the
   * text "NaN" and chart as a category.
   */
  private static toAttributeValue(value: JSONValue | undefined): string | null {
    if (typeof value === "string") {
      return value.substring(0, MaxCapturedMetricAttributeValueLength);
    }

    if (typeof value === "number") {
      return isFinite(value) ? String(value) : null;
    }

    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    return null;
  }
}
