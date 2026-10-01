/**
 * The tool handler and the credential it is registered with.
 *
 * The HTTP layer normally settles who is calling before a tool handler runs
 * (OAuth/RequestGate). These tests go AROUND it: the handlers are registered
 * on a real MCP server that is connected to the SDK's client over an
 * in-memory transport, so a call arrives at the handler with whatever
 * credential the test chose and no gate in front. That is how the handler's
 * own rules are reached - above all the second, independent refusal of a tool
 * that writes for a client its user authorized as read-only.
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
import { registerToolHandlers } from "../Handlers/ToolHandler";
import { McpServer, createMCPServerInstance } from "../Server/MCPServer";
import OneUptimeApiService, {
  OneUptimeApiError,
} from "../Services/OneUptimeApiService";
import * as PublicStatusPageTools from "../Tools/PublicStatusPageTools";
import { generateAllTools } from "../Tools/ToolGenerator";
import McpCredentialUtil, {
  McpCredential,
  McpCredentialInput,
  McpCredentialType,
} from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import Email from "Common/Types/Email";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import ObjectID from "Common/Types/ObjectID";

const API_KEY: string = "3b241101-e2bb-4255-8caf-4136c566a962";
const INCIDENT_ID: string = "550e8400-e29b-41d4-a716-446655440000";

const READ_ONLY_REFUSAL: string =
  "This connection was authorized as read-only, and this tool makes changes. The user must authorize read and write access to use it.";

const READ_ONLY_SUGGESTION: string =
  "Do not retry this tool. Ask the user to connect this MCP client again and choose read and write access. The get, list and count tools still work.";

const DEFAULT_SUGGESTION: string =
  "Check the tool's input schema for required parameters. Use 'oneuptime_help' for guidance.";

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
const READ_WRITE: McpCredential = oauthCredential([
  McpOAuthScope.Read,
  McpOAuthScope.Write,
]);

describe("the tool handler, reached without the HTTP gate", () => {
  const tools: Array<McpToolInfo> = generateAllTools();

  let executeOperation: jest.SpyInstance;
  let makeAuthenticatedApiCall: jest.SpyInstance;
  let publicTool: jest.SpyInstance;
  let mcpServer: McpServer | undefined;
  let client: Client | undefined;

  beforeEach(() => {
    executeOperation = jest
      .spyOn(OneUptimeApiService, "executeOperation")
      .mockResolvedValue({
        _id: INCIDENT_ID,
      } as never) as unknown as jest.SpyInstance;

    makeAuthenticatedApiCall = jest
      .spyOn(OneUptimeApiService, "makeAuthenticatedApiCall")
      .mockResolvedValue([
        { _id: INCIDENT_ID, name: "Acknowledged" },
      ] as never) as unknown as jest.SpyInstance;

    publicTool = jest
      .spyOn(PublicStatusPageTools, "handlePublicStatusPageTool")
      .mockResolvedValue(
        JSON.stringify({ success: true }),
      ) as unknown as jest.SpyInstance;
  });

  afterEach(async () => {
    await client?.close();
    await mcpServer?.close();
    client = undefined;
    mcpServer = undefined;

    executeOperation.mockRestore();
    makeAuthenticatedApiCall.mockRestore();
    publicTool.mockRestore();
  });

  // A server with the handlers registered for `credential`, and a client on it.
  async function connectWith(credential: McpCredentialInput): Promise<Client> {
    const [clientTransport, serverTransport]: [
      InMemoryTransport,
      InMemoryTransport,
    ] = InMemoryTransport.createLinkedPair();

    mcpServer = createMCPServerInstance();
    registerToolHandlers(mcpServer, tools, credential);

    await mcpServer.connect(serverTransport);

    client = new Client({ name: "tool-handler-test", version: "1.0.0" });
    await client.connect(clientTransport);

    return client;
  }

  async function call(
    credential: McpCredentialInput,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ isError: boolean; payload: any }> {
    const connected: Client = await connectWith(credential);
    const result: {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    } = (await connected.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };

    return {
      isError: result.isError === true,
      payload: JSON.parse(result.content[0]!.text),
    };
  }

  describe("the credential it is registered with", () => {
    it("may be a bare API key string, as it always was", async () => {
      const result: { isError: boolean } = await call(
        API_KEY,
        "list_incidents",
      );

      expect(result.isError).toBe(false);
      expect(executeOperation).toHaveBeenCalledTimes(1);
      expect(executeOperation.mock.calls[0]![5]).toEqual({
        type: McpCredentialType.ApiKey,
        apiKey: API_KEY,
      });
    });

    it("may be an API key credential", async () => {
      await call(McpCredentialUtil.fromApiKey(API_KEY), "list_incidents");

      expect(executeOperation.mock.calls[0]![5]).toEqual({
        type: McpCredentialType.ApiKey,
        apiKey: API_KEY,
      });
    });

    it("may be an OAuth credential, which reaches the API layer whole", async () => {
      await call(READ_WRITE, "list_incidents");

      expect(executeOperation.mock.calls[0]![5]).toBe(READ_WRITE);
    });

    it.each<[string, McpCredentialInput]>([
      ["an empty string", ""],
      ["undefined", undefined],
      ["the 'none' credential", McpCredentialUtil.none()],
    ])(
      "being %s, a generated tool answers that a key is required and calls nothing",
      async (_label: string, credential: McpCredentialInput) => {
        const result: { isError: boolean; payload: any } = await call(
          credential,
          "list_incidents",
        );

        expect(result.isError).toBe(true);
        expect(result.payload.error).toMatch(/API key is required/);
        expect(executeOperation).not.toHaveBeenCalled();
      },
    );

    it.each<[string, McpCredentialInput]>([
      ["an empty string", ""],
      ["undefined", undefined],
      ["the 'none' credential", McpCredentialUtil.none()],
    ])(
      "being %s, a workflow tool answers the same",
      async (_label: string, credential: McpCredentialInput) => {
        const result: { isError: boolean; payload: any } = await call(
          credential,
          "oneuptime_whoami",
        );

        expect(result.isError).toBe(true);
        expect(result.payload.error).toMatch(/API key is required/);
        expect(makeAuthenticatedApiCall).not.toHaveBeenCalled();
      },
    );

    it("is not shared between servers: each handler keeps the credential it was registered with", async () => {
      const first: Client = await connectWith("key-one");

      await first.callTool({ name: "list_incidents", arguments: {} });
      await first.close();
      await mcpServer!.close();

      const second: Client = await connectWith("key-two");

      await second.callTool({ name: "list_incidents", arguments: {} });

      expect(executeOperation.mock.calls[0]![5]).toEqual({
        type: McpCredentialType.ApiKey,
        apiKey: "key-one",
      });
      expect(executeOperation.mock.calls[1]![5]).toEqual({
        type: McpCredentialType.ApiKey,
        apiKey: "key-two",
      });
    });
  });

  describe("a read-only OAuth credential (the rule the HTTP gate also applies, held a second time)", () => {
    it.each<[string, Record<string, unknown>]>([
      ["create_incident", { title: "x" }],
      ["update_incident", { id: INCIDENT_ID, title: "y" }],
      ["delete_incident", { id: INCIDENT_ID }],
      ["create_monitor", { name: "m" }],
      ["delete_status_page", { id: INCIDENT_ID }],
    ])(
      "is refused the generated tool %s, and the API is not called",
      async (name: string, args: Record<string, unknown>) => {
        const result: { isError: boolean; payload: any } = await call(
          READ_ONLY,
          name,
          args,
        );

        expect(result.isError).toBe(true);
        expect(result.payload).toMatchObject({
          success: false,
          tool: name,
          error: READ_ONLY_REFUSAL,
          suggestion: READ_ONLY_SUGGESTION,
        });
        expect(executeOperation).not.toHaveBeenCalled();
      },
    );

    /*
     * Nothing is wrong with the arguments, so the handler's usual advice -
     * check the input schema - would send an agent off to retry the same
     * call differently. It is told what is actually the matter, and what
     * still works.
     */
    it("is told to ask its user for more access, not to check its arguments", async () => {
      const result: { isError: boolean; payload: any } = await call(
        READ_ONLY,
        "create_incident",
        { title: "x" },
      );

      expect(result.payload.suggestion).toBe(READ_ONLY_SUGGESTION);
      expect(result.payload.suggestion).not.toContain("input schema");
      expect(result.payload.suggestion).not.toContain("API key");
      expect(result.payload.suggestion).toContain("Do not retry");
    });

    it("keeps the usual advice for a failure that has nothing to do with being read-only", async () => {
      executeOperation.mockRejectedValue(
        new Error("Missing required parameter: id") as never,
      );

      const result: { isError: boolean; payload: any } = await call(
        READ_ONLY,
        "get_incident",
        { id: INCIDENT_ID },
      );

      expect(result.isError).toBe(true);
      expect(result.payload.error).toBe("Missing required parameter: id");
      expect(result.payload.suggestion).toBe(DEFAULT_SUGGESTION);
    });

    it.each<[string, Record<string, unknown>]>([
      ["acknowledge_incident", { incidentId: INCIDENT_ID }],
      ["resolve_incident", { incidentId: INCIDENT_ID }],
      ["acknowledge_alert", { alertId: INCIDENT_ID }],
      ["resolve_alert", { alertId: INCIDENT_ID }],
      ["add_incident_note", { incidentId: INCIDENT_ID, note: "n" }],
      ["add_alert_note", { alertId: INCIDENT_ID, note: "n" }],
    ])(
      "is refused the workflow tool %s - not even its read (the state lookup) is made",
      async (name: string, args: Record<string, unknown>) => {
        const result: { isError: boolean; payload: any } = await call(
          READ_ONLY,
          name,
          args,
        );

        expect(result.isError).toBe(true);
        expect(result.payload.error).toBe(READ_ONLY_REFUSAL);
        expect(result.payload.suggestion).toBe(READ_ONLY_SUGGESTION);
        expect(makeAuthenticatedApiCall).not.toHaveBeenCalled();
      },
    );

    it("is refused every tool on the server that does not declare itself read-only", async () => {
      const connected: Client = await connectWith(READ_ONLY);
      const wrong: Array<string> = [];

      for (const tool of tools) {
        if (tool.annotations?.readOnlyHint === true) {
          continue;
        }

        const result: {
          isError?: boolean;
          content: Array<{ type: string; text: string }>;
        } = (await connected.callTool({
          name: tool.name,
          arguments: {},
        })) as {
          isError?: boolean;
          content: Array<{ type: string; text: string }>;
        };

        if (
          result.isError !== true ||
          JSON.parse(result.content[0]!.text).error !== READ_ONLY_REFUSAL
        ) {
          wrong.push(tool.name);
        }
      }

      expect(wrong).toEqual([]);
      expect(executeOperation).not.toHaveBeenCalled();
      expect(makeAuthenticatedApiCall).not.toHaveBeenCalled();
    });

    it.each<[string, Record<string, unknown>]>([
      ["list_incidents", {}],
      ["count_incidents", {}],
      ["get_incident", { id: INCIDENT_ID }],
      ["list_logs", {}],
    ])(
      "may call the read tool %s",
      async (name: string, args: Record<string, unknown>) => {
        const result: { isError: boolean } = await call(READ_ONLY, name, args);

        expect(result.isError).toBe(false);
        expect(executeOperation).toHaveBeenCalledTimes(1);
        expect(executeOperation.mock.calls[0]![5]).toBe(READ_ONLY);
      },
    );

    it("may call whoami, the one workflow tool that only reads", async () => {
      const result: { isError: boolean; payload: any } = await call(
        READ_ONLY,
        "oneuptime_whoami",
      );

      expect(result.isError).toBe(false);
      expect(result.payload.access).toBe("read-only");
      expect(makeAuthenticatedApiCall).toHaveBeenCalledWith(
        expect.objectContaining({ credential: READ_ONLY }),
      );
    });

    it("may call the helper and public tools", async () => {
      expect((await call(READ_ONLY, "oneuptime_help")).isError).toBe(false);

      await client!.close();
      await mcpServer!.close();

      expect(
        (
          await call(READ_ONLY, "get_public_status_page_overview", {
            statusPageIdOrDomain: "status.example.com",
          })
        ).isError,
      ).toBe(false);
    });

    it("gets 'unknown tool' for a tool that does not exist, not the read-only refusal", async () => {
      const connected: Client = await connectWith(READ_ONLY);

      await expect(
        connected.callTool({ name: "no_such_tool", arguments: {} }),
      ).rejects.toThrow(/Unknown tool: no_such_tool/);
    });
  });

  describe("a read-and-write OAuth credential", () => {
    it("may call a generated tool that writes", async () => {
      const result: { isError: boolean } = await call(
        READ_WRITE,
        "create_incident",
        { title: "Database is down" },
      );

      expect(result.isError).toBe(false);
      expect(executeOperation.mock.calls[0]![5]).toBe(READ_WRITE);
    });

    it("may call a workflow tool that writes, with the credential on every API call it makes", async () => {
      const result: { isError: boolean; payload: any } = await call(
        READ_WRITE,
        "acknowledge_incident",
        { incidentId: INCIDENT_ID },
      );

      expect(result.isError).toBe(false);
      expect(result.payload.success).toBe(true);
      expect(makeAuthenticatedApiCall).toHaveBeenCalledTimes(2);

      for (const [options] of makeAuthenticatedApiCall.mock.calls) {
        expect((options as { credential: unknown }).credential).toBe(
          READ_WRITE,
        );
      }
    });
  });

  describe("an API key", () => {
    it("is never told it is read-only: a key is not scoped here", async () => {
      const result: { isError: boolean } = await call(
        API_KEY,
        "create_incident",
        {
          title: "x",
        },
      );

      expect(result.isError).toBe(false);
      expect(executeOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe("what an agent is told to try next when the API refuses", () => {
    async function suggestionFor(
      credential: McpCredentialInput,
      statusCode: number,
    ): Promise<string> {
      executeOperation.mockRejectedValue(
        new OneUptimeApiError(
          `API request failed: ${statusCode} - refused`,
          statusCode,
        ) as never,
      );

      const result: { isError: boolean; payload: any } = await call(
        credential,
        "list_incidents",
      );

      expect(result.isError).toBe(true);
      expect(result.payload.statusCode).toBe(statusCode);

      return result.payload.suggestion;
    }

    it("is, for a 401 with an API key, to check the key", async () => {
      expect(await suggestionFor(API_KEY, 401)).toBe(
        "The API key was rejected. Verify the key is correct and not expired (sent via the x-api-key header).",
      );
    });

    it("is, for a 401 with a sign-in, to connect the client again - there is no key to fix", async () => {
      const suggestion: string = await suggestionFor(READ_WRITE, 401);

      expect(suggestion).toBe(
        "The sign-in was not accepted for this request. The user may have left the project or been blocked; ask them to connect this MCP client again.",
      );
      expect(suggestion).not.toContain("API key");
    });

    it("is, for a 403 with an API key, to grant the key the permission", async () => {
      expect(await suggestionFor(API_KEY, 403)).toBe(
        "The API key lacks permission for this operation. Ask a project admin to grant the relevant permission to the key.",
      );
    });

    it("is, for a 403 with a sign-in, about the person's permissions in the project", async () => {
      const suggestion: string = await suggestionFor(READ_ONLY, 403);

      expect(suggestion).toBe(
        "The signed-in user lacks permission for this operation in this project. Ask a project admin to grant their team the relevant permission.",
      );
      expect(suggestion).not.toContain("API key");
    });

    it.each([[400], [404], [429], [500]])(
      "is the same for both kinds of credential on a %d",
      async (statusCode: number) => {
        const forKey: string = await suggestionFor(API_KEY, statusCode);

        await client!.close();
        await mcpServer!.close();

        const forSignIn: string = await suggestionFor(READ_WRITE, statusCode);

        expect(forSignIn).toBe(forKey);
        expect(forKey.length).toBeGreaterThan(0);
      },
    );
  });
});
