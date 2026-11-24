/**
 * Data Security Tools
 *
 * Ask AI's Data Security actions as MCP tools (#10378, #10889): what a
 * person does in Data Security, one call each, rather than one record at a
 * time - Scrub It on a finding, Confirm or Not Sensitive, Accept Risk, Not
 * an Issue, Reopen or Assign on an issue, a store's owners, a rule drafted
 * from a sentence and saved, a response action on a store, Fix with AI,
 * Approve or Dismiss on what OneUptime AI proposes - and the two reads
 * beside them: a rule's draft with the stores it matches today, and OneUptime
 * AI's proposals, the data types it found among them.
 *
 * They build nothing here. Each call is sent to the API's
 * POST /api/data-security-actions/run (Common/Server/API/
 * DataSecurityActionAPI), which runs Ask AI's own tool for it - the same
 * prepare, the same checks, the very server code each button calls, as the
 * person - so an agent and Ask AI act alike, and cannot drift. Their
 * arguments are Ask AI's (Tests/DataSecurityTools holds the two schemas
 * together).
 *
 * WHAT IS REFUSED HERE. Ask AI asks a person on a card before some of these
 * in every mode, Auto-run included: responding on a store, marking a finding
 * not sensitive, accepting a risk or marking an issue not an issue, changing
 * a store's owners, saving a rule, approving or dismissing a proposal - and
 * a scrub something reads, or a confirm in a project that pages for a
 * Critical issue. This server runs stateless and has no way to ask anyone,
 * and a client's own confirmation is its choice, unseen by OneUptime: so
 * the API refuses those here, with a sentence that says why and the page in
 * OneUptime where the person does it. Nothing is run silently.
 *
 * Changing something acts as the person who signed in (OAuth); a project API
 * key is refused that, and reads the two reads. MCP_READ_ONLY takes every
 * action off the server and keeps the reads; MCP_ALLOW_DESTRUCTIVE=false
 * refuses removing a store's owners, which deletes them.
 */

import {
  CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME,
  DATA_SECURITY_ACTION_RUN_ROUTE,
  DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
  DRAFT_DATA_SECURITY_RULE_TOOL_NAME,
  FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME,
  getDataSecurityActionApiKeyRefusal,
  JUDGE_DATA_SECURITY_FINDING_TOOL_NAME,
  QUERY_DATA_SECURITY_PROPOSALS_TOOL_NAME,
  RESPOND_ON_DATA_STORE_TOOL_NAME,
  SAVE_DATA_SECURITY_RULE_TOOL_NAME,
  SCRUB_DATA_SECURITY_FINDING_TOOL_NAME,
  SET_DATA_STORE_OWNERS_TOOL_NAME,
} from "Common/Types/AI/AIDataSecurityActions";
import { ALL_DATA_SECURITY_RESPONSE_ACTIONS } from "Common/Types/DataSecurity/DataSecurityResponseAction";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import McpCredentialUtil, { McpCredentialInput } from "../Types/McpCredential";
import { JSONSchema } from "../Types/McpTypes";
import { getServerWritePolicy, getWritePolicyRefusal } from "./ToolGenerator";

// A Data Security tool, as WorkflowTools lists its tools.
export interface DataSecurityToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JSONSchema;
  readOnly: boolean;
  /*
   * It changes what reaches outside the project: a store's settings in its
   * cloud, or a pull request in a repository. Open-world, as a write to a
   * status page is.
   */
  reachesOutside?: boolean;
}

// The sentence each change ends with: who it acts as, and where it is refused.
const AS_THE_PERSON: string =
  "Acts as the person signed in (OAuth), with their permissions; an API key cannot.";

const ASKS_A_PERSON: string =
  "OneUptime asks a person before this in every mode, and this connection cannot show them a card: it is refused here, with the page in OneUptime where they do it.";

const STRING: JSONSchema = { type: "string" };

function arrayOfStrings(description: string): JSONSchema {
  return { type: "array", items: { type: "string" }, description };
}

export const DATA_SECURITY_TOOL_DEFINITIONS: ReadonlyArray<DataSecurityToolDefinition> =
  [
    {
      name: QUERY_DATA_SECURITY_PROPOSALS_TOOL_NAME,
      title: "Query Data Security Proposals",
      description:
        'What OneUptime AI proposes in Data Security, waiting for a person: each proposal\'s kind, title, risk and the issue or store it is about, riskiest first. which="data-types" lists the data types OneUptime AI found that scans do not look for yet: each one\'s name, category and sensitivity, how it was proven ("Matches 98% of the values in these 11 fields, and 0.1% of values elsewhere in the same stores"), the stores and fields it is in (locations only, never a value), and how many more are still being checked. Read-only.',
      inputSchema: {
        type: "object",
        properties: {
          which: {
            type: "string",
            enum: ["waiting", "data-types"],
            description: 'Which proposals: "waiting" (default) or "data-types".',
          },
          dataSecurityIssueId: {
            ...STRING,
            description: "Only the proposals of this issue.",
          },
          limit: {
            type: "number",
            description: "Maximum proposals to list (default 10, max 25).",
          },
        },
        additionalProperties: false,
      },
      readOnly: true,
    },
    {
      name: DRAFT_DATA_SECURITY_RULE_TOOL_NAME,
      title: "Draft Data Security Rule",
      description:
        'Draft a Data Security rule from a sentence, such as "EU personal data must stay in the EU", "the payments team owns every store named payments-" or "label every store holding card numbers PCI": OneUptime AI drafts a residency, owner or label rule - the kind the sentence asks for - and the answer says which stores it matches today, and for a residency rule which break it. Saves nothing; uses OneUptime AI. Read-only.',
      inputSchema: {
        type: "object",
        properties: {
          sentence: {
            ...STRING,
            description: "The rule, in the person's own words.",
          },
        },
        required: ["sentence"],
        additionalProperties: false,
      },
      readOnly: true,
    },
    {
      name: SCRUB_DATA_SECURITY_FINDING_TOOL_NAME,
      title: "Scrub Data Security Finding",
      description: `Scrub It on a finding in telemetry: the proven, narrow scrub rule that hides the finding's data type at its place in the service's logs, spans or metrics as new data arrives, tested on the records it was found in. When a monitor, dashboard, saved view, recording rule, SLO or Security Events reads what it hides, ${ASKS_A_PERSON} ${AS_THE_PERSON}`,
      inputSchema: {
        type: "object",
        properties: {
          dataStoreFindingId: { ...STRING, description: "The finding's ID." },
        },
        required: ["dataStoreFindingId"],
        additionalProperties: false,
      },
      readOnly: false,
    },
    {
      name: JUDGE_DATA_SECURITY_FINDING_TOOL_NAME,
      title: "Judge Data Security Finding",
      description: `Confirm a finding ("confirm": it counts for certain) or mark it not sensitive ("not-sensitive", with reason). alsoSimilar applies the same decision to the findings like it. Not Sensitive, and Confirm in a project that pages someone for a Critical issue: ${ASKS_A_PERSON} ${AS_THE_PERSON}`,
      inputSchema: {
        type: "object",
        properties: {
          dataStoreFindingId: { ...STRING, description: "The finding's ID." },
          decision: {
            type: "string",
            enum: ["confirm", "not-sensitive"],
            description: "Confirm it, or mark it not sensitive.",
          },
          reason: {
            ...STRING,
            description: "Why it is not sensitive, in the person's words.",
          },
          alsoSimilar: {
            type: "boolean",
            description: "Also decide the findings like it the same way.",
          },
        },
        required: ["dataStoreFindingId", "decision"],
        additionalProperties: false,
      },
      readOnly: false,
    },
    {
      name: CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME,
      title: "Change Data Security Issue",
      description: `Change an issue: "reopen" (it counts again), "assign" (assignee, a member by name or email or a team by name), "unassign", "accept-risk" (until acceptedUntil, with reason) or "not-an-issue" (with reason). Accept Risk and Not an Issue stop an issue counting: ${ASKS_A_PERSON} ${AS_THE_PERSON}`,
      inputSchema: {
        type: "object",
        properties: {
          dataSecurityIssueId: { ...STRING, description: "The issue's ID." },
          change: {
            type: "string",
            enum: [
              "accept-risk",
              "not-an-issue",
              "reopen",
              "assign",
              "unassign",
            ],
            description: "What to change.",
          },
          reason: {
            ...STRING,
            description: "Why, in the person's words (accept-risk, not-an-issue).",
          },
          acceptedUntil: {
            ...STRING,
            description: "For accept-risk: YYYY-MM-DD, at most a year away.",
          },
          assignee: {
            ...STRING,
            description: "For assign: a member by name or email, or a team by name.",
          },
        },
        required: ["dataSecurityIssueId", "change"],
        additionalProperties: false,
      },
      readOnly: false,
    },
    {
      name: SET_DATA_STORE_OWNERS_TOOL_NAME,
      title: "Set Data Store Owners",
      description: `Add or remove a store's owners: members by name or email, teams by name. Owners are emailed each new issue on the store, so ${ASKS_A_PERSON.charAt(0).toLowerCase()}${ASKS_A_PERSON.slice(1)} ${AS_THE_PERSON}`,
      inputSchema: {
        type: "object",
        properties: {
          dataStoreId: { ...STRING, description: "The store's ID." },
          add: arrayOfStrings("Members and teams to add as owners."),
          remove: arrayOfStrings("Owners to remove."),
        },
        required: ["dataStoreId"],
        additionalProperties: false,
      },
      readOnly: false,
    },
    {
      name: SAVE_DATA_SECURITY_RULE_TOOL_NAME,
      title: "Save Data Security Rule",
      description: `Save a rule ${DRAFT_DATA_SECURITY_RULE_TOOL_NAME} drafted, its fields unchanged. A person sees what their words became, and the stores it matches, before it is saved: ${ASKS_A_PERSON} ${AS_THE_PERSON}`,
      inputSchema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["residency", "owner", "label"],
            description: "The draft's kind.",
          },
          name: { ...STRING, description: "The draft's name." },
          description: { ...STRING, description: "The draft's description." },
          dataCategories: arrayOfStrings("Residency: the draft's data categories."),
          subjectCountries: arrayOfStrings("Residency: the draft's countries."),
          allowedRegions: arrayOfStrings("Residency: the draft's allowed regions."),
          nameRegexPattern: {
            ...STRING,
            description: "Owner or label: the draft's name pattern.",
          },
          descriptionRegexPattern: {
            ...STRING,
            description: "Owner or label: the draft's description pattern.",
          },
          cloudTagPattern: {
            ...STRING,
            description: "Owner or label: the draft's cloud tag pattern.",
          },
          matchLabels: arrayOfStrings("Owner or label: labels a store must have."),
          owners: arrayOfStrings("Owner: the draft's owners."),
          labelsToAdd: arrayOfStrings("Label: the labels the stores get."),
        },
        required: ["kind", "name"],
        additionalProperties: false,
      },
      readOnly: false,
    },
    {
      name: RESPOND_ON_DATA_STORE_TOOL_NAME,
      title: "Respond On Data Store",
      description: `A response action on a store through its cloud connection - ${ALL_DATA_SECURITY_RESPONSE_ACTIONS.join(", ")} - which changes the store's settings in its cloud, and can stop what reads it working. ${ASKS_A_PERSON} ${AS_THE_PERSON}`,
      inputSchema: {
        type: "object",
        properties: {
          dataStoreId: { ...STRING, description: "The store's ID." },
          action: {
            type: "string",
            enum: [...ALL_DATA_SECURITY_RESPONSE_ACTIONS],
            description: "The response action.",
          },
          dataSecurityIssueId: {
            ...STRING,
            description: "The store's issue it is run from, if any.",
          },
        },
        required: ["dataStoreId", "action"],
        additionalProperties: false,
      },
      readOnly: false,
      reachesOutside: true,
    },
    {
      name: FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME,
      title: "Fix Data Security Issue With AI",
      description: `Fix with AI on an issue: OneUptime AI opens a pull request that fixes it, for someone to review and merge - nothing is merged or deployed - in a repository the person may change in Code; a leak in a service's telemetry gets one pull request for every leak of the service. A fix already on its way is not started twice. It uses OneUptime AI credits. ${AS_THE_PERSON}`,
      inputSchema: {
        type: "object",
        properties: {
          dataSecurityIssueId: { ...STRING, description: "The issue's ID." },
          codeRepositoryId: {
            ...STRING,
            description:
              "The repository, when the first answer asked to choose one.",
          },
        },
        required: ["dataSecurityIssueId"],
        additionalProperties: false,
      },
      readOnly: false,
      reachesOutside: true,
    },
    {
      name: DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
      title: "Decide Data Security Proposal",
      description: `Approve or dismiss one of OneUptime AI's proposals ("approve", or "dismiss" with reason). A person decides what OneUptime AI proposes: ${ASKS_A_PERSON} ${AS_THE_PERSON}`,
      inputSchema: {
        type: "object",
        properties: {
          dataSecurityAiProposalId: {
            ...STRING,
            description: "The proposal's ID.",
          },
          decision: {
            type: "string",
            enum: ["approve", "dismiss"],
            description: "Approve or dismiss it.",
          },
          reason: {
            ...STRING,
            description: "For dismiss: why, in the person's words.",
          },
        },
        required: ["dataSecurityAiProposalId", "decision"],
        additionalProperties: false,
      },
      readOnly: false,
    },
  ];

export function isDataSecurityTool(toolName: string): boolean {
  return DATA_SECURITY_TOOL_DEFINITIONS.some(
    (definition: DataSecurityToolDefinition): boolean => {
      return definition.name === toolName;
    },
  );
}

/*
 * A call that deletes something, which a server set with
 * MCP_ALLOW_DESTRUCTIVE=false refuses: removing a store's owners.
 */
export function isDeletingCall(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  return (
    toolName === SET_DATA_STORE_OWNERS_TOOL_NAME &&
    Array.isArray(args["remove"]) &&
    (args["remove"] as Array<unknown>).length > 0
  );
}

/*
 * Runs a Data Security tool through the API, as the credential's caller,
 * and answers with what was done: the card's title, its effects (what
 * changed, what stopped working, what it cost) and the tool's own words.
 */
export async function handleDataSecurityTool(
  toolName: string,
  args: Record<string, unknown>,
  credential: McpCredentialInput,
): Promise<JSONObject> {
  const definition: DataSecurityToolDefinition | undefined =
    DATA_SECURITY_TOOL_DEFINITIONS.find(
      (candidate: DataSecurityToolDefinition): boolean => {
        return candidate.name === toolName;
      },
    );

  if (!definition) {
    throw new Error(`Unknown Data Security tool: ${toolName}`);
  }

  if (!definition.readOnly && !McpCredentialUtil.isOAuth(credential)) {
    throw new Error(getDataSecurityActionApiKeyRefusal(toolName));
  }

  // Removing an owner deletes them: refused where the operator allows no deletes.
  if (
    !getServerWritePolicy().allowDestructive &&
    isDeletingCall(toolName, args)
  ) {
    throw new Error(getWritePolicyRefusal(getServerWritePolicy()));
  }

  const response: unknown = await OneUptimeApiService.makeAuthenticatedApiCall({
    method: "POST",
    path: `/api${DATA_SECURITY_ACTION_RUN_ROUTE}`,
    body: { action: toolName, arguments: args as JSONObject } as JSONObject,
    credential,
  });

  const result: JSONObject =
    response && typeof response === "object" && !Array.isArray(response)
      ? (response as JSONObject)
      : {};
  const list: (key: string) => JSONValue = (key: string): JSONValue => {
    return (Array.isArray(result[key]) ? result[key] : []) as JSONValue;
  };

  return {
    success: true,
    operation: toolName,
    ...(typeof result["title"] === "string"
      ? { done: result["title"] as string }
      : {}),
    details: list("details"),
    changes: list("changes"),
    stopsWorking: list("stopsWorking"),
    costs: list("costs"),
    message:
      typeof result["message"] === "string" ? result["message"] : "Done.",
    ...(result["record"] ? { record: result["record"] as JSONValue } : {}),
  } as JSONObject;
}
