import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../Types/JSON";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import { getRegionFromGcpLocation } from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudChange } from "../CloudConnectorTypes";

/*
 * WHAT CHANGED IN A GOOGLE CLOUD PROJECT, AND WHAT GOOGLE SAYS ABOUT ITS
 * HEALTH.
 *
 *   - The Admin Activity audit log (GcpInventoryClient.listAuditEntries):
 *     every call that changed a resource or who may reach it, always on,
 *     kept 400 days, free. Of each entry only the method, the service, the
 *     resource's name, the caller and whether it failed are read - never
 *     the request or the response, which can carry anything.
 *   - Service Health events (GcpInventoryClient.listServiceHealthEvents):
 *     an incident on a Google Cloud product that touches the project.
 */

// Methods that are machinery, not a change worth naming next to an incident.
const NOISY_METHOD_PARTS: ReadonlyArray<string> = [
  ".get",
  ".list",
  "google.longrunning.operations",
  "setcommoninstancemetadata",
];

// One audit log entry as a change, or null.
export function readGcpAuditEntry(data: {
  entry: JSONObject;
  projectId: string;
}): CloudChange | null {
  const entry: JSONObject = data.entry;
  const payload: JSONObject = readObject(entry["protoPayload"]);
  const methodName: string = readText(payload["methodName"]);
  const serviceName: string = readText(payload["serviceName"]);
  const resourceName: string = readText(payload["resourceName"]);
  const eventId: string = readText(entry["insertId"]);
  const time: Date = new Date(readText(entry["timestamp"]));

  if (
    !eventId ||
    !methodName ||
    Number.isNaN(time.getTime()) ||
    NOISY_METHOD_PARTS.some((part: string): boolean => {
      return methodName.toLowerCase().includes(part);
    })
  ) {
    return null;
  }

  const labels: JSONObject = readObject(
    readObject(entry["resource"])["labels"],
  );
  const location: string =
    readText(labels["zone"]) ||
    readText(labels["region"]) ||
    readText(labels["location"]);
  const status: JSONObject = readObject(payload["status"]);
  const code: unknown = status["code"];

  return {
    kind: "change",
    provider: CloudProvider.GCP,
    accountId: data.projectId,
    region:
      location && location !== "global"
        ? getRegionFromGcpLocation(location)
        : "",
    time,
    eventId,
    operation: methodName,
    actor: readText(
      readObject(payload["authenticationInfo"])["principalEmail"],
    ),
    resources:
      serviceName && resourceName
        ? [
            {
              // The full resource name Cloud Asset and the metrics write.
              id: resourceName.startsWith("//")
                ? resourceName
                : `//${serviceName}/${resourceName}`,
              type:
                readText(readObject(entry["resource"])["type"]) || undefined,
            },
          ]
        : [],
    // A status with a non-zero code is a call that failed.
    failed: typeof code === "number" && code !== 0,
  };
}

// One Service Health event as a health event, or null.
export function readGcpHealthEvent(data: {
  event: JSONObject;
  projectId: string;
}): CloudChange | null {
  const event: JSONObject = data.event;
  const name: string = readText(event["name"]);
  const time: Date = new Date(
    readText(event["updateTime"]) || readText(event["startTime"]),
  );
  const state: string = readText(event["state"]);

  if (!name || Number.isNaN(time.getTime())) {
    return null;
  }

  const products: Array<string> = Array.from(
    new Set(
      readArray(event["eventImpacts"])
        .map((raw: unknown): string => {
          return readText(
            readObject(readObject(raw)["product"])["productName"],
          );
        })
        .filter((product: string): boolean => {
          return product.length > 0;
        }),
    ),
  );

  return {
    kind: "health",
    provider: CloudProvider.GCP,
    accountId: data.projectId,
    region: "",
    time,
    eventId: `${name}|${state}|${time.toISOString()}`,
    operation: readText(event["category"]) || "INCIDENT",
    actor: "",
    resources: [],
    failed: false,
    title: `Google Cloud Service Health: ${
      readText(event["title"]) || products.join(", ") || "an incident"
    }${state ? ` (${state.toLowerCase()})` : ""}`,
    description:
      readText(event["description"]) ||
      (products.length > 0 ? `Affects ${products.join(", ")}.` : undefined),
  };
}
