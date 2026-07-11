import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { APP_API_URL } from "Common/UI/Config";

/*
 * Client for the Service Map's incident overlay: per-service active
 * incidents from POST /telemetry/service-incident-status, keyed by
 * lowercase service name (topology entity display names are already
 * lowercase). Best-effort — the map renders without the overlay if the
 * status call fails.
 */

export interface ServiceIncidentInfo {
  incidentId: string;
  title: string;
  severityName: string | null;
  severityColor: string | null;
}

export interface ServiceIncidentStatus {
  serviceId: string;
  activeIncidentCount: number;
  worstSeverityName: string | null;
  worstSeverityColor: string | null;
  incidents: Array<ServiceIncidentInfo>;
}

export async function fetchServiceIncidentStatuses(
  serviceNames: Array<string>,
): Promise<Map<string, ServiceIncidentStatus>> {
  const statuses: Map<string, ServiceIncidentStatus> = new Map<
    string,
    ServiceIncidentStatus
  >();

  if (serviceNames.length === 0) {
    return statuses;
  }

  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    "/telemetry/service-incident-status",
  );
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url,
      data: {
        projectId: ProjectUtil.getCurrentProjectId()?.toString(),
        serviceNames: serviceNames,
      },
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const rows: JSONArray = Array.isArray(response.data?.["services"])
    ? (response.data["services"] as JSONArray)
    : [];

  for (const row of rows) {
    const entry: JSONObject = (row || {}) as JSONObject;
    const serviceName: string = String(entry["serviceName"] || "");
    if (!serviceName) {
      continue;
    }
    const rawIncidents: JSONArray = Array.isArray(entry["incidents"])
      ? (entry["incidents"] as JSONArray)
      : [];
    statuses.set(serviceName.toLowerCase(), {
      serviceId: String(entry["serviceId"] || ""),
      activeIncidentCount: Number(entry["activeIncidentCount"]) || 0,
      worstSeverityName: entry["worstSeverityName"]
        ? String(entry["worstSeverityName"])
        : null,
      worstSeverityColor: entry["worstSeverityColor"]
        ? String(entry["worstSeverityColor"])
        : null,
      incidents: rawIncidents.map((incidentRow: unknown) => {
        const incident: JSONObject = (incidentRow || {}) as JSONObject;
        return {
          incidentId: String(incident["incidentId"] || ""),
          title: String(incident["title"] || "Untitled incident"),
          severityName: incident["severityName"]
            ? String(incident["severityName"])
            : null,
          severityColor: incident["severityColor"]
            ? String(incident["severityColor"])
            : null,
        };
      }),
    });
  }

  return statuses;
}
