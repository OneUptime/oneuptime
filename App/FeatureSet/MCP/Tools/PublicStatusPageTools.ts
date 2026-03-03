/**
 * Public Status Page Tools
 * Provides tools for querying public status pages without authentication
 * These tools can be used with either a status page ID or domain name
 */

import { McpToolInfo, JSONSchema } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import MCPLogger from "../Utils/MCPLogger";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import Headers from "Common/Types/API/Headers";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { getApiUrl } from "../Config/ServerConfig";

// Common input schema for status page identifier
const statusPageIdentifierSchema: JSONSchema = {
  type: "object",
  properties: {
    statusPageIdOrDomain: {
      type: "string",
      description:
        "The status page ID (UUID) or domain name (e.g., 'status.company.com'). Use domain for public status pages with custom domains.",
    },
  },
  required: ["statusPageIdOrDomain"],
  additionalProperties: false,
};

/**
 * Generate public status page tools
 */
export function generatePublicStatusPageTools(): McpToolInfo[] {
  return [
    createGetOverviewTool(),
    createGetIncidentsTool(),
    createGetScheduledMaintenanceTool(),
    createGetAnnouncementsTool(),
  ];
}

function createGetOverviewTool(): McpToolInfo {
  return {
    name: "get_public_status_page_overview",
    description: `Get the complete overview of a public status page including current status, resources, active incidents, scheduled maintenance, and announcements.

This tool does NOT require an API key and works with public status pages.

USAGE:
- By domain: statusPageIdOrDomain = "status.company.com"
- By ID: statusPageIdOrDomain = "550e8400-e29b-41d4-a716-446655440000"

RETURNS:
- Status page metadata (name, description, branding)
- Resources and their current status
- Active incidents
- Upcoming scheduled maintenance
- Active announcements
- Monitor status history`,
    inputSchema: statusPageIdentifierSchema,
    modelName: "StatusPageOverview",
    operation: OneUptimeOperation.Read,
    modelType: ModelType.Database,
    singularName: "Status Page Overview",
    pluralName: "Status Page Overviews",
    tableName: "StatusPageOverview",
    apiPath: "/status-page",
  };
}

function createGetIncidentsTool(): McpToolInfo {
  return {
    name: "get_public_status_page_incidents",
    description: `Get incidents from a public status page.

This tool does NOT require an API key and works with public status pages.

USAGE:
- By domain: statusPageIdOrDomain = "status.company.com"
- By ID: statusPageIdOrDomain = "550e8400-e29b-41d4-a716-446655440000"

RETURNS:
- List of incidents (active and recent history)
- Incident details (title, description, severity)
- Incident timeline and state changes
- Public notes/updates for each incident`,
    inputSchema: {
      type: "object",
      properties: {
        statusPageIdOrDomain: {
          type: "string",
          description:
            "The status page ID (UUID) or domain name (e.g., 'status.company.com')",
        },
        incidentId: {
          type: "string",
          description: "Optional: Specific incident ID to fetch details for",
        },
      },
      required: ["statusPageIdOrDomain"],
      additionalProperties: false,
    },
    modelName: "StatusPageIncidents",
    operation: OneUptimeOperation.List,
    modelType: ModelType.Database,
    singularName: "Status Page Incident",
    pluralName: "Status Page Incidents",
    tableName: "StatusPageIncidents",
    apiPath: "/status-page",
  };
}

function createGetScheduledMaintenanceTool(): McpToolInfo {
  return {
    name: "get_public_status_page_scheduled_maintenance",
    description: `Get scheduled maintenance events from a public status page.

This tool does NOT require an API key and works with public status pages.

USAGE:
- By domain: statusPageIdOrDomain = "status.company.com"
- By ID: statusPageIdOrDomain = "550e8400-e29b-41d4-a716-446655440000"

RETURNS:
- List of scheduled maintenance events (upcoming and ongoing)
- Maintenance details (title, description, scheduled times)
- Maintenance timeline and state changes
- Public notes/updates for each maintenance event`,
    inputSchema: {
      type: "object",
      properties: {
        statusPageIdOrDomain: {
          type: "string",
          description:
            "The status page ID (UUID) or domain name (e.g., 'status.company.com')",
        },
        scheduledMaintenanceId: {
          type: "string",
          description:
            "Optional: Specific scheduled maintenance ID to fetch details for",
        },
      },
      required: ["statusPageIdOrDomain"],
      additionalProperties: false,
    },
    modelName: "StatusPageScheduledMaintenance",
    operation: OneUptimeOperation.List,
    modelType: ModelType.Database,
    singularName: "Status Page Scheduled Maintenance",
    pluralName: "Status Page Scheduled Maintenances",
    tableName: "StatusPageScheduledMaintenance",
    apiPath: "/status-page",
  };
}

function createGetAnnouncementsTool(): McpToolInfo {
  return {
    name: "get_public_status_page_announcements",
    description: `Get announcements from a public status page.

This tool does NOT require an API key and works with public status pages.

USAGE:
- By domain: statusPageIdOrDomain = "status.company.com"
- By ID: statusPageIdOrDomain = "550e8400-e29b-41d4-a716-446655440000"

RETURNS:
- List of active announcements
- Announcement details (title, description, dates)`,
    inputSchema: {
      type: "object",
      properties: {
        statusPageIdOrDomain: {
          type: "string",
          description:
            "The status page ID (UUID) or domain name (e.g., 'status.company.com')",
        },
        announcementId: {
          type: "string",
          description:
            "Optional: Specific announcement ID to fetch details for",
        },
      },
      required: ["statusPageIdOrDomain"],
      additionalProperties: false,
    },
    modelName: "StatusPageAnnouncements",
    operation: OneUptimeOperation.List,
    modelType: ModelType.Database,
    singularName: "Status Page Announcement",
    pluralName: "Status Page Announcements",
    tableName: "StatusPageAnnouncements",
    apiPath: "/status-page",
  };
}

/**
 * Check if a tool is a public status page tool
 */
export function isPublicStatusPageTool(toolName: string): boolean {
  return (
    toolName === "get_public_status_page_overview" ||
    toolName === "get_public_status_page_incidents" ||
    toolName === "get_public_status_page_scheduled_maintenance" ||
    toolName === "get_public_status_page_announcements"
  );
}

/**
 * Handle public status page tool execution
 */
export async function handlePublicStatusPageTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const statusPageIdOrDomain: string = args["statusPageIdOrDomain"] as string;

  if (!statusPageIdOrDomain) {
    return JSON.stringify({
      success: false,
      error: "statusPageIdOrDomain is required",
    });
  }

  try {
    switch (toolName) {
      case "get_public_status_page_overview":
        return await getStatusPageOverview(statusPageIdOrDomain);

      case "get_public_status_page_incidents":
        return await getStatusPageIncidents(
          statusPageIdOrDomain,
          args["incidentId"] as string | undefined,
        );

      case "get_public_status_page_scheduled_maintenance":
        return await getStatusPageScheduledMaintenance(
          statusPageIdOrDomain,
          args["scheduledMaintenanceId"] as string | undefined,
        );

      case "get_public_status_page_announcements":
        return await getStatusPageAnnouncements(
          statusPageIdOrDomain,
          args["announcementId"] as string | undefined,
        );

      default:
        return JSON.stringify({
          success: false,
          error: `Unknown public status page tool: ${toolName}`,
        });
    }
  } catch (error) {
    MCPLogger.error(
      `Error executing public status page tool ${toolName}: ${error}`,
    );
    return JSON.stringify({
      success: false,
      error: `Failed to execute ${toolName}: ${error}`,
    });
  }
}

/**
 * Get status page overview
 * The backend now accepts both statusPageId and domain directly
 */
async function getStatusPageOverview(
  statusPageIdOrDomain: string,
): Promise<string> {
  const response: JSONObject = await makeStatusPageApiRequest(
    "POST",
    `/api/status-page/overview/${statusPageIdOrDomain}`,
  );

  return JSON.stringify(
    {
      success: true,
      operation: "get_overview",
      statusPageIdOrDomain,
      data: response,
    },
    null,
    2,
  );
}

/**
 * Get status page incidents
 * The backend now accepts both statusPageId and domain directly
 */
async function getStatusPageIncidents(
  statusPageIdOrDomain: string,
  incidentId?: string,
): Promise<string> {
  let route: string = `/api/status-page/incidents/${statusPageIdOrDomain}`;
  if (incidentId) {
    route = `/api/status-page/incidents/${statusPageIdOrDomain}/${incidentId}`;
  }

  const response: JSONObject = await makeStatusPageApiRequest("POST", route);

  return JSON.stringify(
    {
      success: true,
      operation: "get_incidents",
      statusPageIdOrDomain,
      incidentId: incidentId || null,
      data: response,
    },
    null,
    2,
  );
}

/**
 * Get status page scheduled maintenance events
 * The backend now accepts both statusPageId and domain directly
 */
async function getStatusPageScheduledMaintenance(
  statusPageIdOrDomain: string,
  scheduledMaintenanceId?: string,
): Promise<string> {
  let route: string = `/api/status-page/scheduled-maintenance-events/${statusPageIdOrDomain}`;
  if (scheduledMaintenanceId) {
    route = `/api/status-page/scheduled-maintenance-events/${statusPageIdOrDomain}/${scheduledMaintenanceId}`;
  }

  const response: JSONObject = await makeStatusPageApiRequest("POST", route);

  return JSON.stringify(
    {
      success: true,
      operation: "get_scheduled_maintenance",
      statusPageIdOrDomain,
      scheduledMaintenanceId: scheduledMaintenanceId || null,
      data: response,
    },
    null,
    2,
  );
}

/**
 * Get status page announcements
 * The backend now accepts both statusPageId and domain directly
 */
async function getStatusPageAnnouncements(
  statusPageIdOrDomain: string,
  announcementId?: string,
): Promise<string> {
  let route: string = `/api/status-page/announcements/${statusPageIdOrDomain}`;
  if (announcementId) {
    route = `/api/status-page/announcements/${statusPageIdOrDomain}/${announcementId}`;
  }

  const response: JSONObject = await makeStatusPageApiRequest("POST", route);

  return JSON.stringify(
    {
      success: true,
      operation: "get_announcements",
      statusPageIdOrDomain,
      announcementId: announcementId || null,
      data: response,
    },
    null,
    2,
  );
}

/**
 * Make a request to the StatusPage API
 */
async function makeStatusPageApiRequest(
  method: "GET" | "POST",
  path: string,
  data?: JSONObject,
): Promise<JSONObject> {
  const apiUrl: string = getApiUrl();
  const url: URL = URL.fromString(apiUrl);
  const route: Route = new Route(path);
  const fullUrl: URL = new URL(url.protocol, url.hostname, route);

  const headers: Headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  MCPLogger.info(`Making ${method} request to ${fullUrl.toString()}`);

  let response: HTTPResponse<JSONObject> | HTTPErrorResponse;

  if (method === "GET") {
    response = await API.get({ url: fullUrl, headers });
  } else {
    response = await API.post({ url: fullUrl, headers, data: data || {} });
  }

  if (response instanceof HTTPErrorResponse) {
    MCPLogger.error(
      `API request failed: ${response.statusCode} - ${response.message}`,
    );
    throw new Error(
      `API request failed: ${response.statusCode} - ${response.message}`,
    );
  }

  return response.data as JSONObject;
}
