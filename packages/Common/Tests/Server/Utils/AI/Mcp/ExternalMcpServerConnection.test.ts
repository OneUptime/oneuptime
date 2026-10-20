import ExternalMcpServerConnection, {
  EXTERNAL_MCP_SERVER_CONNECTION_SELECT,
  MCP_CLIENT_NAME,
} from "../../../../../Server/Utils/AI/Mcp/ExternalMcpServerConnection";
import { clearMcpSignInCachesForTests } from "../../../../../Server/Utils/AI/Mcp/McpSignIn";
import McpClientError from "../../../../../Server/Utils/AI/Mcp/McpClientError";
import ExternalMcpServer from "../../../../../Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpServerAuthType from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import { ExternalMcpServerFailureKind } from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import FakeMcpServer, {
  FakeMcpServerOptions,
  LocalMcpHttpTransport,
} from "../../../../Helpers/FakeMcpServer";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A stored server turned into a working connection: it signs in the way
 * the server's Authentication says, and an OAuth token the server refused
 * is replaced once - no other refusal is retried.
 */

const SERVER_ID: string = "4a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01";

let fake: FakeMcpServer | null = null;
const connections: Array<ExternalMcpServerConnection> = [];

beforeEach(() => {
  clearMcpSignInCachesForTests();
});

afterEach(async () => {
  for (const connection of connections.splice(0)) {
    await connection.close();
  }

  if (fake) {
    await fake.stop();
    fake = null;
  }
});

function storedServer(fields: Partial<ExternalMcpServer>): ExternalMcpServer {
  const server: ExternalMcpServer = new ExternalMcpServer();
  server.id = new ObjectID(SERVER_ID);
  server.projectId = new ObjectID("4a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02");
  server.name = "AWS";
  server.isEnabled = true;
  Object.assign(server, fields);
  return server;
}

async function connect(
  options: FakeMcpServerOptions,
  fields: (fakeServer: FakeMcpServer) => Partial<ExternalMcpServer>,
): Promise<{ server: FakeMcpServer; connection: ExternalMcpServerConnection }> {
  fake = await FakeMcpServer.start({
    tools: [{ name: "ping_tool", readOnly: true }],
    ...options,
  });

  const connection: ExternalMcpServerConnection =
    ExternalMcpServerConnection.fromServer(storedServer(fields(fake)), {
      transport: new LocalMcpHttpTransport(),
    });

  connections.push(connection);

  return { server: fake, connection };
}

describe("ExternalMcpServerConnection", () => {
  test("reads what a connection needs, secrets included, and nothing a run never uses", () => {
    expect(Object.keys(EXTERNAL_MCP_SERVER_CONNECTION_SELECT).sort()).toEqual(
      [
        "_id",
        "authType",
        "bearerToken",
        "description",
        "headers",
        "isEnabled",
        "name",
        "oauthAudience",
        "oauthClientId",
        "oauthClientSecret",
        "oauthScope",
        "oauthTokenUrl",
        "projectId",
        "url",
      ].sort(),
    );
  });

  test("signs in with the stored bearer token and names itself OneUptime AI", async () => {
    const { server, connection } = await connect(
      { requiredHeaders: { authorization: "Bearer stored-token" } },
      (fakeServer: FakeMcpServer) => {
        return {
          url: fakeServer.url("/mcp"),
          authType: ExternalMcpServerAuthType.BearerToken,
          bearerToken: "stored-token",
        };
      },
    );

    await connection.listTools();

    const initialize: JSONObject = JSON.parse(
      server.requests[0]!.body,
    ) as JSONObject;
    expect(
      (initialize["params"] as JSONObject)["clientInfo"] as JSONObject,
    ).toEqual(
      expect.objectContaining({ name: MCP_CLIENT_NAME, title: "OneUptime AI" }),
    );
    expect(connection.name).toBe("AWS");
    expect(connection.serverId).toBe(SERVER_ID);
  });

  test("signs in with the stored headers", async () => {
    const { connection } = await connect(
      { requiredHeaders: { "x-api-key": "key-1" } },
      (fakeServer: FakeMcpServer) => {
        return {
          url: fakeServer.url("/mcp"),
          authType: ExternalMcpServerAuthType.Headers,
          headers: { "X-API-Key": "key-1" },
        };
      },
    );

    expect((await connection.listTools()).tools).toHaveLength(1);
  });

  test("redacts every stored secret from what it says", async () => {
    const { connection } = await connect({}, (fakeServer: FakeMcpServer) => {
      return {
        url: fakeServer.url("/mcp"),
        authType: ExternalMcpServerAuthType.Headers,
        headers: { "X-API-Key": "a-secret-header-value" },
      };
    });

    expect(connection.redact("error: a-secret-header-value refused")).toBe(
      "error: [redacted] refused",
    );
  });

  test("an OAuth token the server refused is replaced once, and the request goes through", async () => {
    const { server, connection } = await connect(
      {
        oauth: {
          clientId: "client-1",
          clientSecret: "client-secret-1",
          accepts: "both",
          expiresIn: 3600,
        },
      },
      (fakeServer: FakeMcpServer) => {
        return {
          url: fakeServer.url("/mcp"),
          authType: ExternalMcpServerAuthType.OAuthClientCredentials,
          oauthTokenUrl: fakeServer.url("/oauth/token"),
          oauthClientId: "client-1",
          oauthClientSecret: "client-secret-1",
        };
      },
    );

    await connection.listTools();
    expect(server.issuedTokens).toEqual(["token-1"]);

    // The server stops taking the token it handed out.
    server.revokeIssuedTokens();

    const result: JSONObject = await connection.callTool({
      name: "ping_tool",
      arguments: {},
    });

    expect(result["content"]).toEqual([
      { type: "text", text: "ping_tool ran" },
    ]);
    expect(server.issuedTokens).toEqual(["token-2"]);
  });

  test("a refused bearer token is not retried", async () => {
    const { server, connection } = await connect(
      { requiredHeaders: { authorization: "Bearer the-right-token" } },
      (fakeServer: FakeMcpServer) => {
        return {
          url: fakeServer.url("/mcp"),
          authType: ExternalMcpServerAuthType.BearerToken,
          bearerToken: "a-wrong-token",
        };
      },
    );

    let error: unknown = null;

    try {
      await connection.connect();
    } catch (caught) {
      error = caught;
    }

    expect((error as McpClientError).kind).toBe(
      ExternalMcpServerFailureKind.SignInRefused,
    );
    expect(server.requests).toHaveLength(1);
  });

  test("the token cache key changes with every OAuth setting and never holds the secret", () => {
    const base: {
      authType: ExternalMcpServerAuthType;
      oauth: {
        tokenUrl: string;
        clientId: string;
        clientSecret: string;
        scope: string;
      };
    } = {
      authType: ExternalMcpServerAuthType.OAuthClientCredentials,
      oauth: {
        tokenUrl: "https://login.example.com/token",
        clientId: "client",
        clientSecret: "super-secret-value",
        scope: "mcp",
      },
    };

    const key: string = ExternalMcpServerConnection.getTokenCacheKey(
      SERVER_ID,
      base,
    );

    expect(key.startsWith(`${SERVER_ID}:`)).toBe(true);
    expect(key).not.toContain("super-secret-value");
    expect(ExternalMcpServerConnection.getTokenCacheKey(SERVER_ID, base)).toBe(
      key,
    );

    for (const change of [
      { tokenUrl: "https://other.example.com/token" },
      { clientId: "other" },
      { clientSecret: "other-secret" },
      { scope: "other" },
    ]) {
      expect(
        ExternalMcpServerConnection.getTokenCacheKey(SERVER_ID, {
          ...base,
          oauth: { ...base.oauth, ...change },
        }),
      ).not.toBe(key);
    }

    expect(
      ExternalMcpServerConnection.getTokenCacheKey(
        "4a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b99",
        base,
      ),
    ).not.toBe(key);
  });
});
