/**
 * Move In List
 *
 * The tool that moves a row of an ordered list past others, as dragging it
 * in the dashboard does (issue #9651).
 *
 * Severities, states, monitor statuses, postmortem and security case
 * statuses and priorities are lists in order. Since #9573 and #9650 a write
 * of a row's number places that row and moves no other - what Terraform
 * needs - so an agent asked to "move severity X to the top" can no longer
 * write `order: 1` on X with an update_ tool and see the rest step down: X
 * only shares 1 with the row that holds it. Moving a row past others is a
 * request of its own, POST <list>/:id/move { placeOfId } (Common/Types/
 * Database/MoveInList), which the dashboard's drag sends: the row takes the
 * place of the row named, the rows between step one place towards where it
 * was, and the list is numbered from the top again.
 *
 * One tool for every list rather than one per resource: it is what the
 * dashboard's drag is, for every list alike, and tools/list stays small
 * (Tests/ToolListBudget). Its resources are the models the MCP server has
 * tools for whose rows can be moved (MoveInListUtil.getListColumn), read
 * off the models, so a list that gains MCP tools can be moved with it too.
 */

import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MoveInListUtil, {
  getMoveInListRoute,
} from "Common/Types/Database/MoveInList";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  getApiPluralName,
  getApiSingularName,
} from "Common/Utils/ModelApiName";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import { McpCredentialInput } from "../Types/McpCredential";
import { JSONSchema } from "../Types/McpTypes";
import { sanitizeToolName } from "./SchemaConverter";
import { requireUuid } from "./ToolArguments";
import { isPublishedTable } from "./ToolAnnotations";

export const MOVE_IN_LIST_TOOL_NAME: string = "oneuptime_move_in_list";

// A list whose rows the tool moves.
export interface MovableList {
  // The model's table: IncidentSeverity.
  tableName: string;
  // What the tool's `resource` names it by: "Incident Severity".
  singularName: string;
  // Its API path: /incident-severity.
  apiPath: string;
  // The column its rows are numbered by: order, priority, sortOrder.
  column: string;
  // Every name it is found by, as tool names are written.
  names: Array<string>;
}

// The tool, as WorkflowTools lists its tools.
export interface MoveInListToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JSONSchema;
  readOnly: false;
  // A move of a published list's rows changes what a status page shows.
  published: boolean;
}

/*
 * The names a resource is found by: its own, and its tools', which are
 * named by the names the API keeps (ToolGenerator's withKeptToolName).
 */
function namesOf(
  model: DatabaseBaseModel,
  singularName: string,
): Array<string> {
  const apiSingular: string = getApiSingularName(model);
  const apiPlural: string = getApiPluralName(model);

  return Array.from(
    new Set<string>([
      sanitizeToolName(model.tableName || ""),
      sanitizeToolName(singularName),
      sanitizeToolName(model.pluralName || ""),
      sanitizeToolName(apiSingular),
      sanitizeToolName(apiPlural),
      ...["create", "get", "update", "delete"].map((verb: string): string => {
        return `${verb}_${sanitizeToolName(apiSingular)}`;
      }),
      ...["list", "count"].map((verb: string): string => {
        return `${verb}_${sanitizeToolName(apiPlural)}`;
      }),
    ]),
  ).filter(Boolean);
}

let movableLists: Array<MovableList> | null = null;

/*
 * The lists the tool moves rows of: the models with MCP tools whose rows
 * make up an ordered list. Read once: the models do not change while the
 * process runs.
 */
export function getMovableLists(): Array<MovableList> {
  if (movableLists) {
    return movableLists;
  }

  const lists: Array<MovableList> = [];

  for (const ModelClass of DatabaseModels) {
    const model: DatabaseBaseModel = new ModelClass();
    const column: string | null = MoveInListUtil.getListColumn(model);
    const apiPath: string | undefined = model.crudApiPath?.toString();

    if (!model.tableName || !model.enableMCP || !apiPath || !column) {
      continue;
    }

    const singularName: string = model.singularName || model.tableName;

    lists.push({
      tableName: model.tableName,
      singularName: singularName,
      apiPath: apiPath,
      column: column,
      names: namesOf(model, singularName),
    });
  }

  movableLists = lists;

  return lists;
}

/*
 * The list a `resource` names: by its name or one of its tools', in any
 * case or spacing ("Incident Severity", "incident_severity",
 * "list_incident_severities"). Undefined for anything else.
 */
export function findMovableList(resource: unknown): MovableList | undefined {
  if (typeof resource !== "string" || !resource.trim()) {
    return undefined;
  }

  const wanted: string = sanitizeToolName(resource);

  return getMovableLists().find((list: MovableList): boolean => {
    return list.names.includes(wanted);
  });
}

// Whether a resource, by its table, is a list the tool moves rows of.
export function isMovableTable(tableName: string): boolean {
  return getMovableLists().some((list: MovableList): boolean => {
    return list.tableName === tableName;
  });
}

export function getMoveInListToolDefinition(): MoveInListToolDefinition {
  const lists: Array<MovableList> = getMovableLists();

  return {
    name: MOVE_IN_LIST_TOOL_NAME,
    title: "Move Row in List",
    description:
      "Move a row of an ordered list, such as an incident severity or a monitor status, to another row's place in it, as dragging it in the OneUptime dashboard does: it lands just above that row when it comes from below, just below it when it comes from above, and the list is numbered from the top again. Returns each row whose number changed. An update_ tool's write of the number places only that row and moves no other.",
    inputSchema: {
      type: "object",
      properties: {
        resource: {
          type: "string",
          enum: lists.map((list: MovableList): string => {
            return list.singularName;
          }),
        },
        id: {
          type: "string",
          description: "ID of the row to move.",
        },
        placeOfId: {
          type: "string",
          description: "ID of the row whose place it takes, in the same list.",
        },
      },
      required: ["resource", "id", "placeOfId"],
      additionalProperties: false,
    },
    readOnly: false,
    published: lists.some((list: MovableList): boolean => {
      return isPublishedTable(list.tableName);
    }),
  };
}

/*
 * Moves the row: the API's move request, as the caller. Its refusals - the
 * row named is in another list (400), the row is gone (404), the caller may
 * not change the number (422), the move would put a path's built-in states
 * out of order (400) - come back as they are, for the agent to read.
 */
export async function moveInList(
  args: Record<string, unknown>,
  credential: McpCredentialInput,
): Promise<JSONObject> {
  const list: MovableList | undefined = findMovableList(args["resource"]);

  if (!list) {
    throw new Error(
      `${JSON.stringify(args["resource"] ?? null)} is no list whose rows can be moved. Pass resource as one of: ${getMovableLists()
        .map((candidate: MovableList): string => {
          return candidate.singularName;
        })
        .join(", ")}.`,
    );
  }

  const id: string = requireUuid(args, "id");
  const placeOfId: string = requireUuid(args, "placeOfId");

  const response: unknown = await OneUptimeApiService.makeAuthenticatedApiCall({
    method: "POST",
    path: `/api${list.apiPath}${getMoveInListRoute(id)}`,
    body: { placeOfId: placeOfId },
    credential: credential,
  });

  const changedRows: JSONArray =
    ((response as JSONObject | null)?.["changedRows"] as
      | JSONArray
      | undefined) || [];

  return {
    success: true,
    operation: MOVE_IN_LIST_TOOL_NAME,
    resourceType: list.singularName,
    resourceId: id,
    placeOfId: placeOfId,
    column: list.column,
    changedRows: changedRows,
    message:
      changedRows.length === 0
        ? `${list.singularName} ${id} is in that place already: nothing changed.`
        : `Moved ${list.singularName} ${id} to the place of ${placeOfId}. ${changedRows.length} ${changedRows.length === 1 ? "row has" : "rows have"} a new ${list.column}: each is in changedRows.`,
  } as JSONObject;
}
