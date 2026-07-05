/**
 * Workflow Tools
 * Hand-written tools that encapsulate common incident-response workflows so
 * agents do not need insider knowledge of OneUptime's data model (e.g. that
 * resolving an incident means creating an IncidentStateTimeline row pointing
 * at the project's "Resolved" state).
 */

import { McpToolInfo, JSONSchema } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject, JSONArray } from "Common/Types/JSON";

type StateFlag = "isAcknowledgedState" | "isResolvedState";

interface WorkflowToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JSONSchema;
  readOnly: boolean;
}

const WORKFLOW_TOOL_DEFINITIONS: WorkflowToolDefinition[] = [
  {
    name: "acknowledge_incident",
    title: "Acknowledge Incident",
    description:
      "Acknowledge an incident: marks it as being worked on by moving it to the project's 'Acknowledged' state. Equivalent to pressing 'Acknowledge' in the OneUptime dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        incidentId: {
          type: "string",
          description:
            "UUID of the incident to acknowledge. Use list_incidents to find it.",
        },
      },
      required: ["incidentId"],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: "resolve_incident",
    title: "Resolve Incident",
    description:
      "Resolve an incident: moves it to the project's 'Resolved' state. Equivalent to pressing 'Resolve' in the OneUptime dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        incidentId: {
          type: "string",
          description:
            "UUID of the incident to resolve. Use list_incidents to find it.",
        },
      },
      required: ["incidentId"],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: "acknowledge_alert",
    title: "Acknowledge Alert",
    description:
      "Acknowledge an alert: marks it as being worked on by moving it to the project's 'Acknowledged' state.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: {
          type: "string",
          description:
            "UUID of the alert to acknowledge. Use list_alerts to find it.",
        },
      },
      required: ["alertId"],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: "resolve_alert",
    title: "Resolve Alert",
    description:
      "Resolve an alert: moves it to the project's 'Resolved' state.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: {
          type: "string",
          description:
            "UUID of the alert to resolve. Use list_alerts to find it.",
        },
      },
      required: ["alertId"],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: "add_incident_note",
    title: "Add Incident Note",
    description:
      "Add a note to an incident. Internal notes are visible to your team only; public notes are posted to the status page for subscribers/customers. Markdown is supported.",
    inputSchema: {
      type: "object",
      properties: {
        incidentId: {
          type: "string",
          description: "UUID of the incident to annotate.",
        },
        note: {
          type: "string",
          description: "The note content (Markdown supported).",
        },
        visibility: {
          type: "string",
          enum: ["internal", "public"],
          description:
            "Where the note is visible: 'internal' (team only, default) or 'public' (posted to the status page).",
          default: "internal",
        },
      },
      required: ["incidentId", "note"],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: "add_alert_note",
    title: "Add Alert Note",
    description:
      "Add an internal note to an alert, visible to your team. Markdown is supported.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: {
          type: "string",
          description: "UUID of the alert to annotate.",
        },
        note: {
          type: "string",
          description: "The note content (Markdown supported).",
        },
      },
      required: ["alertId", "note"],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: "oneuptime_whoami",
    title: "Who Am I",
    description:
      "Get the project your API key belongs to (ID and name). Call this first to understand your context. Note: create tools infer projectId from the API key automatically, so you never need to pass it.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    readOnly: true,
  },
];

/**
 * Generate workflow tools
 */
export function generateWorkflowTools(): McpToolInfo[] {
  return WORKFLOW_TOOL_DEFINITIONS.map(
    (definition: WorkflowToolDefinition): McpToolInfo => {
      return {
        name: definition.name,
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.readOnly
          ? { readOnlyHint: true }
          : { readOnlyHint: false, destructiveHint: false },
        modelName: "Workflow",
        operation: definition.readOnly
          ? OneUptimeOperation.Read
          : OneUptimeOperation.Create,
        modelType: ModelType.Database,
        singularName: definition.title,
        pluralName: definition.title,
        tableName: "Workflow",
        apiPath: "",
      };
    },
  );
}

/**
 * Check if a tool is a workflow tool (requires an API key)
 */
export function isWorkflowTool(toolName: string): boolean {
  return WORKFLOW_TOOL_DEFINITIONS.some(
    (definition: WorkflowToolDefinition) => {
      return definition.name === toolName;
    },
  );
}

/**
 * Handle workflow tool execution. Returns a response envelope object;
 * errors are thrown and surfaced by the caller as isError tool results.
 */
export async function handleWorkflowTool(
  toolName: string,
  args: Record<string, unknown>,
  apiKey: string,
): Promise<JSONObject> {
  switch (toolName) {
    case "acknowledge_incident":
      return changeState({
        kind: "incident",
        id: requireUuid(args, "incidentId"),
        flag: "isAcknowledgedState",
        apiKey,
      });
    case "resolve_incident":
      return changeState({
        kind: "incident",
        id: requireUuid(args, "incidentId"),
        flag: "isResolvedState",
        apiKey,
      });
    case "acknowledge_alert":
      return changeState({
        kind: "alert",
        id: requireUuid(args, "alertId"),
        flag: "isAcknowledgedState",
        apiKey,
      });
    case "resolve_alert":
      return changeState({
        kind: "alert",
        id: requireUuid(args, "alertId"),
        flag: "isResolvedState",
        apiKey,
      });
    case "add_incident_note":
      return addIncidentNote(args, apiKey);
    case "add_alert_note":
      return addAlertNote(args, apiKey);
    case "oneuptime_whoami":
      return whoami(apiKey);
    default:
      throw new Error(`Unknown workflow tool: ${toolName}`);
  }
}

function requireUuid(args: Record<string, unknown>, key: string): string {
  const value: unknown = args[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`'${key}' is required.`);
  }
  if (!ObjectID.isValidUUID(value)) {
    throw new Error(
      `'${key}' must be a UUID like "550e8400-e29b-41d4-a716-446655440000". Use the corresponding list tool to find valid IDs.`,
    );
  }
  return value;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value: unknown = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`'${key}' is required.`);
  }
  return value;
}

/**
 * Look up the project's state row (e.g. Acknowledged / Resolved) for
 * incidents or alerts.
 */
async function findStateId(data: {
  kind: "incident" | "alert";
  flag: StateFlag;
  apiKey: string;
}): Promise<{ stateId: string; stateName: string }> {
  const statePath: string =
    data.kind === "incident" ? "/incident-state" : "/alert-state";

  const response: unknown = await OneUptimeApiService.makeAuthenticatedApiCall({
    method: "POST",
    path: `/api${statePath}/get-list`,
    body: {
      query: { [data.flag]: true },
      select: { _id: true, name: true },
      skip: 0,
      limit: 1,
    } as JSONObject,
    apiKey: data.apiKey,
  });

  const rows: JSONArray =
    ((response as JSONObject)?.["data"] as JSONArray) || [];
  const firstRow: JSONObject | undefined = rows[0] as JSONObject | undefined;

  if (!firstRow || !firstRow["_id"]) {
    const friendlyFlag: string =
      data.flag === "isAcknowledgedState" ? "Acknowledged" : "Resolved";
    throw new Error(
      `Could not find the project's '${friendlyFlag}' ${data.kind} state. The API key may lack permission to read ${data.kind} states.`,
    );
  }

  return {
    stateId: firstRow["_id"] as string,
    stateName: (firstRow["name"] as string) || "",
  };
}

/**
 * Acknowledge/resolve an incident or alert by creating a state timeline
 * entry — the same thing the OneUptime dashboard does.
 */
async function changeState(data: {
  kind: "incident" | "alert";
  id: string;
  flag: StateFlag;
  apiKey: string;
}): Promise<JSONObject> {
  const { stateId, stateName } = await findStateId({
    kind: data.kind,
    flag: data.flag,
    apiKey: data.apiKey,
  });

  const timelinePath: string =
    data.kind === "incident"
      ? "/incident-state-timeline"
      : "/alert-state-timeline";
  const idField: string = data.kind === "incident" ? "incidentId" : "alertId";
  const stateField: string =
    data.kind === "incident" ? "incidentStateId" : "alertStateId";

  await OneUptimeApiService.makeAuthenticatedApiCall({
    method: "POST",
    path: `/api${timelinePath}`,
    body: {
      data: {
        [idField]: data.id,
        [stateField]: stateId,
      },
    } as JSONObject,
    apiKey: data.apiKey,
  });

  return {
    success: true,
    operation: toolNameForState(data.kind, data.flag),
    [idField]: data.id,
    newState: stateName,
    message: `${data.kind === "incident" ? "Incident" : "Alert"} moved to state '${stateName}'.`,
  } as JSONObject;
}

function toolNameForState(kind: "incident" | "alert", flag: StateFlag): string {
  const verb: string =
    flag === "isAcknowledgedState" ? "acknowledge" : "resolve";
  return `${verb}_${kind}`;
}

async function addIncidentNote(
  args: Record<string, unknown>,
  apiKey: string,
): Promise<JSONObject> {
  const incidentId: string = requireUuid(args, "incidentId");
  const note: string = requireString(args, "note");
  const visibility: string =
    (args["visibility"] as string) === "public" ? "public" : "internal";

  const path: string =
    visibility === "public"
      ? "/api/incident-public-note"
      : "/api/incident-internal-note";

  const created: unknown = await OneUptimeApiService.makeAuthenticatedApiCall({
    method: "POST",
    path,
    body: {
      data: {
        incidentId,
        note,
      },
    } as JSONObject,
    apiKey,
  });

  return {
    success: true,
    operation: "add_incident_note",
    incidentId,
    visibility,
    noteId: ((created as JSONObject)?.["_id"] as string) || null,
    message:
      visibility === "public"
        ? "Public note posted — it is visible on the status page."
        : "Internal note added — visible to your team only.",
  } as JSONObject;
}

async function addAlertNote(
  args: Record<string, unknown>,
  apiKey: string,
): Promise<JSONObject> {
  const alertId: string = requireUuid(args, "alertId");
  const note: string = requireString(args, "note");

  const created: unknown = await OneUptimeApiService.makeAuthenticatedApiCall({
    method: "POST",
    path: "/api/alert-internal-note",
    body: {
      data: {
        alertId,
        note,
      },
    } as JSONObject,
    apiKey,
  });

  return {
    success: true,
    operation: "add_alert_note",
    alertId,
    noteId: ((created as JSONObject)?.["_id"] as string) || null,
    message: "Internal note added to the alert.",
  } as JSONObject;
}

/**
 * Return the project the API key is scoped to. Project is tenant-scoped by
 * _id, so a project-scoped key sees exactly its own project.
 */
async function whoami(apiKey: string): Promise<JSONObject> {
  const response: unknown = await OneUptimeApiService.makeAuthenticatedApiCall({
    method: "POST",
    path: "/api/project/get-list",
    body: {
      query: {},
      select: { _id: true, name: true },
      skip: 0,
      limit: 10,
    } as JSONObject,
    apiKey,
  });

  const rows: JSONArray =
    ((response as JSONObject)?.["data"] as JSONArray) || [];
  const projects: JSONArray = rows.map((row: unknown): JSONObject => {
    const projectRow: JSONObject = row as JSONObject;
    return {
      projectId: projectRow["_id"] || null,
      projectName: projectRow["name"] || null,
    };
  });

  return {
    success: true,
    operation: "oneuptime_whoami",
    projects,
    message:
      projects.length > 0
        ? "These are the project(s) your API key can access. projectId is inferred automatically on create operations."
        : "No project visible to this API key — it may lack read permission on Project.",
  } as JSONObject;
}
