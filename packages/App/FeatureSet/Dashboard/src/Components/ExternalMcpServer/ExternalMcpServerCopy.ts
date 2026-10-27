import ExternalMcpServerAuthType, {
  readExternalMcpServerAuthType,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import { ExternalMcpServerFailureKind } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import {
  ExternalMcpServerTool,
  countExternalMcpServerChangingTools,
  readExternalMcpServerTools,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import IconProp from "Common/Types/Icon/IconProp";
import {
  RULE_CODE_REPOSITORIES_FIELD_COPY,
  hasRuleCodeRepositories,
} from "../Code/RuleCodeRepositoriesCopy";
import type { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT SETTINGS → AI → EXTERNAL MCP SERVERS SAYS, in one place, React-free
 * so the pages, their tests and the docs tests read the same words.
 *
 * The maintainer: "have a way where OneUptime AI can integrate with MCP
 * tools or MCP servers ... in project settings ... this is how OneUptime AI
 * can integrate with other MCP tools like Azure / AWS". A project adds the
 * MCP servers it already runs or subscribes to - a name, the address, and
 * how OneUptime signs in - and OneUptime AI uses their tools: in
 * investigations the ones that only read, in fixes the others too, the way
 * the auto remediation rule's Approval says.
 *
 * "External", because the AI section also holds MCP Server: OneUptime's
 * own server, which AI assistants connect to. This page is the other way
 * round, and its card says so.
 */

export const EXTERNAL_MCP_SERVERS_PAGE_COPY: {
  title: string;
  description: string;
  ownServerNote: string;
  noItemsMessage: string;
} = {
  title: translationKey("External MCP Servers"),
  description: translationKey(
    "MCP servers outside OneUptime whose tools OneUptime AI may use while it investigates and fixes, such as AWS, Azure or GitHub.",
  ),
  ownServerNote: translationKey(
    "To connect an AI assistant to OneUptime instead, use {{mcpServerLink}}.",
  ),
  noItemsMessage: translationKey(
    "No MCP servers yet. Add one to let OneUptime AI use its tools.",
  ),
};

// What the add / edit form says under its fields (ExternalMcpServerFormFields).
export const EXTERNAL_MCP_SERVER_FIELD_COPY: {
  namePlaceholder: string;
  urlPlaceholder: string;
  urlHint: string;
  descriptionPlaceholder: string;
  descriptionHint: string;
  tokenHint: string;
  headersHint: string;
  tokenUrlPlaceholder: string;
  tokenUrlHint: string;
  scopePlaceholder: string;
  scopeHint: string;
  audienceHint: string;
} = {
  namePlaceholder: translationKey("AWS"),
  urlPlaceholder: "https://mcp.example.com/mcp",
  urlHint: translationKey(
    "The server's MCP address. Streamable HTTP and SSE both work.",
  ),
  descriptionPlaceholder: translationKey(
    "Production AWS account, read-only role",
  ),
  descriptionHint: translationKey(
    "OneUptime AI reads it to pick the right server.",
  ),
  tokenHint: translationKey(
    "Sent as a bearer token. Stored encrypted and never shown again.",
  ),
  headersHint: translationKey(
    "Sent with every request. Values are stored encrypted and never shown again.",
  ),
  tokenUrlPlaceholder:
    "https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token",
  tokenUrlHint: translationKey("Your identity provider's token endpoint."),
  scopePlaceholder: "api://<application-id>/.default",
  scopeHint: translationKey("Leave empty when the token URL needs none."),
  audienceHint: translationKey(
    "Only for a token URL that asks for one, such as Auth0's.",
  ),
};

/*
 * The Authentication choices, as cards: one a row (the form draws them in a
 * single column), each said in one short line, so the four read top to
 * bottom like the rule dialogs' Approval cards - in every language.
 */
export const EXTERNAL_MCP_SERVER_AUTH_OPTIONS: Array<CardSelectOption> = [
  {
    value: ExternalMcpServerAuthType.None,
    title: translationKey("No sign-in"),
    description: translationKey("For a server that needs no sign-in."),
    icon: IconProp.Globe,
  },
  {
    value: ExternalMcpServerAuthType.BearerToken,
    title: translationKey("Bearer token"),
    description: translationKey("An API token or key from the server."),
    icon: IconProp.Key,
  },
  {
    value: ExternalMcpServerAuthType.Headers,
    title: translationKey("Custom headers"),
    description: translationKey(
      "Headers the server asks for, such as X-API-Key.",
    ),
    icon: IconProp.List,
  },
  {
    value: ExternalMcpServerAuthType.OAuthClientCredentials,
    title: translationKey("OAuth client credentials"),
    description: translationKey(
      "A token from your identity provider, such as Microsoft Entra ID or Amazon Cognito.",
    ),
    icon: IconProp.Lock,
  },
];

// What a server's Authentication is called on its page.
export function getExternalMcpServerAuthTitle(value: unknown): string {
  const authType: ExternalMcpServerAuthType =
    readExternalMcpServerAuthType(value);

  return (
    EXTERNAL_MCP_SERVER_AUTH_OPTIONS.find(
      (option: CardSelectOption): boolean => {
        return option.value === authType;
      },
    )?.title || EXTERNAL_MCP_SERVER_AUTH_OPTIONS[0]!.title
  );
}

// How a server is doing, as its list and its page say it.
export enum ExternalMcpServerStatusKind {
  Off = "Off",
  CannotConnect = "CannotConnect",
  Connected = "Connected",
  NotChecked = "NotChecked",
}

export const EXTERNAL_MCP_SERVER_STATUS_TITLES: Record<
  ExternalMcpServerStatusKind,
  string
> = {
  [ExternalMcpServerStatusKind.Off]: translationKey("Off"),
  [ExternalMcpServerStatusKind.CannotConnect]: translationKey("Can't connect"),
  [ExternalMcpServerStatusKind.Connected]: translationKey("Connected"),
  [ExternalMcpServerStatusKind.NotChecked]: translationKey("Not checked yet"),
};

/*
 * A server that is off, then one whose last connection failed (a working
 * connection clears the error), then one that connected, then one never
 * tried.
 */
export function getExternalMcpServerStatus(server: {
  isEnabled?: boolean | undefined | null;
  lastError?: string | undefined | null;
  lastConnectedAt?: Date | string | undefined | null;
}): ExternalMcpServerStatusKind {
  if (server.isEnabled === false) {
    return ExternalMcpServerStatusKind.Off;
  }

  if (server.lastError) {
    return ExternalMcpServerStatusKind.CannotConnect;
  }

  if (server.lastConnectedAt) {
    return ExternalMcpServerStatusKind.Connected;
  }

  return ExternalMcpServerStatusKind.NotChecked;
}

export const EXTERNAL_MCP_SERVER_TOOL_COUNT: PluralTemplate = {
  one: "{{count}} tool",
  other: "{{count}} tools",
};

/*
 * A server can offer up to 200 tools: its page lists the first
 * EXTERNAL_MCP_SERVER_TOOLS_SHOWN, and this opens the rest.
 */
export const EXTERNAL_MCP_SERVER_TOOLS_SHOWN: number = 10;

export const EXTERNAL_MCP_SERVER_SHOW_ALL_TOOLS: PluralTemplate = {
  one: "Show all {{count}} tool",
  other: "Show all {{count}} tools",
};

export const EXTERNAL_MCP_SERVER_TOOL_BADGES: {
  readsOnly: string;
  mayChange: string;
} = {
  readsOnly: translationKey("Reads only"),
  mayChange: translationKey("May change things"),
};

// What a server's Tools card says: what OneUptime AI does with each kind.
export const EXTERNAL_MCP_SERVER_TOOLS_COPY: {
  title: string;
  description: string;
  noTools: string;
  notReadYet: string;
  leftOut: string;
} = {
  title: translationKey("Tools"),
  description: translationKey(
    "Investigations use only the tools that read. Fixes also use the others, the way the AI rule's Fix setting says.",
  ),
  noTools: translationKey("The server offers no tools."),
  notReadYet: translationKey(
    "OneUptime has not read this server's tools yet. Test the connection to read them.",
  ),
  leftOut: translationKey(
    "The server offers more tools than OneUptime reads. Only these are used.",
  ),
};

// The switch on a server's page.
export const EXTERNAL_MCP_SERVER_SWITCH_COPY: {
  cardTitle: string;
  cardDescription: string;
  title: string;
  on: string;
  off: string;
  confirmOffTitle: string;
  confirmOffDescription: string;
  confirmOffButton: string;
} = {
  cardTitle: translationKey("OneUptime AI"),
  cardDescription: translationKey(
    "Turn the server off without deleting it. Its address and sign-in are kept.",
  ),
  title: translationKey("Let OneUptime AI use this server"),
  on: translationKey(
    "On: rules decide which incidents and alerts it is used for.",
  ),
  off: translationKey(
    "Off: OneUptime AI never uses it, whatever a rule names.",
  ),
  confirmOffTitle: translationKey("Turn this server off?"),
  confirmOffDescription: translationKey(
    "OneUptime AI stops using it at once, in every investigation and fix. Fixes waiting for approval that use it can no longer be approved.",
  ),
  confirmOffButton: translationKey("Turn off"),
};

/*
 * What a locked Test button says to someone who may read servers but not
 * change one: the first sentence of the server's refusal, word for word
 * (ExternalMcpServerAPI). The gate adds who may.
 */
export const EXTERNAL_MCP_SERVER_TEST_REFUSED_SENTENCE: string = translationKey(
  "You do not have permission to test this MCP server.",
);

// The Test dialog.
export const EXTERNAL_MCP_SERVER_TEST_COPY: {
  title: string;
  testing: string;
  connected: string;
  connectedTo: string;
  connectedOver: string;
  failed: string;
  testAgain: string;
  test: string;
  close: string;
} = {
  title: translationKey("Test connection"),
  testing: translationKey(
    "Connecting to the MCP server and reading its tools…",
  ),
  connected: translationKey("Connected"),
  // Under "Connected": who answered, by the server's own name, and how.
  connectedTo: translationKey("{{server}} answered over {{transport}}."),
  connectedOver: translationKey("The server answered over {{transport}}."),
  failed: translationKey("Could not connect"),
  testAgain: translationKey("Test again"),
  test: translationKey("Test"),
  close: translationKey("Close"),
};

/*
 * What to do about a failed connection, by its kind, after the server's own
 * words (which are the server's, in English).
 */
export const EXTERNAL_MCP_SERVER_FAILURE_HINTS: Record<
  ExternalMcpServerFailureKind,
  string
> = {
  [ExternalMcpServerFailureKind.AddressNotAllowed]: translationKey(
    "Use the server's public address. On a self-hosted OneUptime, your administrator can allow private addresses.",
  ),
  [ExternalMcpServerFailureKind.Unreachable]: translationKey(
    "Check the URL, and that the server is running and can be reached from OneUptime.",
  ),
  [ExternalMcpServerFailureKind.SignInRefused]: translationKey(
    "Check the token or headers under Authentication.",
  ),
  [ExternalMcpServerFailureKind.TokenRequestFailed]: translationKey(
    "Check the token URL, client ID, client secret and scope under Authentication.",
  ),
  [ExternalMcpServerFailureKind.NotAnMcpServer]: translationKey(
    "Check that the URL is the server's MCP address, such as https://mcp.example.com/mcp.",
  ),
  [ExternalMcpServerFailureKind.TimedOut]: translationKey(
    "Check that the server is running, then test again.",
  ),
  [ExternalMcpServerFailureKind.TooLarge]: translationKey(
    "The server sent more than OneUptime reads in one answer.",
  ),
  [ExternalMcpServerFailureKind.ServerError]: translationKey(
    "Check the server's own logs for the error.",
  ),
  [ExternalMcpServerFailureKind.Other]: translationKey(
    "Test again, or check the server.",
  ),
};

// What the Dashboard says to do about a failed connection, by its kind.
export function getExternalMcpServerFailureHint(
  kind: ExternalMcpServerFailureKind | undefined,
): string {
  return EXTERNAL_MCP_SERVER_FAILURE_HINTS[
    kind || ExternalMcpServerFailureKind.Other
  ];
}

// The tools of a stored server, and how many may change something.
export function readStoredExternalMcpServerTools(value: unknown): {
  tools: Array<ExternalMcpServerTool>;
  changingTools: number;
  isRead: boolean;
} {
  const tools: Array<ExternalMcpServerTool> = readExternalMcpServerTools(value);

  return {
    tools,
    changingTools: countExternalMcpServerChangingTools(tools),
    isRead: Array.isArray(value),
  };
}

/*
 * What a rule's "MCP servers" field says, under an AI rule's More fields:
 * the servers OneUptime AI may use while it investigates (their tools that
 * read) and fixes what the rule matches. The field's line is true of every
 * rule - one that doesn't fix uses them only to investigate - so it says
 * neither.
 */
export const RULE_MCP_SERVERS_FIELD_COPY: {
  title: string;
  placeholder: string;
  aiRuleDescription: string;
  manageHint: string;
  allServersSummary: string;
  emptyList: string;
} = {
  title: translationKey("MCP Servers"),
  placeholder: translationKey("All MCP servers"),
  aiRuleDescription: translationKey(
    "OneUptime AI may use all of your MCP servers. Pick some to let it use only those.",
  ),
  manageHint: translationKey(
    "Add and manage MCP servers on the {{externalMcpServersLink}} page.",
  ),
  allServersSummary: translationKey(
    "OneUptime AI may use all of your MCP servers.",
  ),
  /*
   * What the open list says while the project has no MCP server: the line
   * under the field says where one is added.
   */
  emptyList: translationKey("No MCP servers yet."),
};

// Whether the rule being edited names MCP servers: rows, ids or dropdown picks.
export function hasRuleMcpServers(values: unknown): boolean {
  const servers: unknown =
    values && typeof values === "object"
      ? (values as { externalMcpServers?: unknown }).externalMcpServers
      : undefined;

  return Array.isArray(servers) && servers.length > 0;
}

/*
 * What an investigation rule's folded More fields says while it names no
 * MCP server and no code repository, as a new rule does: both defaults in
 * one sentence.
 */
export const INVESTIGATION_RULE_MORE_FIELDS_SUMMARIES: {
  everything: string;
} = {
  everything: translationKey(
    "OneUptime AI may use any of your MCP servers and connected repositories.",
  ),
};

/*
 * The sentences an investigation rule's folded More fields says while it
 * names no MCP server, or no code repository: what each default does - one
 * sentence while it keeps both.
 */
export function getInvestigationRuleMoreFieldsSummary(
  values: unknown,
): Array<string> | undefined {
  if (!hasRuleMcpServers(values) && !hasRuleCodeRepositories(values)) {
    return [INVESTIGATION_RULE_MORE_FIELDS_SUMMARIES.everything];
  }

  const sentences: Array<string> = [];

  if (!hasRuleMcpServers(values)) {
    sentences.push(RULE_MCP_SERVERS_FIELD_COPY.allServersSummary);
  }

  if (!hasRuleCodeRepositories(values)) {
    sentences.push(RULE_CODE_REPOSITORIES_FIELD_COPY.allRepositoriesSummary);
  }

  return sentences.length > 0 ? sentences : undefined;
}
