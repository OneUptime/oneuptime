import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";

/*
 * Pure helpers for IoT-fleet-scoped telemetry ingestion keys.
 *
 * A TelemetryIngestionKey may optionally carry `iotFleetNames` — a list
 * of fleet names (values of the `iot.fleet.name` OTLP resource
 * attribute) the key is allowed to ingest telemetry for. When the list
 * is null / empty the key is UNSCOPED and behaves exactly as before
 * (project-wide). When non-empty, EVERY resource envelope in an OTLP
 * payload must carry an `iot.fleet.name` resource attribute whose value
 * is in the allowed list — anything else (wrong fleet, missing
 * attribute) rejects the whole request. Fail closed for scoped keys.
 *
 * These helpers are deliberately pure (no I/O, no service imports) so
 * they can be unit-tested without infrastructure and shared by the
 * HTTP middleware, the gRPC entry point, and the queue workers.
 */

/**
 * Marker interface for request-like objects that carry the resolved
 * fleet scope of the authenticated ingestion key. Set by the HTTP /
 * gRPC entry points after auth and forwarded through the queue job so
 * the worker-side resource loops can re-check (defense in depth).
 */
export interface IotFleetScopeCarrier {
  allowedIotFleetNames?: Array<string> | undefined;
}

export interface IotFleetScopeViolation {
  /** The fleet name the offending resource carried, or null when the attribute was missing. */
  offendingFleetName: string | null;
  /** Human-readable rejection reason. NEVER contains the ingestion key value. */
  message: string;
}

/**
 * Normalize a raw `iotFleetNames` column value (or job-data field) into
 * a clean list: only strings, trimmed, empties dropped, de-duplicated.
 * Null / undefined / non-array input yields [] (unscoped).
 */
export function normalizeIotFleetNames(raw: unknown): Array<string> {
  if (!raw || !Array.isArray(raw)) {
    return [];
  }

  const seen: Set<string> = new Set();

  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed: string = item.trim();
    if (!trimmed) {
      continue;
    }
    seen.add(trimmed);
  }

  return Array.from(seen);
}

/**
 * True when the (already-normalized) allowed list actually scopes the
 * key. Empty list = unscoped = today's project-wide behavior.
 */
export function isFleetScoped(allowedIotFleetNames: Array<string>): boolean {
  return allowedIotFleetNames.length > 0;
}

/*
 * First attribute with the given key whose stringValue is a non-empty
 * trimmed string wins; empty / whitespace-only / non-string values are
 * skipped so a later attribute with the same key can still match.
 * Mirrors OtelIngestBaseService.getStringAttribute EXACTLY — see the
 * lockstep warning on getIotFleetNameFromResourceAttributes below.
 */
function getStringAttributeValue(
  attributes: JSONArray,
  key: string,
): string | null {
  for (const attribute of attributes) {
    const attributeObject: JSONObject = attribute as JSONObject;
    if (
      attributeObject["key"] === key &&
      attributeObject["value"] &&
      (attributeObject["value"] as JSONObject)["stringValue"]
    ) {
      const value: unknown = (attributeObject["value"] as JSONObject)[
        "stringValue"
      ];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

/*
 * Extract `iot.fleet.name` from a decoded OTLP resource attribute list
 * ([{ key, value: { stringValue } }, ...]).
 *
 * SECURITY — LOCKSTEP INVARIANT: this MUST resolve the exact same
 * fleet name as the ingest attribution path,
 * OtelIngestBaseService.getIoTFleetNameFromAttributes, which is
 * `getStringAttribute(attrs, "iot.fleet.name") ||
 *  getStringAttribute(attrs, "resource.iot.fleet.name")`
 * — i.e. KEY PRIORITY across the whole array (the canonical
 * `iot.fleet.name` always wins regardless of array position; the
 * `resource.`-prefixed alias is only consulted when no non-empty
 * canonical attribute exists). A first-match-in-array-order resolver
 * here would let a scoped key order both keys so the scope check sees
 * an allowed fleet while ingest attributes the data to a different,
 * out-of-scope fleet — a full scope escape. Parity is pinned by
 * ScopedIngestionKey.test.ts against the real ingest resolver, and
 * checkResourceAgainstFleetScope additionally rejects scoped-key
 * resources that carry BOTH keys with DIFFERENT values (belt and
 * braces against future resolver drift).
 */
export function getIotFleetNameFromResourceAttributes(
  attributes: JSONArray | undefined | null,
): string | null {
  if (!attributes || !Array.isArray(attributes)) {
    return null;
  }

  return (
    getStringAttributeValue(attributes, "iot.fleet.name") ||
    getStringAttributeValue(attributes, "resource.iot.fleet.name")
  );
}

export interface ConflictingIotFleetAttribution {
  /** Value of the canonical `iot.fleet.name` attribute. */
  canonicalFleetName: string;
  /** Value of the `resource.iot.fleet.name` alias attribute. */
  aliasFleetName: string;
}

/**
 * Detect a resource that carries BOTH `iot.fleet.name` and
 * `resource.iot.fleet.name` with DIFFERENT (non-empty) values. Such a
 * resource is ambiguously attributed: any consumer that resolved the
 * "other" key would file the data under a different fleet. Scoped keys
 * reject these outright — see checkResourceAgainstFleetScope.
 */
export function getConflictingIotFleetAttribution(
  attributes: JSONArray | undefined | null,
): ConflictingIotFleetAttribution | null {
  if (!attributes || !Array.isArray(attributes)) {
    return null;
  }

  const canonicalFleetName: string | null = getStringAttributeValue(
    attributes,
    "iot.fleet.name",
  );
  const aliasFleetName: string | null = getStringAttributeValue(
    attributes,
    "resource.iot.fleet.name",
  );

  if (
    canonicalFleetName &&
    aliasFleetName &&
    canonicalFleetName !== aliasFleetName
  ) {
    return { canonicalFleetName, aliasFleetName };
  }

  return null;
}

/**
 * Map an OTLP product type to the resource-envelope array key in the
 * decoded payload body.
 */
export function getResourceEnvelopeKeyForProductType(
  productType: ProductType,
): string | null {
  switch (productType) {
    case ProductType.Traces:
      return "resourceSpans";
    case ProductType.Logs:
      return "resourceLogs";
    case ProductType.Metrics:
      return "resourceMetrics";
    case ProductType.Profiles:
      return "resourceProfiles";
    default:
      return null;
  }
}

/**
 * Pull the resource envelopes (resourceSpans / resourceLogs /
 * resourceMetrics / resourceProfiles) out of a decoded OTLP body.
 * Returns [] when absent — an empty payload has nothing to enforce.
 */
export function getResourceEnvelopesFromOtelBody(
  body: JSONObject | undefined | null,
  productType: ProductType,
): JSONArray {
  if (!body) {
    return [];
  }

  const key: string | null = getResourceEnvelopeKeyForProductType(productType);
  if (!key) {
    return [];
  }

  const envelopes: unknown = body[key];
  return Array.isArray(envelopes) ? (envelopes as JSONArray) : [];
}

function formatAllowedScope(allowedIotFleetNames: Array<string>): string {
  return allowedIotFleetNames
    .map((name: string) => {
      return `"${name}"`;
    })
    .join(", ");
}

/**
 * Check a single resource envelope's attributes against the allowed
 * fleet list. Returns null when allowed (or when the key is unscoped),
 * otherwise a violation describing the offending fleet vs the allowed
 * scope. The message never contains the ingestion key value.
 */
export function checkResourceAgainstFleetScope(data: {
  allowedIotFleetNames: Array<string>;
  resourceAttributes: JSONArray | undefined | null;
}): IotFleetScopeViolation | null {
  const allowed: Array<string> = data.allowedIotFleetNames;

  if (!isFleetScoped(allowed)) {
    // Unscoped key — no enforcement, identical to today's behavior.
    return null;
  }

  /*
   * Belt and braces: a resource carrying BOTH iot.fleet.name and
   * resource.iot.fleet.name with DIFFERENT values is ambiguously
   * attributed — if any consumer ever resolved the other key than the
   * ingest path does, the data would be filed under a fleet this check
   * never approved. Reject outright for scoped keys, even when the
   * ingest-resolved value happens to be in scope, so a future resolver
   * drift can never become a scope escape.
   */
  const conflict: ConflictingIotFleetAttribution | null =
    getConflictingIotFleetAttribution(data.resourceAttributes);

  if (conflict) {
    return {
      offendingFleetName: conflict.canonicalFleetName,
      message:
        `This telemetry ingestion key is scoped to IoT fleet(s) [${formatAllowedScope(allowed)}], ` +
        `but the payload contains a resource with conflicting fleet attribution: ` +
        `iot.fleet.name "${conflict.canonicalFleetName}" and resource.iot.fleet.name "${conflict.aliasFleetName}". ` +
        `Scoped keys reject ambiguously-attributed resources — send a single consistent iot.fleet.name value.`,
    };
  }

  const fleetName: string | null = getIotFleetNameFromResourceAttributes(
    data.resourceAttributes,
  );

  if (fleetName === null) {
    // Fail closed: scoped keys may only ingest fleet-attributed resources.
    return {
      offendingFleetName: null,
      message:
        `This telemetry ingestion key is scoped to IoT fleet(s) [${formatAllowedScope(allowed)}], ` +
        `but the payload contains a resource with no iot.fleet.name resource attribute. ` +
        `Scoped keys may only ingest telemetry that carries an in-scope iot.fleet.name resource attribute.`,
    };
  }

  if (!allowed.includes(fleetName)) {
    return {
      offendingFleetName: fleetName,
      message:
        `This telemetry ingestion key is scoped to IoT fleet(s) [${formatAllowedScope(allowed)}], ` +
        `but the payload contains a resource with iot.fleet.name "${fleetName}", which is outside this key's scope.`,
    };
  }

  return null;
}

/**
 * Check every resource envelope in a decoded OTLP payload. Returns the
 * first violation found (the whole request must be rejected), or null
 * when all resources are in scope / the key is unscoped.
 */
export function findIotFleetScopeViolation(data: {
  allowedIotFleetNames: Array<string>;
  resourceEnvelopes: JSONArray;
}): IotFleetScopeViolation | null {
  if (!isFleetScoped(data.allowedIotFleetNames)) {
    return null;
  }

  for (const envelope of data.resourceEnvelopes) {
    const resourceAttributes: JSONArray | undefined = (
      (envelope as JSONObject)?.["resource"] as JSONObject
    )?.["attributes"] as JSONArray | undefined;

    const violation: IotFleetScopeViolation | null =
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: data.allowedIotFleetNames,
        resourceAttributes,
      });

    if (violation) {
      return violation;
    }
  }

  return null;
}
