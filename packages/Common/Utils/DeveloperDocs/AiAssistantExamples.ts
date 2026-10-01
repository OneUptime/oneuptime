import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE,
  toSentenceCaseName,
} from "./ExampleValues";
import { getTerraformTypeName } from "./TerraformSchema";

/*
 * What the dashboard's Developer > AI Assistants pages show: how to connect
 * an assistant to OneUptime's MCP server, which of its tools work on a
 * resource, and prompts to start from.
 *
 * The MCP server (App/FeatureSet/MCP) generates six tools for every model
 * marked @EnableMCP. Their names are worked out here the way its
 * ToolGenerator works them out, and
 * Common/Tests/Utils/DeveloperDocs/AiAssistantExamples.test.ts holds this file
 * to the real tool list.
 */

export interface McpToolNames {
  create: string;
  get: string;
  list: string;
  update: string;
  delete: string;
  count: string;
}

/*
 * The MCP server's tool-name rule (MCP/Tools/SchemaConverter.ts
 * sanitizeToolName): "On-Call Policy" -> on_call_policy.
 */
export function sanitizeMcpToolName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// Whether the MCP server has tools for this model.
export function hasMcpTools(modelType: DatabaseBaseModelType): boolean {
  const model: DatabaseBaseModel = new modelType();

  return Boolean(model.enableMCP && model.tableName && model.crudApiPath);
}

// The MCP server's tools for a model, or null when it has none.
export function getMcpToolNames(
  modelType: DatabaseBaseModelType,
): McpToolNames | null {
  if (!hasMcpTools(modelType)) {
    return null;
  }

  const model: DatabaseBaseModel = new modelType();
  const singularName: string = model.singularName || model.tableName || "";
  const pluralName: string = model.pluralName || `${singularName}s`;
  const singular: string = sanitizeMcpToolName(singularName);
  const plural: string = sanitizeMcpToolName(pluralName);

  return {
    create: `create_${singular}`,
    get: `get_${singular}`,
    list: `list_${plural}`,
    update: `update_${singular}`,
    delete: `delete_${singular}`,
    count: `count_${plural}`,
  };
}

// `https://oneuptime.com/mcp`.
export function getMcpServerUrl(oneuptimeUrl: string): string {
  return `${oneuptimeUrl.replace(/\/+$/, "")}/mcp`;
}

export interface McpClientSetup {
  // The client, as a tab label.
  label: string;
  // Markdown: where to put the server, and the snippet.
  markdown: string;
}

const FENCE: string = "```";

function codeBlock(language: string, code: string): string {
  return `${FENCE}${language}\n${code}\n${FENCE}`;
}

/*
 * Connecting each common MCP client by signing in: the server URL is all a
 * client needs; it opens OneUptime to sign in the first time.
 */
export function getMcpClientSetups(mcpUrl: string): Array<McpClientSetup> {
  return [
    {
      label: "Claude Code",
      markdown: [
        "Add the server, then run `/mcp` inside Claude Code and choose **oneuptime** to sign in:",
        "",
        codeBlock("bash", `claude mcp add --transport http oneuptime ${mcpUrl}`),
      ].join("\n"),
    },
    {
      label: "Claude",
      markdown: [
        "In Claude (web or desktop), open **Customize → Connectors**, choose **Add custom connector** and enter this URL. Claude asks you to sign in to OneUptime the first time it needs your data.",
        "",
        codeBlock("text", mcpUrl),
      ].join("\n"),
    },
    {
      label: "VS Code",
      markdown: [
        "Add this to `.vscode/mcp.json`. VS Code opens OneUptime for you to sign in when the server starts:",
        "",
        codeBlock(
          "json",
          JSON.stringify(
            { servers: { oneuptime: { type: "http", url: mcpUrl } } },
            null,
            2,
          ),
        ),
      ].join("\n"),
    },
    {
      label: "Cursor",
      markdown: [
        "Add this to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):",
        "",
        codeBlock(
          "json",
          JSON.stringify({ mcpServers: { oneuptime: { url: mcpUrl } } }, null, 2),
        ),
      ].join("\n"),
    },
    {
      label: "Other assistants",
      markdown: [
        "Any assistant that supports remote MCP servers works the same way: give it this URL, and sign in to OneUptime when it asks.",
        "",
        codeBlock("text", mcpUrl),
      ].join("\n"),
    },
  ];
}

/*
 * Connecting an agent that runs on its own (a scheduled job, a CI step),
 * where nobody is there to sign in: an API key in a header.
 */
export function getMcpApiKeySetupMarkdown(mcpUrl: string): string {
  return [
    `Give the agent a project API key in the \`x-api-key\` header. With Claude Code, for example, read it from the \`${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}\` environment variable:`,
    "",
    codeBlock(
      "bash",
      `claude mcp add --transport http oneuptime ${mcpUrl} --header "x-api-key: $${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}"`,
    ),
    "",
    "Create the key with only the permissions the agent needs. Never give an agent a master API key.",
  ].join("\n");
}

export interface AssistantPromptContext {
  modelType: DatabaseBaseModelType;
  // "workflow", "status page": how the prompts call the resource.
  singularName: string;
  pluralName: string;
  // The resource the page is about; unset on a list page.
  displayName?: string | null | undefined;
  id?: string | null | undefined;
  // The API reference page for the model, for assistants that use the API.
  apiReferenceUrl: string;
}

// `the workflow "Send weekly report" (ID 6e4f...)`.
export function describeResourceForPrompt(context: AssistantPromptContext): string {
  const noun: string = toSentenceCaseName(context.singularName);

  if (context.displayName && context.id) {
    return `the ${noun} "${context.displayName}" (ID ${context.id})`;
  }

  if (context.id) {
    return `the ${noun} with ID ${context.id}`;
  }

  return `the ${noun}`;
}

interface PromptSet {
  // Prompts about one resource, given how to refer to it.
  resource: (resource: string) => Array<string>;
  // Prompts about all of them.
  collection: Array<string>;
}

/*
 * Prompts for the resources the MCP server has tools for, by table. Each one
 * asks only for what those tools can do: the timelines, notes and
 * acknowledge/resolve tools exist for incidents and alerts, announcements
 * for status pages, and so on.
 */
const MCP_PROMPTS_BY_TABLE: Readonly<Record<string, PromptSet>> = {
  Monitor: {
    resource: (resource: string): Array<string> => {
      return [
        `Is ${resource} up right now? Show me its status changes from the last 7 days.`,
        `List the incidents ${resource} opened in the last 30 days and how long each took to resolve.`,
        `Update the description of ${resource} to say what it checks and who to call when it is down.`,
      ];
    },
    collection: [
      "Which of my monitors are not operational right now?",
      "List my monitors that have no labels.",
      "Create a website monitor for https://example.com that checks it every 5 minutes.",
    ],
  },
  Incident: {
    resource: (resource: string): Array<string> => {
      return [
        `Summarize ${resource}: what happened, its timeline and where it stands now.`,
        `Acknowledge ${resource} and add an internal note that I am looking into it.`,
        `Draft a public status page update for ${resource}, show it to me, and post it once I approve.`,
      ];
    },
    collection: [
      "Show me the incidents that are not resolved yet, most severe first.",
      "How many incidents did we have in the last 30 days, by severity?",
      "Which monitors caused the most incidents this month?",
    ],
  },
  Alert: {
    resource: (resource: string): Array<string> => {
      return [
        `Summarize ${resource} and its timeline.`,
        `Acknowledge ${resource} and add an internal note that I am looking into it.`,
        `Resolve ${resource} with a note on what fixed it.`,
      ];
    },
    collection: [
      "Which alerts are open right now?",
      "How many alerts fired in the last 7 days, by severity?",
      "Acknowledge every open alert and add a note that I am on it.",
    ],
  },
  ScheduledMaintenance: {
    resource: (resource: string): Array<string> => {
      return [
        `When does ${resource} start and end, and what does it affect?`,
        `What state is ${resource} in, and when did that change?`,
        `Move ${resource} one hour later.`,
      ];
    },
    collection: [
      "What maintenance is scheduled for the next 7 days?",
      'Schedule maintenance called "Database upgrade" for next Saturday from 02:00 to 04:00 UTC.',
    ],
  },
  StatusPage: {
    resource: (resource: string): Array<string> => {
      return [
        `Show me how ${resource} is set up: is it public, and how can people subscribe?`,
        `Post an announcement on ${resource} saying we are investigating slow logins.`,
        `List the announcements on ${resource} from the last 30 days.`,
      ];
    },
    collection: [
      "List my status pages and say which ones are public.",
      "Post an announcement on every public status page about maintenance this Saturday.",
    ],
  },
  StatusPageAnnouncement: {
    resource: (resource: string): Array<string> => {
      return [
        `Show me ${resource} and the status pages it is on.`,
        `End ${resource} now.`,
      ];
    },
    collection: [
      "List the announcements that are showing on my status pages right now.",
      "Post an announcement on every public status page about maintenance this Saturday.",
    ],
  },
  Team: {
    resource: (resource: string): Array<string> => {
      return [
        `Show me ${resource} and what it is for.`,
        `Update the description of ${resource} to say what the team owns.`,
      ];
    },
    collection: ["List the teams in this project.", 'Create a team called "Platform".'],
  },
  OnCallDutyPolicy: {
    resource: (resource: string): Array<string> => {
      return [
        `Show me ${resource} and how it is set up.`,
        `List the incidents from the last 7 days that ${resource} was paged for.`,
      ];
    },
    collection: [
      "List my on-call policies.",
      "Which on-call policies have no labels?",
    ],
  },
};

/*
 * Prompts to start from. With MCP tools for the model, they ask the
 * assistant to use OneUptime directly. Without, they are written for an
 * assistant that can run commands (Claude Code, Cursor, GitHub Copilot):
 * they point it at the API reference and the API key in the environment,
 * and one asks for Terraform instead.
 */
export function getAssistantPrompts(
  context: AssistantPromptContext,
): Array<string> {
  const plural: string = toSentenceCaseName(context.pluralName);
  const noun: string = toSentenceCaseName(context.singularName);
  const terraformType: string | null = getTerraformTypeName(context.modelType);
  const isResource: boolean = Boolean(context.id);
  const resource: string = describeResourceForPrompt(context);

  if (hasMcpTools(context.modelType)) {
    const tableName: string = new context.modelType().tableName || "";
    const curated: PromptSet | undefined = MCP_PROMPTS_BY_TABLE[tableName];

    if (curated) {
      return isResource ? curated.resource(resource) : [...curated.collection];
    }

    if (isResource) {
      return [
        `Show me ${resource} in OneUptime and summarize how it is set up.`,
        `Update the description of ${resource} so it explains what it is for and who owns it.`,
      ];
    }

    return [
      `List my ${plural} in OneUptime.`,
      `Create a ${noun} in OneUptime called "Example ${noun}" and show me what you set.`,
    ];
  }

  const apiNote: string = `Use the OneUptime REST API (reference: ${context.apiReferenceUrl}) with the API key in the ${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE} environment variable.`;

  const prompts: Array<string> = isResource
    ? [
        `Show me ${resource} and explain what it does. ${apiNote}`,
        `Update the description of ${resource} so it explains what it is for. ${apiNote}`,
      ]
    : [
        `List my ${plural} and summarize them in a table. ${apiNote}`,
        `Create a ${noun} called "Example ${noun}" and show me what you set. ${apiNote}`,
      ];

  if (terraformType) {
    prompts.push(
      isResource
        ? `Write Terraform for ${resource} with the oneuptime/oneuptime provider (resource ${terraformType}), with an import block so Terraform adopts the existing one.`
        : `Write Terraform with the oneuptime/oneuptime provider to manage my ${plural} (resource ${terraformType}), and import blocks for the ones I already have.`,
    );
  }

  return prompts;
}
