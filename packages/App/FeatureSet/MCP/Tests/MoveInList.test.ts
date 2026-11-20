/**
 * THE TOOL THAT MOVES A ROW OF AN ORDERED LIST (issue #9651).
 *
 * Since #9573 and #9650 a write of a list's number places that row and moves
 * no other: an agent that writes `order: 1` on a severity with
 * update_incident_severity only puts it beside the severity at 1. Moving a
 * row past others is the API's move request, POST <list>/:id/move
 * { placeOfId }, which the dashboard's drag sends - and which the MCP server
 * now sends too, through oneuptime_move_in_list. Here: the lists it takes,
 * the request it sends and what it answers, the refusals it passes on, and
 * that it is a write - destructive, never offered on a read-only server or
 * to a read-only sign-in - that changes nothing outside the project.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
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

import http from "http";
import { AddressInfo } from "net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerToolHandlers } from "../Handlers/ToolHandler";
import RequestGate, { McpToolAccess } from "../OAuth/RequestGate";
import { McpServer, createMCPServerInstance } from "../Server/MCPServer";
import OneUptimeApiService, {
  OneUptimeApiError,
} from "../Services/OneUptimeApiService";
import { handleHelperTool } from "../Tools/HelperTools";
import {
  MOVE_IN_LIST_TOOL_NAME,
  MovableList,
  findMovableList,
  getMovableLists,
  moveInList,
} from "../Tools/MoveInList";
import {
  applyWritePolicy,
  generateAllTools,
  getWritePolicy,
} from "../Tools/ToolGenerator";
import { isWorkflowTool } from "../Tools/WorkflowTools";
import McpCredentialUtil, {
  McpCredential,
  McpCredentialInput,
} from "../Types/McpCredential";
import { JSONSchemaProperty, McpToolInfo } from "../Types/McpTypes";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import MoveInListUtil from "Common/Types/Database/MoveInList";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import ObjectID from "Common/Types/ObjectID";

const API_KEY: string = "3b241101-e2bb-4255-8caf-4136c566a962";
const ROW_ID: string = "550e8400-e29b-41d4-a716-446655440000";
const PLACE_ID: string = "550e8400-e29b-41d4-a716-446655440001";
const OTHER_ID: string = "550e8400-e29b-41d4-a716-446655440002";

function oauthCredential(scopes: Array<McpOAuthScope>): McpCredential {
  const grant: McpOAuthGrant = new McpOAuthGrant();

  grant._id = ObjectID.generate().toString();
  grant.projectId = ObjectID.generate();
  grant.userId = ObjectID.generate();
  grant.clientId = ObjectID.generate().toString();
  grant.name = "Claude Code";
  grant.scope = scopes.join(" ");

  return McpCredentialUtil.fromPrincipal({
    grant,
    user: {
      id: grant.userId,
      email: new Email("member@example.com"),
      name: "A Member",
      isMasterAdmin: false,
    },
    scopes,
  });
}

const READ_ONLY: McpCredential = oauthCredential([McpOAuthScope.Read]);

const tools: Array<McpToolInfo> = generateAllTools();

function moveTool(): McpToolInfo {
  const tool: McpToolInfo | undefined = tools.find(
    (candidate: McpToolInfo): boolean => {
      return candidate.name === MOVE_IN_LIST_TOOL_NAME;
    },
  );

  if (!tool) {
    throw new Error(`${MOVE_IN_LIST_TOOL_NAME} is not generated.`);
  }

  return tool;
}

function nameOf(list: MovableList): string {
  return list.singularName;
}

describe("the lists the tool moves rows of", () => {
  it("are the ordered lists the MCP server has tools for, each by its own column", () => {
    const expected: Array<string> = DatabaseModels.map(
      (ModelClass: { new (): DatabaseBaseModel }): DatabaseBaseModel => {
        return new ModelClass();
      },
    )
      .filter((model: DatabaseBaseModel): boolean => {
        return Boolean(
          model.enableMCP &&
            model.crudApiPath &&
            MoveInListUtil.getListColumn(model),
        );
      })
      .map((model: DatabaseBaseModel): string => {
        return model.tableName!;
      })
      .sort();

    expect(
      getMovableLists()
        .map((list: MovableList): string => {
          return list.tableName;
        })
        .sort(),
    ).toEqual(expected);

    // Severities, states, statuses and priorities, at least.
    expect(expected.length).toBeGreaterThanOrEqual(9);
    expect(findMovableList("Incident Severity")).toEqual(
      expect.objectContaining({
        tableName: "IncidentSeverity",
        apiPath: "/incident-severity",
        column: "order",
      }),
    );
    expect(findMovableList("Monitor Status")?.column).toBe("priority");
  });

  it("leaves out a record that is no list, and a list the server has no tools for", () => {
    expect(findMovableList("Incident")).toBeUndefined();
    expect(findMovableList("list_incidents")).toBeUndefined();
    // Log pipelines are ordered, but have no MCP tools to find their IDs with.
    expect(findMovableList("Log Pipeline")).toBeUndefined();
    expect(findMovableList("")).toBeUndefined();
    expect(findMovableList(undefined)).toBeUndefined();
    expect(findMovableList(42)).toBeUndefined();
  });

  it.each([
    "Incident Severity",
    "incident severity",
    "IncidentSeverity",
    "incident_severity",
    "Incident Severities",
    "list_incident_severities",
    "update_incident_severity",
    "count_incident_severities",
  ])("finds a list by its name or one of its tools: %p", (name: string) => {
    expect(findMovableList(name)?.tableName).toBe("IncidentSeverity");
  });
});

describe("the tool, as tools/list shows it", () => {
  it("is one tool, beside the hand-written ones, that every list shares", () => {
    expect(
      tools.filter((tool: McpToolInfo): boolean => {
        return tool.name.includes("move");
      }),
    ).toEqual([moveTool()]);
    expect(isWorkflowTool(MOVE_IN_LIST_TOOL_NAME)).toBe(true);
    expect(moveTool().title).toBe("Move Row in List");
  });

  it("changes something, so it carries destructiveHint, and stays inside the project", () => {
    expect(moveTool().annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });

  it("takes the list, the row and the row whose place it takes, and nothing else", () => {
    const schema: McpToolInfo["inputSchema"] = moveTool().inputSchema;
    const resource: JSONSchemaProperty | undefined =
      schema.properties?.["resource"];

    expect(schema.required).toEqual(["resource", "id", "placeOfId"]);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties || {})).toEqual([
      "resource",
      "id",
      "placeOfId",
    ]);
    expect(resource?.enum).toEqual(getMovableLists().map(nameOf));
    expect(resource?.enum).toEqual(
      expect.arrayContaining([
        "Incident Severity",
        "Incident State",
        "Monitor Status",
        "Alert Severity",
        "Alert State",
      ]),
    );
  });

  it("says a write of the number places only that row, so an agent knows when to move instead", () => {
    expect(moveTool().description).toContain(
      "as dragging it in the OneUptime dashboard does",
    );
    expect(moveTool().description).toContain(
      "places only that row and moves no other",
    );
  });

  it("is a write to the request gate: a read-only sign-in is asked for more", () => {
    expect(RequestGate.getToolAccess(MOVE_IN_LIST_TOOL_NAME, tools)).toBe(
      McpToolAccess.Write,
    );
  });

  it("is taken away by MCP_READ_ONLY, and kept by MCP_ALLOW_DESTRUCTIVE=false: a move deletes nothing", () => {
    const names: (kept: Array<McpToolInfo>) => Array<string> = (
      kept: Array<McpToolInfo>,
    ): Array<string> => {
      return kept.map((tool: McpToolInfo): string => {
        return tool.name;
      });
    };

    expect(
      names(applyWritePolicy(tools, getWritePolicy({ MCP_READ_ONLY: "true" }))),
    ).not.toContain(MOVE_IN_LIST_TOOL_NAME);
    expect(
      names(
        applyWritePolicy(
          tools,
          getWritePolicy({ MCP_ALLOW_DESTRUCTIVE: "false" }),
        ),
      ),
    ).toContain(MOVE_IN_LIST_TOOL_NAME);
  });
});

describe("the help tools", () => {
  const resourceTools: Array<McpToolInfo> = tools.filter(
    (tool: McpToolInfo): boolean => {
      return tool.apiPath !== "";
    },
  );

  function listed(): Array<{
    singularName: string;
    tools: Record<string, string>;
  }> {
    return JSON.parse(
      handleHelperTool("oneuptime_list_resources", {}, resourceTools),
    ).resources;
  }

  it("list the move among the tools of each list it moves rows of, and of no other resource", () => {
    const movable: Set<string> = new Set<string>(getMovableLists().map(nameOf));

    for (const resource of listed()) {
      expect([resource.singularName, resource.tools["move"]]).toEqual([
        resource.singularName,
        movable.has(resource.singularName) ? MOVE_IN_LIST_TOOL_NAME : undefined,
      ]);
    }
  });

  it("describe a list's order and the tool that moves its rows", () => {
    const described: JSONObject = JSON.parse(
      handleHelperTool(
        "oneuptime_describe_resource",
        { resource: "Incident Severity" },
        resourceTools,
      ),
    );

    expect((described["tools"] as JSONObject)["move"]).toBe(
      MOVE_IN_LIST_TOOL_NAME,
    );
    expect((described["usage"] as JSONObject)["order"]).toBe(
      `Its rows are a list in order by order, top first. Writing order places only that row, even beside a row at the same number. To move a row past others, as dragging it in the dashboard does, call ${MOVE_IN_LIST_TOOL_NAME} with resource "Incident Severity", the row's id and placeOfId.`,
    );

    const incident: JSONObject = JSON.parse(
      handleHelperTool(
        "oneuptime_describe_resource",
        { resource: "Incident" },
        resourceTools,
      ),
    );

    expect((incident["tools"] as JSONObject)["move"]).toBeUndefined();
    expect((incident["usage"] as JSONObject)["order"]).toBeUndefined();
  });

  it("never take the move tool's name for one resource's", () => {
    expect(() => {
      handleHelperTool(
        "oneuptime_describe_resource",
        { resource: MOVE_IN_LIST_TOOL_NAME },
        resourceTools,
      );
    }).toThrow(/Unknown resource/);
  });
});

describe("a move", () => {
  let apiCall: jest.SpyInstance;

  beforeEach(() => {
    apiCall = jest
      .spyOn(OneUptimeApiService, "makeAuthenticatedApiCall")
      .mockResolvedValue({
        changedRows: [
          { _id: ROW_ID, order: 1 },
          { _id: PLACE_ID, order: 2 },
        ],
      } as never) as unknown as jest.SpyInstance;
  });

  afterEach(() => {
    apiCall.mockRestore();
  });

  it("sends the list's move request for the row, naming the row whose place it takes, as the caller", async () => {
    await moveInList(
      { resource: "Incident Severity", id: ROW_ID, placeOfId: PLACE_ID },
      API_KEY,
    );

    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall.mock.calls[0]![0]).toEqual({
      method: "POST",
      path: `/api/incident-severity/${ROW_ID}/move`,
      body: { placeOfId: PLACE_ID },
      credential: API_KEY,
    });
  });

  it("goes to the list the resource names, by any of its names", async () => {
    await moveInList(
      { resource: "list_monitor_statuses", id: ROW_ID, placeOfId: PLACE_ID },
      API_KEY,
    );

    expect((apiCall.mock.calls[0]![0] as JSONObject)["path"]).toBe(
      `/api/monitor-status/${ROW_ID}/move`,
    );
  });

  it("answers with every row whose number changed, under the list's own column", async () => {
    expect(
      await moveInList(
        { resource: "Incident Severity", id: ROW_ID, placeOfId: PLACE_ID },
        API_KEY,
      ),
    ).toEqual({
      success: true,
      operation: MOVE_IN_LIST_TOOL_NAME,
      resourceType: "Incident Severity",
      resourceId: ROW_ID,
      placeOfId: PLACE_ID,
      column: "order",
      changedRows: [
        { _id: ROW_ID, order: 1 },
        { _id: PLACE_ID, order: 2 },
      ],
      message: `Moved Incident Severity ${ROW_ID} to the place of ${PLACE_ID}. 2 rows have a new order: each is in changedRows.`,
    });
  });

  it("says nothing changed when the row was in that place already", async () => {
    apiCall.mockResolvedValue({ changedRows: [] } as never);

    const result: JSONObject = await moveInList(
      { resource: "Incident Severity", id: ROW_ID, placeOfId: ROW_ID },
      API_KEY,
    );

    expect(result["changedRows"]).toEqual([]);
    expect(result["message"]).toBe(
      `Incident Severity ${ROW_ID} is in that place already: nothing changed.`,
    );
  });

  it.each([
    [{ resource: "Incident", id: ROW_ID, placeOfId: PLACE_ID }, /is no list/],
    [{ id: ROW_ID, placeOfId: PLACE_ID }, /is no list/],
    [
      { resource: "Incident Severity", id: "sev-1", placeOfId: PLACE_ID },
      /'id' must be a UUID/,
    ],
    [{ resource: "Incident Severity", id: ROW_ID }, /'placeOfId' is required/],
    [
      { resource: "Incident Severity", id: ROW_ID, placeOfId: "top" },
      /'placeOfId' must be a UUID/,
    ],
  ])(
    "refuses %p before it asks the API anything",
    async (args: Record<string, unknown>, refusal: RegExp) => {
      await expect(moveInList(args, API_KEY)).rejects.toThrow(refusal);
      expect(apiCall).not.toHaveBeenCalled();
    },
  );

  it("names the lists it moves rows of when it is given another", async () => {
    await expect(
      moveInList(
        { resource: "Monitor", id: ROW_ID, placeOfId: PLACE_ID },
        API_KEY,
      ),
    ).rejects.toThrow(
      `"Monitor" is no list whose rows can be moved. Pass resource as one of: ${getMovableLists()
        .map(nameOf)
        .join(", ")}.`,
    );
  });
});

describe("a move called by a client", () => {
  let apiCall: jest.SpyInstance;
  let mcpServer: McpServer | undefined;
  let client: Client | undefined;

  beforeEach(() => {
    apiCall = jest
      .spyOn(OneUptimeApiService, "makeAuthenticatedApiCall")
      .mockResolvedValue({
        changedRows: [{ _id: ROW_ID, priority: 3 }],
      } as never) as unknown as jest.SpyInstance;
  });

  afterEach(async () => {
    await client?.close();
    await mcpServer?.close();
    client = undefined;
    mcpServer = undefined;
    apiCall.mockRestore();
  });

  async function call(
    credential: McpCredentialInput,
    args: Record<string, unknown>,
  ): Promise<{ isError: boolean; payload: any }> {
    const [clientTransport, serverTransport]: [
      InMemoryTransport,
      InMemoryTransport,
    ] = InMemoryTransport.createLinkedPair();

    mcpServer = createMCPServerInstance();
    registerToolHandlers(mcpServer, tools, credential);
    await mcpServer.connect(serverTransport);

    client = new Client({ name: "move-in-list-test", version: "1.0.0" });
    await client.connect(clientTransport);

    const result: {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    } = (await client.callTool({
      name: MOVE_IN_LIST_TOOL_NAME,
      arguments: args,
    })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };

    return {
      isError: result.isError === true,
      payload: JSON.parse(result.content[0]!.text),
    };
  }

  it("moves the row and answers with the rows renumbered", async () => {
    const result: { isError: boolean; payload: any } = await call(API_KEY, {
      resource: "Monitor Status",
      id: ROW_ID,
      placeOfId: PLACE_ID,
    });

    expect(result.isError).toBe(false);
    expect(result.payload.changedRows).toEqual([{ _id: ROW_ID, priority: 3 }]);
    expect(result.payload.column).toBe("priority");
  });

  /*
   * The API's refusals of a move (BaseAPI's moveItem, #9650): the row named
   * is in another list, the row is gone, the caller may not change the
   * number. They come back in-band, with the status and what the API said,
   * for the agent to read and correct.
   */
  it.each([
    [
      400,
      "The row whose place it takes is not in this row's list.",
      "The request was invalid.",
    ],
    [404, "Incident Severity not found.", "The resource was not found."],
    [
      422,
      "You do not have permission to edit the order of Incident Severity.",
      "Use 'oneuptime_help'",
    ],
  ])(
    "passes the API's %p refusal back to the agent, in-band",
    async (statusCode: number, message: string, suggestion: string) => {
      apiCall.mockRejectedValue(
        new OneUptimeApiError(
          `API request failed: ${statusCode} - ${message}`,
          statusCode,
          { message: message } as never,
        ) as never,
      );

      const result: { isError: boolean; payload: any } = await call(API_KEY, {
        resource: "Incident Severity",
        id: ROW_ID,
        placeOfId: OTHER_ID,
      });

      expect(result.isError).toBe(true);
      expect(result.payload).toEqual(
        expect.objectContaining({
          success: false,
          tool: MOVE_IN_LIST_TOOL_NAME,
          statusCode: statusCode,
          details: { message: message },
        }),
      );
      expect(result.payload.error).toContain(message);
      expect(result.payload.suggestion).toContain(suggestion);
    },
  );

  it("is refused to a client signed in read-only, before the API is asked", async () => {
    const result: { isError: boolean; payload: any } = await call(READ_ONLY, {
      resource: "Incident Severity",
      id: ROW_ID,
      placeOfId: PLACE_ID,
    });

    expect(result.isError).toBe(true);
    expect(result.payload.error).toMatch(/authorized as read-only/);
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("asks for a key when it has none, and calls nothing", async () => {
    const result: { isError: boolean; payload: any } = await call(
      McpCredentialUtil.none(),
      { resource: "Incident Severity", id: ROW_ID, placeOfId: PLACE_ID },
    );

    expect(result.isError).toBe(true);
    expect(result.payload.error).toMatch(/API key is required/);
    expect(apiCall).not.toHaveBeenCalled();
  });
});

/*
 * Over HTTP, against a server that answers as the API's move route does:
 * the request the tool sends - its method, path, body and key - and the
 * answer it reads, `{ changedRows: [{ _id, <column> }] }`, through the real
 * API client rather than a spy.
 */
describe("a move over HTTP", () => {
  let server: http.Server;
  let received: Array<{
    method: string;
    path: string;
    headers: http.IncomingHttpHeaders;
    body: unknown;
  }>;

  beforeAll(async () => {
    server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse): void => {
        let raw: string = "";

        req.on("data", (chunk: string): void => {
          raw += chunk;
        });
        req.on("end", (): void => {
          received.push({
            method: req.method || "",
            path: req.url || "",
            headers: req.headers,
            body: raw ? JSON.parse(raw) : null,
          });

          res.setHeader("Content-Type", "application/json");

          if ((req.url || "").endsWith(`/${OTHER_ID}/move`)) {
            res.statusCode = 404;
            res.end(JSON.stringify({ message: "Incident State not found." }));
            return;
          }

          res.statusCode = 200;
          res.end(
            JSON.stringify({
              changedRows: [
                { _id: ROW_ID, order: 2 },
                { _id: PLACE_ID, order: 3 },
              ],
            }),
          );
        });
      },
    );

    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, "127.0.0.1", (): void => {
        resolve();
      });
    });

    OneUptimeApiService.initialize({
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
      server.closeAllConnections();
    });
  });

  beforeEach(() => {
    received = [];
  });

  it("posts the row whose place it takes to the row's move route, with the key", async () => {
    const result: JSONObject = await moveInList(
      { resource: "Incident State", id: ROW_ID, placeOfId: PLACE_ID },
      API_KEY,
    );

    expect(received).toHaveLength(1);
    expect(received[0]!.method).toBe("POST");
    expect(received[0]!.path).toBe(`/api/incident-state/${ROW_ID}/move`);
    expect(received[0]!.headers["apikey"]).toBe(API_KEY);
    expect(received[0]!.body).toEqual({ placeOfId: PLACE_ID });
    expect(result["changedRows"]).toEqual([
      { _id: ROW_ID, order: 2 },
      { _id: PLACE_ID, order: 3 },
    ]);
  });

  it("throws the API's refusal with its status, for the handler to pass on", async () => {
    const refusal: unknown = await moveInList(
      { resource: "Incident State", id: OTHER_ID, placeOfId: PLACE_ID },
      API_KEY,
    ).catch((error: unknown): unknown => {
      return error;
    });

    expect(refusal).toBeInstanceOf(OneUptimeApiError);
    expect((refusal as OneUptimeApiError).statusCode).toBe(404);
  });
});
