/*
 * TOOLS/LIST STAYS SMALL ENOUGH TO LOAD.
 *
 * tools/list is one answer, and a client that does not defer its tools puts
 * every word of it in front of the model before anyone has asked anything. On
 * 2026-11-02 oneuptime.com answered it with 283 tools and 1,202,028 bytes,
 * about 300,000 tokens at four characters a token: more than most models hold.
 * The tools were not too many (Rootly lists about 255 in Claude's connector
 * directory); their schemas were too big. A list and a count tool each carried
 * every field of their model with its operators and an example, and the same
 * words were repeated on every tool.
 *
 * So a list and a count tool now say how to write a filter and leave the fields
 * to oneuptime_describe_resource, which an agent asks about one resource at a
 * time (Tests/DescribeResource), and generated schemas carry no examples.
 *
 * Every new model adds six tools, so this answer grows with the product. The
 * budget is what stops it growing back unnoticed: when a change goes over it,
 * make the tools say less, or raise it in the same change and say why. What is
 * said once in a helper costs an agent that needs it; what is said on a tool
 * costs every client on every connection.
 *
 * The answer is read the way a client reads it: through the MCP SDK's Client,
 * over an in-memory transport, and measured as the JSON that crosses the wire.
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
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { registerToolHandlers } from "../Handlers/ToolHandler";
import { McpServer, createMCPServerInstance } from "../Server/MCPServer";
import { DESCRIBE_RESOURCE_TOOL_NAME } from "../Tools/HelperTools";
import { generateAllTools } from "../Tools/ToolGenerator";
import McpCredentialUtil from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";

// The budget for the whole answer: about 62,500 tokens at four bytes a token.
const MAX_TOOLS_LIST_BYTES: number = 250_000;

// The most any one tool may take of it.
const MAX_TOOL_BYTES: number = 5_000;

const LIST_OR_COUNT_TOOL: RegExp = /^(list|count)_/;

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// Every key anywhere inside a JSON value.
function keysIn(value: unknown): Array<string> {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(keysIn);
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, member]: [string, unknown]): Array<string> => {
      return [key, ...keysIn(member)];
    },
  );
}

function nameOf(tool: { name: string }): string {
  return tool.name;
}

describe("tools/list stays small enough for a client to load", () => {
  const tools: Array<McpToolInfo> = generateAllTools();

  let listing: ListToolsResult | undefined;
  let mcpServer: McpServer | undefined;
  let client: Client | undefined;

  beforeAll(async () => {
    const [clientTransport, serverTransport]: [
      InMemoryTransport,
      InMemoryTransport,
    ] = InMemoryTransport.createLinkedPair();

    mcpServer = createMCPServerInstance();
    registerToolHandlers(mcpServer, tools, McpCredentialUtil.none());
    await mcpServer.connect(serverTransport);

    client = new Client({ name: "tool-list-budget-test", version: "1.0.0" });
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

  function listOrCountTools(): Array<Tool> {
    return listed().filter((tool: Tool): boolean => {
      return LIST_OR_COUNT_TOOL.test(tool.name);
    });
  }

  function findTool(name: string): Tool {
    const tool: Tool | undefined = listed().find((candidate: Tool): boolean => {
      return candidate.name === name;
    });

    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    return tool;
  }

  test("reads every tool, so the budget measures the whole answer", () => {
    expect(listing?.nextCursor).toBeUndefined();
    expect(listed().map(nameOf)).toEqual(tools.map(nameOf));
    expect(listed().length).toBeGreaterThan(280);
    expect(listOrCountTools().length).toBeGreaterThan(100);
  });

  test(`the whole answer is at most ${MAX_TOOLS_LIST_BYTES} bytes`, () => {
    const bytes: number = bytesOf({ result: listing, jsonrpc: "2.0", id: 1 });

    // The biggest tools, in the failure: where to start cutting.
    const biggest: Array<string> = [...listed()]
      .sort((a: Tool, b: Tool): number => {
        return bytesOf(b) - bytesOf(a);
      })
      .slice(0, 5)
      .map((tool: Tool): string => {
        return `${tool.name}: ${bytesOf(tool)}`;
      });

    expect({ bytes, withinBudget: bytes <= MAX_TOOLS_LIST_BYTES }).toEqual({
      bytes,
      withinBudget: true,
    });
    expect(biggest).toHaveLength(5);
  });

  test(`no tool takes more than ${MAX_TOOL_BYTES} bytes of it`, () => {
    const overBudget: Array<[string, number]> = listed()
      .map((tool: Tool): [string, number] => {
        return [tool.name, bytesOf(tool)];
      })
      .filter(([, bytes]: [string, number]): boolean => {
        return bytes > MAX_TOOL_BYTES;
      });

    expect(overBudget).toEqual([]);
  });

  test("no tool's schema carries an example", () => {
    const withExamples: Array<string> = listed()
      .filter((tool: Tool): boolean => {
        return keysIn(tool.inputSchema).includes("example");
      })
      .map(nameOf);

    expect(withExamples).toEqual([]);
  });

  test("a list or count tool does not list its model's fields", () => {
    for (const tool of listOrCountTools()) {
      const query: Record<string, unknown> | undefined = tool.inputSchema
        .properties?.["query"] as Record<string, unknown> | undefined;

      expect([tool.name, query?.["properties"]]).toEqual([
        tool.name,
        undefined,
      ]);
      expect([tool.name, query?.["additionalProperties"]]).toEqual([
        tool.name,
        true,
      ]);
    }
  });

  test("a list or count tool says how a filter is written, and where the fields are", () => {
    for (const tool of listOrCountTools()) {
      const query: { description?: string } | undefined = tool.inputSchema
        .properties?.["query"] as { description?: string } | undefined;

      expect([tool.name, query?.description]).toEqual([
        tool.name,
        expect.stringContaining('{"_type":"GreaterThan","value":...}'),
      ]);
      expect(query?.description).toContain(DESCRIBE_RESOURCE_TOOL_NAME);
    }

    expect(listed().map(nameOf)).toContain(DESCRIBE_RESOURCE_TOOL_NAME);
  });

  test("a list tool still says which directions a sort takes", () => {
    const validator: AjvJsonSchemaValidator = new AjvJsonSchemaValidator();

    for (const tool of listOrCountTools().filter((tool: Tool): boolean => {
      return tool.name.startsWith("list_");
    })) {
      const check: (input: unknown) => { valid: boolean } =
        validator.getValidator(tool.inputSchema as never);

      expect([tool.name, check({ sort: { anyField: "DESC" } }).valid]).toEqual([
        tool.name,
        true,
      ]);
      expect([tool.name, check({ sort: { anyField: "UP" } }).valid]).toEqual([
        tool.name,
        false,
      ]);
    }
  });

  test("a create or update tool still names and types every field, so a client can check a call", () => {
    const validator: AjvJsonSchemaValidator = new AjvJsonSchemaValidator();

    const checkCreate: (input: unknown) => { valid: boolean } =
      validator.getValidator(findTool("create_incident").inputSchema as never);
    const checkUpdate: (input: unknown) => { valid: boolean } =
      validator.getValidator(findTool("update_incident").inputSchema as never);

    const title: string = "Database down";
    const incidentSeverityId: string = "550e8400-e29b-41d4-a716-446655440000";

    expect(checkCreate({ title, incidentSeverityId }).valid).toBe(true);
    // What the schema asks for is what it always asked for.
    expect(checkCreate({ title }).valid).toBe(false);
    expect(checkCreate({ title, incidentSeverityId, nope: 1 }).valid).toBe(
      false,
    );
    expect(checkUpdate({ id: incidentSeverityId, title }).valid).toBe(true);
    expect(checkUpdate({ id: incidentSeverityId, nope: 1 }).valid).toBe(false);
    expect(checkUpdate({ id: incidentSeverityId, title: 1 }).valid).toBe(false);
  });

  test("a create tool explains the fields a call cannot leave out, and an update tool leaves that to the helper", () => {
    const properties: (
      name: string,
    ) => Record<string, { description?: string }> = (
      name: string,
    ): Record<string, { description?: string }> => {
      return findTool(name).inputSchema.properties as Record<
        string,
        { description?: string }
      >;
    };

    expect(properties("create_incident")["title"]?.description).toBe(
      "Title of this incident.",
    );
    expect(
      properties("create_incident")["description"]?.description,
    ).toBeUndefined();
    expect(properties("update_incident")["title"]?.description).toBeUndefined();
    // An id is the one thing a call to update or delete cannot go without.
    expect(properties("update_incident")["id"]?.description).toContain("ID");

    for (const name of ["create_incident", "update_incident"]) {
      expect(findTool(name).description).toContain(DESCRIBE_RESOURCE_TOOL_NAME);
    }
  });

  test("a typed value keeps the shape the API reads, though its example is gone", () => {
    const declaredAt: Record<string, unknown> | undefined = findTool(
      "create_incident",
    ).inputSchema.properties?.["declaredAt"] as
      | Record<string, unknown>
      | undefined;

    expect(declaredAt).toEqual({
      type: "object",
      properties: {
        _type: { type: "string", enum: ["DateTime"] },
        value: { type: "string" },
      },
      required: ["_type", "value"],
    });

    const check: (input: unknown) => { valid: boolean } =
      new AjvJsonSchemaValidator().getValidator(
        findTool("update_label").inputSchema as never,
      );

    expect(
      check({
        id: "550e8400-e29b-41d4-a716-446655440000",
        color: { _type: "Color", value: "#ff0000" },
      }).valid,
    ).toBe(true);
    expect(
      check({
        id: "550e8400-e29b-41d4-a716-446655440000",
        color: { _type: "Name", value: "#ff0000" },
      }).valid,
    ).toBe(false);
  });

  test("every tool's schema compiles, so a client that validates can use it", () => {
    const validator: AjvJsonSchemaValidator = new AjvJsonSchemaValidator();

    for (const tool of listed()) {
      expect(() => {
        return validator.getValidator(tool.inputSchema as never);
      }).not.toThrow();
    }
  });
});
