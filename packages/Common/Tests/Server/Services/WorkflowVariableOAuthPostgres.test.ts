import Entities from "../../../Models/DatabaseModels/Index";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import WorkflowVariableService from "../../../Server/Services/WorkflowVariableService";
import Encryption from "../../../Server/Utils/Encryption";
import logger from "../../../Server/Utils/Logger";
import OAuth2TokenClient, {
  OAuth2TokenHttpRequest,
  OAuth2TokenHttpResponse,
} from "../../../Server/Utils/Workflow/OAuth2TokenClient";
import WorkflowVariableOAuthToken from "../../../Server/Utils/Workflow/WorkflowVariableOAuthToken";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  OAuth2GrantType,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import { DataSource } from "typeorm";

/*
 * OAuth 2.0 workflow variables against a real Postgres: the migration's
 * columns, encryption at rest, the service hooks and the column permissions
 * running through the real create/update pipeline, and the token manager's
 * writes landing where the runner reads them.
 *
 * Opt in with RUN_POSTGRES_WORKFLOW_VARIABLE_OAUTH_TESTS=true, pointed at a
 * database that has every registered migration applied
 * (WORKFLOW_VARIABLE_OAUTH_TEST_DATABASE_HOST / _PORT / _NAME, or the usual
 * DATABASE_* variables). Every write goes to a uniquely named schema holding a
 * structural copy of the WorkflowVariable table; no existing row is read.
 *
 * The identity provider is a fake transport. The Redis lock is unavailable,
 * which exercises the unlocked path the manager falls back to.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_WORKFLOW_VARIABLE_OAUTH_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = ObjectID.generate();

function ownerProps(): DatabaseCommonInteractionProps {
  const permission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectOwner,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: permission },
  };
}

describePostgres("OAuth 2.0 workflow variables against Postgres", () => {
  const schema: string = `wf_oauth_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  let tokenRequests: Array<OAuth2TokenHttpRequest>;
  let nextResponse: OAuth2TokenHttpResponse;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["WORKFLOW_VARIABLE_OAUTH_TEST_DATABASE_HOST"] ||
        process.env["DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["WORKFLOW_VARIABLE_OAUTH_TEST_DATABASE_PORT"] ||
          process.env["DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["WORKFLOW_VARIABLE_OAUTH_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });

    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."WorkflowVariable" (LIKE public."WorkflowVariable" INCLUDING ALL)`,
    );

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    tokenRequests = [];
    nextResponse = {
      statusCode: 200,
      bodyText: JSON.stringify({
        access_token: "access-token-from-idp",
        token_type: "Bearer",
        expires_in: 3600,
      }),
      headers: { "content-type": "application/json" },
    };

    jest
      .spyOn(OAuth2TokenClient, "transport")
      .mockImplementation(async (request: OAuth2TokenHttpRequest) => {
        tokenRequests.push(request);
        return nextResponse;
      });

    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new Error("Redis client is not connected"));

    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    (OAuth2TokenClient.transport as unknown as jest.Mock).mockRestore?.();
    (Semaphore.lock as unknown as jest.Mock).mockRestore?.();
    (logger.warn as unknown as jest.Mock).mockRestore?.();
  });

  async function raw(id: ObjectID): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "${schema}"."WorkflowVariable" WHERE "_id" = $1`,
      [id.toString()],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function createOAuthVariable(
    overrides?: Record<string, unknown>,
  ): Promise<WorkflowVariable> {
    const variable: WorkflowVariable = new WorkflowVariable();
    variable.name = `TOKEN_${ObjectID.generate().toString().substring(0, 8)}`;
    variable.projectId = PROJECT_ID;
    variable.variableType = WorkflowVariableType.OAuth2;
    variable.oauthGrantType = OAuth2GrantType.ClientCredentials;
    variable.oauthTokenUrl = "https://login.example.com/oauth2/token";
    variable.oauthClientId = "client-123";
    variable.oauthClientSecret = "client-secret-plaintext";
    variable.oauthScope = "api.read";

    for (const [key, value] of Object.entries(overrides || {})) {
      (variable as unknown as Record<string, unknown>)[key] = value;
    }

    return await WorkflowVariableService.create({
      data: variable,
      props: ownerProps(),
    });
  }

  test("the migration added the columns with the types the model declares", async () => {
    const columns: Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }> = await database.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'WorkflowVariable' AND (column_name LIKE 'oauth%' OR column_name = 'variableType')
       ORDER BY column_name`,
    );

    const byName: Record<string, { data_type: string; is_nullable: string }> =
      {};

    for (const column of columns) {
      byName[column.column_name] = column;
    }

    expect(Object.keys(byName).sort()).toEqual(
      [
        "oauthAccessToken",
        "oauthAccessTokenExpiresAt",
        "oauthAdditionalParameters",
        "oauthClientAuthenticationMethod",
        "oauthClientId",
        "oauthClientSecret",
        "oauthGrantType",
        "oauthLastRefreshError",
        "oauthLastRefreshErrorAt",
        "oauthLastRefreshedAt",
        "oauthRefreshToken",
        "oauthScope",
        "oauthTokenUrl",
        "variableType",
      ].sort(),
    );

    const variableType: {
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    } = columns.find((column: { column_name: string }) => {
      return column.column_name === "variableType";
    })!;

    // Existing rows became Static without a data migration.
    expect(variableType.is_nullable).toBe("NO");
    expect(variableType.column_default).toContain("Static");
    expect(byName["oauthAdditionalParameters"]!.data_type).toBe("jsonb");
    expect(byName["oauthAccessTokenExpiresAt"]!.data_type).toBe(
      "timestamp with time zone",
    );
  });

  test("a Static variable created the old way is still Static and keeps its content", async () => {
    const variable: WorkflowVariable = new WorkflowVariable();
    variable.name = "PLAIN_VALUE";
    variable.projectId = PROJECT_ID;
    variable.content = "plain-content";
    /*
     * Sent the way the dashboard's toggle always sends it: the column's
     * `defaultValue: false` is falsy, so checkRequiredFields has never filled
     * it in for an API caller that leaves it out (unchanged by this feature).
     */
    variable.isSecret = false as unknown as string;

    const created: WorkflowVariable = await WorkflowVariableService.create({
      data: variable,
      props: ownerProps(),
    });

    const row: Record<string, unknown> = await raw(created.id!);

    expect(row["variableType"]).toBe(WorkflowVariableType.Static);
    expect(row["content"]).toBe("plain-content");
    expect(row["oauthClientSecret"]).toBeNull();
  });

  test("an OAuth variable is stored secret, with empty content and an encrypted client secret", async () => {
    const created: WorkflowVariable = await createOAuthVariable();
    const row: Record<string, unknown> = await raw(created.id!);

    expect(row["variableType"]).toBe(WorkflowVariableType.OAuth2);
    expect(row["isSecret"]).toBe(true);
    expect(row["content"]).toBe("");

    const storedSecret: string = row["oauthClientSecret"] as string;

    expect(storedSecret).toBeTruthy();
    expect(storedSecret).not.toContain("client-secret-plaintext");
    expect(await Encryption.decrypt(storedSecret)).toBe(
      "client-secret-plaintext",
    );
  });

  test("an owner cannot read the client secret back through the service", async () => {
    const created: WorkflowVariable = await createOAuthVariable();

    await expect(
      WorkflowVariableService.findOneById({
        id: created.id!,
        select: { oauthClientSecret: true },
        props: ownerProps(),
      }),
    ).rejects.toThrow();

    // The readable settings do come back.
    const readable: WorkflowVariable | null =
      await WorkflowVariableService.findOneById({
        id: created.id!,
        select: {
          variableType: true,
          oauthTokenUrl: true,
          oauthClientId: true,
          oauthScope: true,
        },
        props: ownerProps(),
      });

    expect(readable?.oauthClientId).toBe("client-123");
  });

  test("a refresh stores the token encrypted, with its expiry, and the runner's query reads it back", async () => {
    const created: WorkflowVariable = await createOAuthVariable();

    const token: { accessToken: string; expiresAt: Date | null } =
      await WorkflowVariableOAuthToken.getAccessToken({
        variableId: created.id!,
      });

    expect(token.accessToken).toBe("access-token-from-idp");
    expect(tokenRequests).toHaveLength(1);
    // The decrypted secret went into the request, in the Basic header.
    expect(tokenRequests[0]!.headers["Authorization"]).toBe(
      `Basic ${Buffer.from("client-123:client-secret-plaintext").toString(
        "base64",
      )}`,
    );

    const row: Record<string, unknown> = await raw(created.id!);

    expect(row["oauthAccessToken"]).not.toBe("access-token-from-idp");
    expect(await Encryption.decrypt(row["oauthAccessToken"] as string)).toBe(
      "access-token-from-idp",
    );
    expect(row["oauthAccessTokenExpiresAt"]).toBeInstanceOf(Date);
    expect(row["oauthLastRefreshedAt"]).toBeInstanceOf(Date);
    expect(row["oauthLastRefreshError"]).toBeNull();

    // What RunWorkflow.getVariables selects, as root, decrypted.
    const asRunnerSees: WorkflowVariable | null =
      await WorkflowVariableService.findOneById({
        id: created.id!,
        select: {
          variableType: true,
          oauthAccessToken: true,
          oauthAccessTokenExpiresAt: true,
        },
        props: { isRoot: true },
      });

    expect(asRunnerSees?.oauthAccessToken).toBe("access-token-from-idp");

    // A second call reuses the stored token instead of asking again.
    await WorkflowVariableOAuthToken.getAccessToken({
      variableId: created.id!,
    });
    expect(tokenRequests).toHaveLength(1);
  });

  test("a rotated refresh token is stored encrypted in place of the old one", async () => {
    const created: WorkflowVariable = await createOAuthVariable({
      oauthGrantType: OAuth2GrantType.RefreshToken,
      oauthRefreshToken: "refresh-token-1",
    });

    nextResponse = {
      statusCode: 200,
      bodyText: JSON.stringify({
        access_token: "access-2",
        expires_in: 3600,
        refresh_token: "refresh-token-2",
      }),
      headers: {},
    };

    await WorkflowVariableOAuthToken.getAccessToken({
      variableId: created.id!,
    });

    expect(tokenRequests[0]!.body["refresh_token"]).toBe("refresh-token-1");

    const row: Record<string, unknown> = await raw(created.id!);

    expect(await Encryption.decrypt(row["oauthRefreshToken"] as string)).toBe(
      "refresh-token-2",
    );
  });

  test("a refused refresh is recorded on the row", async () => {
    const created: WorkflowVariable = await createOAuthVariable();

    nextResponse = {
      statusCode: 401,
      bodyText: JSON.stringify({ error: "invalid_client" }),
      headers: {},
    };

    await expect(
      WorkflowVariableOAuthToken.getAccessToken({ variableId: created.id! }),
    ).rejects.toThrow("invalid_client");

    const row: Record<string, unknown> = await raw(created.id!);

    expect(row["oauthLastRefreshError"]).toContain("invalid_client");
    expect(row["oauthLastRefreshErrorAt"]).toBeInstanceOf(Date);
    expect(row["oauthAccessToken"]).toBeNull();
  });

  test("changing a setting through the API throws the cached token away", async () => {
    const created: WorkflowVariable = await createOAuthVariable();

    await WorkflowVariableOAuthToken.getAccessToken({
      variableId: created.id!,
    });
    expect((await raw(created.id!))["oauthAccessToken"]).not.toBeNull();

    await WorkflowVariableService.updateOneById({
      id: created.id!,
      data: { oauthScope: "api.write" },
      props: ownerProps(),
    });

    const row: Record<string, unknown> = await raw(created.id!);

    expect(row["oauthScope"]).toBe("api.write");
    expect(row["oauthAccessToken"]).toBeNull();
    expect(row["oauthAccessTokenExpiresAt"]).toBeNull();
    expect(row["oauthLastRefreshedAt"]).toBeNull();
  });

  test("an edit that sends the same settings back keeps the cached token", async () => {
    const created: WorkflowVariable = await createOAuthVariable();

    await WorkflowVariableOAuthToken.getAccessToken({
      variableId: created.id!,
    });

    await WorkflowVariableService.updateOneById({
      id: created.id!,
      data: {
        description: "fixed a typo",
        oauthTokenUrl: "https://login.example.com/oauth2/token",
        oauthClientId: "client-123",
        oauthScope: "api.read",
      },
      props: ownerProps(),
    });

    const row: Record<string, unknown> = await raw(created.id!);

    expect(row["description"]).toBe("fixed a typo");
    expect(row["oauthAccessToken"]).not.toBeNull();
  });

  test("a new client secret through the API is encrypted and invalidates the token", async () => {
    const created: WorkflowVariable = await createOAuthVariable();

    await WorkflowVariableOAuthToken.getAccessToken({
      variableId: created.id!,
    });

    await WorkflowVariableService.updateOneById({
      id: created.id!,
      data: { oauthClientSecret: "rotated-secret" },
      props: ownerProps(),
    });

    const row: Record<string, unknown> = await raw(created.id!);

    expect(await Encryption.decrypt(row["oauthClientSecret"] as string)).toBe(
      "rotated-secret",
    );
    expect(row["oauthAccessToken"]).toBeNull();
  });

  test("an owner can neither type content over an OAuth variable nor write its token", async () => {
    const created: WorkflowVariable = await createOAuthVariable();

    await expect(
      WorkflowVariableService.updateOneById({
        id: created.id!,
        data: { content: "pasted-token" },
        props: ownerProps(),
      }),
    ).rejects.toThrow("is an OAuth 2.0 variable");

    await expect(
      WorkflowVariableService.updateOneById({
        id: created.id!,
        data: { oauthAccessToken: "forged-token" },
        props: ownerProps(),
      }),
    ).rejects.toThrow();

    await expect(
      WorkflowVariableService.updateOneById({
        id: created.id!,
        data: { variableType: WorkflowVariableType.Static },
        props: ownerProps(),
      }),
    ).rejects.toThrow();

    const row: Record<string, unknown> = await raw(created.id!);

    expect(row["content"]).toBe("");
    expect(row["oauthAccessToken"]).toBeNull();
    expect(row["variableType"]).toBe(WorkflowVariableType.OAuth2);
  });

  /*
   * The dashboard's edit form for a Static variable posts the hidden OAuth
   * fields too. The update must succeed and store none of them.
   */
  test("editing a Static variable with the OAuth fields the form posts stores none of them", async () => {
    const variable: WorkflowVariable = new WorkflowVariable();
    variable.name = "EDITED_PLAIN";
    variable.projectId = PROJECT_ID;
    variable.content = "plain";
    variable.isSecret = false as unknown as string;

    const created: WorkflowVariable = await WorkflowVariableService.create({
      data: variable,
      props: ownerProps(),
    });

    await WorkflowVariableService.updateOneById({
      id: created.id!,
      data: {
        description: "edited",
        oauthTokenUrl: null,
        oauthClientId: null,
        oauthScope: null,
        oauthClientAuthenticationMethod: "HTTP Basic Header",
      } as never,
      props: ownerProps(),
    });

    const row: Record<string, unknown> = await raw(created.id!);

    expect(row["description"]).toBe("edited");
    expect(row["oauthClientAuthenticationMethod"]).toBeNull();
    expect(row["content"]).toBe("plain");
  });
});
