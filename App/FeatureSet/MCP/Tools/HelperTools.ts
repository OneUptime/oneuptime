/**
 * Helper Tools
 * Provides utility tools for agents to discover and understand OneUptime MCP capabilities
 */

import { McpToolInfo } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";

export interface ResourceInfo {
  name: string;
  singularName: string;
  pluralName: string;
  description: string;
  operations: string[];
}

/**
 * Generate helper tools for MCP
 */
export function generateHelperTools(
  resourceTools: McpToolInfo[],
): McpToolInfo[] {
  // Extract unique resources from tools
  const resources: Map<string, ResourceInfo> = new Map();

  for (const tool of resourceTools) {
    if (!resources.has(tool.tableName)) {
      resources.set(tool.tableName, {
        name: tool.tableName,
        singularName: tool.singularName,
        pluralName: tool.pluralName,
        description: getResourceDescription(tool.singularName),
        operations: [],
      });
    }
    const resource: ResourceInfo | undefined = resources.get(tool.tableName);
    if (resource) {
      resource.operations.push(tool.operation);
    }
  }

  const resourceList: ResourceInfo[] = Array.from(resources.values());

  return [createHelpTool(resourceList), createResourceInfoTool(resourceList)];
}

function getResourceDescription(singularName: string): string {
  const descriptions: Record<string, string> = {
    Incident:
      "Represents service disruptions or issues affecting your systems. Track incident lifecycle from creation to resolution.",
    Monitor:
      "Defines what to monitor (websites, APIs, servers) and how to check their health and availability.",
    Alert:
      "Notifications triggered when monitors detect issues. Configures who gets notified and how.",
    Project:
      "Top-level container for all your monitoring resources. Organizes monitors, incidents, and team members.",
    "Status Page":
      "Public-facing page showing the status of your services to your customers.",
    "Scheduled Maintenance":
      "Planned downtime events that inform users about expected service interruptions.",
    Team: "Groups of users with shared access to project resources.",
    "On-Call Duty Policy":
      "Defines escalation rules and schedules for incident response.",
    "Incident State":
      "Represents the lifecycle states of incidents (e.g., Created, Acknowledged, Resolved).",
    "Monitor Status":
      "Represents the health states of monitors (e.g., Operational, Degraded, Offline).",
  };

  return (
    descriptions[singularName] ||
    `Manages ${singularName} resources in OneUptime.`
  );
}

function createHelpTool(resources: ResourceInfo[]): McpToolInfo {
  const resourceSummary: string = resources
    .map((r: ResourceInfo) => {
      return `- ${r.pluralName}: ${r.description}`;
    })
    .join("\n");

  return {
    name: "oneuptime_help",
    description: `Get help and guidance for using the OneUptime MCP server. Returns information about available resources and common operations. Use this tool first to understand what you can do with OneUptime.

AVAILABLE RESOURCES:
${resourceSummary}

COMMON WORKFLOWS:
1. List incidents: Use list_incidents to see current incidents
2. Create incident: Use create_incident with title and severity
3. Check monitor status: Use list_monitors to see all monitors and their status
4. Count resources: Use count_* tools to get totals without fetching all data`,
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "Optional topic to get help on: 'resources', 'incidents', 'monitors', 'alerts', 'workflows', or 'examples'",
          enum: [
            "resources",
            "incidents",
            "monitors",
            "alerts",
            "workflows",
            "examples",
          ],
        },
      },
      additionalProperties: false,
    },
    modelName: "Help",
    operation: OneUptimeOperation.Read,
    modelType: ModelType.Database,
    singularName: "Help",
    pluralName: "Help",
    tableName: "Help",
    apiPath: "",
  };
}

function createResourceInfoTool(_resources: ResourceInfo[]): McpToolInfo {
  return {
    name: "oneuptime_list_resources",
    description:
      "List all available OneUptime resources and their supported operations. Use this to discover what resources you can manage through the MCP server.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    modelName: "ResourceInfo",
    operation: OneUptimeOperation.List,
    modelType: ModelType.Database,
    singularName: "Resource",
    pluralName: "Resources",
    tableName: "ResourceInfo",
    apiPath: "",
  };
}

/**
 * Handle helper tool execution
 */
export function handleHelperTool(
  toolName: string,
  args: Record<string, unknown>,
  resourceTools: McpToolInfo[],
): string {
  // Extract unique resources from tools
  const resources: Map<string, ResourceInfo> = new Map();

  for (const tool of resourceTools) {
    if (!resources.has(tool.tableName)) {
      resources.set(tool.tableName, {
        name: tool.tableName,
        singularName: tool.singularName,
        pluralName: tool.pluralName,
        description: getResourceDescription(tool.singularName),
        operations: [],
      });
    }
    const resource: ResourceInfo | undefined = resources.get(tool.tableName);
    if (resource) {
      resource.operations.push(tool.operation);
    }
  }

  const resourceList: ResourceInfo[] = Array.from(resources.values());

  if (toolName === "oneuptime_help") {
    return handleHelpTool(args, resourceList);
  } else if (toolName === "oneuptime_list_resources") {
    return handleListResourcesTool(resourceList);
  }

  return JSON.stringify({ error: "Unknown helper tool" });
}

function handleHelpTool(
  args: Record<string, unknown>,
  resourceList: ResourceInfo[],
): string {
  const topic: string = (args["topic"] as string) || "general";

  const response: Record<string, unknown> = {
    success: true,
    topic,
    data: {} as Record<string, unknown>,
  };

  switch (topic) {
    case "resources":
      (response["data"] as Record<string, unknown>)["resources"] =
        resourceList.map((r: ResourceInfo) => {
          return {
            name: r.name,
            singularName: r.singularName,
            pluralName: r.pluralName,
            description: r.description,
            availableOperations: r.operations,
          };
        });
      (response["data"] as Record<string, unknown>)["hint"] =
        "Use the specific tool for each operation. For example: list_incidents, create_incident, get_incident, update_incident, delete_incident, count_incidents";
      break;

    case "incidents":
      (response["data"] as Record<string, unknown>)["description"] =
        "Incidents represent service disruptions or issues. They have states (Created, Acknowledged, Resolved) and severities.";
      (response["data"] as Record<string, unknown>)["commonOperations"] = [
        {
          tool: "list_incidents",
          description:
            "List all incidents, optionally filtered by state or severity",
        },
        {
          tool: "create_incident",
          description: "Create a new incident when an issue is detected",
        },
        {
          tool: "update_incident",
          description: "Update incident state, severity, or add notes",
        },
        {
          tool: "count_incidents",
          description: "Get count of incidents by state",
        },
      ];
      (response["data"] as Record<string, unknown>)["example"] = {
        createIncident: {
          title: "Database connection failure",
          description: "Production database is not responding to queries",
          incidentSeverityId: "<severity-uuid>",
        },
      };
      break;

    case "monitors":
      (response["data"] as Record<string, unknown>)["description"] =
        "Monitors check the health and availability of your services (websites, APIs, servers).";
      (response["data"] as Record<string, unknown>)["commonOperations"] = [
        {
          tool: "list_monitors",
          description: "List all monitors and their current status",
        },
        {
          tool: "create_monitor",
          description: "Create a new monitor to watch a service",
        },
        {
          tool: "update_monitor",
          description: "Update monitor configuration or enable/disable",
        },
        { tool: "count_monitors", description: "Get total number of monitors" },
      ];
      break;

    case "alerts":
      (response["data"] as Record<string, unknown>)["description"] =
        "Alerts are notifications sent when monitors detect issues.";
      (response["data"] as Record<string, unknown>)["commonOperations"] = [
        {
          tool: "list_alerts",
          description: "List all alerts and their status",
        },
        { tool: "count_alerts", description: "Get count of alerts" },
      ];
      break;

    case "workflows":
      (response["data"] as Record<string, unknown>)["workflows"] = [
        {
          name: "Check system status",
          steps: [
            "1. Use count_incidents to see if there are active incidents",
            "2. Use list_monitors with query to find any monitors with issues",
            "3. Use list_incidents to get details of any active incidents",
          ],
        },
        {
          name: "Create and manage incident",
          steps: [
            "1. Use list_incident_states to get available states",
            "2. Use create_incident with title, description, and severity",
            "3. Use update_incident to change state as incident progresses",
          ],
        },
        {
          name: "Incident summary report",
          steps: [
            "1. Use count_incidents to get total count",
            "2. Use list_incidents with sort by createdAt descending",
            "3. Group and summarize the results",
          ],
        },
      ];
      break;

    case "examples":
      (response["data"] as Record<string, unknown>)["examples"] = {
        listRecentIncidents: {
          tool: "list_incidents",
          args: { limit: 10, sort: { createdAt: -1 } },
        },
        countActiveIncidents: {
          tool: "count_incidents",
          args: { query: {} },
        },
        getSpecificIncident: {
          tool: "get_incident",
          args: { id: "<incident-uuid>" },
        },
        updateIncidentTitle: {
          tool: "update_incident",
          args: { id: "<incident-uuid>", title: "Updated title" },
        },
      };
      break;

    default:
      (response["data"] as Record<string, unknown>)["welcome"] =
        "Welcome to OneUptime MCP Server!";
      (response["data"] as Record<string, unknown>)["description"] =
        "OneUptime is an open-source monitoring platform. This MCP server lets you manage incidents, monitors, alerts, and more.";
      (response["data"] as Record<string, unknown>)["availableTopics"] = [
        "resources",
        "incidents",
        "monitors",
        "alerts",
        "workflows",
        "examples",
      ];
      (response["data"] as Record<string, unknown>)["quickStart"] = [
        "1. Use 'oneuptime_list_resources' to see all available resources",
        "2. Use 'list_*' tools to browse existing data",
        "3. Use 'count_*' tools to get quick summaries",
        "4. Use 'create_*' tools to add new items",
      ];
      (response["data"] as Record<string, unknown>)["resourceCount"] =
        resourceList.length;
      break;
  }

  return JSON.stringify(response, null, 2);
}

function handleListResourcesTool(resources: ResourceInfo[]): string {
  const response: Record<string, unknown> = {
    success: true,
    totalResources: resources.length,
    resources: resources.map((r: ResourceInfo) => {
      return {
        name: r.name,
        singularName: r.singularName,
        pluralName: r.pluralName,
        description: r.description,
        operations: r.operations,
        tools: {
          create: `create_${r.singularName.toLowerCase().replace(/\s+/g, "_")}`,
          get: `get_${r.singularName.toLowerCase().replace(/\s+/g, "_")}`,
          list: `list_${r.pluralName.toLowerCase().replace(/\s+/g, "_")}`,
          update: `update_${r.singularName.toLowerCase().replace(/\s+/g, "_")}`,
          delete: `delete_${r.singularName.toLowerCase().replace(/\s+/g, "_")}`,
          count: `count_${r.pluralName.toLowerCase().replace(/\s+/g, "_")}`,
        },
      };
    }),
  };

  return JSON.stringify(response, null, 2);
}

/**
 * Check if a tool is a helper tool (doesn't require API key)
 */
export function isHelperTool(toolName: string): boolean {
  return (
    toolName === "oneuptime_help" || toolName === "oneuptime_list_resources"
  );
}

/**
 * Check if a tool doesn't require API key (helper or public status page tool)
 */
export function isPublicTool(toolName: string): boolean {
  // Import check is done in ToolHandler to avoid circular dependencies
  return isHelperTool(toolName);
}
