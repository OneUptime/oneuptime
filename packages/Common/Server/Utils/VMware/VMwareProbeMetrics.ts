import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * A probe's collection, made ready for the metrics ingest the VMware agent's
 * data goes through.
 *
 * The probe sends what the agent's vcenter receiver would - one OTLP resource
 * per vSphere object, identity in the resource attributes - and the server,
 * not the probe, says which vCenter it is: every resource gets this vCenter's
 * name as vmware.vcenter.name, the attribute ingest routes VMware data by
 * (OtelIngestBaseService.autoDiscoverVMwareVCenter). Whatever a probe put
 * under vmware.vcenter.name, service.* or oneuptime.* itself is dropped
 * first: a probe never names another vCenter, never registers a phantom
 * Service (the agent config deletes service.name for the same reason), never
 * claims to be the agent (oneuptime.agent.version) and never tags labels.
 *
 * Anything that is not an OTLP resource is dropped, so the ingest is handed
 * the shape it expects or nothing.
 */

export interface VMwareProbeMetricsPayload {
  resourceMetrics: JSONArray;
  resourceCount: number;
  datapointCount: number;
}

const DROPPED_ATTRIBUTE_PREFIXES: ReadonlyArray<string> = [
  "oneuptime.",
  "service.",
];

const VCENTER_NAME_ATTRIBUTE: string = "vmware.vcenter.name";

function isObject(value: JSONValue | undefined): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDroppedKey(key: string): boolean {
  return (
    key === VCENTER_NAME_ATTRIBUTE ||
    DROPPED_ATTRIBUTE_PREFIXES.some((prefix: string): boolean => {
      return key.startsWith(prefix);
    })
  );
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

export default class VMwareProbeMetrics {
  public static prepare(data: {
    resourceMetrics: unknown;
    vcenterName: string;
  }): VMwareProbeMetricsPayload {
    const prepared: JSONArray = [];
    let datapointCount: number = 0;

    if (!Array.isArray(data.resourceMetrics) || !data.vcenterName.trim()) {
      return { resourceMetrics: [], resourceCount: 0, datapointCount: 0 };
    }

    for (const entry of data.resourceMetrics as JSONArray) {
      if (!isObject(entry) || !Array.isArray(entry["scopeMetrics"])) {
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

      keptAttributes.push({
        key: VCENTER_NAME_ATTRIBUTE,
        value: { stringValue: data.vcenterName },
      });

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
    };
  }
}
