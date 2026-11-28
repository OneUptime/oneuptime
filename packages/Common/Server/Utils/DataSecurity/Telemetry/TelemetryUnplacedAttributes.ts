import { METRIC_NAME_LOCATION } from "../../../../Types/DataSecurity/TelemetryScrubTarget";
import { RUM_SESSION_TAGS_PREFIX } from "../../../../Types/DataSecurity/RumSessionPlaces";
import {
  describeUnplacedField,
  MAX_UNPLACED_FIELDS_PER_SCAN,
  UnplacedField,
} from "../../../../Utils/DataSecurity/UnplacedFields";
import { DataStoreLocationKind } from "../DataSecurityScanTypes";

/*
 * THE ATTRIBUTES A TELEMETRY SCAN COULD NOT PLACE (#10371).
 *
 * A content scan keeps the columns and fields no detector placed, by their
 * names and the shapes of their values, for OneUptime AI to ask about
 * (UnplacedFields, FieldSuggestion) - and to learn the company's own data
 * types from. A service's telemetry is held to the same: an attribute such
 * as `policy_ref` on a span, whose name points at no data type and whose
 * values match no detector, is kept as a column would be - never a value.
 *
 * Telemetry repeats itself, so it is held tighter than a database:
 *
 *   - at most MAX_UNPLACED_ATTRIBUTES_PER_SERVICE attributes of a service a
 *     scan, shared out in turn across its logs, traces, exceptions, metrics
 *     and AI calls, the attributes with the most values first in each;
 *   - never a key OneUptime adds (`oneuptime.*`, which the scan does not
 *     read), nor the keys OpenTelemetry's conventions write on every record
 *     to say where it came from - the service, its host, process, container
 *     and Kubernetes pod, its cloud, its SDK - nor the conventions' own
 *     keys for a request, a query or an error: they would take a service's
 *     share every scan, and k8s.pod.name in every service's logs would
 *     look like a data type of the company's own;
 *   - never free text: a log's body, a message, a stack trace or a prompt,
 *     and any attribute whose values average more than 80 characters, as
 *     for every field (describeUnplacedField).
 */

export const MAX_UNPLACED_ATTRIBUTES_PER_SERVICE: number = 50;

/*
 * Where an attribute's key starts in a telemetry location: a record's own
 * attributes, a RUM application's, a session's, its tags (#11458) and its
 * user's traits, and a span event's ("events.<event>.").
 */
const ATTRIBUTE_BASES: ReadonlyArray<string> = [
  "attributes.",
  "logs.attributes.",
  "spans.attributes.",
  "sessions.attributes.",
  RUM_SESSION_TAGS_PREFIX,
  "sessions.identifiedUserTraits.",
];

// A resource's attributes are read under this, inside a record's own.
const RESOURCE_PREFIX: string = "resource.";

/*
 * The namespaces of OpenTelemetry's semantic conventions for where a
 * record came from and how it was carried - and OneUptime's own.
 */
export const CONVENTION_ATTRIBUTE_NAMESPACES: ReadonlyArray<string> = [
  "oneuptime",
  "otel",
  "telemetry",
  "service",
  "deployment",
  "host",
  "os",
  "process",
  "container",
  "k8s",
  "cloud",
  "faas",
  "aws",
  "azure",
  "gcp",
  "heroku",
  "device",
  "browser",
  "webengine",
  "code",
  "thread",
  "log",
  "http",
  "url",
  "net",
  "network",
  "server",
  "client",
  "user_agent",
  "rpc",
  "db",
  "messaging",
  "exception",
  "error",
  "event",
  "gen_ai",
  "feature_flag",
  "tls",
  "dns",
  "system",
  "process_runtime",
  "jvm",
  "nodejs",
  "v8js",
  "go",
  "dotnet",
];

/*
 * An attribute's key as its record has it, from a telemetry location - a
 * resource's without "resource." - or null for a location that is no
 * attribute: a body, a message, a metric's name.
 */
export function getTelemetryAttributeKey(location: string): string | null {
  let key: string | null = null;

  for (const base of ATTRIBUTE_BASES) {
    if (location.startsWith(base)) {
      key = location.slice(base.length);
      break;
    }
  }

  if (key === null && location.startsWith("events.")) {
    // events.<event>.<key>: the key is what follows the event's name.
    const afterEvent: number = location.indexOf(".", "events.".length);

    key = afterEvent > 0 ? location.slice(afterEvent + 1) : null;
  }

  if (key !== null && key.startsWith(RESOURCE_PREFIX)) {
    key = key.slice(RESOURCE_PREFIX.length);
  }

  return key ? key : null;
}

// Whether an attribute is one of OpenTelemetry's conventions, or OneUptime's own.
export function isConventionAttributeKey(key: string): boolean {
  const lower: string = key.toLowerCase();
  const namespace: string = lower.split(".")[0] || "";

  return CONVENTION_ATTRIBUTE_NAMESPACES.includes(namespace);
}

/*
 * One attribute no detector placed, described as a column would be - or
 * null when it is not one to ask about: not an attribute, one of the
 * conventions' keys, free text, or one describeUnplacedField leaves out.
 */
export function describeUnplacedAttribute(data: {
  location: string;
  locationKind: DataStoreLocationKind;
  values: ReadonlyArray<unknown>;
  neighbours: ReadonlyArray<string>;
}): UnplacedField | null {
  const isAttribute: boolean =
    data.locationKind === DataStoreLocationKind.Attribute ||
    (data.locationKind === DataStoreLocationKind.Field &&
      data.location !== METRIC_NAME_LOCATION);

  if (!isAttribute) {
    return null;
  }

  const key: string | null = getTelemetryAttributeKey(data.location);

  // A session's user label is the one field with no key: kept as a field.
  if (key !== null && isConventionAttributeKey(key)) {
    return null;
  }

  return describeUnplacedField({
    path: data.location,
    values: data.values,
    neighbours: data.neighbours,
    locationKind: data.locationKind,
  });
}

/*
 * A service's attributes shared out across its stores: in turn, one of each
 * store's at a time, each store's with the most values first, until the
 * service's MAX_UNPLACED_ATTRIBUTES_PER_SERVICE are given out. By store,
 * in the order given.
 */
export function shareUnplacedAttributes(
  stores: ReadonlyArray<ReadonlyArray<UnplacedField>>,
  max: number = MAX_UNPLACED_ATTRIBUTES_PER_SERVICE,
): Array<Array<UnplacedField>> {
  const queues: Array<Array<UnplacedField>> = stores.map(
    (fields: ReadonlyArray<UnplacedField>): Array<UnplacedField> => {
      return [...fields].sort((a: UnplacedField, b: UnplacedField): number => {
        return (
          b.valueCount - a.valueCount ||
          (a.location < b.location ? -1 : a.location > b.location ? 1 : 0)
        );
      });
    },
  );
  const shared: Array<Array<UnplacedField>> = stores.map(() => {
    return [];
  });
  let given: number = 0;
  let isAnyLeft: boolean = true;

  while (isAnyLeft && given < max) {
    isAnyLeft = false;

    for (let index: number = 0; index < queues.length && given < max; index++) {
      const next: UnplacedField | undefined = queues[index]!.shift();

      if (!next) {
        continue;
      }

      isAnyLeft = true;

      if (shared[index]!.length < MAX_UNPLACED_FIELDS_PER_SCAN) {
        shared[index]!.push(next);
        given++;
      }
    }
  }

  return shared;
}
