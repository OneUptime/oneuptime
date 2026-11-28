import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import { StorageArrayProbeCollector } from "../../../Types/StorageArray/Collection/StorageArrayProbeCollector";

/*
 * A probe's storage array collection (#11004), made ready for the metrics
 * ingest the Storage Array Agent's data goes through - VMware's
 * VMwareProbeMetrics, for arrays.
 *
 * The probe sends one OTLP resource per array, carrying the array's own
 * identifier in the platform's identity attribute (a PowerMax's Symmetrix
 * ID). The server, not the probe, says which array each is in OneUptime:
 * every resource gets `storage.system` from the connection and
 * `storage.array.name` from the array's row (found by its identifier,
 * StorageArray.systemId) - or the identifier itself for an array with no
 * row yet, under which name ingest makes one. So an array renamed in
 * OneUptime stays the same array, and a probe can never name another
 * array, platform or project's resource.
 *
 * Whatever a probe put under storage.array.name, storage.system, service.*
 * or oneuptime.* itself is dropped first. A resource without a well-formed
 * identifier is dropped whole, and anything that is not an OTLP resource
 * too, so the ingest is handed the shape it expects or nothing.
 */

export interface StorageArrayProbeMetricsPayload {
  resourceMetrics: JSONArray;
  resourceCount: number;
  datapointCount: number;
  // The identifiers of the arrays the payload holds, in order.
  arrayIdentifiers: Array<string>;
}

export const STORAGE_ARRAY_NAME_ATTRIBUTE: string = "storage.array.name";
export const STORAGE_SYSTEM_ATTRIBUTE: string = "storage.system";

const DROPPED_ATTRIBUTE_PREFIXES: ReadonlyArray<string> = [
  "oneuptime.",
  "service.",
];

// An array's own identifier: what a vendor writes on its chassis.
const IDENTIFIER_PATTERN: RegExp = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isObject(value: JSONValue | undefined): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDroppedKey(key: string): boolean {
  return (
    key === STORAGE_ARRAY_NAME_ATTRIBUTE ||
    key === STORAGE_SYSTEM_ATTRIBUTE ||
    DROPPED_ATTRIBUTE_PREFIXES.some((prefix: string): boolean => {
      return key.startsWith(prefix);
    })
  );
}

function readStringAttribute(
  attributes: JSONArray,
  key: string,
): string | null {
  for (const attribute of attributes) {
    if (
      isObject(attribute) &&
      attribute["key"] === key &&
      isObject(attribute["value"])
    ) {
      const value: JSONValue | undefined = (attribute["value"] as JSONObject)[
        "stringValue"
      ];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function countDatapoints(scopeMetrics: JSONArray): number {
  let count: number = 0;
  for (const scope of scopeMetrics) {
    if (!isObject(scope) || !Array.isArray(scope["metrics"])) {
      continue;
    }
    for (const metric of scope["metrics"] as JSONArray) {
      if (!isObject(metric)) {
        continue;
      }
      for (const kind of ["gauge", "sum"]) {
        const body: JSONValue | undefined = metric[kind];
        if (isObject(body) && Array.isArray(body["dataPoints"])) {
          count += (body["dataPoints"] as JSONArray).length;
        }
      }
    }
  }
  return count;
}

export default class StorageArrayProbeMetrics {
  // The well-formed array identifiers a collection's resources carry.
  public static getArrayIdentifiers(data: {
    resourceMetrics: unknown;
    collector: StorageArrayProbeCollector;
  }): Array<string> {
    const identifiers: Array<string> = [];
    if (!Array.isArray(data.resourceMetrics)) {
      return identifiers;
    }
    for (const entry of data.resourceMetrics as JSONArray) {
      const identifier: string | null = StorageArrayProbeMetrics.readIdentifier(
        entry,
        data.collector,
      );
      if (identifier && !identifiers.includes(identifier)) {
        identifiers.push(identifier);
      }
    }
    return identifiers;
  }

  public static readIdentifier(
    entry: JSONValue | undefined,
    collector: StorageArrayProbeCollector,
  ): string | null {
    if (!isObject(entry)) {
      return null;
    }
    const resource: JSONValue | undefined = entry["resource"];
    const attributes: JSONArray =
      isObject(resource) && Array.isArray(resource["attributes"])
        ? (resource["attributes"] as JSONArray)
        : [];
    const identifier: string | null = readStringAttribute(
      attributes,
      collector.arrayIdentityAttribute,
    );
    return identifier && IDENTIFIER_PATTERN.test(identifier)
      ? identifier
      : null;
  }

  public static prepare(data: {
    resourceMetrics: unknown;
    collector: StorageArrayProbeCollector;
    // The arrays' names in OneUptime, by identifier (rows that exist).
    namesByIdentifier: Map<string, string>;
  }): StorageArrayProbeMetricsPayload {
    const prepared: JSONArray = [];
    const arrayIdentifiers: Array<string> = [];
    let datapointCount: number = 0;

    if (!Array.isArray(data.resourceMetrics)) {
      return {
        resourceMetrics: [],
        resourceCount: 0,
        datapointCount: 0,
        arrayIdentifiers: [],
      };
    }

    for (const entry of data.resourceMetrics as JSONArray) {
      if (!isObject(entry) || !Array.isArray(entry["scopeMetrics"])) {
        continue;
      }

      const identifier: string | null = StorageArrayProbeMetrics.readIdentifier(
        entry,
        data.collector,
      );
      if (!identifier) {
        continue;
      }

      const resource: JSONValue | undefined = entry["resource"];
      const attributes: JSONArray =
        isObject(resource) && Array.isArray(resource["attributes"])
          ? (resource["attributes"] as JSONArray)
          : [];

      const keptAttributes: JSONArray = attributes.filter(
        (attribute: JSONValue): boolean => {
          return (
            isObject(attribute) &&
            typeof attribute["key"] === "string" &&
            !isDroppedKey(attribute["key"] as string)
          );
        },
      );

      keptAttributes.push(
        {
          key: STORAGE_ARRAY_NAME_ATTRIBUTE,
          value: {
            stringValue: data.namesByIdentifier.get(identifier) || identifier,
          },
        },
        {
          key: STORAGE_SYSTEM_ATTRIBUTE,
          value: { stringValue: data.collector.storageSystem },
        },
      );

      const scopeMetrics: JSONArray = entry["scopeMetrics"] as JSONArray;
      datapointCount += countDatapoints(scopeMetrics);

      if (!arrayIdentifiers.includes(identifier)) {
        arrayIdentifiers.push(identifier);
      }

      prepared.push({
        resource: {
          attributes: keptAttributes,
        },
        scopeMetrics: scopeMetrics,
      });
    }

    return {
      resourceMetrics: prepared,
      resourceCount: prepared.length,
      datapointCount: datapointCount,
      arrayIdentifiers: arrayIdentifiers,
    };
  }
}
