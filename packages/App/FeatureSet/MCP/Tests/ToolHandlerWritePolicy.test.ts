/**
 * A tool the server's write policy took away stays away when it is called
 * by name.
 *
 * MCP_READ_ONLY and MCP_ALLOW_DESTRUCTIVE take tools off the list a server
 * offers (ToolGenerator.applyWritePolicy). A generated tool that is not on
 * the list is an unknown tool. A workflow tool - acknowledge_incident,
 * set_up_paging, and the Data Security actions beside them - was found by
 * its name among every definition there is, so on a server that only reads
 * it still ran when a client named it: the write policy hid it from the list
 * and nothing more. These tests register a policed list on a real MCP
 * server, connected to the SDK's client in memory, and call the tools it
 * left out.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
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
import { registerToolHandlers } from "../Handlers/ToolHandler";
import { McpServer, createMCPServerInstance } from "../Server/MCPServer";
import OneUptimeApiService from "../Services/OneUptimeApiService";
import * as ToolGenerator from "../Tools/ToolGenerator";
import {
  WritePolicy,
  applyWritePolicy,
  generateAllTools,
  getWritePolicyRefusal,
} from "../Tools/ToolGenerator";
import McpCredentialUtil, { McpCredential } from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import Email from "Common/Types/Email";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import ObjectID from "Common/Types/ObjectID";

const INCIDENT_ID: string = "550e8400-e29b-41d4-a716-446655440000";

const READ_ONLY_POLICY: WritePolicy = {
  readOnly: true,
  allowDestructive: true,
};
const NO_DELETES_POLICY: WritePolicy = {
  readOnly: false,
  allowDestructive: false,
};

// A member signed in with read and write access: only the server says no.
function signedInMember(): McpCredential {
  const grant: McpOAuthGrant = new McpOAuthGrant();
  const scopes: Array<McpOAuthScope> = [
    McpOAuthScope.Read,
    McpOAuthScope.Write,
  ];

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

describe("a tool the write policy took off the server", () => {
  const everyTool: Array<McpToolInfo> = generateAllTools();

  let makeAuthenticatedApiCall: jest.SpyInstance;
  let serverPolicy: jest.SpyInstance;
  let mcpServer: McpServer | undefined;
  let client: Client | undefined;

  beforeEach(() => {
    makeAuthenticatedApiCall = jest
      .spyOn(OneUptimeApiService, "makeAuthenticatedApiCall")
      .mockResolvedValue([
        { _id: INCIDENT_ID, name: "Acknowledged" },
      ] as never) as unknown as jest.SpyInstance;
  });

  afterEach(async () => {
    await client?.close();
    await mcpServer?.close();
    client = undefined;
    mcpServer = undefined;

    makeAuthenticatedApiCall.mockRestore();
    serverPolicy?.mockRestore();
  });

  // A server that offers what `policy` leaves, as the server builds its list.
  async function call(
    policy: WritePolicy,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ isError: boolean; payload: any }> {
    serverPolicy = jest
      .spyOn(ToolGenerator, "getServerWritePolicy")
      .mockReturnValue(policy) as unknown as jest.SpyInstance;

    const [clientTransport, serverTransport]: [
      InMemoryTransport,
      InMemoryTransport,
    ] = InMemoryTransport.createLinkedPair();

    mcpServer = createMCPServerInstance();
    registerToolHandlers(
      mcpServer,
      applyWritePolicy(everyTool, policy),
      signedInMember(),
    );
    await mcpServer.connect(serverTransport);

    client = new Client({ name: "write-policy-test", version: "1.0.0" });
    await client.connect(clientTransport);

    const result: {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    } = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };

    return {
      isError: result.isError === true,
      payload: JSON.parse(result.content[0]!.text),
    };
  }

  it.each<[string, Record<string, unknown>]>([
    ["acknowledge_incident", { incidentId: INCIDENT_ID }],
    ["resolve_incident", { incidentId: INCIDENT_ID }],
    ["add_alert_note", { alertId: INCIDENT_ID, note: "Checked." }],
    ["set_up_paging", {}],
    ["invite_people", { emails: ["ana@example.com"] }],
  ])(
    "%s, called by name on a server that only reads, is refused and makes no request",
    async (name: string, args: Record<string, unknown>) => {
      // It is a tool of this server's, only not offered here.
      expect(
        everyTool.some((tool: McpToolInfo): boolean => {
          return tool.name === name;
        }),
      ).toBe(true);
      expect(
        applyWritePolicy(everyTool, READ_ONLY_POLICY).some(
          (tool: McpToolInfo): boolean => {
            return tool.name === name;
          },
        ),
      ).toBe(false);

      const result: { isError: boolean; payload: any } = await call(
        READ_ONLY_POLICY,
        name,
        args,
      );

      expect(result.isError).toBe(true);
      expect(result.payload.error).toBe(
        getWritePolicyRefusal(READ_ONLY_POLICY),
      );
      expect(result.payload.error).toContain("MCP_READ_ONLY");
      expect(result.payload.suggestion).toBe(
        "Do not retry this tool: it is turned off on this server. The tools it lists still work.",
      );
      expect(makeAuthenticatedApiCall).not.toHaveBeenCalled();
    },
  );

  it("a tool that only reads still runs on a server that only reads", async () => {
    const result: { isError: boolean; payload: any } = await call(
      READ_ONLY_POLICY,
      "oneuptime_whoami",
    );

    expect(result.isError).toBe(false);
    expect(makeAuthenticatedApiCall).toHaveBeenCalled();
  });

  it("a workflow tool that deletes nothing still runs where only deletes are off", async () => {
    const result: { isError: boolean } = await call(
      NO_DELETES_POLICY,
      "acknowledge_incident",
      { incidentId: INCIDENT_ID },
    );

    expect(result.isError).toBe(false);
    expect(makeAuthenticatedApiCall).toHaveBeenCalled();
  });

  it("says which switch did it", () => {
    expect(getWritePolicyRefusal(READ_ONLY_POLICY)).toContain("MCP_READ_ONLY");
    expect(getWritePolicyRefusal(NO_DELETES_POLICY)).toContain(
      "MCP_ALLOW_DESTRUCTIVE",
    );
    expect(getWritePolicyRefusal(NO_DELETES_POLICY)).not.toContain(
      "MCP_READ_ONLY",
    );
  });
});
