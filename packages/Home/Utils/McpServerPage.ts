/*
 * What the website's MCP server page (/tool/mcp-server, Views/mcp-server.ejs)
 * and its Markdown copy (/tool/mcp-server.md) tell a person, or an AI agent,
 * about connecting to OneUptime: the address, how each client connects, how
 * to sign in, what it needs from a plan, and the tools to expect. llms.txt
 * sends agents to that copy, so it has to be enough to connect with.
 *
 * Everything here is the real server's (packages/App/FeatureSet/MCP), held to
 * it twice:
 *
 *   - Tests/McpServerPage.test.ts holds the page and its copy to what is
 *     here, what is here to the MCP docs page, and the plan to the billing
 *     plan of the grant a sign-in creates (McpOAuthGrant) and to the pricing
 *     data.
 *   - packages/App/FeatureSet/MCP/Tests/HomeMcpServerPage.test.ts holds every
 *     tool named here to the tools the server lists.
 */

// Where every OneUptime instance serves its MCP server.
export const McpServerPath: string = "/mcp";

// The website's page about it. Its Markdown copy adds .md.
export const McpServerPagePath: string = "/tool/mcp-server";

// The guide with every client, setting and troubleshooting step.
export const McpServerDocsPath: string = "/docs/ai/mcp-server";

// That guide as raw Markdown, for an agent reading it.
export const McpServerDocsMarkdownPath: string =
  "/docs/as-markdown/en/ai/mcp-server";

/*
 * What connecting needs from a plan. McpOAuthGrant and ApiKey set it, and a
 * self-hosted instance has no billing, so it is OneUptime Cloud's alone.
 */
export const McpServerPlanNote: string =
  "On OneUptime Cloud, connecting an MCP client or using an API key needs the Growth plan or higher.";

export interface McpServerTool {
  // The tool's name, as tools/list gives it.
  name: string;
  description: string;
}

export interface McpServerCode {
  // What a Markdown fence names.
  language: "bash" | "json";
  lines: Array<string>;
}

export interface McpServerClientSetup {
  client: string;
  // What to do with the code, or, for a client with none, what to do instead.
  instruction: string;
  code?: McpServerCode | undefined;
}

export interface McpServerPageContent {
  endpoint: string;
  claudeCodeCommand: string;
  // The same command for an agent nobody is there to sign in for.
  apiKeyCommand: string;
  clientSetups: Array<McpServerClientSetup>;
  signIn: string;
  apiKey: string;
  publicTools: string;
  plan: string;
  selfHosted: string;
  // The tools the page shows: the ones that read what a person asks about.
  tools: Array<McpServerTool>;
}

export const McpServerTools: Array<McpServerTool> = [
  { name: "list_incidents", description: "Query active and past incidents" },
  {
    name: "list_monitors",
    description: "Find monitors and check their status",
  },
  { name: "list_logs", description: "Search and filter log entries" },
  { name: "list_metrics", description: "Retrieve metric data points" },
  { name: "list_spans", description: "Find the spans of a distributed trace" },
];

function jsonCode(config: Record<string, unknown>): McpServerCode {
  return {
    language: "json",
    lines: JSON.stringify(config, null, 2).split("\n"),
  };
}

export const getMcpServerPageContent: (
  homeUrl: string,
) => McpServerPageContent = (homeUrl: string): McpServerPageContent => {
  const endpoint: string = `${homeUrl.replace(/\/$/, "")}${McpServerPath}`;
  const claudeCodeCommand: string = `claude mcp add --transport http oneuptime ${endpoint}`;

  return {
    endpoint,
    claudeCodeCommand,
    apiKeyCommand: `${claudeCodeCommand} --header "x-api-key: your-api-key-here"`,
    clientSetups: [
      {
        client: "Claude Code",
        instruction:
          "Run this, then run `/mcp` inside Claude Code and choose **oneuptime** to sign in.",
        code: { language: "bash", lines: [claudeCodeCommand] },
      },
      {
        client: "Claude",
        instruction: `Open **Customize → Connectors**, choose **Add custom connector**, and enter \`${endpoint}\`.`,
      },
      {
        client: "Cursor",
        instruction: "Add this to `.cursor/mcp.json`.",
        code: jsonCode({ mcpServers: { oneuptime: { url: endpoint } } }),
      },
      {
        client: "VS Code with GitHub Copilot",
        instruction: "Add this to `.vscode/mcp.json` and start the server.",
        code: jsonCode({
          servers: { oneuptime: { type: "http", url: endpoint } },
        }),
      },
    ],
    signIn:
      "Give your client the address and sign in to OneUptime when it asks. There is no API key to copy.",
    apiKey:
      "For an agent that runs unattended, create a project API key under Project Settings → Advanced → API Keys and send it in the x-api-key header.",
    publicTools: "The public status page tools need no account or key.",
    plan: McpServerPlanNote,
    selfHosted: `A self-hosted instance serves the same server at ${McpServerPath} on its own address, with no plan needed.`,
    tools: McpServerTools,
  };
};
