import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import * as mssql from "mssql";
import DataverseApi, {
  DATAVERSE_CORE_TABLES,
  DataverseConnection,
  DataverseThrottledError,
  getDataverseAuthority,
  getDataverseOrganization,
  inlineDataverseSqlParameters,
  isCountedDataverseTable,
  readDataverseConnection,
  selectDataverseTables,
} from "../../../../Server/Utils/DataObservability/DataverseApi";
import {
  collectTableHealth,
  CollectedTable,
  describeDataverseSqlError,
  readCheckValues,
  readDataverseColumns,
  readDataverseColumnType,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import { readConnectionTarget } from "../../../../Server/Utils/DataObservability/TableHealthTarget";
import { getDatabaseConnectionHosts } from "../../../../Server/Utils/DataObservability/DatabaseConnectionGuard";
import {
  getConnectionSecrets,
  sanitizeErrorMessage,
} from "../../../../Server/Utils/DataSecurity/Content/DatabaseSampler";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import { DataAssetColumn } from "../../../../Types/DataObservability/DataAssetColumn";
import { DataCheckRunResult } from "../../../../Server/Utils/DataObservability/DataCheckResults";
import { JSONObject } from "../../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";

jest.mock("mssql", () => {
  return { __esModule: true, ConnectionPool: jest.fn() };
});

/*
 * MICROSOFT DATAVERSE, AN ENVIRONMENT AT A TIME.
 *
 * Read over its Web API, signed in as an application through Microsoft
 * Entra ID: the tables' definitions, rows and newest changes every
 * collection, their columns once an hour, and data checks as read-only SQL
 * on its TDS endpoint. What is held here: only the default tables (the core
 * business tables and the environment's own custom tables) and the tables
 * the connection names are read, so a bill never carries Dataverse's own
 * hundreds; an excluded table costs no request; a 429 leaves the rest of a
 * collection's reads to the next; a table missing from a column read is
 * unread, never "every column dropped"; a check's values are written in as
 * strings that cannot break out of their quotes; and the secret never
 * reaches an error.
 */

const HOST: string = "contoso.crm.dynamics.com";
const TENANT: string = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";
const SECRET: string = "s3cr3t~Value.With_Special";
const WEB_API: string = `https://${HOST}/api/data/v9.2`;
const TOKEN_URL: string = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

function json(
  body: unknown,
  statusCode: number = 200,
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  return {
    statusCode,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers,
  };
}

function connectionString(overrides: JSONObject = {}): string {
  return JSON.stringify({
    environmentUrl: `https://${HOST}`,
    tenantId: TENANT,
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    ...overrides,
  });
}

function connection(
  overrides: Partial<DataverseConnection> = {},
): DataverseConnection {
  return {
    host: HOST,
    tenantId: TENANT,
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    tables: [],
    sqlPort: null,
    ...overrides,
  };
}

function definition(
  logicalName: string,
  overrides: JSONObject = {},
): JSONObject {
  return {
    LogicalName: logicalName,
    EntitySetName: `${logicalName}s`,
    TableType: "Standard",
    IsCustomEntity: false,
    IsIntersect: false,
    IsPrivate: false,
    IsLogicalEntity: false,
    IsActivityParty: false,
    IsBPFEntity: false,
    ...overrides,
  };
}

describe("readDataverseConnection", () => {
  test("JSON: the environment's host, the tenant and the app", () => {
    expect(
      readDataverseConnection(
        connectionString({
          environmentUrl: "https://Contoso.crm.dynamics.com/main.aspx?appid=1",
          clientId: CLIENT_ID.toUpperCase(),
          tables: ["msdyn_workorder", "SalesOrderDetail", "msdyn_workorder"],
        }),
      ),
    ).toEqual(connection({ tables: ["msdyn_workorder", "salesorderdetail"] }));
  });

  test("a Dataverse connection string, as its SDKs take it", () => {
    expect(
      readDataverseConnection(
        `AuthType=ClientSecret;Url=https://${HOST};ClientId=${CLIENT_ID};ClientSecret=${SECRET};TenantId=${TENANT};Tables=msdyn_workorder, cr123_site`,
      ),
    ).toEqual(connection({ tables: ["msdyn_workorder", "cr123_site"] }));
  });

  test("a quoted secret may hold a semicolon", () => {
    expect(
      readDataverseConnection(
        `AuthType=ClientSecret; Url=https://${HOST}; ClientId=${CLIENT_ID}; ClientSecret="a;b=c"`,
      ).clientSecret,
    ).toBe("a;b=c");
  });

  test("the tenant may be left out: the environment is asked", () => {
    expect(
      readDataverseConnection(connectionString({ tenantId: undefined }))
        .tenantId,
    ).toBe(null);
  });

  test("only an application signs in", () => {
    expect(() => {
      return readDataverseConnection(
        `AuthType=OAuth;Url=https://${HOST};Username=jane@contoso.com;Password=pw`,
      );
    }).toThrow(/AuthType=ClientSecret, not oauth/);
  });

  test("only a Dataverse environment's host is ever called", () => {
    for (const url of [
      "",
      "https://example.com",
      `https://${HOST}.evil.example`,
      "https://169.254.169.254",
      "https://localhost",
      "https://-bad.crm.dynamics.com",
      "https://a.b.crm.dynamics.com",
    ]) {
      expect(() => {
        return readDataverseConnection(
          connectionString({ environmentUrl: url }),
        );
      }).toThrow(/environment's URL/);
    }
  });

  test("every Microsoft cloud's environments sign in at their own authority", () => {
    expect(getDataverseAuthority("contoso.crm.dynamics.com")).toBe(
      "login.microsoftonline.com",
    );
    expect(getDataverseAuthority("contoso.crm4.dynamics.com")).toBe(
      "login.microsoftonline.com",
    );
    // GCC.
    expect(getDataverseAuthority("contoso.crm9.dynamics.com")).toBe(
      "login.microsoftonline.com",
    );
    expect(getDataverseAuthority("contoso.crm.microsoftdynamics.us")).toBe(
      "login.microsoftonline.us",
    );
    expect(getDataverseAuthority("contoso.crm.appsplatform.us")).toBe(
      "login.microsoftonline.us",
    );
    expect(getDataverseAuthority("contoso.crm.dynamics.cn")).toBe(
      "login.chinacloudapi.cn",
    );
    expect(getDataverseAuthority("contoso.dynamics.com")).toBe(null);
    expect(getDataverseOrganization(HOST)).toBe("contoso");
  });

  test("what is missing or wrong is said", () => {
    expect(() => {
      return readDataverseConnection(
        connectionString({ clientId: "not-a-guid" }),
      );
    }).toThrow(/client ID and client secret/);
    expect(() => {
      return readDataverseConnection(connectionString({ clientSecret: "" }));
    }).toThrow(/client ID and client secret/);
    expect(() => {
      return readDataverseConnection(
        connectionString({ tenantId: "contoso/../../evil" }),
      );
    }).toThrow(/tenant's ID or domain/);
    expect(() => {
      return readDataverseConnection(
        connectionString({ tables: ["account; DROP"] }),
      );
    }).toThrow(/logical name/);
    expect(() => {
      return readDataverseConnection(connectionString({ sqlPort: 1234 }));
    }).toThrow(/1433 or 5558/);
    expect(() => {
      return readDataverseConnection("not a connection");
    }).toThrow(/environment's URL/);
  });

  test("a domain names the tenant as well as an ID", () => {
    expect(
      readDataverseConnection(
        connectionString({ tenantId: "contoso.onmicrosoft.com" }),
      ).tenantId,
    ).toBe("contoso.onmicrosoft.com");
  });

  test("the SQL endpoint's port may be named", () => {
    expect(
      readDataverseConnection(connectionString({ sqlPort: 5558 })).sqlPort,
    ).toBe(5558);
    expect(
      new DataverseApi({ connection: connection({ sqlPort: 5558 }) }).sqlPorts,
    ).toEqual([5558]);
    expect(new DataverseApi({ connection: connection() }).sqlPorts).toEqual([
      1433, 5558,
    ]);
  });

  test("tables named in a list are lower-cased and kept once; too many are refused", () => {
    expect(
      readDataverseConnection(
        connectionString({ tables: "a_one,\nA_TWO  a_one" }),
      ).tables,
    ).toEqual(["a_one", "a_two"]);
    expect(() => {
      return readDataverseConnection(
        connectionString({
          tables: Array.from({ length: 501 }, (_: unknown, index: number) => {
            return `cr123_t${index}`;
          }),
        }),
      );
    }).toThrow(/at most 500/);
  });
});

describe("selectDataverseTables", () => {
  const definitions: Array<JSONObject> = [
    definition("contact"),
    definition("account"),
    definition("systemuser"),
    definition("webresource"),
    definition("cr123_project", { IsCustomEntity: true }),
    definition("new_invoiceline", { IsCustomEntity: true }),
    definition("cr123_projectmember", {
      IsCustomEntity: true,
      IsIntersect: true,
    }),
    definition("cr123_onboarding", { IsCustomEntity: true, IsBPFEntity: true }),
    definition("cr123_external", {
      IsCustomEntity: true,
      TableType: "Virtual",
    }),
    definition("cr123_reading", { IsCustomEntity: true, TableType: "Elastic" }),
    definition("msdyn_workorder", { IsCustomEntity: true }),
    definition("msdynmkt_journey", { IsCustomEntity: true }),
    definition("adx_webpage", { IsCustomEntity: true }),
    definition("mspp_website", { IsCustomEntity: true }),
    definition("activityparty", { IsActivityParty: true }),
    definition("principalobjectaccess", { IsPrivate: true }),
    definition("cr123_logical", {
      IsCustomEntity: true,
      IsLogicalEntity: true,
    }),
    definition("email", { TableType: "Activity" }),
    definition("nosetname", { EntitySetName: "" }),
  ];

  test("by default: the core tables there are, and the environment's own custom tables", () => {
    expect(
      selectDataverseTables(definitions, []).tables.map(
        (table: { logicalName: string }): string => {
          return table.logicalName;
        },
      ),
    ).toEqual([
      "account",
      "contact",
      "cr123_project",
      "cr123_reading",
      "email",
      "new_invoiceline",
    ]);
  });

  test("a named table is watched too, even one of Microsoft's apps or a virtual one", () => {
    const selection: ReturnType<typeof selectDataverseTables> =
      selectDataverseTables(definitions, [
        "msdyn_workorder",
        "systemuser",
        "cr123_external",
        "cr123_projectmember",
      ]);

    expect(
      selection.tables.map((table: { logicalName: string }): string => {
        return table.logicalName;
      }),
    ).toEqual([
      "account",
      "contact",
      "cr123_external",
      "cr123_project",
      "cr123_projectmember",
      "cr123_reading",
      "email",
      "msdyn_workorder",
      "new_invoiceline",
      "systemuser",
    ]);
    expect(selection.unknownNames).toEqual([]);
  });

  test("a private or logical table, or one the environment has not, cannot be named", () => {
    expect(
      selectDataverseTables(definitions, [
        "principalobjectaccess",
        "cr123_logical",
        "cr123_missing",
      ]).unknownNames,
    ).toEqual(["principalobjectaccess", "cr123_logical", "cr123_missing"]);
  });

  test("each table keeps its collection's name and type", () => {
    expect(selectDataverseTables(definitions, []).tables[3]).toEqual({
      logicalName: "cr123_reading",
      entitySetName: "cr123_readings",
      tableType: "Elastic",
    });
  });

  test("only standard and activity tables are counted", () => {
    expect(
      isCountedDataverseTable({
        logicalName: "a",
        entitySetName: "as",
        tableType: "Standard",
      }),
    ).toBe(true);
    expect(
      isCountedDataverseTable({
        logicalName: "a",
        entitySetName: "as",
        tableType: "Activity",
      }),
    ).toBe(true);
    expect(
      isCountedDataverseTable({
        logicalName: "a",
        entitySetName: "as",
        tableType: "Elastic",
      }),
    ).toBe(false);
    expect(
      isCountedDataverseTable({
        logicalName: "a",
        entitySetName: "as",
        tableType: "Virtual",
      }),
    ).toBe(false);
  });

  test("the core tables are business data, never Dataverse's own", () => {
    expect(DATAVERSE_CORE_TABLES).toContain("account");
    expect(DATAVERSE_CORE_TABLES).toContain("incident");
    expect(DATAVERSE_CORE_TABLES).not.toContain("systemuser");
    expect(new Set(DATAVERSE_CORE_TABLES).size).toBe(
      DATAVERSE_CORE_TABLES.length,
    );
  });
});

describe("inlineDataverseSqlParameters", () => {
  test("each value is written in as an N'...' string, its quotes doubled", () => {
    expect(
      inlineDataverseSqlParameters(
        "SELECT COUNT(*) AS value FROM [dbo].[account] WHERE [name] NOT IN (@p0, @p1)",
        ["Contoso", "O'Brien's"],
      ),
    ).toBe(
      "SELECT COUNT(*) AS value FROM [dbo].[account] WHERE [name] NOT IN (N'Contoso', N'O''Brien''s')",
    );
  });

  test("a value cannot break out of its string", () => {
    expect(
      inlineDataverseSqlParameters("SELECT @p0 AS value", [
        "x'); DROP TABLE account; --",
      ]),
    ).toBe("SELECT N'x''); DROP TABLE account; --' AS value");
  });

  test("names, strings and comments are copied as they are", () => {
    expect(
      inlineDataverseSqlParameters(
        "SELECT [@p0], [a]]@p0], \"@p0\", '@p0', 'it''s @p0' -- @p0\n, /* @p0 */ @p0 AS value",
        ["v"],
      ),
    ).toBe(
      "SELECT [@p0], [a]]@p0], \"@p0\", '@p0', 'it''s @p0' -- @p0\n, /* @p0 */ N'v' AS value",
    );
  });

  test("@p10 is the eleventh value, and a longer name is no placeholder", () => {
    const params: Array<string> = Array.from(
      { length: 11 },
      (_: unknown, index: number): string => {
        return `v${index}`;
      },
    );

    expect(
      inlineDataverseSqlParameters(
        "SELECT @p10, @p1, @pa, x@p0, @p0x, @@p0",
        params,
      ),
    ).toBe("SELECT N'v10', N'v1', @pa, x@p0, @p0x, @@p0");
  });

  test("a placeholder without a value is refused, and no values leave the statement as it is", () => {
    expect(() => {
      return inlineDataverseSqlParameters("SELECT @p1", ["only one"]);
    }).toThrow(/no value for @p1/);
    expect(inlineDataverseSqlParameters("SELECT '@p0'", [])).toBe(
      "SELECT '@p0'",
    );
  });
});

describe("DataverseApi", () => {
  function api(
    transport: (
      request: DataSourceHttpRequest,
    ) => Promise<DataSourceHttpResponse>,
    overrides: Partial<DataverseConnection> = {},
  ): DataverseApi {
    return new DataverseApi({ connection: connection(overrides), transport });
  }

  test("the app's token is bought once, for the environment, then sent", async () => {
    const requests: Array<DataSourceHttpRequest> = [];
    const client: DataverseApi = api(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        requests.push(request);

        if (request.url === TOKEN_URL) {
          return json({ access_token: "token-1", expires_in: 3600 });
        }

        return json({ value: [] });
      },
    );

    await client.listTables();
    await client.listTables();

    expect(
      requests.map((request: DataSourceHttpRequest) => {
        return request.url.split("?")[0];
      }),
    ).toEqual([
      TOKEN_URL,
      `${WEB_API}/EntityDefinitions`,
      `${WEB_API}/EntityDefinitions`,
    ]);
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.formUrlEncoded).toBe(true);
    expect(requests[0]!.body).toEqual({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: SECRET,
      scope: `https://${HOST}/.default`,
    });
    expect(requests[1]!.headers?.["Authorization"]).toBe("Bearer token-1");
    expect(requests[1]!.headers?.["OData-Version"]).toBe("4.0");
  });

  test("a token is bought again a minute before it ends", async () => {
    let now: number = 0;
    let tokens: number = 0;
    const client: DataverseApi = new DataverseApi({
      connection: connection(),
      now: (): number => {
        return now;
      },
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === TOKEN_URL) {
          tokens++;

          return json({ access_token: `token-${tokens}`, expires_in: 3600 });
        }

        return json({ value: [] });
      },
    });

    expect(await client.getAccessToken()).toBe("token-1");
    now = 3_000_000;
    expect(await client.getAccessToken()).toBe("token-1");
    now = 3_550_000;
    expect(await client.getAccessToken()).toBe("token-2");
  });

  test("the tenant, left out, is read from the environment's challenge", async () => {
    const requests: Array<DataSourceHttpRequest> = [];
    const client: DataverseApi = api(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        requests.push(request);

        if (request.url === `${WEB_API}/`) {
          return json({}, 401, {
            "www-authenticate": `Bearer authorization_uri=https://login.microsoftonline.com/${TENANT.toUpperCase()}/oauth2/authorize, resource_id=https://${HOST}/`,
          });
        }

        return json({ access_token: "token-1", expires_in: 3600 });
      },
      { tenantId: null },
    );

    expect(await client.getAccessToken()).toBe("token-1");
    expect(requests[0]!.headers?.["Authorization"]).toBeUndefined();
    expect(requests[1]!.url).toBe(TOKEN_URL);
  });

  test("an environment that names no tenant asks for one", async () => {
    const client: DataverseApi = api(
      async (): Promise<DataSourceHttpResponse> => {
        return json({}, 401);
      },
      { tenantId: null },
    );

    await expect(client.getAccessToken()).rejects.toThrow(/add tenantId/);
  });

  test("a sovereign cloud's environment signs in at its own authority", async () => {
    const urls: Array<string> = [];
    const client: DataverseApi = api(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        urls.push(request.url);

        return json({ access_token: "token-1" });
      },
      { host: "agency.crm.microsoftdynamics.us" },
    );

    await client.getAccessToken();

    expect(urls[0]).toBe(
      `https://login.microsoftonline.us/${TENANT}/oauth2/v2.0/token`,
    );
  });

  test("Entra ID refusing the app says why", async () => {
    const client: DataverseApi = api(
      async (): Promise<DataSourceHttpResponse> => {
        return json(
          {
            error: "invalid_client",
            error_description:
              "AADSTS7000215: Invalid client secret provided.\r\nTrace ID: 1",
          },
          401,
        );
      },
    );

    await expect(client.listTables()).rejects.toThrow(
      /^Microsoft Entra ID refused the app \(401\): AADSTS7000215: Invalid client secret provided\.$/,
    );
  });

  test("an app that is no application user of the environment is told to be added", async () => {
    const client: DataverseApi = api(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === TOKEN_URL) {
          return json({ access_token: "token-1" });
        }

        return json(
          {
            error: {
              code: "0x80072560",
              message: "The user is not a member of the organization.",
            },
          },
          403,
        );
      },
    );

    await expect(client.listTables()).rejects.toThrow(
      /refused the app \(403\): The user is not a member of the organization\. Add it to the environment as an application user/,
    );
  });

  test("the tables' definitions: no rows, and only what is needed of each", async () => {
    let url: URL | null = null;
    const client: DataverseApi = api(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === TOKEN_URL) {
          return json({ access_token: "token-1" });
        }

        url = new URL(request.url);

        return json({ value: [definition("account")] });
      },
    );

    expect(await client.listTables()).toEqual([definition("account")]);
    expect(url!.pathname).toBe("/api/data/v9.2/EntityDefinitions");
    expect(url!.searchParams.get("$select")).toBe(
      "LogicalName,EntitySetName,TableType,IsCustomEntity,IsIntersect,IsPrivate,IsLogicalEntity,IsActivityParty,IsBPFEntity",
    );
  });

  test("rows: fifty tables a call, from the daily snapshot's keys and values", async () => {
    const asked: Array<Array<string>> = [];
    const client: DataverseApi = api(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === TOKEN_URL) {
          return json({ access_token: "token-1" });
        }

        const url: URL = new URL(request.url);

        expect(decodeURIComponent(url.pathname)).toBe(
          "/api/data/v9.2/RetrieveTotalRecordCount(EntityNames=@p1)",
        );

        const names: Array<string> = JSON.parse(
          url.searchParams.get("@p1") || "[]",
        ) as Array<string>;

        asked.push(names);

        return json({
          EntityRecordCountCollection: {
            Count: names.length,
            IsReadOnly: false,
            Keys: names.map((name: string): string => {
              return name.toUpperCase();
            }),
            Values: names.map((_: string, index: number): number | string => {
              return index === 0 ? "12" : index;
            }),
          },
        });
      },
    );
    const names: Array<string> = Array.from(
      { length: 51 },
      (_: unknown, index: number): string => {
        return `cr123_t${index}`;
      },
    );
    const counts: Map<string, number> = await client.countRows(names);

    expect(
      asked.map((chunk: Array<string>) => {
        return chunk.length;
      }),
    ).toEqual([50, 1]);
    expect(counts.get("cr123_t0")).toBe(12);
    expect(counts.get("cr123_t1")).toBe(1);
    expect(counts.get("cr123_t50")).toBe(12);
    expect(counts.size).toBe(51);
  });

  test("a table's newest change: its newest modifiedon, nothing else of the row", async () => {
    let url: URL | null = null;
    const client: DataverseApi = api(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === TOKEN_URL) {
          return json({ access_token: "token-1" });
        }

        url = new URL(request.url);

        return json({
          value: [{ modifiedon: "2026-11-10T11:58:00Z", accountid: "a" }],
        });
      },
    );

    expect(await client.readNewestChange("accounts")).toEqual(
      new Date("2026-11-10T11:58:00Z"),
    );
    expect(url!.pathname).toBe("/api/data/v9.2/accounts");
    expect(url!.searchParams.get("$select")).toBe("modifiedon");
    expect(url!.searchParams.get("$orderby")).toBe("modifiedon desc");
    expect(url!.searchParams.get("$top")).toBe("1");
  });

  test("a table that keeps no modifiedon is read by its createdon; an empty one has none", async () => {
    const columns: Array<string> = [];
    const client: DataverseApi = api(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === TOKEN_URL) {
          return json({ access_token: "token-1" });
        }

        const url: URL = new URL(request.url);
        const column: string = url.searchParams.get("$select") || "";

        columns.push(`${url.pathname.split("/").pop()}:${column}`);

        if (url.pathname.endsWith("/cr123_logs") && column === "modifiedon") {
          return json(
            {
              error: {
                code: "0x0",
                message:
                  "Could not find a property named 'modifiedon' on type 'Microsoft.Dynamics.CRM.cr123_log'.",
              },
            },
            400,
          );
        }

        return url.pathname.endsWith("/cr123_logs")
          ? json({ value: [{ createdon: "2026-11-10T10:00:00Z" }] })
          : json({ value: [] });
      },
    );

    expect(await client.readNewestChange("cr123_logs")).toEqual(
      new Date("2026-11-10T10:00:00Z"),
    );
    expect(await client.readNewestChange("contacts")).toBe(null);
    expect(columns).toEqual([
      "cr123_logs:modifiedon",
      "cr123_logs:createdon",
      "contacts:modifiedon",
    ]);
  });

  test("a 429 is a throttle, with how long to wait", async () => {
    const client: DataverseApi = api(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        return request.url === TOKEN_URL
          ? json({ access_token: "token-1" })
          : json({}, 429, { "retry-after": "17" });
      },
    );
    const error: unknown = await client
      .readNewestChange("accounts")
      .catch((thrown: unknown) => {
        return thrown;
      });

    expect(error).toBeInstanceOf(DataverseThrottledError);
    expect((error as DataverseThrottledError).retryAfterInSeconds).toBe(17);
    expect((error as Error).message).toMatch(
      /slow down \(429\), for 17 seconds/,
    );
  });

  test("columns: twenty tables a call, each table's attributes by its name", async () => {
    const filters: Array<string> = [];
    const client: DataverseApi = api(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === TOKEN_URL) {
          return json({ access_token: "token-1" });
        }

        const url: URL = new URL(request.url);

        filters.push(url.searchParams.get("$filter") || "");
        expect(url.searchParams.get("$expand")).toBe(
          "Attributes($select=LogicalName,AttributeType,AttributeTypeName,AttributeOf,IsValidForRead,RequiredLevel,ColumnNumber)",
        );

        return json({
          value: [
            {
              LogicalName: "Account",
              Attributes: [{ LogicalName: "name" }],
            },
          ],
        });
      },
    );
    const names: Array<string> = Array.from(
      { length: 21 },
      (_: unknown, index: number): string => {
        return `t${index}`;
      },
    );
    const columns: Map<string, Array<JSONObject>> = await client.listColumns([
      ...names,
      "Bad-Name",
    ]);

    expect(filters).toHaveLength(2);
    expect(filters[0]).toBe(
      names
        .slice(0, 20)
        .map((name: string): string => {
          return `LogicalName eq '${name}'`;
        })
        .join(" or "),
    );
    expect(filters[1]).toBe("LogicalName eq 't20'");
    expect(columns.get("account")).toEqual([{ LogicalName: "name" }]);
  });
});

describe("Dataverse columns", () => {
  test("each attribute's type, without Type", () => {
    expect(
      readDataverseColumnType({ AttributeTypeName: { Value: "StringType" } }),
    ).toBe("string");
    expect(
      readDataverseColumnType({
        AttributeTypeName: { Value: "MultiSelectPicklistType" },
      }),
    ).toBe("multiselectpicklist");
    expect(readDataverseColumnType({ AttributeType: "Lookup" })).toBe("lookup");
    expect(readDataverseColumnType({})).toBe("unknown");
  });

  test("readable columns in their order; a derived one is left out", () => {
    expect(
      readDataverseColumns("account", [
        {
          LogicalName: "name",
          AttributeTypeName: { Value: "StringType" },
          RequiredLevel: { Value: "ApplicationRequired" },
          ColumnNumber: 3,
        },
        {
          LogicalName: "accountid",
          AttributeTypeName: { Value: "UniqueidentifierType" },
          RequiredLevel: { Value: "SystemRequired" },
          ColumnNumber: 1,
          AttributeOf: null,
        },
        {
          LogicalName: "parentaccountidname",
          AttributeTypeName: { Value: "StringType" },
          AttributeOf: "parentaccountid",
          ColumnNumber: 9,
        },
        {
          LogicalName: "secret_hidden",
          AttributeTypeName: { Value: "StringType" },
          IsValidForRead: false,
          ColumnNumber: 10,
        },
        { LogicalName: "Revenue", AttributeType: "Money" },
      ]).map((column: { column: DataAssetColumn }) => {
        return column.column;
      }),
    ).toEqual([
      { name: "name", dataType: "string", isNullable: true, position: 3 },
      {
        name: "accountid",
        dataType: "uniqueidentifier",
        isNullable: false,
        position: 1,
      },
      { name: "revenue", dataType: "money", isNullable: true, position: 5 },
    ]);
  });
});

/*
 * A Dataverse environment that answers OneUptime's requests: its tables'
 * definitions, its daily counts, each table's newest row and its columns.
 * Every Web API request is recorded, by its path and query.
 */
interface FakeEnvironment {
  requests: Array<string>;
  throttleFreshnessOf?: string | undefined;
  failCounts?: boolean | undefined;
  leaveOutColumnsOf?: string | undefined;
}

function useEnvironment(environment: FakeEnvironment): void {
  jest
    .spyOn(DataSourceHttpFetch, "fetch")
    .mockImplementation(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url === TOKEN_URL) {
          return json({ access_token: "token-1", expires_in: 3600 });
        }

        const url: URL = new URL(request.url);
        const path: string = decodeURIComponent(url.pathname).replace(
          "/api/data/v9.2",
          "",
        );

        environment.requests.push(
          `${path}${url.search ? "?" : ""}${decodeURIComponent(url.search.slice(1))}`,
        );

        if (path === "/EntityDefinitions" && !url.searchParams.has("$expand")) {
          return json({
            value: [
              definition("account"),
              definition("contact"),
              definition("systemuser"),
              definition("email", { TableType: "Activity" }),
              definition("cr123_project", { IsCustomEntity: true }),
              definition("cr123_reading", {
                IsCustomEntity: true,
                TableType: "Elastic",
              }),
              definition("msdyn_workorder", { IsCustomEntity: true }),
              definition("cr123_projectmember", {
                IsCustomEntity: true,
                IsIntersect: true,
              }),
            ],
          });
        }

        if (path === "/RetrieveTotalRecordCount(EntityNames=@p1)") {
          if (environment.failCounts) {
            return json({ error: { message: "Snapshot unavailable." } }, 500);
          }

          const names: Array<string> = JSON.parse(
            url.searchParams.get("@p1") || "[]",
          ) as Array<string>;

          return json({
            EntityRecordCountCollection: {
              Count: names.length,
              IsReadOnly: false,
              Keys: names,
              Values: names.map((_: string, index: number): number => {
                return (index + 1) * 100;
              }),
            },
          });
        }

        if (path === "/EntityDefinitions") {
          const filter: string = url.searchParams.get("$filter") || "";
          const names: Array<string> = Array.from(
            filter.matchAll(/LogicalName eq '([a-z0-9_]+)'/g),
          ).map((match: RegExpMatchArray): string => {
            return match[1]!;
          });

          return json({
            value: names
              .filter((name: string): boolean => {
                return name !== environment.leaveOutColumnsOf;
              })
              .map((name: string): JSONObject => {
                return {
                  LogicalName: name,
                  Attributes: [
                    {
                      LogicalName: `${name}id`,
                      AttributeTypeName: { Value: "UniqueidentifierType" },
                      RequiredLevel: { Value: "SystemRequired" },
                      ColumnNumber: 1,
                    },
                    {
                      LogicalName: "modifiedon",
                      AttributeTypeName: { Value: "DateTimeType" },
                      RequiredLevel: { Value: "None" },
                      ColumnNumber: 2,
                    },
                    {
                      LogicalName: "owneridname",
                      AttributeTypeName: { Value: "StringType" },
                      AttributeOf: "ownerid",
                      ColumnNumber: 3,
                    },
                  ],
                };
              }),
          });
        }

        const set: string = path.slice(1);

        if (set === environment.throttleFreshnessOf) {
          return json({}, 429, { "retry-after": "30" });
        }

        const ages: Record<string, number | null> = {
          systemusers: 30,
          accounts: 120,
          contacts: null,
          emails: 600,
          cr123_projects: 3600,
          cr123_readings: 60,
        };

        if (!(set in ages)) {
          throw new Error(`Unexpected request: ${request.url}`);
        }

        const age: number | null = ages[set] ?? null;

        return json({
          value:
            age === null
              ? []
              : [
                  {
                    modifiedon: new Date(Date.now() - age * 1000).toISOString(),
                  },
                ],
        });
      },
    );
}

function names(snapshot: TableHealthSnapshot): Array<string> {
  return snapshot.tables.map((table: CollectedTable): string => {
    return table.name;
  });
}

function tableOf(snapshot: TableHealthSnapshot, name: string): CollectedTable {
  const found: CollectedTable | undefined = snapshot.tables.find(
    (table: CollectedTable): boolean => {
      return table.name === name;
    },
  );

  if (!found) {
    throw new Error(`No table ${name}`);
  }

  return found;
}

describe("collecting a Dataverse environment", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every 5 minutes: the default tables' rows and last changes, and no columns", async () => {
    const environment: FakeEnvironment = { requests: [] };

    useEnvironment(environment);

    const snapshot: TableHealthSnapshot = await collectTableHealth(
      { engine: "dataverse", connectionString: connectionString() },
      { maxTables: 100, maxColumns: 1000, exclusions: [] },
    );

    expect(names(snapshot)).toEqual([
      "account",
      "contact",
      "cr123_project",
      "cr123_reading",
      "email",
    ]);
    expect(snapshot.engine).toBe("dataverse");
    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.warnings).toEqual([]);

    const account: CollectedTable = tableOf(snapshot, "account");

    expect(account).toMatchObject({
      schema: "dbo",
      kind: DataAssetKind.Table,
      estimatedRows: 100,
      sizeInBytes: null,
      writeCount: null,
      readCount: null,
      secondsSinceRead: null,
      isChangeTimeFromData: true,
      columns: null,
      columnsNotRead: true,
    });
    expect(account.secondsSinceChange).toBeGreaterThanOrEqual(119);
    expect(account.secondsSinceChange).toBeLessThanOrEqual(125);
    // An empty table has no last change: the last one known stands.
    expect(tableOf(snapshot, "contact").secondsSinceChange).toBe(null);
    // An elastic table keeps no daily count.
    expect(tableOf(snapshot, "cr123_reading").estimatedRows).toBe(null);
    expect(
      tableOf(snapshot, "cr123_reading").secondsSinceChange,
    ).toBeLessThanOrEqual(65);
    expect(snapshot.target).toEqual({
      databaseName: "contoso",
      host: HOST,
      port: 443,
    });

    // One count for the counted tables, one newest row per table, and no column read.
    expect(
      environment.requests.filter((request: string): boolean => {
        return request.startsWith("/RetrieveTotalRecordCount");
      }),
    ).toEqual([
      '/RetrieveTotalRecordCount(EntityNames=@p1)?@p1=["account","contact","cr123_project","email"]',
    ]);
    expect(
      environment.requests.filter((request: string): boolean => {
        return request.includes("$expand");
      }),
    ).toEqual([]);
    expect(environment.requests).toHaveLength(1 + 1 + 5);
  });

  test("an excluded table costs no request at all", async () => {
    const environment: FakeEnvironment = { requests: [] };

    useEnvironment(environment);

    const snapshot: TableHealthSnapshot = await collectTableHealth(
      { engine: "dataverse", connectionString: connectionString() },
      {
        maxTables: 100,
        maxColumns: 1000,
        exclusions: ["dbo.email", "cr123_reading"],
      },
    );

    expect(names(snapshot)).toEqual(["account", "contact", "cr123_project"]);
    expect(
      environment.requests.some((request: string): boolean => {
        return (
          request.startsWith("/emails") || request.startsWith("/cr123_readings")
        );
      }),
    ).toBe(false);
  });

  test("named tables are read besides the default ones; one the environment has not is said", async () => {
    const environment: FakeEnvironment = { requests: [] };

    useEnvironment(environment);

    const snapshot: TableHealthSnapshot = await collectTableHealth(
      {
        engine: "dataverse",
        connectionString: connectionString({
          tables: ["systemuser", "cr123_gone"],
        }),
      },
      { maxTables: 100, maxColumns: 1000, exclusions: [] },
    ).catch((error: unknown) => {
      throw error;
    });

    expect(names(snapshot)).toContain("systemuser");
    expect(snapshot.warnings).toEqual([
      "The connection names tables this environment does not have, or that cannot be watched: cr123_gone.",
    ]);
  });

  test("once an hour: the columns too, each derived one left out", async () => {
    const environment: FakeEnvironment = {
      requests: [],
      leaveOutColumnsOf: "email",
    };

    useEnvironment(environment);

    const snapshot: TableHealthSnapshot = await collectTableHealth(
      { engine: "dataverse", connectionString: connectionString() },
      {
        maxTables: 100,
        maxColumns: 1000,
        exclusions: [],
        queryHistoryLookbackInSeconds: 3600,
      },
    );

    const account: CollectedTable = tableOf(snapshot, "account");

    expect(account.columns).toEqual([
      {
        name: "accountid",
        dataType: "uniqueidentifier",
        isNullable: false,
        position: 1,
      },
      {
        name: "modifiedon",
        dataType: "datetime",
        isNullable: true,
        position: 2,
      },
    ]);
    expect(account.columnsNotRead).toBeUndefined();
    // A table Dataverse left out of the column read is unread, never one with no columns.
    expect(tableOf(snapshot, "email").columns).toBe(null);
    expect(tableOf(snapshot, "email").columnsNotRead).toBe(true);
    expect(
      environment.requests.filter((request: string): boolean => {
        return request.includes("$expand");
      }),
    ).toHaveLength(1);
  });

  test("a 429 leaves the rest of the collection's reads to the next one, said once", async () => {
    const environment: FakeEnvironment = {
      requests: [],
      throttleFreshnessOf: "accounts",
    };

    useEnvironment(environment);

    const snapshot: TableHealthSnapshot = await collectTableHealth(
      { engine: "dataverse", connectionString: connectionString() },
      {
        maxTables: 100,
        maxColumns: 1000,
        exclusions: [],
        queryHistoryLookbackInSeconds: 3600,
      },
    );

    expect(names(snapshot)).toHaveLength(5);
    expect(snapshot.warnings).toEqual([
      "Dataverse asked OneUptime to slow down (429), for 30 seconds: the app has made too many requests in the last five minutes. What was not read this time is read at the next collection.",
    ]);
    expect(tableOf(snapshot, "account").secondsSinceChange).toBe(null);
    expect(tableOf(snapshot, "account").isChangeTimeFromData).toBe(true);
    // No column read after a throttle: every table's columns stay as last read.
    expect(
      snapshot.tables.every((table: CollectedTable): boolean => {
        return table.columns === null && table.columnsNotRead === true;
      }),
    ).toBe(true);
    expect(
      environment.requests.some((request: string): boolean => {
        return request.includes("$expand");
      }),
    ).toBe(false);
  });

  test("counts that cannot be read leave the rows out, never the collection", async () => {
    const environment: FakeEnvironment = { requests: [], failCounts: true };

    useEnvironment(environment);

    const snapshot: TableHealthSnapshot = await collectTableHealth(
      { engine: "dataverse", connectionString: connectionString() },
      { maxTables: 100, maxColumns: 1000, exclusions: [] },
    );

    expect(tableOf(snapshot, "account").estimatedRows).toBe(null);
    expect(tableOf(snapshot, "account").secondsSinceChange).not.toBe(null);
    expect(snapshot.warnings).toEqual([
      "Row counts were left out: Dataverse answered 500: Snapshot unavailable.",
    ]);
  });

  test("a table list cut at the limit says the rest were not collected", async () => {
    const environment: FakeEnvironment = { requests: [] };

    useEnvironment(environment);

    const snapshot: TableHealthSnapshot = await collectTableHealth(
      { engine: "dataverse", connectionString: connectionString() },
      { maxTables: 2, maxColumns: 1000, exclusions: [] },
    );

    expect(names(snapshot)).toEqual(["account", "contact"]);
    expect(snapshot.isComplete).toBe(false);
  });

  test("a secret Entra ID repeats never reaches the store's error", async () => {
    jest
      .spyOn(DataSourceHttpFetch, "fetch")
      .mockImplementation(async (): Promise<DataSourceHttpResponse> => {
        return json(
          {
            error: "invalid_client",
            error_description: `Bad secret ${SECRET}`,
          },
          401,
        );
      });

    await expect(
      collectTableHealth(
        { engine: "dataverse", connectionString: connectionString() },
        { maxTables: 100, maxColumns: 1000, exclusions: [] },
      ),
    ).rejects.toThrow(
      "Microsoft Entra ID refused the app (401): Bad secret ****",
    );
  });
});

describe("Dataverse checks on the SQL endpoint", () => {
  const pools: Array<Record<string, unknown>> = [];
  const queries: Array<string> = [];
  let refuse: ((port: number) => Error | null) | null = null;

  beforeEach(() => {
    pools.length = 0;
    queries.length = 0;
    refuse = null;
    useEnvironment({ requests: [] });
    (mssql.ConnectionPool as unknown as jest.Mock).mockImplementation(
      (config: unknown) => {
        const settings: Record<string, unknown> = config as Record<
          string,
          unknown
        >;

        pools.push(settings);

        return {
          connect: async (): Promise<void> => {
            const error: Error | null = refuse
              ? refuse(Number(settings["port"]))
              : null;

            if (error) {
              throw error;
            }
          },
          close: async (): Promise<void> => {},
          request: (): unknown => {
            return {
              query: async (
                sql: string,
              ): Promise<{ recordset: Array<Record<string, unknown>> }> => {
                queries.push(sql);

                return { recordset: [{ value: 7 }] };
              },
            };
          },
        };
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function check(): {
    checkId: string;
    type: DataCheckType;
    isSegmented: boolean;
    sql: string;
    params: Array<string>;
  } {
    return {
      checkId: "check-1",
      type: DataCheckType.InvalidPercent,
      isSegmented: false,
      sql: "SELECT 100.0 * SUM(CASE WHEN [statuscode] IS NOT NULL AND CAST([statuscode] AS NVARCHAR(4000)) NOT IN (@p0, @p1) THEN 1 ELSE 0 END) / NULLIF(COUNT([statuscode]), 0) AS value FROM [dbo].[account]",
      params: ["1", "it's 2"],
    };
  }

  test("a check runs read-only on the TDS endpoint, signed in with the app's token, its values written in", async () => {
    const results: Array<DataCheckRunResult> = await readCheckValues(
      { engine: "dataverse", connectionString: connectionString() },
      [check()],
    );

    expect(results).toEqual([
      {
        checkId: "check-1",
        values: [{ segment: null, value: 7 }],
        error: null,
      },
    ]);
    expect(pools).toHaveLength(1);
    expect(pools[0]).toMatchObject({
      server: HOST,
      port: 1433,
      authentication: {
        type: "azure-active-directory-access-token",
        options: { token: "token-1" },
      },
      options: { encrypt: true, trustServerCertificate: false },
    });
    expect(queries).toEqual([
      "SELECT 100.0 * SUM(CASE WHEN [statuscode] IS NOT NULL AND CAST([statuscode] AS NVARCHAR(4000)) NOT IN (N'1', N'it''s 2') THEN 1 ELSE 0 END) / NULLIF(COUNT([statuscode]), 0) AS value FROM [dbo].[account]",
    ]);
  });

  test("port 1433 that no server answers on falls back to 5558", async () => {
    refuse = (port: number): Error | null => {
      return port === 1433
        ? Object.assign(new Error("Failed to connect in 10000ms"), {
            code: "ETIMEOUT",
          })
        : null;
    };

    const results: Array<DataCheckRunResult> = await readCheckValues(
      { engine: "dataverse", connectionString: connectionString() },
      [check()],
    );

    expect(results[0]!.error).toBe(null);
    expect(
      pools.map((pool: Record<string, unknown>) => {
        return pool["port"];
      }),
    ).toEqual([1433, 5558]);
  });

  test("an endpoint that refuses the app says to turn the TDS endpoint on, and tries no other port", async () => {
    refuse = (): Error => {
      return Object.assign(new Error("Login failed for user."), {
        code: "ELOGIN",
      });
    };

    const results: Array<DataCheckRunResult> = await readCheckValues(
      { engine: "dataverse", connectionString: connectionString() },
      [check()],
    );

    expect(results[0]!.error).toMatch(
      /^Dataverse's SQL endpoint refused the app: Login failed for user\. Checks run on the TDS endpoint: turn it on, and where user level access control is on, give the app's role the Allow user to access TDS endpoint privilege\.$/,
    );
    expect(pools).toHaveLength(1);
  });

  test("a named port is the only one tried", async () => {
    refuse = (): Error => {
      return Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ESOCKET",
      });
    };

    const results: Array<DataCheckRunResult> = await readCheckValues(
      {
        engine: "dataverse",
        connectionString: connectionString({ sqlPort: 5558 }),
      },
      [check()],
    );

    expect(results[0]!.error).toMatch(
      /^Dataverse's SQL endpoint could not be reached: connect ECONNREFUSED\. Checks run on the TDS endpoint, on port 1433 or 5558; table health does not need it\.$/,
    );
    expect(
      pools.map((pool: Record<string, unknown>) => {
        return pool["port"];
      }),
    ).toEqual([5558]);
  });

  test("a collection with no check due never opens the SQL endpoint", async () => {
    await collectTableHealth(
      { engine: "dataverse", connectionString: connectionString() },
      { maxTables: 100, maxColumns: 1000, exclusions: [] },
    );

    expect(pools).toEqual([]);
  });

  test("a due check runs in the collection, on one connection", async () => {
    const snapshot: TableHealthSnapshot = await collectTableHealth(
      { engine: "dataverse", connectionString: connectionString() },
      {
        maxTables: 100,
        maxColumns: 1000,
        exclusions: [],
        checks: [check(), { ...check(), checkId: "check-2" }],
      },
    );

    expect(
      snapshot.checkResults!.map((result: DataCheckRunResult) => {
        return `${result.checkId}:${result.error}`;
      }),
    ).toEqual(["check-1:null", "check-2:null"]);
    expect(pools).toHaveLength(1);
    expect(queries).toHaveLength(2);
  });

  test("the error of a code that is no driver's is the reach error", () => {
    expect(describeDataverseSqlError(new Error("boom"))).toMatch(
      /could not be reached: boom/,
    );
  });
});

describe("Dataverse elsewhere", () => {
  test("the target is the organization and the environment's host", () => {
    expect(
      readConnectionTarget({
        engine: "dataverse",
        connectionString: connectionString(),
      }),
    ).toEqual({ databaseName: "contoso", host: HOST, port: 443 });
    expect(
      readConnectionTarget({
        engine: "dataverse",
        connectionString: "{}",
      }),
    ).toBe(null);
  });

  test("the network guard is given the environment's host, for the SQL endpoint", () => {
    expect(
      getDatabaseConnectionHosts({
        engine: "dataverse",
        connectionString: connectionString(),
      }),
    ).toEqual([HOST]);
  });

  test("the app's secret is taken out of errors, in JSON and in a connection string", () => {
    expect(
      sanitizeErrorMessage(
        new Error(`refused ${SECRET}`),
        getConnectionSecrets(connectionString()),
      ),
    ).toBe("refused ****");
    expect(
      sanitizeErrorMessage(
        new Error(`refused ${SECRET}`),
        getConnectionSecrets(
          `AuthType=ClientSecret;Url=https://${HOST};ClientId=${CLIENT_ID};ClientSecret=${SECRET}`,
        ),
      ),
    ).toBe("refused ****");
    expect(
      sanitizeErrorMessage(
        new Error("refused quoted-secret-value"),
        getConnectionSecrets(
          `AuthType=ClientSecret;Url=https://${HOST};ClientId=${CLIENT_ID};Secret='quoted-secret-value'`,
        ),
      ),
    ).toBe("refused ****");
  });
});
