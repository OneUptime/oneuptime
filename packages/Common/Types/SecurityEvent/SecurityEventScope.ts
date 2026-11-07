/*
 * THE SECURITY EVENTS ABOUT ONE RECORD: what a record's own Security Events
 * page - a network device's (issue #5769) - reads every list, count, chart
 * and facet under.
 *
 * An event is about the record when either is true:
 *
 *   - it names one of the record's exact identities: its observables hold
 *     one of them. These are the identities the record's Security card
 *     counts by (Server/Utils/SecurityEvent/Connections/ResourceSecurity) -
 *     a device's name, DNS name and hostname, and the public addresses no
 *     other host or device holds - so the card and the page agree;
 *   - or it was read from the record's own logs: it carries the attribute
 *     that names the record, `networkDevice.id` for a device, which ingest
 *     sets on every syslog line it matched to one and the log scan carries
 *     onto every security event read from such a line. A firewall's denied
 *     connections name the hosts on either side of it, never the firewall,
 *     and are still the firewall's.
 *
 * The search bar ANDs every filter it is given, so this OR cannot be typed
 * there. The page puts it on its query under its own synthetic key, which
 * the statement generator compiles to
 *
 *   (hasAny(observables, [...]) OR (has(attributeKeys, 'k') AND attributes['k'] IN (...)))
 *
 * It only ever narrows a read: authorization still runs on the query's own
 * project and sources. A scope with nothing left to match matches nothing,
 * never everything, so a record's page can never widen to every event.
 *
 * Pure: the page that builds a scope, the server that answers it and the
 * generator that compiles it agree on every word of this.
 */

// The synthetic query key a scoped read carries the scope under.
export const SECURITY_EVENT_SCOPE_QUERY_KEY: string = "securityEventScope";

/*
 * The most spellings of a record's identities one scope searches for: the
 * Security card's own bound (SECURITY_CONNECTION_MAX_ENTITIES spellings),
 * with room to spare.
 */
export const SECURITY_EVENT_SCOPE_MAX_OBSERVABLES: number = 100;

// The most values the record's attribute may take in one scope.
export const SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_VALUES: number = 10;

/*
 * The longest value read: a cloud resource's own ID, the longest identity a
 * record has, fits. Anything longer is dropped, never cut: a cut value
 * would match a different one.
 */
export const SECURITY_EVENT_SCOPE_MAX_VALUE_LENGTH: number = 2048;

// The longest attribute key read.
export const SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_KEY_LENGTH: number = 256;

export interface SecurityEventScope {
  // Spellings of the record's identities, any of which an event may name.
  observables: Array<string>;
  // The attribute that names the record on events read from its own logs.
  attributeKey?: string | undefined;
  // The values that attribute takes for the record: its id.
  attributeValues?: Array<string> | undefined;
}

// The distinct, trimmed, bounded strings of an untrusted list.
function readValues(value: unknown, limit: number): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const values: Array<string> = [];

  for (const entry of value) {
    if (values.length >= limit) {
      break;
    }

    if (typeof entry !== "string") {
      continue;
    }

    const trimmed: string = entry.trim();

    if (
      trimmed.length > 0 &&
      trimmed.length <= SECURITY_EVENT_SCOPE_MAX_VALUE_LENGTH &&
      !values.includes(trimmed)
    ) {
      values.push(trimmed);
    }
  }

  return values;
}

/*
 * A scope read from an untrusted query: every list bounded, every value a
 * string, the attribute's values kept only with a key to read them under.
 * Null when it is not an object at all.
 */
export function readSecurityEventScope(
  value: unknown,
): SecurityEventScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const scope: SecurityEventScope = {
    observables: readValues(
      raw["observables"],
      SECURITY_EVENT_SCOPE_MAX_OBSERVABLES,
    ),
  };

  const attributeKey: string =
    typeof raw["attributeKey"] === "string" ? raw["attributeKey"].trim() : "";

  if (
    attributeKey.length > 0 &&
    attributeKey.length <= SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_KEY_LENGTH
  ) {
    const attributeValues: Array<string> = readValues(
      raw["attributeValues"],
      SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_VALUES,
    );

    if (attributeValues.length > 0) {
      scope.attributeKey = attributeKey;
      scope.attributeValues = attributeValues;
    }
  }

  return scope;
}

// Whether a scope can match anything: an identity to name, or an attribute to carry.
export function hasSecurityEventScopeMatch(
  scope: SecurityEventScope | null | undefined,
): boolean {
  return Boolean(
    scope &&
      (scope.observables.length > 0 ||
        (scope.attributeKey &&
          scope.attributeValues &&
          scope.attributeValues.length > 0)),
  );
}
