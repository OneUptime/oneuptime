import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { CloudEndpointSuggestion } from "Common/Types/Cloud/CloudEndpointMatch";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The cloud resources a monitor seems to check, as the server matches its
 * host to the endpoints cloud connections listed
 * (CloudEndpointSuggestions), and linking one. No React here, so App's
 * tests can load it.
 */

export const CLOUD_RESOURCE_SUGGESTIONS_ROUTE: string =
  "/monitor/cloud-resource-suggestions";

// The answer's suggestions, each one checked: a malformed entry is dropped.
export function readCloudLinkSuggestions(
  data: unknown,
): Array<CloudEndpointSuggestion> {
  const list: unknown =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)["suggestions"]
      : undefined;

  if (!Array.isArray(list)) {
    return [];
  }

  const suggestions: Array<CloudEndpointSuggestion> = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const id: unknown = record["cloudResourceId"];

    if (typeof id !== "string" || !ObjectID.isValidUUID(id)) {
      continue;
    }

    const text: (key: string) => string = (key: string): string => {
      const value: unknown = record[key];
      return typeof value === "string" ? value : "";
    };

    suggestions.push({
      cloudResourceId: id,
      name: text("name"),
      type: text("type"),
      provider: text("provider"),
      endpoint: text("endpoint"),
      via: text("via"),
    });
  }

  return suggestions;
}

/*
 * Why a resource is suggested, in the reader's language: it answers on the
 * monitor's host itself ("Answers on shop.example.com"), or the host
 * points, through DNS, to a name it answers on ("shop.example.com points
 * to my-lb-123.elb.amazonaws.com"). Names are compared in any case.
 */
export function getCloudLinkSuggestionReason(
  translator: Translator,
  suggestion: CloudEndpointSuggestion,
): string {
  const host: string = suggestion.via.trim();
  const endpoint: string = suggestion.endpoint.trim();

  if (host && endpoint && host.toLowerCase() !== endpoint.toLowerCase()) {
    return translator.translateTemplate("{{host}} points to {{endpoint}}", {
      host,
      endpoint,
    });
  }

  return translator.translateTemplate("Answers on {{host}}", {
    host: endpoint || host,
  });
}

export async function fetchCloudLinkSuggestions(
  monitorId: ObjectID,
): Promise<Array<CloudEndpointSuggestion>> {
  const response: HTTPResponse<JSONObject> = (await API.get<JSONObject>({
    url: URL.fromString(APP_API_URL.toString()).addRoute(
      `${CLOUD_RESOURCE_SUGGESTIONS_ROUTE}/${monitorId.toString()}`,
    ),
    headers: ModelAPI.getCommonHeaders(),
  })) as HTTPResponse<JSONObject>;

  return readCloudLinkSuggestions(response.data);
}

/*
 * Links a cloud resource to the monitor, keeping what it is linked to: the
 * monitor's cloud resources are read, and written back with this one.
 */
export async function linkCloudResourceToMonitor(data: {
  monitorId: ObjectID;
  cloudResourceId: string;
}): Promise<void> {
  const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
    modelType: Monitor,
    id: data.monitorId,
    select: {
      cloudResources: {
        _id: true,
      },
    },
  });

  const ids: Array<string> = (monitor?.cloudResources || [])
    .map((resource: CloudResource): string => {
      return resource._id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });

  if (ids.includes(data.cloudResourceId)) {
    return;
  }

  await ModelAPI.updateById<Monitor>({
    modelType: Monitor,
    id: data.monitorId,
    data: {
      cloudResources: [...ids, data.cloudResourceId],
    } as unknown as JSONObject,
  });
}
