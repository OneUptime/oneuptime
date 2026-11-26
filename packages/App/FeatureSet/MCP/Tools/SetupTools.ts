/**
 * Setup Tools
 *
 * Ask AI's setup actions as MCP tools (#7241, #10041): the outcomes a
 * person sets up in OneUptime, one call each, rather than one table at a
 * time - a website monitor with the website guided setup's criteria, a
 * service's recommended monitors, who is paged, people added to a policy
 * the project has, people invited to the project, the person's own How to
 * Reach Me, a status page with monitors on it, monitors put on a status
 * page, and who is told when a monitor goes down.
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
 * a person, so it is refused the setup actions, in words that say why for
 * each (Common's getSetupActionApiKeyRefusal: an invitation names who sent
 * it, and How to Reach Me is the person's own); who_is_told only reads,
 * and answers a key too.
 *
 * With no card to show first, each description says what the card would
 * have said before anyone approved it: what is made, what it replaces,
 * that an invitation is emailed, what a monitor costs on OneUptime Cloud's
 * Free plan, and what a second identical call does.
 */

import {
  ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
  ADD_TO_ON_CALL_POLICY_TOOL_NAME,
  INVITE_PEOPLE_TOOL_NAME,
  PUBLISH_STATUS_PAGE_TOOL_NAME,
  SETUP_ACTION_RUN_ROUTE,
  SET_HOW_TO_REACH_ME_TOOL_NAME,
  SET_UP_PAGING_TOOL_NAME,
  SET_UP_SERVICE_MONITOR_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
  WHO_IS_TOLD_TOOL_NAME,
  getSetupActionApiKeyRefusal,
} from "Common/Types/AI/AISetupActions";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  formatPriceInUSD,
} from "Common/Types/Billing/PayAsYouGoPricing";
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
  /*
   * It sends email to addresses outside the project, as an invitation
   * does: it reaches past the caller's project, so it is open-world too.
   */
  mailsOutsideProject?: boolean;
  /*
   * What it makes points OneUptime at an address outside it, as a monitor
   * created with create_monitor does: a website monitor checks the address
   * it is given. Open-world too (ToolAnnotations' OUTSIDE_ADDRESS_TABLE_NAMES).
   */
  pointsOutside?: boolean;
}

// The reach methods set_up_paging takes, as Ask AI's tool takes them.
const REACH_METHODS: Array<string> = ["sms", "call", "push", "email"];

// The recommended monitors set_up_service_monitor takes, as Ask AI's tool takes them.
const SERVICE_MONITORS: Array<string> = [
  "errors",
  "slow_requests",
  "exceptions",
  "error_logs",
];

// The ways set_how_to_reach_me takes, as Ask AI's tool takes them.
const LADDER_WAYS: Array<string> = [
  "sms",
  "call",
  "push",
  "email",
  "whatsapp",
  "telegram",
  "slack",
  "microsoft_teams",
  "mattermost",
  "webhook",
];

// The sentence each write ends with: who it acts as.
const AS_THE_PERSON: string =
  "Acts as the person signed in (OAuth), with their permissions; an API key cannot.";

/*
 * What a new monitor costs, as the website guided setup quotes it on
 * OneUptime Cloud's Free plan (#9995): said before the call, where Ask
 * AI's card says it before the approval.
 */
const FREE_PLAN_MONITOR_PRICE: string = `On OneUptime Cloud's Free plan each new monitor is billed as you use it, at ${formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH)} a month, and details say so.`;

export const SETUP_TOOL_DEFINITIONS: ReadonlyArray<SetupToolDefinition> = [
  {
    name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
    title: "Set Up Website Monitoring",
    description: `Monitor a website or API address in one call, as the website guided setup does: a Website monitor (API with isApi) that opens an incident when the address does not answer or answers with an error, checked every 5 minutes (checkEveryMinutes) from the locations new monitors start with. The person owns it and is emailed when its status changes. An address a monitor checks already gets no second one. ${FREE_PLAN_MONITOR_PRICE} ${AS_THE_PERSON}`,
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
    pointsOutside: true,
  },
  {
    name: SET_UP_SERVICE_MONITOR_TOOL_NAME,
    title: "Set Up Service Monitor",
    description: `Create one of the monitors the telemetry guided setup recommends for a service that sends telemetry, as its Recommendations tab makes it: errors (failing requests), slow_requests (p95 latency), exceptions (unhandled exceptions) or error_logs (a spike in error logs). It opens an alert for the team, never an incident on a status page. Call it once for each monitor. One that reads data the project does not send yet is refused, and so is one the service has already: a second identical call makes none. ${FREE_PLAN_MONITOR_PRICE} ${AS_THE_PERSON}`,
    inputSchema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description: "The service, by its name.",
        },
        monitor: {
          type: "string",
          enum: SERVICE_MONITORS,
          description: "Which recommended monitor.",
        },
      },
      required: ["service", "monitor"],
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
    name: ADD_TO_ON_CALL_POLICY_TOOL_NAME,
    title: "Add To On-Call Policy",
    description: `Add members and teams to an on-call policy the project has, as the on-call guided setup's "Who else is on call?" does: to one of its levels (level 1, paged at once, by default), or as a new level after its last, paged when nobody acknowledges within afterMinutes, which then sets how long the level before it waits. Someone a level pages already is left as they are: a second identical call adds nobody and makes no second level. Someone invited to the project who has not joined yet is added by the address they were invited at: they are paged once they join, and nothing reaches them before. In a project that pages nobody yet, use set_up_paging. ${AS_THE_PERSON}`,
    inputSchema: {
      type: "object",
      properties: {
        policy: {
          type: "string",
          description:
            "The policy, by name. Leave it out only when the project has one.",
        },
        alsoPage: {
          type: "array",
          items: { type: "string" },
          description:
            "Members to add, by name or email, and people invited who have not joined yet, by the address they were invited at.",
        },
        teams: {
          type: "array",
          items: { type: "string" },
          description: "Teams to add, by name.",
        },
        includeMe: {
          type: "boolean",
          description: "Add the person signed in too. Defaults to false.",
        },
        level: {
          type: "number",
          description:
            "The level to add to: 1, the first, by default. One past the last makes a new level.",
        },
        afterMinutes: {
          type: "number",
          description:
            "For a new level: minutes the level before waits for an acknowledgement, 1 to 1440. Defaults to 30.",
        },
      },
      additionalProperties: false,
    },
    readOnly: false,
    published: false,
  },
  {
    name: INVITE_PEOPLE_TOOL_NAME,
    title: "Invite People",
    description: `Invite people to the project by email, as Invite User on the Users page does: each joins the project's members team and is sent an email, in the name of the person signed in, inviting them to accept. An address in the project already, invited or a member, is not invited again: a second identical call sends no email. Up to 25 addresses a call. Someone invited is paged only once they join; add_to_on_call_policy adds them to a policy by their address before that. ${AS_THE_PERSON}`,
    inputSchema: {
      type: "object",
      properties: {
        emails: {
          type: "array",
          items: { type: "string" },
          description: "The email addresses to invite.",
        },
      },
      required: ["emails"],
      additionalProperties: false,
    },
    readOnly: false,
    published: false,
    mailsOutsideProject: true,
  },
  {
    name: SET_HOW_TO_REACH_ME_TOOL_NAME,
    title: "Set How To Reach Me",
    description:
      "Set how pages reach the person signed in, as their How to Reach Me ladder: a step for each way and wait, for every incident and alert at every severity. It replaces how pages reach them now; steps on their custom channels are kept. Each way reaches their own verified methods of it: a way with none is left out, and details say where to verify one. It never adds a phone number or the app. A ladder that reaches them this way already is left as it is. Only the person signed in (OAuth) sets their own; an API key has nobody to set it for.",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description:
            "In order: [{ by: 'sms', afterMinutes: 0 }, { by: 'call', afterMinutes: 5 }] is 'text me, then call me after five minutes'.",
          items: {
            type: "object",
            properties: {
              by: { type: "string", enum: LADDER_WAYS },
              afterMinutes: {
                type: "number",
                description:
                  "Minutes after the page starts, 0 to 1440. Defaults to 0, at once.",
              },
            },
            required: ["by"],
            additionalProperties: false,
          },
        },
      },
      required: ["steps"],
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

/*
 * Said, before any request, when a project API key asks a setup tool to
 * make something: the words the API says too, as each tool's own.
 */
export function getApiKeyRefusal(toolName: string): string {
  return getSetupActionApiKeyRefusal(toolName);
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
