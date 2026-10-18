/*
 * EVERY TOOL CARRIES THE TITLE AND THE HINTS MCP DIRECTORIES ASK FOR.
 *
 * Anthropic's Claude Connectors Directory requires every tool to have a
 * `title` and a `readOnlyHint` or `destructiveHint` annotation: its developer
 * portal flags each tool that lacks one, to be fixed on the server before it
 * is submitted, and its reviewers hold tool names to 64 characters. ChatGPT's
 * app directory requires `readOnlyHint`, `destructiveHint` and
 * `openWorldHint` on every tool, each true or false. Claude lets a tool
 * marked read-only run without asking each time, so the hints have to be
 * right as well as present.
 *
 * The rule they are held to here is Tools/ToolAnnotations': every tool
 * states all three, a tool is destructive exactly when it is not read-only,
 * and only the public status page tools, which read any public status page
 * on the instance, are open-world. No directory or client is left to guess.
 *
 * The tools are read the way a client reads them: tools/list, answered by
 * the handlers ToolHandler registers, through the MCP SDK's own Client over
 * an in-memory transport. That is every tool generateAllTools() makes - the
 * tools generated for database and analytics models, and the workflow,
 * helper and public status page tools written by hand.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  /*
   * Only the logger itself is silenced. The module's other exports stay real:
   * the API's error responder calls one of them on every refusal.
   */
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});
jest.mock("../Utils/MCPLogger");

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListToolsResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { registerToolHandlers } from "../Handlers/ToolHandler";
import RequestGate, { McpToolAccess } from "../OAuth/RequestGate";
import { McpServer, createMCPServerInstance } from "../Server/MCPServer";
import { isPublicStatusPageTool } from "../Tools/PublicStatusPageTools";
import { generateAllTools } from "../Tools/ToolGenerator";
import McpCredentialUtil from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";

// The longest tool name the Claude Connectors Directory accepts.
const MAX_TOOL_NAME_LENGTH: number = 64;

// The hints ChatGPT's app directory requires on every tool, true or false.
const REQUIRED_HINTS: Array<
  "readOnlyHint" | "destructiveHint" | "openWorldHint"
> = ["readOnlyHint", "destructiveHint", "openWorldHint"];

// What a directory would flag on a tool as it is listed: nothing, if it passes.
function directoryFlags(tool: Tool): Array<string> {
  const flags: Array<string> = [];

  if (typeof tool.title !== "string" || tool.title.trim() === "") {
    flags.push("no title");
  }

  for (const hint of REQUIRED_HINTS) {
    if (typeof tool.annotations?.[hint] !== "boolean") {
      flags.push(`no ${hint}`);
    }
  }

  if (tool.name.length > MAX_TOOL_NAME_LENGTH) {
    flags.push(`a name longer than ${MAX_TOOL_NAME_LENGTH} characters`);
  }

  return flags;
}

// Each tool a directory would flag, by name, with what it would flag on it.
function flaggedTools(tools: Array<Tool>): Array<[string, Array<string>]> {
  return tools
    .map((tool: Tool): [string, Array<string>] => {
      return [tool.name, directoryFlags(tool)];
    })
    .filter(([, flags]: [string, Array<string>]): boolean => {
      return flags.length > 0;
    });
}

function nameOf(tool: { name: string }): string {
  return tool.name;
}

describe("every tool carries the title and the hints MCP directories ask for", () => {
  const tools: Array<McpToolInfo> = generateAllTools();

  let listing: ListToolsResult | undefined;
  let mcpServer: McpServer | undefined;
  let client: Client | undefined;

  beforeAll(async () => {
    const [clientTransport, serverTransport]: [
      InMemoryTransport,
      InMemoryTransport,
    ] = InMemoryTransport.createLinkedPair();

    // A directory lists the tools before anyone has signed in.
    mcpServer = createMCPServerInstance();
    registerToolHandlers(mcpServer, tools, McpCredentialUtil.none());
    await mcpServer.connect(serverTransport);

    client = new Client({
      name: "directory-annotations-test",
      version: "1.0.0",
    });
    await client.connect(clientTransport);

    listing = await client.listTools();
  });

  afterAll(async () => {
    await client?.close();
    await mcpServer?.close();
  });

  function listed(): Array<Tool> {
    return listing?.tools || [];
  }

  test("tools/list answers with every tool, of every kind, on one page (the checks below are not vacuous)", () => {
    expect(listing?.nextCursor).toBeUndefined();
    expect(listed().map(nameOf)).toEqual(tools.map(nameOf));

    const names: Array<string> = listed().map(nameOf);

    for (const name of [
      // Generated for a database model: one tool per operation.
      "create_incident",
      "get_incident",
      "list_incidents",
      "update_incident",
      "delete_incident",
      "count_incidents",
      // Generated for an analytics model: read-only.
      "list_logs",
      "count_logs",
      // Written by hand: workflow, helper and public status page tools.
      "acknowledge_incident",
      "add_incident_note",
      "oneuptime_whoami",
      "oneuptime_help",
      "get_public_status_page_overview",
    ]) {
      expect([name, names.includes(name)]).toEqual([name, true]);
    }

    expect(names.length).toBeGreaterThan(100);
  });

  test("every tool has a title, and says whether it is read-only, destructive and open-world", () => {
    expect(flaggedTools(listed())).toEqual([]);
  });

  test("a tool is marked read-only exactly when the server lets a read-only sign-in call it", () => {
    const mismarked: Array<[string, unknown]> = listed()
      .filter((tool: Tool): boolean => {
        const readsOnly: boolean =
          RequestGate.getToolAccess(tool.name, tools) !== McpToolAccess.Write;

        return tool.annotations?.readOnlyHint !== readsOnly;
      })
      .map((tool: Tool): [string, unknown] => {
        return [tool.name, tool.annotations?.readOnlyHint];
      });

    expect(mismarked).toEqual([]);
  });

  test("a tool is marked destructive exactly when it changes something", () => {
    const mismarked: Array<[string, unknown, unknown]> = listed()
      .filter((tool: Tool): boolean => {
        return (
          tool.annotations?.destructiveHint !==
          (tool.annotations?.readOnlyHint === false)
        );
      })
      .map((tool: Tool): [string, unknown, unknown] => {
        return [
          tool.name,
          tool.annotations?.readOnlyHint,
          tool.annotations?.destructiveHint,
        ];
      });

    expect(mismarked).toEqual([]);

    // Writes of every kind: generated, and written by hand.
    const destructive: Array<string> = listed()
      .filter((tool: Tool): boolean => {
        return tool.annotations?.destructiveHint === true;
      })
      .map(nameOf);

    for (const name of [
      "create_incident",
      "update_incident",
      "delete_incident",
      "acknowledge_incident",
      "resolve_incident",
      "add_incident_note",
    ]) {
      expect([name, destructive.includes(name)]).toEqual([name, true]);
    }
  });

  test("only the public status page tools reach past the caller's project", () => {
    const openWorld: Array<string> = listed()
      .filter((tool: Tool): boolean => {
        return tool.annotations?.openWorldHint === true;
      })
      .map(nameOf);

    expect(openWorld).toEqual(
      listed().map(nameOf).filter(isPublicStatusPageTool),
    );
    expect(openWorld).toContain("get_public_status_page_overview");
  });

  test("the check flags a tool that lacks any of them, and only that tool", () => {
    const inputSchema: Tool["inputSchema"] = { type: "object" };
    const reads: Tool["annotations"] = {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    };

    expect(
      flaggedTools([
        { name: "no_title", inputSchema, annotations: reads },
        { name: "blank_title", title: "  ", inputSchema, annotations: reads },
        // A title only in annotations is not the tool's title.
        {
          name: "title_in_annotations",
          inputSchema,
          annotations: { ...reads, title: "Title In Annotations" },
        },
        { name: "no_annotations", title: "No Annotations", inputSchema },
        {
          name: "destructive_only",
          title: "Destructive Only",
          inputSchema,
          annotations: { destructiveHint: true },
        },
        // Enough for MCP, which reads the rest as their defaults, but not for ChatGPT.
        {
          name: "read_only_only",
          title: "Read Only Only",
          inputSchema,
          annotations: { readOnlyHint: true },
        },
        {
          name: "writes_without_saying_how",
          title: "Writes Without Saying How",
          inputSchema,
          annotations: { readOnlyHint: false, openWorldHint: false },
        },
        {
          name: "n".repeat(MAX_TOOL_NAME_LENGTH + 1),
          title: "Long Name",
          inputSchema,
          annotations: reads,
        },
        {
          name: "n".repeat(MAX_TOOL_NAME_LENGTH),
          title: "Longest Name",
          inputSchema,
          annotations: reads,
        },
        { name: "reads", title: "Reads", inputSchema, annotations: reads },
        {
          name: "writes",
          title: "Writes",
          inputSchema,
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            openWorldHint: false,
          },
        },
      ]),
    ).toEqual([
      ["no_title", ["no title"]],
      ["blank_title", ["no title"]],
      ["title_in_annotations", ["no title"]],
      [
        "no_annotations",
        ["no readOnlyHint", "no destructiveHint", "no openWorldHint"],
      ],
      ["destructive_only", ["no readOnlyHint", "no openWorldHint"]],
      ["read_only_only", ["no destructiveHint", "no openWorldHint"]],
      ["writes_without_saying_how", ["no destructiveHint"]],
      [
        "n".repeat(MAX_TOOL_NAME_LENGTH + 1),
        [`a name longer than ${MAX_TOOL_NAME_LENGTH} characters`],
      ],
    ]);
  });
});
