/**
 * Helper Tools
 * Provides utility tools for agents to discover and understand OneUptime MCP capabilities
 */

import { McpToolInfo } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { sanitizeToolName } from "./SchemaConverter";
import { readOnlyToolAnnotations } from "./ToolAnnotations";
import { describeResource } from "./DescribeResource";

export const DESCRIBE_RESOURCE_TOOL_NAME: string =
  "oneuptime_describe_resource";

export interface ResourceInfo {
  name: string;
  singularName: string;
  pluralName: string;
  // What its tools are named by, when it differs (McpToolInfo).
  apiSingularName?: string | undefined;
  apiPluralName?: string | undefined;
  description: string;
  operations: string[];
  modelType: ModelType;
}

// The resources behind the tools generated for models.
function getResources(resourceTools: McpToolInfo[]): ResourceInfo[] {
  const resources: Map<string, ResourceInfo> = new Map();

  for (const tool of resourceTools) {
    if (!resources.has(tool.tableName)) {
      resources.set(tool.tableName, {
        name: tool.tableName,
        singularName: tool.singularName,
        pluralName: tool.pluralName,
        apiSingularName: tool.apiSingularName,
        apiPluralName: tool.apiPluralName,
        description: getResourceDescription(tool.singularName),
        operations: [],
        modelType: tool.modelType,
      });
    }
    const resource: ResourceInfo | undefined = resources.get(tool.tableName);
    if (resource) {
      resource.operations.push(tool.operation);
    }
  }

  return Array.from(resources.values());
}

/**
 * Generate helper tools for MCP
 */
export function generateHelperTools(): McpToolInfo[] {
  return [
    createHelpTool(),
    createResourceInfoTool(),
    createDescribeResourceTool(),
  ];
}

/*
 * What oneuptime_list_resources says a resource is, by its model's
 * singularName - the name it is looked up by. A key that is no model's
 * singularName is never shown: "Scheduled Maintenance" waited here unused
 * until #6817 named the model "Maintenance Event". HelperTools.test holds
 * every key to a model's name.
 */
export const RESOURCE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  Incident:
    "Represents service disruptions or issues affecting your systems. Track incident lifecycle from creation to resolution.",
  Monitor:
    "Defines what to monitor (websites, APIs, servers) and how to check their health and availability.",
  Alert:
    "Notifications triggered when monitors detect issues. Configures who gets notified and how.",
  "Status Page":
    "Public-facing page showing the status of your services to your customers.",
  "Maintenance Event":
    "Planned downtime events that inform users about expected service interruptions.",
  Team: "Groups of users with shared access to project resources.",
  "On-Call Policy":
    "Defines escalation rules and schedules for incident response.",
  "Incident State":
    "Represents the lifecycle states of incidents (e.g., Created, Acknowledged, Resolved).",
  "Monitor Status":
    "Represents the health states of monitors (e.g., Operational, Degraded, Offline).",
  "Incident Severity":
    "Severity levels for incidents (e.g., Critical, Major, Minor). List these to find the incidentSeverityId required by create_incident.",
  "Alert State":
    "Lifecycle states of alerts (e.g., Created, Acknowledged, Resolved).",
  "Alert Severity":
    "Severity levels for alerts. List these to find the alertSeverityId required by create_alert.",
  "Incident State Timeline":
    "History of state changes for incidents. Creating an entry changes the incident's state (this is how acknowledge/resolve work).",
  "Alert State Timeline":
    "History of state changes for alerts. Creating an entry changes the alert's state.",
  "Incident Public Note":
    "Status-page-visible notes on incidents, seen by customers and subscribers.",
  "Incident Internal Note":
    "Internal notes on incidents. Only the people who can see the incident can read them.",
  "Incident Alert":
    "Links an alert to an incident (many-to-many). Create one to link an alert to an incident, delete it to unlink. List these by incidentId to see an incident's linked alerts, or by alertId to see the incidents an alert is linked to.",
  "Alert Internal Note":
    "Internal notes on alerts. Only the people who can see the alert can read them.",
  "Status Page Announcement": "Announcements posted to your status pages.",
  "Scheduled Maintenance State":
    "Lifecycle states for maintenance events (e.g., Scheduled, Ongoing, Completed).",
  Label: "Labels for organizing and filtering project resources.",
  "Monitor Status Event":
    "History of monitor status changes — useful for investigating when a monitor went down or recovered.",
  Log: "OpenTelemetry log records from your services. Filter by time range and service.",
  Metric: "OpenTelemetry metrics from your services.",
  Span: "OpenTelemetry trace spans from your services.",
  "Exception Instance": "Application exceptions captured via telemetry.",
  "Monitor Log":
    "Raw probe results for monitors — explains why a monitor check passed or failed.",
};

function getResourceDescription(singularName: string): string {
  return (
    RESOURCE_DESCRIPTIONS[singularName] ||
    `Manages ${singularName} resources in OneUptime.`
  );
}

function createHelpTool(): McpToolInfo {
  return {
    name: "oneuptime_help",
    description: `Get help and guidance for using the OneUptime MCP server. Returns information about available resources and common operations. Use this tool first to understand what you can do with OneUptime.

COMMON WORKFLOWS:
1. Orient yourself: Use oneuptime_whoami to see your project, oneuptime_list_resources to see what you can work with
2. List incidents: Use list_incidents to see current incidents
3. Respond: Use acknowledge_incident / resolve_incident / add_incident_note
4. Investigate: Use list_logs, list_metrics, list_spans, list_monitor_logs (always with a time-range filter)
5. Create incident: Use list_incident_severities to get a severity ID, then create_incident
6. Filter or sort on a field: Use ${DESCRIBE_RESOURCE_TOOL_NAME} to see a resource's fields`,
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
    title: "OneUptime Help",
    annotations: readOnlyToolAnnotations(),
    modelName: "Help",
    operation: OneUptimeOperation.Read,
    modelType: ModelType.Database,
    singularName: "Help",
    pluralName: "Help",
    tableName: "Help",
    apiPath: "",
  };
}

function createResourceInfoTool(): McpToolInfo {
  return {
    name: "oneuptime_list_resources",
    description:
      "List all available OneUptime resources and their supported operations. Use this to discover what resources you can manage through the MCP server.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    title: "List OneUptime Resources",
    annotations: readOnlyToolAnnotations(),
    modelName: "ResourceInfo",
    operation: OneUptimeOperation.List,
    modelType: ModelType.Database,
    singularName: "Resource",
    pluralName: "Resources",
    tableName: "ResourceInfo",
    apiPath: "",
  };
}

function createDescribeResourceTool(): McpToolInfo {
  return {
    name: "oneuptime_describe_resource",
    description:
      "Get the fields of one OneUptime resource: what each means, and how to filter, sort and select on it. Use it before filtering or sorting a list_ or count_ tool, or to understand a field of a create_ or update_ tool.",
    inputSchema: {
      type: "object",
      properties: {
        resource: {
          type: "string",
          description:
            'The resource, or any of its tools. Examples: "Incident", "list_incidents".',
        },
      },
      required: ["resource"],
      additionalProperties: false,
    },
    title: "Describe OneUptime Resource",
    annotations: readOnlyToolAnnotations(),
    modelName: "ResourceDescription",
    operation: OneUptimeOperation.Read,
    modelType: ModelType.Database,
    singularName: "Resource Description",
    pluralName: "Resource Descriptions",
    tableName: "ResourceDescription",
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
  const resourceList: ResourceInfo[] = getResources(resourceTools);

  if (toolName === "oneuptime_help") {
    return handleHelpTool(args, resourceList);
  } else if (toolName === "oneuptime_list_resources") {
    return handleListResourcesTool(resourceList);
  } else if (toolName === DESCRIBE_RESOURCE_TOOL_NAME) {
    return handleDescribeResourceTool(args, resourceList);
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
          description:
            "Create a new incident. Requires incidentSeverityId — get one from list_incident_severities first. projectId is inferred from your API key.",
        },
        {
          tool: "acknowledge_incident / resolve_incident",
          description: "Move an incident through its lifecycle in one call",
        },
        {
          tool: "add_incident_note",
          description:
            "Add an internal note (only the people who can see the incident can read it) or a public note (on the status page) to an incident",
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
          incidentSeverityId: "<uuid from list_incident_severities>",
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
          name: "Respond to an incident",
          steps: [
            "1. Use acknowledge_incident to signal you are on it",
            "2. Investigate: list_monitor_logs for the failing monitor, list_logs / list_exceptions for the affected service (always filter by time range)",
            "3. Use add_incident_note (visibility: public) to post a status update",
            "4. Use resolve_incident once fixed",
          ],
        },
        {
          name: "Create and manage incident",
          steps: [
            "1. Use list_incident_severities to get a severity ID",
            "2. Use create_incident with title, description, and incidentSeverityId (projectId is inferred from your API key)",
            "3. Use acknowledge_incident / resolve_incident as the incident progresses",
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
          args: { limit: 10, sort: { createdAt: "DESC" } },
        },
        recentErrorLogs: {
          tool: "list_logs",
          args: {
            query: {
              time: { _type: "GreaterThan", value: "<ISO-8601 timestamp>" },
              severityText: "Error",
            },
            limit: 20,
            sort: { time: "DESC" },
          },
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
        acknowledgeIncident: {
          tool: "acknowledge_incident",
          args: { incidentId: "<incident-uuid>" },
        },
        postPublicUpdate: {
          tool: "add_incident_note",
          args: {
            incidentId: "<incident-uuid>",
            note: "We have identified the issue and are working on a fix.",
            visibility: "public",
          },
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
        "1. Use 'oneuptime_whoami' to see which project your API key belongs to",
        "2. Use 'oneuptime_list_resources' to see all available resources",
        "3. Use 'list_*' tools to browse existing data",
        `4. Use '${DESCRIBE_RESOURCE_TOOL_NAME}' to see a resource's fields before filtering or sorting`,
        "5. Use 'acknowledge_incident', 'resolve_incident', 'add_incident_note' for incident response",
        "6. Use 'list_logs', 'list_metrics', 'list_spans' to investigate telemetry (always filter by time range)",
      ];
      (response["data"] as Record<string, unknown>)["resourceCount"] =
        resourceList.length;
      break;
  }

  return JSON.stringify(response, null, 2);
}

// A resource's tools by operation.
function getResourceTools(resource: ResourceInfo): Record<string, string> {
  // Tool names must match ToolGenerator exactly — always sanitize
  const singular: string = sanitizeToolName(
    resource.apiSingularName || resource.singularName,
  );
  const plural: string = sanitizeToolName(
    resource.apiPluralName || resource.pluralName,
  );
  const operations: string[] = resource.operations;

  const tools: Record<string, string> = {};
  if (operations.includes(OneUptimeOperation.Create)) {
    tools["create"] = `create_${singular}`;
  }
  if (operations.includes(OneUptimeOperation.Read)) {
    tools["get"] = `get_${singular}`;
  }
  if (operations.includes(OneUptimeOperation.List)) {
    tools["list"] = `list_${plural}`;
  }
  if (operations.includes(OneUptimeOperation.Update)) {
    tools["update"] = `update_${singular}`;
  }
  if (operations.includes(OneUptimeOperation.Delete)) {
    tools["delete"] = `delete_${singular}`;
  }
  if (operations.includes(OneUptimeOperation.Count)) {
    tools["count"] = `count_${plural}`;
  }

  return tools;
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
        tools: getResourceTools(r),
      };
    }),
  };

  return JSON.stringify(response, null, 2);
}

// A resource by its name, in any form, or by the name of one of its tools.
function findResource(
  name: string,
  resources: ResourceInfo[],
): ResourceInfo | undefined {
  const wanted: string = sanitizeToolName(name);

  return resources.find((resource: ResourceInfo): boolean => {
    return (
      [
        resource.name,
        resource.singularName,
        resource.pluralName,
        // A renamed resource is found by the names it had, too.
        resource.apiSingularName || "",
        resource.apiPluralName || "",
      ]
        .filter(Boolean)
        .map(sanitizeToolName)
        .includes(wanted) ||
      Object.values(getResourceTools(resource)).includes(wanted)
    );
  });
}

function handleDescribeResourceTool(
  args: Record<string, unknown>,
  resources: ResourceInfo[],
): string {
  const name: unknown = args["resource"];
  const resource: ResourceInfo | undefined =
    typeof name === "string" ? findResource(name, resources) : undefined;

  if (!resource) {
    // Thrown, so the agent reads it as a failed call: see handleCallTool.
    throw new Error(
      `Unknown resource ${JSON.stringify(name)}. Use oneuptime_list_resources to see the resources.`,
    );
  }

  return describeResource({
    name: resource.name,
    singularName: resource.singularName,
    modelType: resource.modelType,
    tools: getResourceTools(resource),
  });
}

/**
 * Check if a tool is a helper tool (doesn't require API key)
 */
export function isHelperTool(toolName: string): boolean {
  return (
    toolName === "oneuptime_help" ||
    toolName === "oneuptime_list_resources" ||
    toolName === DESCRIBE_RESOURCE_TOOL_NAME
  );
}

/**
 * Check if a tool doesn't require API key (helper or public status page tool)
 */
export function isPublicTool(toolName: string): boolean {
  // Import check is done in ToolHandler to avoid circular dependencies
  return isHelperTool(toolName);
}
