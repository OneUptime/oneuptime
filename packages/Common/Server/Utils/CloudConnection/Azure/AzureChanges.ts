import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../Types/JSON";
import { readObject, readText } from "../../LlmObservability/LlmProviderHttp";
import { CloudChange } from "../CloudConnectorTypes";

/*
 * WHAT CHANGED IN AN AZURE SUBSCRIPTION, AND WHAT AZURE SAYS ABOUT ITS
 * HEALTH: one Activity Log read (AzureArm.listActivityLog), three kinds of
 * event in it.
 *
 *   - Administrative: a write, delete or action on a resource. Azure logs
 *     each operation as it starts, is accepted and ends; only its end - it
 *     succeeded or failed - is a change.
 *   - ServiceHealth: an Azure service incident, maintenance or advisory
 *     that touches the subscription.
 *   - ResourceHealth: one resource went unavailable or degraded, or came
 *     back - and whether Azure or someone did it.
 *
 * Only the fields the read selects are read; of `properties`, only a
 * health event's title, status and cause - never a request's body.
 */

const ENDED_STATUSES: ReadonlyArray<string> = ["succeeded", "failed"];

// Administrative operations that are machinery, not a change.
const NOISY_OPERATION_SUFFIXES: ReadonlyArray<string> = [
  "/read",
  "/listkeys/action",
  "/validate/action",
];

function valueOf(field: unknown): string {
  // Activity Log fields are { value, localizedValue } or plain text.
  if (field && typeof field === "object" && !Array.isArray(field)) {
    return readText((field as JSONObject)["value"]);
  }

  return readText(field);
}

function localizedOf(field: unknown): string {
  if (field && typeof field === "object" && !Array.isArray(field)) {
    return (
      readText((field as JSONObject)["localizedValue"]) ||
      readText((field as JSONObject)["value"])
    );
  }

  return readText(field);
}

// A property of an Activity Log event, as text.
function propertyOf(event: JSONObject, key: string): string {
  return readText(readObject(event["properties"])[key]);
}

/*
 * One Activity Log event as a change or a health event, or null for an
 * operation's start, a read, or anything it cannot place.
 */
export function readAzureActivityEvent(data: {
  event: JSONObject;
  subscriptionId: string;
}): CloudChange | null {
  const event: JSONObject = data.event;
  const eventId: string = readText(event["eventDataId"]);
  const time: Date = new Date(readText(event["eventTimestamp"]));
  const category: string = valueOf(event["category"]).toLowerCase();
  const resourceId: string = readText(event["resourceId"]);

  if (!eventId || Number.isNaN(time.getTime())) {
    return null;
  }

  const base: Omit<CloudChange, "kind" | "operation" | "actor" | "failed"> = {
    provider: CloudProvider.Azure,
    accountId: data.subscriptionId,
    region: "",
    time,
    eventId,
    resources: resourceId ? [{ id: resourceId }] : [],
  };

  if (category === "administrative") {
    const status: string = valueOf(event["status"]).toLowerCase();
    const operation: string = valueOf(event["operationName"]);

    if (
      !operation ||
      !ENDED_STATUSES.includes(status) ||
      NOISY_OPERATION_SUFFIXES.some((suffix: string): boolean => {
        return operation.toLowerCase().endsWith(suffix);
      })
    ) {
      return null;
    }

    return {
      ...base,
      kind: "change",
      operation,
      actor: readText(event["caller"]),
      failed: status === "failed",
    };
  }

  if (category === "servicehealth") {
    const title: string =
      propertyOf(event, "title") ||
      propertyOf(event, "defaultLanguageTitle") ||
      localizedOf(event["operationName"]);
    const incidentType: string = propertyOf(event, "incidentType");
    const stage: string = propertyOf(event, "stage");
    const trackingId: string = propertyOf(event, "trackingId");

    return {
      ...base,
      // A service incident is about the subscription, not one resource.
      resources: [],
      kind: "health",
      operation: incidentType
        ? `ServiceHealth ${incidentType}`
        : "ServiceHealth",
      actor: "",
      failed: false,
      title: `Azure Service Health: ${title || "an event"}${
        stage ? ` (${stage})` : ""
      }`,
      description: [
        incidentType
          ? `${incidentType} published by Azure`
          : "Published by Azure",
        trackingId ? `tracking id ${trackingId}` : "",
        stage ? `stage ${stage}` : "",
      ]
        .filter((part: string): boolean => {
          return part.length > 0;
        })
        .join(", ")
        .concat("."),
    };
  }

  if (category === "resourcehealth") {
    const current: string = propertyOf(event, "currentHealthStatus");
    const previous: string = propertyOf(event, "previousHealthStatus");
    const cause: string = propertyOf(event, "cause");
    const title: string = propertyOf(event, "title");

    return {
      ...base,
      kind: "health",
      operation: `ResourceHealth ${current || "changed"}`,
      actor: "",
      failed: false,
      title: `Azure Resource Health: ${
        current
          ? `${previous ? `${previous} → ` : ""}${current}`
          : title || "changed"
      }`,
      description: [
        title,
        cause === "PlatformInitiated"
          ? "Azure caused it"
          : cause === "UserInitiated"
            ? "Someone with access caused it"
            : "",
      ]
        .filter((part: string): boolean => {
          return part.length > 0;
        })
        .join(". ")
        .concat("."),
    };
  }

  return null;
}
