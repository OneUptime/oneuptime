import Entities from "../../../Models/DatabaseModels/Index";
import McpOAuthClient from "../../../Models/DatabaseModels/McpOAuthClient";
import McpOAuthGrant from "../../../Models/DatabaseModels/McpOAuthGrant";
import McpOAuthToken from "../../../Models/DatabaseModels/McpOAuthToken";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import McpOAuthClientService, {
  RegisteredMcpOAuthClient,
} from "../../../Server/Services/McpOAuthClientService";
import McpOAuthGrantService from "../../../Server/Services/McpOAuthGrantService";
import McpOAuthTokenService, {
  IssuedMcpOAuthAuthorizationCode,
  IssuedMcpOAuthTokenPair,
} from "../../../Server/Services/McpOAuthTokenService";
import McpOAuthSecret from "../../../Server/Utils/Mcp/McpOAuthSecret";
import McpOAuthClientAuthMethod from "../../../Types/Mcp/McpOAuthClientAuthMethod";
import McpOAuthScope from "../../../Types/Mcp/McpOAuthScope";
import McpOAuthTokenType from "../../../Types/Mcp/McpOAuthTokenType";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

/*
 * The MCP authorization server's three tables against a real, migrated
 * database.
 *
 * The unit suites pin what the services ASK the database to do, with the
 * database faked. Everything that makes an OAuth token store safe is a promise
 * the database keeps, and a fake keeps none of them:
 *
 *   - "single use" is a compare-and-set. Of two requests racing with one
 *     authorization code or one refresh token, exactly one may be told yes,
 *     and that is only true if the check and the write really are one
 *     statement on a real row.
 *   - "revoke" is a DELETE of the grant. It ends the connection only if the
 *     delete is a real delete (not a soft one) and the foreign key really
 *     cascades to every code, access token and refresh token under it.
 *   - two secrets can never share a row, because the hash is unique.
 *
 * Opt in with RUN_POSTGRES_MCP_OAUTH_TESTS=true against a Postgres migrated to
 * the current head (the Postgres Schema Drift job runs it right after its
 * drift check). Point it at the database with
 * MCP_OAUTH_TEST_DATABASE_HOST/PORT/NAME (default localhost:5400); credentials
 * come from DATABASE_USERNAME / DATABASE_PASSWORD. Only the table DEFINITIONS
 * are copied from public, into an isolated schema that is dropped afterwards;
 * every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MCP_OAUTH_TESTS"] === "true"
    ? describe
    : describe.skip;

const RESOURCE: string = "https://oneuptime.example/mcp";
const CODE_CHALLENGE: string = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT_URI: string = "http://127.0.0.1:33418/callback";

describePostgres("MCP OAuth tables against Postgres", () => {
  const schema: string = `mcp_oauth_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  const table: (name: string) => string = (name: string): string => {
    return `"${schema}"."${name}"`;
  };

  const count: (
    name: string,
    where: string,
    params: Array<string>,
  ) => Promise<number> = async (
    name: string,
    where: string,
    params: Array<string>,
  ): Promise<number> => {
    const rows: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*)::text AS count FROM ${table(name)} WHERE ${where}`,
      params,
    );

    return Number(rows[0]!.count);
  };

  const createGrant: (data?: {
    userId?: ObjectID;
    projectId?: ObjectID;
    clientId?: string;
    scopes?: Array<McpOAuthScope>;
  }) => Promise<McpOAuthGrant> = async (data?: {
    userId?: ObjectID;
    projectId?: ObjectID;
    clientId?: string;
    scopes?: Array<McpOAuthScope>;
  }): Promise<McpOAuthGrant> => {
    return await McpOAuthGrantService.createPendingGrant({
      projectId: data?.projectId || ObjectID.generate(),
      userId: data?.userId || ObjectID.generate(),
      clientId: data?.clientId || ObjectID.generate().toString(),
      clientName: "Test Client",
      scopes: data?.scopes || [McpOAuthScope.Read, McpOAuthScope.Write],
      resource: RESOURCE,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      ssoEvidence: null,
    });
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["MCP_OAUTH_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["MCP_OAUTH_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MCP_OAUTH_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    /*
     * Project and User are cloned empty. A grant's delete is audited, so the
     * delete path reads the whole row first, joins to its project and user
     * included; the joins find nobody, which is all they need to do here.
     */
    for (const name of [
      "McpOAuthClient",
      "McpOAuthGrant",
      "McpOAuthToken",
      "Project",
      "User",
    ]) {
      await database.query(
        `CREATE TABLE ${table(name)} (LIKE public."${name}" INCLUDING ALL)`,
      );
    }

    /*
     * LIKE copies columns, defaults, indexes and the unique constraint, but
     * never foreign keys. The one this suite is about - token to grant - is
     * rebuilt from the definition the MIGRATED table carries, so what is
     * tested is the constraint the migration created rather than one this
     * file wrote. (The grant's keys to Project and User are left out on
     * purpose: every project and user here is a made-up id.)
     */
    const foreignKeys: Array<{ definition: string }> = await database.query(
      `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
        WHERE c.contype = 'f'
          AND c.conrelid = 'public."McpOAuthToken"'::regclass
          AND c.confrelid = 'public."McpOAuthGrant"'::regclass`,
    );

    expect(foreignKeys).toHaveLength(1);

    const grantReference: RegExp = /REFERENCES\s+(?:public\.)?"McpOAuthGrant"/;

    expect(foreignKeys[0]!.definition).toMatch(grantReference);

    await database.query(
      `ALTER TABLE ${table("McpOAuthToken")} ADD CONSTRAINT "fk_token_grant" ${foreignKeys[0]!.definition.replace(
        grantReference,
        `REFERENCES ${table("McpOAuthGrant")}`,
      )}`,
    );

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }

    jest.restoreAllMocks();
  });

  describe("what the migration created", () => {
    test("a token belongs to a grant, and goes when the grant does", async () => {
      const rows: Array<{ definition: string }> = await database.query(
        `SELECT pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
          WHERE c.contype = 'f'
            AND c.conrelid = 'public."McpOAuthToken"'::regclass`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.definition).toContain('FOREIGN KEY ("mcpOAuthGrantId")');
      expect(rows[0]!.definition).toContain("ON DELETE CASCADE");
    });

    test("a grant goes when its project or its user does", async () => {
      const rows: Array<{ definition: string }> = await database.query(
        `SELECT pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
          WHERE c.contype = 'f'
            AND c.conrelid = 'public."McpOAuthGrant"'::regclass
          ORDER BY 1`,
      );

      const definitions: Array<string> = rows.map(
        (row: { definition: string }): string => {
          return row.definition;
        },
      );

      expect(definitions).toHaveLength(2);

      const projectKey: string | undefined = definitions.find(
        (definition: string): boolean => {
          return definition.includes('FOREIGN KEY ("projectId")');
        },
      );
      const userKey: string | undefined = definitions.find(
        (definition: string): boolean => {
          return definition.includes('FOREIGN KEY ("userId")');
        },
      );

      /*
       * Postgres spells the target with its schema when the name is shadowed
       * on the search path - which it is here, by this suite's own clones.
       */
      const projectReference: RegExp =
        /REFERENCES (?:public\.)?"Project"\(_id\)/;
      const userReference: RegExp = /REFERENCES (?:public\.)?"User"\(_id\)/;

      expect(projectKey).toMatch(projectReference);
      expect(projectKey).toContain("ON DELETE CASCADE");
      expect(userKey).toMatch(userReference);
      expect(userKey).toContain("ON DELETE CASCADE");
    });

    test("the token hash is unique", async () => {
      const rows: Array<{ definition: string }> = await database.query(
        `SELECT pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
          WHERE c.contype = 'u'
            AND c.conrelid = 'public."McpOAuthToken"'::regclass`,
      );

      expect(
        rows.map((row: { definition: string }): string => {
          return row.definition;
        }),
      ).toEqual(['UNIQUE ("tokenHash")']);
    });

    test("no client, grant or token table has a column that could hold a plaintext secret", async () => {
      const rows: Array<{ table_name: string; column_name: string }> =
        await database.query(
          `SELECT table_name, column_name
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN ('McpOAuthClient', 'McpOAuthGrant', 'McpOAuthToken')`,
        );

      const secretLikeName: RegExp = /secret|token|code/i;

      const secretLikeColumns: Array<string> = rows
        .map((row: { table_name: string; column_name: string }): string => {
          return row.column_name;
        })
        .filter((column: string): boolean => {
          return secretLikeName.test(column);
        })
        .sort();

      /*
       * Every one of these is a digest, a type name or a PKCE challenge
       * (which is itself a hash). A new column matching the pattern has to be
       * looked at before it is added to this list.
       */
      expect(secretLikeColumns).toEqual([
        "clientSecretHash",
        "codeChallenge",
        "tokenEndpointAuthMethod",
        "tokenHash",
        "tokenType",
      ]);
    });
  });

  describe("secrets are stored as digests", () => {
    test("an authorization code is found by the secret and stored only as its hash", async () => {
      const grant: McpOAuthGrant = await createGrant();
      const now: Date = new Date();

      const issued: IssuedMcpOAuthAuthorizationCode =
        await McpOAuthTokenService.issueAuthorizationCode({
          grantId: grant.id!,
          codeChallenge: CODE_CHALLENGE,
          redirectUri: REDIRECT_URI,
          now,
        });

      const stored: Array<{
        tokenHash: string;
        tokenType: string;
        codeChallenge: string;
        redirectUri: string;
        consumedAt: Date | null;
        expiresAt: Date;
      }> = await database.query(
        `SELECT "tokenHash", "tokenType", "codeChallenge", "redirectUri", "consumedAt", "expiresAt"
           FROM ${table("McpOAuthToken")} WHERE "mcpOAuthGrantId" = $1`,
        [grant.id!.toString()],
      );

      expect(stored).toHaveLength(1);
      expect(stored[0]!.tokenHash).toBe(McpOAuthSecret.hash(issued.code));
      expect(stored[0]!.tokenHash).not.toContain(issued.code);
      expect(stored[0]!.tokenType).toBe(McpOAuthTokenType.AuthorizationCode);
      expect(stored[0]!.codeChallenge).toBe(CODE_CHALLENGE);
      expect(stored[0]!.redirectUri).toBe(REDIRECT_URI);
      expect(stored[0]!.consumedAt).toBeNull();
      expect(new Date(stored[0]!.expiresAt).getTime()).toBe(
        now.getTime() + 5 * 60 * 1000,
      );

      const found: McpOAuthToken | null =
        await McpOAuthTokenService.findBySecret({
          secret: issued.code,
          tokenType: McpOAuthTokenType.AuthorizationCode,
        });

      expect(found?.mcpOAuthGrantId?.toString()).toBe(grant.id!.toString());
      expect(found?.codeChallenge).toBe(CODE_CHALLENGE);
      expect(found?.redirectUri).toBe(REDIRECT_URI);
    });

    test("a token pair is two rows, neither holding its secret, each found only as its own type", async () => {
      const grant: McpOAuthGrant = await createGrant();
      const now: Date = new Date();

      const pair: IssuedMcpOAuthTokenPair =
        await McpOAuthTokenService.issueTokenPair({
          grantId: grant.id!,
          now,
        });

      const stored: Array<{ tokenHash: string; tokenType: string }> =
        await database.query(
          `SELECT "tokenHash", "tokenType" FROM ${table("McpOAuthToken")}
            WHERE "mcpOAuthGrantId" = $1 ORDER BY "tokenType"`,
          [grant.id!.toString()],
        );

      expect(stored).toEqual([
        {
          tokenHash: McpOAuthSecret.hash(pair.accessToken),
          tokenType: McpOAuthTokenType.AccessToken,
        },
        {
          tokenHash: McpOAuthSecret.hash(pair.refreshToken),
          tokenType: McpOAuthTokenType.RefreshToken,
        },
      ]);

      expect(
        await McpOAuthTokenService.findBySecret({
          secret: pair.accessToken,
          tokenType: McpOAuthTokenType.AccessToken,
        }),
      ).not.toBeNull();

      // The right secret asked for as the wrong kind is no token at all.
      expect(
        await McpOAuthTokenService.findBySecret({
          secret: pair.accessToken,
          tokenType: McpOAuthTokenType.RefreshToken,
        }),
      ).toBeNull();
      expect(
        await McpOAuthTokenService.findBySecret({
          secret: pair.refreshToken,
          tokenType: McpOAuthTokenType.AccessToken,
        }),
      ).toBeNull();

      // A well-formed secret that was never issued.
      expect(
        await McpOAuthTokenService.findBySecret({
          secret: McpOAuthSecret.mint(McpOAuthTokenType.AccessToken),
          tokenType: McpOAuthTokenType.AccessToken,
        }),
      ).toBeNull();
    });

    test("two rows can never share a hash", async () => {
      const grant: McpOAuthGrant = await createGrant();
      const hash: string = McpOAuthSecret.hash(
        McpOAuthSecret.mint(McpOAuthTokenType.AccessToken),
      );

      const insert: () => Promise<unknown> = async (): Promise<unknown> => {
        return await database.query(
          `INSERT INTO ${table("McpOAuthToken")}
             ("version", "mcpOAuthGrantId", "tokenType", "tokenHash", "expiresAt")
           VALUES (1, $1, $2, $3, now() + interval '1 hour')`,
          [grant.id!.toString(), McpOAuthTokenType.AccessToken, hash],
        );
      };

      await insert();
      await expect(insert()).rejects.toThrow(/duplicate key value/);

      expect(await count("McpOAuthToken", '"tokenHash" = $1', [hash])).toBe(1);
    });

    test("a confidential client's secret is stored as its hash; a public client has none", async () => {
      const confidential: RegisteredMcpOAuthClient =
        await McpOAuthClientService.registerClient({
          clientName: "Confidential Client",
          clientUri: "https://client.example/",
          redirectUris: ["https://client.example/callback", REDIRECT_URI],
          tokenEndpointAuthMethod: McpOAuthClientAuthMethod.ClientSecretBasic,
        });

      expect(confidential.clientSecret).toMatch(/^oumcp_cs_/);

      const rows: Array<{
        clientSecretHash: string | null;
        redirectUris: Array<string>;
        tokenEndpointAuthMethod: string;
      }> = await database.query(
        `SELECT "clientSecretHash", "redirectUris", "tokenEndpointAuthMethod"
           FROM ${table("McpOAuthClient")} WHERE "_id" = $1`,
        [confidential.client.id!.toString()],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.clientSecretHash).toBe(
        McpOAuthSecret.hash(confidential.clientSecret!),
      );
      expect(JSON.stringify(rows[0])).not.toContain(confidential.clientSecret!);
      expect(rows[0]!.redirectUris).toEqual([
        "https://client.example/callback",
        REDIRECT_URI,
      ]);

      const found: McpOAuthClient | null =
        await McpOAuthClientService.findRegisteredClient(
          confidential.client.id!.toString(),
        );

      expect(found?.redirectUris).toEqual([
        "https://client.example/callback",
        REDIRECT_URI,
      ]);
      expect(found?.tokenEndpointAuthMethod).toBe(
        McpOAuthClientAuthMethod.ClientSecretBasic,
      );
      expect(found?.clientSecretHash).toBe(
        McpOAuthSecret.hash(confidential.clientSecret!),
      );

      const publicClient: RegisteredMcpOAuthClient =
        await McpOAuthClientService.registerClient({
          clientName: "Public Client",
          redirectUris: [REDIRECT_URI],
          tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
        });

      expect(publicClient.clientSecret).toBeNull();
      expect(
        await count(
          "McpOAuthClient",
          '"_id" = $1 AND "clientSecretHash" IS NULL',
          [publicClient.client.id!.toString()],
        ),
      ).toBe(1);

      // A client id that was never registered, and one that is not a UUID.
      expect(
        await McpOAuthClientService.findRegisteredClient(
          ObjectID.generate().toString(),
        ),
      ).toBeNull();
      expect(
        await McpOAuthClientService.findRegisteredClient(
          "https://client.example/metadata.json",
        ),
      ).toBeNull();
    });
  });

  describe("single use", () => {
    test("of many requests racing to claim one code, exactly one wins", async () => {
      const grant: McpOAuthGrant = await createGrant();

      const issued: IssuedMcpOAuthAuthorizationCode =
        await McpOAuthTokenService.issueAuthorizationCode({
          grantId: grant.id!,
          codeChallenge: CODE_CHALLENGE,
          redirectUri: REDIRECT_URI,
        });

      const token: McpOAuthToken | null =
        await McpOAuthTokenService.findBySecret({
          secret: issued.code,
          tokenType: McpOAuthTokenType.AuthorizationCode,
        });

      const outcomes: Array<boolean> = await Promise.all(
        Array.from({ length: 12 }, (): Promise<boolean> => {
          return McpOAuthTokenService.claim({ tokenId: token!.id! });
        }),
      );

      expect(
        outcomes.filter((won: boolean): boolean => {
          return won;
        }),
      ).toHaveLength(1);

      expect(
        await count(
          "McpOAuthToken",
          '"_id" = $1 AND "consumedAt" IS NOT NULL',
          [token!.id!.toString()],
        ),
      ).toBe(1);
    });

    test("a claimed credential stays claimed, and the first claim's time is kept", async () => {
      const grant: McpOAuthGrant = await createGrant();

      const pair: IssuedMcpOAuthTokenPair =
        await McpOAuthTokenService.issueTokenPair({ grantId: grant.id! });

      const refreshToken: McpOAuthToken | null =
        await McpOAuthTokenService.findBySecret({
          secret: pair.refreshToken,
          tokenType: McpOAuthTokenType.RefreshToken,
        });

      const firstClaimAt: Date = new Date("2030-01-01T00:00:00.000Z");
      const secondClaimAt: Date = new Date("2030-01-01T00:05:00.000Z");

      expect(
        await McpOAuthTokenService.claim({
          tokenId: refreshToken!.id!,
          now: firstClaimAt,
        }),
      ).toBe(true);
      expect(
        await McpOAuthTokenService.claim({
          tokenId: refreshToken!.id!,
          now: secondClaimAt,
        }),
      ).toBe(false);

      const reread: McpOAuthToken | null =
        await McpOAuthTokenService.findBySecret({
          secret: pair.refreshToken,
          tokenType: McpOAuthTokenType.RefreshToken,
        });

      // Reuse detection measures from this value; a second claim must not move it.
      expect(new Date(reread!.consumedAt!).toISOString()).toBe(
        firstClaimAt.toISOString(),
      );
    });

    test("claiming a credential that no longer exists is a no", async () => {
      expect(
        await McpOAuthTokenService.claim({ tokenId: ObjectID.generate() }),
      ).toBe(false);
    });

    test("claiming one credential leaves the others under the same grant alone", async () => {
      const grant: McpOAuthGrant = await createGrant();

      const pair: IssuedMcpOAuthTokenPair =
        await McpOAuthTokenService.issueTokenPair({ grantId: grant.id! });

      const refreshToken: McpOAuthToken | null =
        await McpOAuthTokenService.findBySecret({
          secret: pair.refreshToken,
          tokenType: McpOAuthTokenType.RefreshToken,
        });

      expect(
        await McpOAuthTokenService.claim({ tokenId: refreshToken!.id! }),
      ).toBe(true);

      const accessToken: McpOAuthToken | null =
        await McpOAuthTokenService.findBySecret({
          secret: pair.accessToken,
          tokenType: McpOAuthTokenType.AccessToken,
        });

      expect(accessToken?.consumedAt ?? null).toBeNull();
    });
  });

  describe("the life of a grant", () => {
    test("a grant starts pending, is activated by the code exchange, and slides on refresh", async () => {
      const userId: ObjectID = ObjectID.generate();
      const projectId: ObjectID = ObjectID.generate();

      const pending: McpOAuthGrant = await createGrant({
        userId,
        projectId,
        scopes: [McpOAuthScope.Write],
      });

      const found: McpOAuthGrant | null = await McpOAuthGrantService.findGrant(
        pending.id!,
      );

      expect(found?.activatedAt ?? null).toBeNull();
      expect(found?.userId?.toString()).toBe(userId.toString());
      expect(found?.projectId?.toString()).toBe(projectId.toString());
      // Write is stored spelled out as read + write.
      expect(found?.scope).toBe("mcp:read mcp:write");
      expect(found?.resource).toBe(RESOURCE);
      expect(found?.name).toBe("Test Client");

      const before: Array<{ updatedAt: Date; version: number }> =
        await database.query(
          `SELECT "updatedAt", "version" FROM ${table("McpOAuthGrant")} WHERE "_id" = $1`,
          [pending.id!.toString()],
        );

      const activatedAt: Date = new Date("2030-02-01T10:00:00.000Z");
      const firstExpiry: Date = new Date("2030-03-03T10:00:00.000Z");

      await McpOAuthGrantService.activate({
        grantId: pending.id!,
        expiresAt: firstExpiry,
        now: activatedAt,
      });

      const activated: McpOAuthGrant | null =
        await McpOAuthGrantService.findGrant(pending.id!);

      expect(new Date(activated!.activatedAt!).toISOString()).toBe(
        activatedAt.toISOString(),
      );
      expect(new Date(activated!.expiresAt!).toISOString()).toBe(
        firstExpiry.toISOString(),
      );

      const secondExpiry: Date = new Date("2030-04-02T10:00:00.000Z");

      await McpOAuthGrantService.extend({
        grantId: pending.id!,
        expiresAt: secondExpiry,
      });

      const extended: McpOAuthGrant | null =
        await McpOAuthGrantService.findGrant(pending.id!);

      expect(new Date(extended!.expiresAt!).toISOString()).toBe(
        secondExpiry.toISOString(),
      );
      // Extending does not re-activate.
      expect(new Date(extended!.activatedAt!).toISOString()).toBe(
        activatedAt.toISOString(),
      );

      /*
       * Bookkeeping writes: they must not look like an edit of the grant
       * (updatedAt feeds "last changed", version feeds optimistic locking).
       */
      const after: Array<{ updatedAt: Date; version: number }> =
        await database.query(
          `SELECT "updatedAt", "version" FROM ${table("McpOAuthGrant")} WHERE "_id" = $1`,
          [pending.id!.toString()],
        );

      expect(new Date(after[0]!.updatedAt).toISOString()).toBe(
        new Date(before[0]!.updatedAt).toISOString(),
      );
      expect(after[0]!.version).toBe(before[0]!.version);
    });

    test("last-used is written at most once per five minutes", async () => {
      const grant: McpOAuthGrant = await createGrant();
      const firstUse: Date = new Date("2030-05-01T12:00:00.000Z");

      const fresh: McpOAuthGrant | null = await McpOAuthGrantService.findGrant(
        grant.id!,
      );

      await McpOAuthGrantService.touchLastUsed(fresh!, firstUse);

      const afterFirst: McpOAuthGrant | null =
        await McpOAuthGrantService.findGrant(grant.id!);

      expect(new Date(afterFirst!.lastUsedAt!).toISOString()).toBe(
        firstUse.toISOString(),
      );

      // Four minutes later: inside the interval, nothing is written.
      await McpOAuthGrantService.touchLastUsed(
        afterFirst!,
        new Date("2030-05-01T12:04:00.000Z"),
      );

      const afterSecond: McpOAuthGrant | null =
        await McpOAuthGrantService.findGrant(grant.id!);

      expect(new Date(afterSecond!.lastUsedAt!).toISOString()).toBe(
        firstUse.toISOString(),
      );

      // Six minutes later: written.
      const thirdUse: Date = new Date("2030-05-01T12:06:00.000Z");

      await McpOAuthGrantService.touchLastUsed(afterSecond!, thirdUse);

      const afterThird: McpOAuthGrant | null =
        await McpOAuthGrantService.findGrant(grant.id!);

      expect(new Date(afterThird!.lastUsedAt!).toISOString()).toBe(
        thirdUse.toISOString(),
      );
    });
  });

  describe("revocation", () => {
    test("revoking a grant really deletes it, and every credential under it, and nothing else", async () => {
      const revoked: McpOAuthGrant = await createGrant();
      const kept: McpOAuthGrant = await createGrant();

      const revokedCode: IssuedMcpOAuthAuthorizationCode =
        await McpOAuthTokenService.issueAuthorizationCode({
          grantId: revoked.id!,
          codeChallenge: CODE_CHALLENGE,
          redirectUri: REDIRECT_URI,
        });
      const revokedPair: IssuedMcpOAuthTokenPair =
        await McpOAuthTokenService.issueTokenPair({ grantId: revoked.id! });
      // A rotated pair, as a client that has refreshed once would hold.
      const revokedSecondPair: IssuedMcpOAuthTokenPair =
        await McpOAuthTokenService.issueTokenPair({ grantId: revoked.id! });
      const keptPair: IssuedMcpOAuthTokenPair =
        await McpOAuthTokenService.issueTokenPair({ grantId: kept.id! });

      expect(
        await count("McpOAuthToken", '"mcpOAuthGrantId" = $1', [
          revoked.id!.toString(),
        ]),
      ).toBe(5);

      await McpOAuthGrantService.revoke({
        grantId: revoked.id!,
        props: { isRoot: true },
      });

      // Gone, not flagged: there is no row left for anything to find.
      expect(
        await count("McpOAuthGrant", '"_id" = $1', [revoked.id!.toString()]),
      ).toBe(0);
      expect(
        await count("McpOAuthToken", '"mcpOAuthGrantId" = $1', [
          revoked.id!.toString(),
        ]),
      ).toBe(0);

      expect(await McpOAuthGrantService.findGrant(revoked.id!)).toBeNull();

      for (const [secret, tokenType] of [
        [revokedCode.code, McpOAuthTokenType.AuthorizationCode],
        [revokedPair.accessToken, McpOAuthTokenType.AccessToken],
        [revokedPair.refreshToken, McpOAuthTokenType.RefreshToken],
        [revokedSecondPair.accessToken, McpOAuthTokenType.AccessToken],
        [revokedSecondPair.refreshToken, McpOAuthTokenType.RefreshToken],
      ] as Array<[string, McpOAuthTokenType]>) {
        expect(
          await McpOAuthTokenService.findBySecret({ secret, tokenType }),
        ).toBeNull();
      }

      // The other grant and its tokens are untouched.
      expect(await McpOAuthGrantService.findGrant(kept.id!)).not.toBeNull();
      expect(
        await McpOAuthTokenService.findBySecret({
          secret: keptPair.accessToken,
          tokenType: McpOAuthTokenType.AccessToken,
        }),
      ).not.toBeNull();
      expect(
        await McpOAuthTokenService.findBySecret({
          secret: keptPair.refreshToken,
          tokenType: McpOAuthTokenType.RefreshToken,
        }),
      ).not.toBeNull();
    });

    test("a replayed credential takes the whole grant with it", async () => {
      const grant: McpOAuthGrant = await createGrant();

      const pair: IssuedMcpOAuthTokenPair =
        await McpOAuthTokenService.issueTokenPair({ grantId: grant.id! });

      await McpOAuthGrantService.revokeBecauseCredentialWasReplayed({
        grantId: grant.id!,
        credential: "refresh token",
      });

      expect(await McpOAuthGrantService.findGrant(grant.id!)).toBeNull();
      expect(
        await McpOAuthTokenService.findBySecret({
          secret: pair.accessToken,
          tokenType: McpOAuthTokenType.AccessToken,
        }),
      ).toBeNull();
    });

    test("revoking a grant that is already gone is not an error", async () => {
      await expect(
        McpOAuthGrantService.revoke({
          grantId: ObjectID.generate(),
          props: { isRoot: true },
        }),
      ).resolves.toBeUndefined();
    });

    test("a reconnecting registered client replaces its own earlier grants, and only those", async () => {
      const userId: ObjectID = ObjectID.generate();
      const projectId: ObjectID = ObjectID.generate();
      const clientId: string = ObjectID.generate().toString();

      const earlier: McpOAuthGrant = await createGrant({
        userId,
        projectId,
        clientId,
      });
      const earlierStill: McpOAuthGrant = await createGrant({
        userId,
        projectId,
        clientId,
      });
      const current: McpOAuthGrant = await createGrant({
        userId,
        projectId,
        clientId,
      });

      // Same client, but somebody else's grant, another project, another client.
      const otherUser: McpOAuthGrant = await createGrant({
        projectId,
        clientId,
      });
      const otherProject: McpOAuthGrant = await createGrant({
        userId,
        clientId,
      });
      const otherClient: McpOAuthGrant = await createGrant({
        userId,
        projectId,
      });

      const earlierPair: IssuedMcpOAuthTokenPair =
        await McpOAuthTokenService.issueTokenPair({ grantId: earlier.id! });
      const currentPair: IssuedMcpOAuthTokenPair =
        await McpOAuthTokenService.issueTokenPair({ grantId: current.id! });

      await McpOAuthGrantService.revokeEarlierGrantsOfClient({
        userId,
        projectId,
        clientId,
        exceptGrantId: current.id!,
      });

      expect(await McpOAuthGrantService.findGrant(earlier.id!)).toBeNull();
      expect(await McpOAuthGrantService.findGrant(earlierStill.id!)).toBeNull();
      expect(
        await McpOAuthTokenService.findBySecret({
          secret: earlierPair.refreshToken,
          tokenType: McpOAuthTokenType.RefreshToken,
        }),
      ).toBeNull();

      for (const survivor of [current, otherUser, otherProject, otherClient]) {
        expect(
          await McpOAuthGrantService.findGrant(survivor.id!),
        ).not.toBeNull();
      }

      expect(
        await McpOAuthTokenService.findBySecret({
          secret: currentPair.refreshToken,
          tokenType: McpOAuthTokenType.RefreshToken,
        }),
      ).not.toBeNull();
    });
  });

  describe("client registrations", () => {
    test("a registration's last-used time moves at most once a day", async () => {
      const registered: RegisteredMcpOAuthClient =
        await McpOAuthClientService.registerClient({
          clientName: "Daily Client",
          redirectUris: [REDIRECT_URI],
          tokenEndpointAuthMethod: McpOAuthClientAuthMethod.None,
        });

      const readLastUsedAt: () => Promise<string> =
        async (): Promise<string> => {
          const rows: Array<{ lastUsedAt: Date }> = await database.query(
            `SELECT "lastUsedAt" FROM ${table("McpOAuthClient")} WHERE "_id" = $1`,
            [registered.client.id!.toString()],
          );

          return new Date(rows[0]!.lastUsedAt).toISOString();
        };

      const atRegistration: string = await readLastUsedAt();

      const recent: McpOAuthClient = new McpOAuthClient();
      recent._id = registered.client.id!.toString();
      recent.lastUsedAt = new Date();

      await McpOAuthClientService.touchLastUsed(recent);

      expect(await readLastUsedAt()).toBe(atRegistration);

      // Known to have been idle for two days: the write goes through.
      const stale: McpOAuthClient = new McpOAuthClient();
      stale._id = registered.client.id!.toString();
      stale.lastUsedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      await McpOAuthClientService.touchLastUsed(stale);

      expect(await readLastUsedAt()).not.toBe(atRegistration);
    });
  });
});
