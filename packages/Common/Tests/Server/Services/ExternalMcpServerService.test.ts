import ExternalMcpServerService, {
  EXTERNAL_MCP_SERVER_COUNT_STATEMENT,
  EXTERNAL_MCP_SERVER_LIMIT_MESSAGE,
  EXTERNAL_MCP_SERVER_LIMIT_NAME,
  Service as ExternalMcpServerServiceClass,
} from "../../../Server/Services/ExternalMcpServerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import CreateLimit from "../../../Server/Types/Database/CreateLimit";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { EXTERNAL_MCP_SERVER_CONNECTION_SELECT } from "../../../Server/Utils/AI/Mcp/ExternalMcpServerConnection";
import ExternalMcpServer, {
  getHeaderNamesSql,
} from "../../../Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpServerAuthType from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import {
  EVERY_EXTERNAL_MCP_SERVER,
  NO_EXTERNAL_MCP_SERVER,
} from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import { MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT } from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerLimits";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { EntityManager } from "typeorm";

/*
 * An external MCP server that saves is one OneUptime can try: an address
 * with a host and the sign-in its Authentication needs - on create, and on
 * every update that touches how OneUptime reaches it, checked against the
 * server as it will be (stored values under the new ones; an empty secret
 * keeps the stored one). Changing Authentication removes the secrets the old
 * one used. A project has at most MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT.
 */

const PROJECT: ObjectID = new ObjectID("6c000000-0000-4000-8000-000000000001");
const SERVER: ObjectID = new ObjectID("6c000000-0000-4000-8000-000000000002");

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<ExternalMcpServer>,
  ) => Promise<OnCreate<ExternalMcpServer>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<ExternalMcpServer>,
  ) => Promise<OnUpdate<ExternalMcpServer>>;
  getCreateLimit: (
    createBy: CreateBy<ExternalMcpServer>,
  ) => Promise<CreateLimit | null>;
};

const service: Hooks = ExternalMcpServerService as unknown as Hooks;

function createBy(data: JSONObject): CreateBy<ExternalMcpServer> {
  const server: ExternalMcpServer = new ExternalMcpServer();
  Object.assign(server, { projectId: PROJECT, name: "AWS", ...data });
  return {
    data: server,
    props: { isRoot: true },
  } as CreateBy<ExternalMcpServer>;
}

function updateBy(data: JSONObject): UpdateBy<ExternalMcpServer> {
  return {
    query: { _id: SERVER.toString() },
    data,
    props: { isRoot: true, tenantId: PROJECT },
  } as unknown as UpdateBy<ExternalMcpServer>;
}

function storedServer(
  overrides: Partial<ExternalMcpServer> = {},
): ExternalMcpServer {
  const server: ExternalMcpServer = new ExternalMcpServer();
  server._id = SERVER.toString();
  server.projectId = PROJECT;
  server.url = "https://mcp.example.com/mcp";
  server.authType = ExternalMcpServerAuthType.BearerToken;
  server.bearerToken = "stored-token";
  Object.assign(server, overrides);
  return server;
}

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal.");
}

let countBy: jest.SpiedFunction<typeof ExternalMcpServerService.countBy>;
let findRows: jest.SpiedFunction<
  typeof ExternalMcpServerService.findRowsAndHoldUpdateToThem
>;

beforeEach(() => {
  countBy = jest
    .spyOn(ExternalMcpServerService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  findRows = jest
    .spyOn(ExternalMcpServerService, "findRowsAndHoldUpdateToThem")
    .mockResolvedValue([storedServer()]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ExternalMcpServerService.onBeforeCreate", () => {
  test("a server with no Authentication signs in with none", async () => {
    const result: OnCreate<ExternalMcpServer> = await service.onBeforeCreate(
      createBy({ url: " https://mcp.example.com/mcp " }),
    );

    expect(result.createBy.data.authType).toBe(ExternalMcpServerAuthType.None);
    expect(result.createBy.data.url).toBe("https://mcp.example.com/mcp");
    expect(result.createBy.data.bearerToken).toBeNull();
    expect(result.createBy.data.headers).toBeNull();
    expect(result.createBy.data.oauthClientSecret).toBeNull();
  });

  test("refuses an address that is not one", async () => {
    expect(
      await refusal(service.onBeforeCreate(createBy({ url: "mcp example com" }))),
    ).toBe(
      "The MCP server's URL is not a valid URL. Use the full address, such as https://mcp.example.com/mcp.",
    );
    // "localhost:3000" reads as a URL whose scheme is "localhost:".
    expect(
      await refusal(service.onBeforeCreate(createBy({ url: "localhost:3000" }))),
    ).toBe("The MCP server's URL must start with https:// or http://.");
    expect(await refusal(service.onBeforeCreate(createBy({})))).toBe(
      "The MCP server's URL is required.",
    );
    expect(
      await refusal(
        service.onBeforeCreate(
          createBy({ url: "https://user:secret@mcp.example.com/mcp" }),
        ),
      ),
    ).toContain("cannot hold a user name or password");
  });

  test("a bearer token is required, and the other sign-ins' secrets are left out", async () => {
    expect(
      await refusal(
        service.onBeforeCreate(
          createBy({
            url: "https://mcp.example.com/mcp",
            authType: ExternalMcpServerAuthType.BearerToken,
          }),
        ),
      ),
    ).toBe("The token is required.");

    const result: OnCreate<ExternalMcpServer> = await service.onBeforeCreate(
      createBy({
        url: "https://mcp.example.com/mcp",
        authType: ExternalMcpServerAuthType.BearerToken,
        bearerToken: " ghp_token ",
        headers: { "X-API-Key": "should-not-stay" },
        oauthClientSecret: "should-not-stay",
      }),
    );

    expect(result.createBy.data.bearerToken).toBe("ghp_token");
    expect(result.createBy.data.headers).toBeNull();
    expect(result.createBy.data.oauthClientSecret).toBeNull();
  });

  test("headers sent as JSON text are read, checked and stored trimmed", async () => {
    const result: OnCreate<ExternalMcpServer> = await service.onBeforeCreate(
      createBy({
        url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
        authType: ExternalMcpServerAuthType.Headers,
        headers: '{" DD-API-KEY ":" key ","DD-APPLICATION-KEY":"app"}',
      }),
    );

    expect(result.createBy.data.headers).toEqual({
      "DD-API-KEY": "key",
      "DD-APPLICATION-KEY": "app",
    });

    expect(
      await refusal(
        service.onBeforeCreate(
          createBy({
            url: "https://mcp.example.com/mcp",
            authType: ExternalMcpServerAuthType.Headers,
            headers: "{not json",
          }),
        ),
      ),
    ).toBe("Headers must be a JSON object of header names and values.");

    expect(
      await refusal(
        service.onBeforeCreate(
          createBy({
            url: "https://mcp.example.com/mcp",
            authType: ExternalMcpServerAuthType.Headers,
            headers: { "Mcp-Session-Id": "forged" },
          }),
        ),
      ),
    ).toBe(
      "OneUptime sets the Mcp-Session-Id header itself. Remove it from the headers.",
    );
  });

  test("OAuth client credentials keep their settings and drop a stray token", async () => {
    const result: OnCreate<ExternalMcpServer> = await service.onBeforeCreate(
      createBy({
        url: "https://mcp.example.com/mcp",
        authType: ExternalMcpServerAuthType.OAuthClientCredentials,
        oauthTokenUrl: "https://login.microsoftonline.com/t/oauth2/v2.0/token",
        oauthClientId: "client",
        oauthClientSecret: "secret",
        oauthScope: "",
        bearerToken: "stray",
      }),
    );

    expect(result.createBy.data.oauthTokenUrl).toBe(
      "https://login.microsoftonline.com/t/oauth2/v2.0/token",
    );
    expect(result.createBy.data.oauthClientSecret).toBe("secret");
    expect(result.createBy.data.oauthScope).toBeNull();
    expect(result.createBy.data.bearerToken).toBeNull();
  });

  test("an Authentication OneUptime does not know is refused", async () => {
    expect(
      await refusal(
        service.onBeforeCreate(
          createBy({ url: "https://mcp.example.com/mcp", authType: "Kerberos" }),
        ),
      ),
    ).toBe(
      "Authentication must be None, BearerToken, Headers or OAuthClientCredentials.",
    );
  });

  test("a project at its limit is told before anything is prepared", async () => {
    countBy.mockResolvedValue(
      new PositiveNumber(MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT),
    );

    expect(
      await refusal(
        service.onBeforeCreate(createBy({ url: "https://mcp.example.com/mcp" })),
      ),
    ).toBe(EXTERNAL_MCP_SERVER_LIMIT_MESSAGE);
    expect(countBy.mock.calls[0]![0].query).toEqual({ projectId: PROJECT });
  });
});

describe("ExternalMcpServerService.getCreateLimit", () => {
  test("decides the limit again with the INSERT, under the project's lock", async () => {
    const limit: CreateLimit | null = await service.getCreateLimit(
      createBy({ url: "https://mcp.example.com/mcp" }),
    );

    expect(limit?.limitName).toBe(EXTERNAL_MCP_SERVER_LIMIT_NAME);
    expect(limit?.projectId.toString()).toBe(PROJECT.toString());

    const managerAt: (count: number) => EntityManager = (
      count: number,
    ): EntityManager => {
      return {
        query: async (statement: string, parameters: Array<string>) => {
          expect(statement).toBe(EXTERNAL_MCP_SERVER_COUNT_STATEMENT);
          expect(parameters).toEqual([PROJECT.toString()]);
          return [{ count }];
        },
      } as unknown as EntityManager;
    };

    await expect(
      limit!.check(managerAt(MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT - 1)),
    ).resolves.toBeUndefined();
    await expect(
      limit!.check(managerAt(MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT)),
    ).rejects.toThrow(EXTERNAL_MCP_SERVER_LIMIT_MESSAGE);
  });

  test("counts only the project's servers that are not deleted", () => {
    expect(EXTERNAL_MCP_SERVER_COUNT_STATEMENT).toBe(
      'SELECT COUNT(*)::int AS "count" FROM "ExternalMcpServer" WHERE "projectId" = $1 AND "deletedAt" IS NULL',
    );
  });
});

describe("ExternalMcpServerService.onBeforeUpdate", () => {
  test("a rename or turning a server off reads nothing and checks nothing", async () => {
    const result: OnUpdate<ExternalMcpServer> = await service.onBeforeUpdate(
      updateBy({ name: "AWS prod", isEnabled: false }),
    );

    expect(result.updateBy.data).toEqual({ name: "AWS prod", isEnabled: false });
    expect(findRows).not.toHaveBeenCalled();
  });

  test("an empty secret keeps the stored one", async () => {
    const result: OnUpdate<ExternalMcpServer> = await service.onBeforeUpdate(
      updateBy({
        name: "Renamed",
        bearerToken: "",
        headers: {},
        oauthClientSecret: null,
      }),
    );

    expect(result.updateBy.data).toEqual({ name: "Renamed" });
    expect(findRows).not.toHaveBeenCalled();
  });

  test("a new address is checked against the server as it will be", async () => {
    expect(
      await refusal(service.onBeforeUpdate(updateBy({ url: "nope" }))),
    ).toContain("is not a valid URL");

    const result: OnUpdate<ExternalMcpServer> = await service.onBeforeUpdate(
      updateBy({ url: "https://new.example.com/sse" }),
    );

    expect((result.updateBy.data as JSONObject)["url"]).toBe(
      "https://new.example.com/sse",
    );
    expect(findRows.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ url: true, authType: true, bearerToken: true }),
    );
  });

  test("switching to a bearer token needs one, unless one is stored", async () => {
    findRows.mockResolvedValue([
      storedServer({
        authType: ExternalMcpServerAuthType.None,
        bearerToken: undefined,
      }),
    ]);

    expect(
      await refusal(
        service.onBeforeUpdate(
          updateBy({ authType: ExternalMcpServerAuthType.BearerToken }),
        ),
      ),
    ).toBe("The token is required.");

    findRows.mockResolvedValue([storedServer()]);

    await expect(
      service.onBeforeUpdate(
        updateBy({ authType: ExternalMcpServerAuthType.BearerToken }),
      ),
    ).resolves.toBeDefined();
  });

  test("choosing an Authentication removes the secrets the others used", async () => {
    findRows.mockResolvedValue([storedServer()]);

    const result: OnUpdate<ExternalMcpServer> = await service.onBeforeUpdate(
      updateBy({ authType: ExternalMcpServerAuthType.None }),
    );

    expect(result.updateBy.data).toEqual({
      authType: ExternalMcpServerAuthType.None,
      bearerToken: null,
      headers: null,
      oauthClientSecret: null,
      oauthTokenUrl: null,
      oauthClientId: null,
      oauthScope: null,
      oauthAudience: null,
    });
  });

  test("new headers replace the stored ones, checked and trimmed", async () => {
    findRows.mockResolvedValue([
      storedServer({
        authType: ExternalMcpServerAuthType.Headers,
        headers: { "X-Old": "old" },
      }),
    ]);

    const result: OnUpdate<ExternalMcpServer> = await service.onBeforeUpdate(
      updateBy({ headers: { " X-API-Key ": " new " } }),
    );

    expect((result.updateBy.data as JSONObject)["headers"]).toEqual({
      "X-API-Key": "new",
    });

    expect(
      await refusal(
        service.onBeforeUpdate(updateBy({ headers: { Host: "evil.example" } })),
      ),
    ).toBe("OneUptime sets the Host header itself. Remove it from the headers.");
  });
});

describe("ExternalMcpServerService.findServersForRun", () => {
  let findBy: jest.SpiedFunction<typeof ExternalMcpServerService.findBy>;

  function row(id: string, projectId: ObjectID = PROJECT): ExternalMcpServer {
    const server: ExternalMcpServer = new ExternalMcpServer();
    server.id = new ObjectID(id);
    server.projectId = projectId;
    return server;
  }

  beforeEach(() => {
    findBy = jest.spyOn(ExternalMcpServerService, "findBy");
  });

  test("no server allowed: nothing is read", async () => {
    expect(
      await ExternalMcpServerService.findServersForRun({
        projectId: PROJECT,
        allowance: NO_EXTERNAL_MCP_SERVER,
      }),
    ).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("every server: the project's servers that are on, with what a connection needs", async () => {
    findBy.mockResolvedValue([row("6c000000-0000-4000-8000-0000000000a1")]);

    const servers: Array<ExternalMcpServer> =
      await ExternalMcpServerService.findServersForRun({
        projectId: PROJECT,
        allowance: EVERY_EXTERNAL_MCP_SERVER,
      });

    expect(servers).toHaveLength(1);
    expect(findBy.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT,
      isEnabled: true,
    });
    expect(findBy.mock.calls[0]![0].select).toEqual(
      EXTERNAL_MCP_SERVER_CONNECTION_SELECT,
    );
    expect(findBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });

  test("some servers: only those, and never another project's however it came back", async () => {
    const allowed: string = "6c000000-0000-4000-8000-0000000000a1";
    const notAllowed: string = "6c000000-0000-4000-8000-0000000000a2";
    const elsewhere: string = "6c000000-0000-4000-8000-0000000000a3";

    findBy.mockResolvedValue([
      row(allowed),
      row(notAllowed),
      row(
        elsewhere,
        new ObjectID("6c000000-0000-4000-8000-0000000000ff"),
      ),
    ]);

    const servers: Array<ExternalMcpServer> =
      await ExternalMcpServerService.findServersForRun({
        projectId: PROJECT,
        allowance: {
          isEveryServer: false,
          serverIds: [allowed, elsewhere, "not-a-uuid"],
        },
      });

    expect(
      servers.map((server: ExternalMcpServer): string => {
        return server.id!.toString();
      }),
    ).toEqual([allowed]);

    const query: JSONObject = findBy.mock.calls[0]![0]
      .query as unknown as JSONObject;
    expect(query["projectId"]).toEqual(PROJECT);
    expect(query["isEnabled"]).toBe(true);
    expect(query["_id"]).toBeDefined();
  });
});

describe("ExternalMcpServerService statics", () => {
  test("clearOtherSignIns keeps only what the chosen Authentication uses", () => {
    const data: Record<string, unknown> = {
      authType: ExternalMcpServerAuthType.OAuthClientCredentials,
      oauthTokenUrl: "https://login.example.com/token",
      oauthClientSecret: "secret",
      bearerToken: "x",
    };

    ExternalMcpServerServiceClass.clearOtherSignIns(data);

    expect(data).toEqual({
      authType: ExternalMcpServerAuthType.OAuthClientCredentials,
      oauthTokenUrl: "https://login.example.com/token",
      oauthClientSecret: "secret",
      bearerToken: null,
      headers: null,
    });
  });

  test("the header names are worked out by Postgres from the stored object, never its values", () => {
    expect(getHeaderNamesSql('"ExternalMcpServer"')).toBe(
      `CASE WHEN jsonb_typeof("ExternalMcpServer"."headers") = 'object' THEN (SELECT string_agg("headerName", ', ' ORDER BY "headerName") FROM jsonb_object_keys("ExternalMcpServer"."headers") AS "headerName") END`,
    );
  });
});
