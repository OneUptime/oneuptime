import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * A probe's instance actions, made ready for the log ingest the agent's data goes through.
 *
 * As with its metrics (OpenStackProbeMetrics), the server and not the probe says which cloud
 * these are of: whatever a probe put under openstack.cloud.name, service.* or oneuptime.* is
 * dropped first, and every resource gets this cloud's name. A record is kept only if its body
 * is a string, because that is the notification, and the ingest reads nothing else of it.
 * Bounded, because a collection's actions are few and a report is a probe's word for it.
 */

export const MAX_OPENSTACK_PROBE_LOG_RECORDS: number = 500;

export interface OpenStackProbeLogsPayload {
  resourceLogs: JSONArray;
  recordCount: number;
}

const DROPPED_ATTRIBUTE_PREFIXES: ReadonlyArray<string> = [
  "oneuptime.",
  "service.",
];

const CLOUD_NAME_ATTRIBUTE: string = "openstack.cloud.name";

function isObject(value: JSONValue | undefined): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDroppedKey(key: string): boolean {
  return (
    key === CLOUD_NAME_ATTRIBUTE ||
    DROPPED_ATTRIBUTE_PREFIXES.some((prefix: string): boolean => {
      return key.startsWith(prefix);
    })
  );
}

function hasStringBody(record: JSONValue): boolean {
  if (!isObject(record) || !isObject(record["body"])) {
    return false;
  }

  return typeof (record["body"] as JSONObject)["stringValue"] === "string";
}

export default class OpenStackProbeLogs {
  public static prepare(data: {
    resourceLogs: unknown;
    cloudName: string;
  }): OpenStackProbeLogsPayload {
    if (!Array.isArray(data.resourceLogs) || !data.cloudName.trim()) {
      return { resourceLogs: [], recordCount: 0 };
    }

    const prepared: JSONArray = [];
    let recordCount: number = 0;

    for (const entry of data.resourceLogs as JSONArray) {
      if (!isObject(entry) || !Array.isArray(entry["scopeLogs"])) {
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
        key: CLOUD_NAME_ATTRIBUTE,
        value: { stringValue: data.cloudName },
      });

      const scopeLogs: JSONArray = [];

      for (const scope of entry["scopeLogs"] as JSONArray) {
        if (!isObject(scope) || !Array.isArray(scope["logRecords"])) {
          continue;
        }

        const room: number = MAX_OPENSTACK_PROBE_LOG_RECORDS - recordCount;
        const logRecords: JSONArray = (scope["logRecords"] as JSONArray)
          .filter(hasStringBody)
          .slice(0, Math.max(0, room));

        if (logRecords.length > 0) {
          recordCount += logRecords.length;
          scopeLogs.push({
            scope: isObject(scope["scope"]) ? scope["scope"] : {},
            logRecords,
          });
        }
      }

      if (scopeLogs.length > 0) {
        prepared.push({
          resource: { attributes: keptAttributes },
          scopeLogs,
        });
      }
    }

    return { resourceLogs: prepared, recordCount };
  }
}
