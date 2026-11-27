import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import {
  XCP_NG_POOL_ID_ATTRIBUTE,
  XCP_NG_POOL_NAME_ATTRIBUTE,
  XEN_ORCHESTRA_NAME_ATTRIBUTE,
  XcpNgTelemetryUtil,
} from "../../../Types/XcpNg/XcpNgTelemetry";

/*
 * A probe's read of an XCP-ng connection, made ready for the metrics ingest
 * the XCP-ng Agent's data goes through - a vCenter's (VMwareProbeMetrics),
 * for pools.
 *
 * The probe sends what the agent's collector sends - one OTLP resource per
 * pool, the pool's UUID in xcp_ng.pool.id - and the server, not the probe,
 * says which Xen Orchestra it was read from: every resource gets the
 * connection's name as xen_orchestra.name, the name each pool's Settings
 * shows. Whatever a probe put under xen_orchestra.name, service.* or
 * oneuptime.* itself is dropped first: a probe never names another Xen
 * Orchestra, never registers a phantom Service, never claims to be the
 * agent (oneuptime.agent.version) and never tags labels.
 *
 * Only the pools the connection reads now (XcpNgPoolAssignment) are kept:
 * a pool another connection reads, or one switched back to the agent, is
 * left to them. Anything that is not an OTLP resource of a pool is dropped,
 * so the ingest is handed the shape it expects or nothing.
 */

export interface XcpNgProbeMetricsPayload {
  resourceMetrics: JSONArray;
  resourceCount: number;
  datapointCount: number;
  // Pools whose resources were dropped, because another reads them.
  droppedPoolIds: Array<string>;
}

const DROPPED_ATTRIBUTE_PREFIXES: ReadonlyArray<string> = [
  "oneuptime.",
  "service.",
];

function isObject(value: JSONValue | undefined): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDroppedKey(key: string): boolean {
  return (
    key === XEN_ORCHESTRA_NAME_ATTRIBUTE ||
    DROPPED_ATTRIBUTE_PREFIXES.some((prefix: string): boolean => {
      return key.startsWith(prefix);
    })
  );
}

function countDatapoints(scopeMetrics: JSONArray): number {
  let total: number = 0;

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
          total += (body["dataPoints"] as JSONArray).length;
        }
      }
    }
  }

  return total;
}

// The pool a resource is about, lower case, or null when it names none.
export function readResourcePoolId(entry: JSONValue): string | null {
  if (!isObject(entry)) {
    return null;
  }

  const resource: JSONValue | undefined = entry["resource"];
  const attributes: JSONArray =
    isObject(resource) && Array.isArray(resource["attributes"])
      ? (resource["attributes"] as JSONArray)
      : [];

  for (const attribute of attributes) {
    if (!isObject(attribute) || attribute["key"] !== XCP_NG_POOL_ID_ATTRIBUTE) {
      continue;
    }

    const value: JSONValue | undefined = attribute["value"];
    const text: unknown = isObject(value) ? value["stringValue"] : undefined;
    const normalized: string = XcpNgTelemetryUtil.normalizePoolIdentifier(
      typeof text === "string" ? text : "",
    );

    return normalized || null;
  }

  return null;
}

// Every pool a read's resources are about, once each, sorted.
export function readReportedPoolIds(resourceMetrics: unknown): Array<string> {
  return readReportedPools(resourceMetrics).map(
    (pool: { poolIdentifier: string }): string => {
      return pool.poolIdentifier;
    },
  );
}

/*
 * Every pool a read's resources are about, once each, sorted, with the name
 * the read gives it. A name that is the pool's own UUID (Xen Orchestra
 * sends that while it has not loaded the pool) is no name.
 */
export function readReportedPools(
  resourceMetrics: unknown,
): Array<{ poolIdentifier: string; reportedName?: string | undefined }> {
  if (!Array.isArray(resourceMetrics)) {
    return [];
  }

  const pools: Map<string, string | undefined> = new Map();

  for (const entry of resourceMetrics as JSONArray) {
    const poolId: string | null = readResourcePoolId(entry);

    if (!poolId) {
      continue;
    }

    const resource: JSONValue | undefined = (entry as JSONObject)["resource"];
    const attributes: JSONArray =
      isObject(resource) && Array.isArray(resource["attributes"])
        ? (resource["attributes"] as JSONArray)
        : [];
    let name: string | undefined;

    for (const attribute of attributes) {
      if (
        isObject(attribute) &&
        attribute["key"] === XCP_NG_POOL_NAME_ATTRIBUTE &&
        isObject(attribute["value"])
      ) {
        const text: unknown = (attribute["value"] as JSONObject)["stringValue"];

        if (
          typeof text === "string" &&
          text.trim() &&
          XcpNgTelemetryUtil.normalizePoolIdentifier(text) !== poolId
        ) {
          name = text.trim();
        }
      }
    }

    if (!pools.has(poolId) || (name && !pools.get(poolId))) {
      pools.set(poolId, name);
    }
  }

  return Array.from(pools.entries())
    .sort(
      (
        left: [string, string | undefined],
        right: [string, string | undefined],
      ) => {
        return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
      },
    )
    .map(([poolIdentifier, reportedName]: [string, string | undefined]) => {
      return reportedName
        ? { poolIdentifier, reportedName }
        : { poolIdentifier };
    });
}

export default class XcpNgProbeMetrics {
  public static prepare(data: {
    resourceMetrics: unknown;
    // Stamped as xen_orchestra.name; absent for a pool read through XAPI.
    xenOrchestraName?: string | null | undefined;
    // The pools the connection reads now; every other one is dropped.
    poolIdsToKeep: ReadonlySet<string>;
  }): XcpNgProbeMetricsPayload {
    const prepared: JSONArray = [];
    const dropped: Set<string> = new Set();
    let datapointCount: number = 0;

    if (!Array.isArray(data.resourceMetrics)) {
      return {
        resourceMetrics: [],
        resourceCount: 0,
        datapointCount: 0,
        droppedPoolIds: [],
      };
    }

    const xenOrchestraName: string = (data.xenOrchestraName || "").trim();

    for (const entry of data.resourceMetrics as JSONArray) {
      if (!isObject(entry) || !Array.isArray(entry["scopeMetrics"])) {
        continue;
      }

      const poolId: string | null = readResourcePoolId(entry);

      if (!poolId) {
        continue;
      }

      if (!data.poolIdsToKeep.has(poolId)) {
        dropped.add(poolId);
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

      if (xenOrchestraName) {
        keptAttributes.push({
          key: XEN_ORCHESTRA_NAME_ATTRIBUTE,
          value: { stringValue: xenOrchestraName },
        });
      }

      const scopeMetrics: JSONArray = entry["scopeMetrics"] as JSONArray;
      datapointCount += countDatapoints(scopeMetrics);

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
      droppedPoolIds: Array.from(dropped).sort(),
    };
  }
}
