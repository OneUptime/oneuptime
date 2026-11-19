/**
 * Setup Tools
 *
 * Ask AI's setup actions as MCP tools (#7241): the outcomes a person sets
 * up in OneUptime, one call each, rather than one table at a time - a
 * website monitor with the website guided setup's criteria, who is paged,
 * a status page with monitors on it, monitors put on a status page, and
 * who is told when a monitor goes down.
 *
 * They do not build a record here. Each call is sent to the API's
 * POST /api/setup-actions/run (Common/Server/API/SetupActionAPI), which
 * runs Ask AI's own tool for it - the same prepare, the same checks before
 * anything is made, the same writes as the person - so an agent and Ask AI
 * set the same things up, and cannot drift. Their arguments are Ask AI's
 * (Tests/SetupTools holds the two schemas together); their words are the
 * agent's, and each says what it makes, since an MCP client has no
 * approval card: the client asks the person before a tool that is not
 * read-only, by itself.
 *
 * Setting things up acts as the person who signed in (OAuth): the monitor
 * is theirs and a policy pages them, as in Ask AI. A project API key is not
 * a person, so it is refused the setup actions, in words that say what to
 * do instead; who_is_told only reads, and answers a key too.
 */

import {
  ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
  PUBLISH_STATUS_PAGE_TOOL_NAME,
  SETUP_ACTION_RUN_ROUTE,
  SET_UP_PAGING_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
  WHO_IS_TOLD_TOOL_NAME,
} from "Common/Types/AI/AISetupActions";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import McpCredentialUtil, { McpCredentialInput } from "../Types/McpCredential";
import { JSONSchema } from "../Types/McpTypes";

// A setup tool, as WorkflowTools lists its tools.
export interface SetupToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JSONSchema;
  readOnly: boolean;
  /*
   * What it makes is published, as a write to a status page is: shown on
   * the public page, to anyone with its link.
   */
  published: boolean;
}

// The reach methods set_up_paging takes, as Ask AI's tool takes them.
const REACH_METHODS: Array<string> = ["sms", "call", "push", "email"];

// The sentence each write ends with: who it acts as.
const AS_THE_PERSON: string =
  "Acts as the person signed in (OAuth), with their permissions; an API key cannot.";

export const SETUP_TOOL_DEFINITIONS: ReadonlyArray<SetupToolDefinition> = [
  {
    name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
    title: "Set Up Website Monitoring",
    description: `Monitor a website or API address in one call, as the website guided setup does: a Website monitor (API with isApi) that opens an incident when the address does not answer or answers with an error, checked every 5 minutes (checkEveryMinutes) from the locations new monitors start with. The person owns it and is emailed when its status changes. An address a monitor checks already gets no second one. ${AS_THE_PERSON}`,
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            "'example.com' (https is added) or a URL such as 'https://api.example.com/health'.",
        },
        isApi: {
          type: "boolean",
          description: "True for an API endpoint. Defaults to false.",
        },
        checkEveryMinutes: {
          type: "number",
          description: "1, 2, 5, 10, 15, 30 or 60. Defaults to 5.",
        },
      },
      required: ["address"],
      additionalProperties: false,
    },
    readOnly: false,
    published: false,
  },
  {
    name: SET_UP_PAGING_TOOL_NAME,
    title: "Set Up Paging",
    description: `Set up who is paged in a project that pages nobody yet, as the on-call guided setup does: the policy "Default on-call policy" paging the person (unless includeMe is false), alsoPage and teams, with on-call rules that run it for every new incident and alert. escalateTo and escalateToTeams are paged next after afterMinutes; repeatTimes starts it over. A project with on-call policies or rules is refused. For reachMeBy, details say what the person must still add. ${AS_THE_PERSON}`,
    inputSchema: {
      type: "object",
      properties: {
        includeMe: {
          type: "boolean",
          description: "Page the person signed in. Defaults to true.",
        },
        alsoPage: {
          type: "array",
          items: { type: "string" },
          description: "Members to page, by name or email.",
        },
        teams: {
          type: "array",
          items: { type: "string" },
          description: "Teams to page, by name.",
        },
        escalateTo: {
          type: "array",
          items: { type: "string" },
          description: "Members paged next, by name or email.",
        },
        escalateToTeams: {
          type: "array",
          items: { type: "string" },
          description: "Teams paged next, by name.",
        },
        afterMinutes: {
          type: "number",
          description:
            "Minutes to wait for an acknowledgement, 1 to 1440. Defaults to 30.",
        },
        repeatTimes: {
          type: "number",
          description: "Times to start over, 1 to 10.",
        },
        reachMeBy: {
          type: "array",
          items: { type: "string", enum: REACH_METHODS },
          description: "How the person asked to be reached.",
        },
      },
      additionalProperties: false,
    },
    readOnly: false,
    published: false,
  },
  {
    name: PUBLISH_STATUS_PAGE_TOOL_NAME,
    title: "Publish Status Page",
    description: `Publish a status page showing monitors, as the status page guided setup does: each monitor named, with its status, uptime and history. It is public as soon as it is created: anyone with its link sees it. Named after the project unless name is given. ${AS_THE_PERSON}`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "At least two characters.",
        },
        monitors: {
          type: "array",
          items: { type: "string" },
          description: "Monitors, by name or address, in order.",
        },
      },
      required: ["monitors"],
      additionalProperties: false,
    },
    readOnly: false,
    published: true,
  },
  {
    name: ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
    title: "Add Monitors To Status Page",
    description: `Put monitors on a status page the project has, as its Add Multiple Monitors does: each is shown on the public page after the ones it shows; one shown already is left as it is. ${AS_THE_PERSON}`,
    inputSchema: {
      type: "object",
      properties: {
        statusPage: {
          type: "string",
          description: "The status page, by name.",
        },
        monitors: {
          type: "array",
          items: { type: "string" },
          description: "Monitors, by name or address.",
        },
      },
      required: ["statusPage", "monitors"],
      additionalProperties: false,
    },
    readOnly: false,
    published: true,
  },
  {
    name: WHO_IS_TOLD_TOOL_NAME,
    title: "Who Is Told",
    description:
      "Who is told when a monitor goes down, and where that breaks: what each criteria opens, who it emails, the policies it pages, who they reach now and how, or why someone can't be paged. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        monitor: {
          type: "string",
          description: "The monitor, by name, address or id.",
        },
      },
      required: ["monitor"],
      additionalProperties: false,
    },
    readOnly: true,
    published: false,
  },
];

export function isSetupTool(toolName: string): boolean {
  return SETUP_TOOL_DEFINITIONS.some(
    (definition: SetupToolDefinition): boolean => {
      return definition.name === toolName;
    },
  );
}

// Said, before any request, when a project API key asks a setup tool to make something.
export function getApiKeyRefusal(toolName: string): string {
  return `${toolName} sets things up as the person signed in to OneUptime, as Ask AI does: they own the monitor, and they are paged. A project API key is not a person. Connect this MCP client by signing in to OneUptime (OAuth) to use it, or create the records with the create tools.`;
}

/*
 * Runs a setup tool through the API, as the credential's caller, and
 * answers with what was made: the card's title and details (what it does,
 * what is missing), and the tool's own words, which name the records made.
 */
export async function handleSetupTool(
  toolName: string,
  args: Record<string, unknown>,
  credential: McpCredentialInput,
): Promise<JSONObject> {
  const definition: SetupToolDefinition | undefined =
    SETUP_TOOL_DEFINITIONS.find((candidate: SetupToolDefinition): boolean => {
      return candidate.name === toolName;
    });

  if (!definition) {
    throw new Error(`Unknown setup tool: ${toolName}`);
  }

  if (!definition.readOnly && !McpCredentialUtil.isOAuth(credential)) {
    throw new Error(getApiKeyRefusal(toolName));
  }

  const response: unknown = await OneUptimeApiService.makeAuthenticatedApiCall({
    method: "POST",
    path: `/api${SETUP_ACTION_RUN_ROUTE}`,
    body: { action: toolName, arguments: args as JSONObject } as JSONObject,
    credential,
  });

  const result: JSONObject =
    response && typeof response === "object" && !Array.isArray(response)
      ? (response as JSONObject)
      : {};

  return {
    success: true,
    operation: toolName,
    ...(typeof result["title"] === "string"
      ? { made: result["title"] as string }
      : {}),
    details: (Array.isArray(result["details"])
      ? result["details"]
      : []) as JSONValue,
    message:
      typeof result["message"] === "string" ? result["message"] : "Done.",
    ...(result["record"] ? { record: result["record"] as JSONValue } : {}),
  } as JSONObject;
}
