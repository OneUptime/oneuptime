import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { APP_API_URL } from "Common/UI/Config";

/*
 * Client for the Service Map's operational overlay: per-service active
 * incidents and alerts from POST /telemetry/service-operational-status,
 * keyed by lowercase service name (topology entity display names are
 * already lowercase). Best-effort — the map renders without the overlay
 * if the status call fails.
 */

export interface ServiceStatusItem {
  id: string;
  title: string;
  severityName: string | null;
  severityColor: string | null;
}

export interface ServiceOperationalStatus {
  serviceId: string;
  activeIncidentCount: number;
  worstIncidentSeverityName: string | null;
  worstIncidentSeverityColor: string | null;
  incidents: Array<ServiceStatusItem>;
  activeAlertCount: number;
  worstAlertSeverityName: string | null;
  worstAlertSeverityColor: string | null;
  alerts: Array<ServiceStatusItem>;
}

function parseItems(value: unknown): Array<ServiceStatusItem> {
  const rows: JSONArray = Array.isArray(value) ? (value as JSONArray) : [];
  return rows.map((row: unknown): ServiceStatusItem => {
    const item: JSONObject = (row || {}) as JSONObject;
    return {
      id: String(item["id"] || ""),
      title: String(item["title"] || "Untitled"),
      severityName: item["severityName"] ? String(item["severityName"]) : null,
      severityColor: item["severityColor"]
        ? String(item["severityColor"])
        : null,
    };
  });
}

export async function fetchServiceOperationalStatuses(
  serviceNames: Array<string>,
): Promise<Map<string, ServiceOperationalStatus>> {
  const statuses: Map<string, ServiceOperationalStatus> = new Map<
    string,
    ServiceOperationalStatus
  >();

  if (serviceNames.length === 0) {
    return statuses;
  }

  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    "/telemetry/service-operational-status",
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
    statuses.set(serviceName.toLowerCase(), {
      serviceId: String(entry["serviceId"] || ""),
      activeIncidentCount: Number(entry["activeIncidentCount"]) || 0,
      worstIncidentSeverityName: entry["worstIncidentSeverityName"]
        ? String(entry["worstIncidentSeverityName"])
        : null,
      worstIncidentSeverityColor: entry["worstIncidentSeverityColor"]
        ? String(entry["worstIncidentSeverityColor"])
        : null,
      incidents: parseItems(entry["incidents"]),
      activeAlertCount: Number(entry["activeAlertCount"]) || 0,
      worstAlertSeverityName: entry["worstAlertSeverityName"]
        ? String(entry["worstAlertSeverityName"])
        : null,
      worstAlertSeverityColor: entry["worstAlertSeverityColor"]
        ? String(entry["worstAlertSeverityColor"])
        : null,
      alerts: parseItems(entry["alerts"]),
    });
  }

  return statuses;
}
