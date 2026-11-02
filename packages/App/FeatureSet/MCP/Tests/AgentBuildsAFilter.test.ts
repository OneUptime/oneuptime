/*
 * AN AGENT BUILDS A CORRECT FILTER FROM WHAT THE SERVER TELLS IT.
 *
 * The tools no longer list a resource's fields, so an agent has to find them.
 * This walks that path as a client does, with nothing but what the server
 * answers: the MCP SDK's Client reads tools/list over an in-memory transport,
 * asks oneuptime_describe_resource, checks its call against the tool's schema
 * with the validator the SDK gives clients, and calls the tool. Only the HTTP
 * request to the OneUptime API is stubbed, so what is asserted is the request
 * the API would get - and that request then goes through the code the API runs
 * on it, up to the database.
 *
 * An agent that went on using the old call shapes loses nothing either: the
 * server never checked a call against the schema, so they still work.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
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
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { registerToolHandlers } from "../Handlers/ToolHandler";
import RequestGate, { McpToolAccess } from "../OAuth/RequestGate";
import { McpServer, createMCPServerInstance } from "../Server/MCPServer";
import OneUptimeApiService, {
  OneUptimeApiError,
} from "../Services/OneUptimeApiService";
import { generateAllTools } from "../Tools/ToolGenerator";
import McpCredentialUtil, { McpCredentialInput } from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import Log from "Common/Models/AnalyticsModels/Log";
import Incident from "Common/Models/DatabaseModels/Incident";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import QueryPermission from "Common/Server/Types/Database/Permissions/QueryPermission";
import QueryUtil from "Common/Server/Types/Database/QueryUtil";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import Headers from "Common/Types/API/Headers";
import Route from "Common/Types/API/Route";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Search from "Common/Types/BaseDatabase/Search";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import UserType from "Common/Types/UserType";

const API_KEY: string = "3b241101-e2bb-4255-8caf-4136c566a962";
const A_DAY_AGO: string = "2026-11-01T00:00:00.000Z";

const PROJECT_ID: ObjectID = ObjectID.generate();

type MakeApiRequestArgs = [
  OneUptimeOperation,
  Route,
  Headers,
  JSONObject | undefined,
];

interface FieldAnswer {
  type: string;
  filter?: boolean;
  sort?: boolean;
}

interface DescribeAnswer {
  operators: Record<string, JSONObject>;
  operatorsByType: Record<string, Array<string>>;
  fields: Record<string, FieldAnswer>;
}

interface ToolAnswer {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

describe("an agent builds a filter from what the server tells it", () => {
  const tools: Array<McpToolInfo> = generateAllTools();

  let makeApiRequest: jest.SpyInstance;
  let mcpServer: McpServer | undefined;
  let client: Client | undefined;

  beforeAll(() => {
    OneUptimeApiService.initialize({ url: "https://test.oneuptime.com" });
  });

  beforeEach(() => {
    makeApiRequest = jest
      .spyOn(
        OneUptimeApiService as unknown as {
          makeApiRequest: (...args: MakeApiRequestArgs) => Promise<unknown>;
        },
        "makeApiRequest",
      )
      .mockResolvedValue({ data: [], count: 0 }) as unknown as jest.SpyInstance;
  });

  afterEach(async () => {
    await client?.close();
    await mcpServer?.close();
    client = undefined;
    mcpServer = undefined;

    makeApiRequest.mockRestore();
  });

  async function connect(credential: McpCredentialInput): Promise<Client> {
    const [clientTransport, serverTransport]: [
      InMemoryTransport,
      InMemoryTransport,
    ] = InMemoryTransport.createLinkedPair();

    mcpServer = createMCPServerInstance();
    registerToolHandlers(mcpServer, tools, credential);
    await mcpServer.connect(serverTransport);

    client = new Client({ name: "agent-builds-a-filter", version: "1.0.0" });
    await client.connect(clientTransport);

    return client;
  }

  async function callTool(
    connected: Client,
    name: string,
    args: JSONObject,
  ): Promise<ToolAnswer> {
    return (await connected.callTool({
      name,
      arguments: args,
    })) as unknown as ToolAnswer;
  }

  function textOf(answer: ToolAnswer): string {
    return answer.content[0]?.text as string;
  }

  async function findTool(connected: Client, name: string): Promise<Tool> {
    const tool: Tool | undefined = (await connected.listTools()).tools.find(
      (candidate: Tool): boolean => {
        return candidate.name === name;
      },
    );

    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    return tool;
  }

  // The request the API got: its route and body.
  function lastRequest(): { route: string; body: JSONObject } {
    const call: MakeApiRequestArgs = makeApiRequest.mock.calls[
      makeApiRequest.mock.calls.length - 1
    ] as unknown as MakeApiRequestArgs;

    return { route: call[1].toString(), body: call[3] as JSONObject };
  }

  // A field the answer says takes an operator, by the operator it takes.
  function fieldTaking(answer: DescribeAnswer, operator: string): string {
    const name: string | undefined = Object.keys(answer.fields).find(
      (field: string): boolean => {
        const described: FieldAnswer = answer.fields[field] as FieldAnswer;

        return (
          described.filter === true &&
          (answer.operatorsByType[described.type] || []).includes(operator)
        );
      },
    );

    if (!name) {
      throw new Error(`No field takes ${operator}`);
    }

    return name;
  }

  test("reads, from the tool it wants, how to write a filter and where the fields are", async () => {
    const connected: Client = await connect(API_KEY);

    const query: { description?: string } | undefined = (
      await findTool(connected, "list_incidents")
    ).inputSchema.properties?.["query"] as { description?: string } | undefined;

    expect(query?.description).toContain("oneuptime_describe_resource");
    expect(
      (await findTool(connected, "oneuptime_describe_resource")).title,
    ).toBe("Describe OneUptime Resource");
  });

  test("filters, sorts and selects incidents with fields and operators it read from the helper", async () => {
    const connected: Client = await connect(API_KEY);

    const answer: DescribeAnswer = JSON.parse(
      textOf(
        await callTool(connected, "oneuptime_describe_resource", {
          resource: "list_incidents",
        }),
      ),
    ) as DescribeAnswer;

    const textField: string = fieldTaking(answer, "Search");
    const timeField: string = fieldTaking(answer, "GreaterThan");

    const args: JSONObject = {
      query: {
        [textField]: { ...answer.operators["Search"], value: "database" },
        [timeField]: {
          ...answer.operators["GreaterThan"],
          value: A_DAY_AGO,
        },
      },
      sort: { [timeField]: "DESC" },
      select: ["_id", textField],
      limit: 5,
    };

    // A client that validates a call before sending it lets this one through.
    const check: (input: unknown) => { valid: boolean } =
      new AjvJsonSchemaValidator().getValidator(
        (await findTool(connected, "list_incidents")).inputSchema as never,
      );

    expect(check(args).valid).toBe(true);

    const result: ToolAnswer = await callTool(
      connected,
      "list_incidents",
      args,
    );

    expect(result.isError).toBeUndefined();

    const { route, body }: { route: string; body: JSONObject } = lastRequest();

    expect(route).toBe("/api/incident/get-list");
    expect(body).toEqual({
      query: args["query"],
      select: { _id: true, [textField]: true },
      sort: args["sort"],
      limit: 5,
    });

    // The API reads the operators the agent wrote as operators.
    const query: JSONObject = JSONFunctions.deserialize(
      body["query"] as JSONObject,
    );

    expect(query[textField]).toBeInstanceOf(Search);
    expect(query[timeField]).toBeInstanceOf(GreaterThan);

    const owner: { userId: ObjectID; userType: UserType } & Record<
      string,
      unknown
    > = {
      userId: ObjectID.generate(),
      userType: UserType.User,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [
            {
              _type: "UserPermission",
              permission: Permission.ProjectOwner,
              labelIds: [],
              isBlockPermission: false,
            },
          ],
        },
      },
    };

    expect(() => {
      QueryPermission.checkQueryPermission(
        Incident as never,
        query as never,
        owner,
      );
      QueryUtil.serializeQuery(Incident as never, query as never);
    }).not.toThrow();
  });

  test("counts with the same filter", async () => {
    const connected: Client = await connect(API_KEY);

    const query: JSONObject = {
      title: { _type: "Search", value: "database" },
    };

    await callTool(connected, "count_incidents", { query });

    const { route, body }: { route: string; body: JSONObject } = lastRequest();

    expect(route).toBe("/api/incident/count");
    expect(body["query"]).toEqual(query);
  });

  test("bounds telemetry by time, as its tool says to, and the filter reaches ClickHouse as a time", async () => {
    const connected: Client = await connect(API_KEY);

    const answer: DescribeAnswer = JSON.parse(
      textOf(
        await callTool(connected, "oneuptime_describe_resource", {
          resource: "Log",
        }),
      ),
    ) as DescribeAnswer;

    expect(answer.fields["time"]?.filter).toBe(true);
    expect(answer.fields["time"]?.sort).toBe(true);

    const args: JSONObject = {
      query: {
        time: { ...answer.operators["GreaterThan"], value: A_DAY_AGO },
        severityText: {
          ...answer.operators["Includes"],
          value: ["Error", "Fatal"],
        },
      },
      sort: { time: "DESC" },
      select: ["time", "body"],
      limit: 20,
    };

    const check: (input: unknown) => { valid: boolean } =
      new AjvJsonSchemaValidator().getValidator(
        (await findTool(connected, "list_logs")).inputSchema as never,
      );

    expect(check(args).valid).toBe(true);

    await callTool(connected, "list_logs", args);

    const { route, body }: { route: string; body: JSONObject } = lastRequest();

    expect(route).toBe("/api/logs/get-list");
    expect(body["select"]).toEqual({ time: true, body: true });

    const statement: Statement = new StatementGenerator({
      modelType: Log,
      database: ClickhouseAppInstance,
    } as never).toWhereStatement(
      JSONFunctions.deserialize(body["query"] as JSONObject) as never,
    );

    expect(statement.query).toContain("DateTime64(9)");
    expect(Object.values(statement.query_params)).toEqual(
      expect.arrayContaining([
        "2026-11-01 00:00:00.000000000",
        ["Error", "Fatal"],
      ]),
    );
  });

  test("a call in the old shape still works: telemetry's select as an object", async () => {
    const connected: Client = await connect(API_KEY);

    await callTool(connected, "list_logs", {
      select: { time: true, body: true },
      sort: { time: "DESC" },
    });

    expect(lastRequest().body["select"]).toEqual({ time: true, body: true });
  });

  test("a call in the old shape still works: a list with no arguments at all", async () => {
    const connected: Client = await connect(API_KEY);

    const result: ToolAnswer = await callTool(connected, "list_incidents", {});

    expect(result.isError).toBeUndefined();
    expect(lastRequest().route).toBe("/api/incident/get-list");
  });

  test("a filter written another way never reaches the API, and the agent is told how to write it", async () => {
    const connected: Client = await connect(API_KEY);

    for (const [toolName, query, named] of [
      [
        "list_incidents",
        { title: { $regex: "database" } },
        'title {"$regex":"database"}',
      ],
      [
        "count_logs",
        { time: { $gt: A_DAY_AGO } },
        `time {"$gt":"${A_DAY_AGO}"}`,
      ],
    ] as Array<[string, JSONObject, string]>) {
      const result: ToolAnswer = await callTool(connected, toolName, {
        query,
      });

      expect([toolName, result.isError]).toEqual([toolName, true]);

      const payload: { error: string; suggestion: string } = JSON.parse(
        textOf(result),
      ) as { error: string; suggestion: string };

      expect(payload.error).toContain(named);
      expect(payload.suggestion).toContain("oneuptime_describe_resource");
    }

    // Without the check, the database would have matched the object's JSON.
    expect(makeApiRequest).not.toHaveBeenCalled();
  });

  test("a relation still filters by its own fields, as the CLI's skill writes it", async () => {
    const connected: Client = await connect(API_KEY);
    const query: JSONObject = {
      currentIncidentState: { isResolvedState: false },
    };

    const result: ToolAnswer = await callTool(connected, "count_incidents", {
      query,
    });

    expect(result.isError).toBeUndefined();
    expect(lastRequest().body["query"]).toEqual(query);
  });

  test("a field the API refuses comes back as a failed call that says where the fields are", async () => {
    makeApiRequest.mockRejectedValueOnce(
      new OneUptimeApiError(
        "API request failed: 400 - Invalid column on Incident - nope. Column does not exist.",
        400,
      ),
    );

    const connected: Client = await connect(API_KEY);

    const result: ToolAnswer = await callTool(connected, "list_incidents", {
      query: { nope: "database" },
    });

    expect(result.isError).toBe(true);

    const payload: { error: string; suggestion: string } = JSON.parse(
      textOf(result),
    ) as { error: string; suggestion: string };

    expect(payload.error).toContain("nope");
    expect(payload.suggestion).toContain("oneuptime_describe_resource");
  });

  test("asks with no credential, as tools/list is read with none", async () => {
    const connected: Client = await connect(McpCredentialUtil.none());

    const result: ToolAnswer = await callTool(
      connected,
      "oneuptime_describe_resource",
      { resource: "Incident" },
    );

    expect(result.isError).toBeUndefined();
    expect(makeApiRequest).not.toHaveBeenCalled();
    expect(
      RequestGate.getToolAccess("oneuptime_describe_resource", tools),
    ).toBe(McpToolAccess.Public);
  });

  test("a resource that does not exist comes back as a failed call that says where the resources are", async () => {
    const connected: Client = await connect(McpCredentialUtil.none());

    const result: ToolAnswer = await callTool(
      connected,
      "oneuptime_describe_resource",
      { resource: "nope" },
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      "Use oneuptime_list_resources to see the resources.",
    );
  });
});
