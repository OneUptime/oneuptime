import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  BiDashboardRead,
  BiTableRef,
  LookerConnector,
  MetabaseConnector,
  PowerBiConnector,
  readPowerQueryTables,
  readQualifiedName,
  readSqlTables,
  SupersetConnector,
  TableauConnector,
} from "../../../../Server/Utils/DataObservability/Bi/BiConnectors";
import { matchBiTable } from "../../../../Server/Utils/DataObservability/Bi/BiMatching";
import DataBiSync from "../../../../Server/Utils/DataObservability/Bi/DataBiSync";
import DataTableDashboards, {
  TableDashboard,
} from "../../../../Server/Utils/DataObservability/Bi/DataTableDashboards";
import DataBiConnectionService from "../../../../Server/Services/DataBiConnectionService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import DataDashboard from "../../../../Models/DatabaseModels/DataDashboard";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../../Models/DatabaseModels/DataAssetLineage";
import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";

/*
 * Dashboards of BI tools, and the watched tables behind them: each tool's
 * reader against its own API's answers, the matching that never ties a
 * dashboard to the wrong table, the sync that keeps a tool's dashboards as
 * the tool says, and the dashboards a table's alert lists.
 */

function json(body: unknown, statusCode: number = 200): DataSourceHttpResponse {
  return { statusCode, bodyText: JSON.stringify(body), bodyJson: body };
}

// A transport answering by path; every request kept.
function fake(
  routes: Record<string, unknown>,
  requests: Array<DataSourceHttpRequest> = [],
): (request: DataSourceHttpRequest) => Promise<DataSourceHttpResponse> {
  return async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    requests.push(request);

    const url: URL = new URL(request.url);
    const key: string = `${request.method} ${url.pathname}`;

    if (!(key in routes)) {
      return json({ message: `no route ${key}` }, 404);
    }

    return json(routes[key]);
  };
}

function tables(dashboard: BiDashboardRead): Array<string> {
  return dashboard.tables.map((ref: BiTableRef): string => {
    return [ref.database, ref.schema, ref.table].filter(Boolean).join(".");
  });
}

describe("reading SQL and qualified names", () => {
  test("every table after FROM and JOIN, never a CTE, a template tag or a string", () => {
    expect(
      readSqlTables(
        `WITH recent AS (SELECT * FROM public.orders WHERE created_at > '2026-01-01 FROM x')
         SELECT * FROM recent JOIN "public"."customers" c ON c.id = recent.customer_id
         LEFT JOIN analytics.revenue.daily d ON true
         WHERE {{date_filter}}`,
      ).map((ref: BiTableRef): string => {
        return [ref.database, ref.schema, ref.table].filter(Boolean).join(".");
      }),
    ).toEqual(["public.orders", "public.customers", "analytics.revenue.daily"]);
  });

  test("a BigQuery name in one pair of backticks is its three parts", () => {
    expect(readQualifiedName("`my-project.analytics.orders`")).toEqual({
      database: "my-project",
      schema: "analytics",
      table: "orders",
      engine: null,
      host: null,
    });
  });

  test("Power Query's navigation steps and native queries", () => {
    expect(
      readPowerQueryTables(
        'let Source = Sql.Database("orders-db.database.windows.net", "orders"), dbo_Orders = Source{[Schema="dbo",Item="Orders"]}[Data] in dbo_Orders',
      ),
    ).toEqual([
      {
        database: "orders",
        schema: "dbo",
        table: "Orders",
        engine: "sqlserver",
        host: "orders-db.database.windows.net",
      },
    ]);
    expect(
      readPowerQueryTables(
        'let Source = Snowflake.Databases("acme.snowflakecomputing.com","WH"), DB = Source{[Name="ANALYTICS",Kind="Database"]}[Data], S = DB{[Name="PUBLIC",Kind="Schema"]}[Data], T = S{[Name="ORDERS",Kind="Table"]}[Data] in T',
      ).map((ref: BiTableRef): string => {
        return `${ref.database}.${ref.schema}.${ref.table}`;
      }),
    ).toEqual(["ANALYTICS.PUBLIC.ORDERS"]);
  });
});

describe("each tool's reader", () => {
  test("Metabase: a card's table and a native question's tables, with the database each is in", async () => {
    const requests: Array<DataSourceHttpRequest> = [];
    const dashboards: Array<BiDashboardRead> = await MetabaseConnector.read({
      baseUrl: "https://metabase.acme.com",
      credentials: { apiKey: "mb_secret" },
      transport: fake(
        {
          "GET /api/database": {
            data: [
              {
                id: 1,
                name: "Orders",
                engine: "postgres",
                details: { dbname: "orders", host: "orders-db" },
              },
            ],
          },
          "GET /api/table": [
            { id: 10, name: "orders", schema: "public", db_id: 1 },
          ],
          "GET /api/collection": [{ id: 5, name: "Finance" }],
          "GET /api/dashboard/": [
            { id: 42, name: "Revenue", collection_id: 5 },
          ],
          "GET /api/dashboard/42": {
            id: 42,
            name: "Revenue",
            collection_id: 5,
            updated_at: "2026-11-01T10:00:00Z",
            creator: { common_name: "Ana Lima" },
            dashcards: [
              { card: { table_id: 10 } },
              {
                card: {
                  dataset_query: {
                    type: "native",
                    database: 1,
                    native: { query: "select * from public.refunds" },
                  },
                },
              },
            ],
          },
        },
        requests,
      ),
    });

    expect(dashboards).toHaveLength(1);
    expect(dashboards[0]).toMatchObject({
      externalId: "42",
      name: "Revenue",
      url: "https://metabase.acme.com/dashboard/42",
      folder: "Finance",
      owner: "Ana Lima",
    });
    expect(tables(dashboards[0]!)).toEqual([
      "orders.public.orders",
      "orders.public.refunds",
    ]);
    expect(dashboards[0]!.tables[0]!.engine).toBe("postgres");
    expect(requests[0]!.headers!["x-api-key"]).toBe("mb_secret");
  });

  test("Superset: a dataset's table, and a virtual dataset's SQL", async () => {
    const dashboards: Array<BiDashboardRead> = await SupersetConnector.read({
      baseUrl: "https://superset.acme.com",
      credentials: { username: "oneuptime", password: "pw" },
      transport: fake({
        "POST /api/v1/security/login": { access_token: "jwt" },
        "GET /api/v1/dashboard/": {
          result: [
            {
              id: 7,
              dashboard_title: "Ops",
              url: "/superset/dashboard/ops/",
              changed_on_utc: "2026-11-01T00:00:00+00:00",
              owners: [{ first_name: "Sam", last_name: "Lee" }],
            },
          ],
        },
        "GET /api/v1/dashboard/7/datasets": {
          result: [
            {
              table_name: "orders",
              schema: "public",
              database: { database_name: "orders", backend: "postgresql" },
              sql: null,
            },
            {
              table_name: "virtual",
              database: { database_name: "orders", backend: "postgresql" },
              sql: "SELECT * FROM public.refunds",
            },
          ],
        },
      }),
    });

    expect(dashboards[0]).toMatchObject({
      externalId: "7",
      name: "Ops",
      url: "https://superset.acme.com/superset/dashboard/ops/",
      owner: "Sam Lee",
    });
    expect(tables(dashboards[0]!)).toEqual([
      "orders.public.orders",
      "orders.public.refunds",
    ]);
  });

  test("Tableau: the Metadata API's upstream tables, page after page", async () => {
    let page: number = 0;
    const dashboards: Array<BiDashboardRead> = await TableauConnector.read({
      baseUrl: "https://tableau.acme.com",
      credentials: { tokenName: "t", tokenSecret: "s", site: "acme" },
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        if (request.url.endsWith("/auth/signin")) {
          return json({
            credentials: { token: "tok", site: { contentUrl: "acme" } },
          });
        }

        page++;

        return json({
          data: {
            dashboardsConnection: {
              nodes: [
                {
                  luid: `d${page}`,
                  name: `Dashboard ${page}`,
                  path: `Workbook/Dashboard${page}`,
                  workbook: {
                    name: "Workbook",
                    projectName: "Sales",
                    owner: { name: "Kim" },
                  },
                  upstreamTables: [
                    {
                      name: "orders",
                      schema: "public",
                      database: { name: "orders", connectionType: "postgres" },
                    },
                  ],
                },
              ],
              pageInfo: { hasNextPage: page === 1, endCursor: "c1" },
            },
          },
        });
      },
    });

    expect(
      dashboards.map((dashboard: BiDashboardRead): string => {
        return dashboard.externalId;
      }),
    ).toEqual(["d1", "d2"]);
    expect(dashboards[0]!.url).toBe(
      "https://tableau.acme.com/#/site/acme/views/Workbook/Dashboard1",
    );
    expect(dashboards[0]!.folder).toBe("Sales");
    expect(tables(dashboards[0]!)).toEqual(["orders.public.orders"]);
  });

  test("Looker: each tile's explore, by its base view's sql_table_name", async () => {
    const dashboards: Array<BiDashboardRead> = await LookerConnector.read({
      baseUrl: "https://acme.cloud.looker.com",
      credentials: { clientId: "id", clientSecret: "secret" },
      transport: fake({
        "POST /api/4.0/login": { access_token: "tok" },
        "GET /api/4.0/dashboards": [{ id: "12", title: "Board" }],
        "GET /api/4.0/dashboards/12": {
          id: "12",
          title: "Board",
          folder: { name: "Shared" },
          dashboard_elements: [{ query: { model: "shop", view: "orders" } }],
        },
        "GET /api/4.0/lookml_models/shop/explores/orders": {
          sql_table_name: "analytics.orders",
        },
      }),
    });

    expect(dashboards[0]).toMatchObject({
      externalId: "12",
      url: "https://acme.cloud.looker.com/dashboards/12",
      folder: "Shared",
    });
    expect(tables(dashboards[0]!)).toEqual(["analytics.orders"]);
  });

  test("Power BI: a report charts its dataset's tables, from a workspace scan", async () => {
    let polls: number = 0;
    const dashboards: Array<BiDashboardRead> = await PowerBiConnector.read({
      baseUrl: "",
      credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
      wait: async (): Promise<void> => {},
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        const url: string = request.url;

        if (url.includes("login.microsoftonline.com")) {
          return json({ access_token: "aad" });
        }

        if (url.includes("/admin/workspaces/modified")) {
          return json([{ id: "w1" }]);
        }

        if (url.includes("/admin/workspaces/getInfo")) {
          return json({ id: "scan1" });
        }

        if (url.includes("/scanStatus/")) {
          polls++;
          return json({ status: polls < 2 ? "Running" : "Succeeded" });
        }

        return json({
          workspaces: [
            {
              id: "w1",
              name: "Finance",
              reports: [
                {
                  id: "r1",
                  name: "Revenue",
                  datasetId: "ds1",
                  modifiedBy: "kim@acme.com",
                },
              ],
              datasets: [
                {
                  id: "ds1",
                  tables: [
                    {
                      name: "Orders",
                      source: [
                        {
                          expression:
                            'let Source = Sql.Database("db.acme.com", "orders"), T = Source{[Schema="dbo",Item="Orders"]}[Data] in T',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        });
      },
    });

    expect(polls).toBe(2);
    expect(dashboards[0]).toMatchObject({
      externalId: "r1",
      name: "Revenue",
      url: "https://app.powerbi.com/groups/w1/reports/r1",
      folder: "Finance",
    });
    expect(tables(dashboards[0]!)).toEqual(["orders.dbo.Orders"]);
  });

  test("a refused sign-in says which tool, and why", async () => {
    await expect(
      SupersetConnector.read({
        baseUrl: "https://superset.acme.com",
        credentials: { username: "u", password: "wrong" },
        transport: async (): Promise<DataSourceHttpResponse> => {
          return json({ message: "Not authorized" }, 401);
        },
      }),
    ).rejects.toThrow("Superset answered 401: Not authorized");
  });
});

describe("matching a tool's table to a watched one", () => {
  const catalog: Parameters<typeof matchBiTable>[1] = {
    stores: [
      {
        dataStoreId: "s1",
        kind: DataStoreKind.PostgreSql,
        databaseName: "orders",
        serverAddress: "orders-db",
      },
      {
        dataStoreId: "s2",
        kind: DataStoreKind.PostgreSql,
        databaseName: "staging",
        serverAddress: "staging-db",
      },
      {
        dataStoreId: "s3",
        kind: DataStoreKind.MySql,
        databaseName: "shop",
        serverAddress: "mysql",
      },
    ],
    assets: [
      {
        dataAssetId: "a1",
        dataStoreId: "s1",
        schemaName: "public",
        name: "orders",
      },
      {
        dataAssetId: "a2",
        dataStoreId: "s2",
        schemaName: "public",
        name: "orders",
      },
      {
        dataAssetId: "a3",
        dataStoreId: "s3",
        schemaName: "shop",
        name: "carts",
      },
    ],
  };

  test("narrowed by schema, then database, then host", () => {
    expect(
      matchBiTable(
        {
          database: "orders",
          schema: "public",
          table: "orders",
          engine: null,
          host: null,
        },
        catalog,
      )?.dataAssetId,
    ).toBe("a1");
    expect(
      matchBiTable(
        {
          database: null,
          schema: "public",
          table: "orders",
          engine: null,
          host: "staging-db:5432",
        },
        catalog,
      )?.dataAssetId,
    ).toBe("a2");
  });

  test("a MySQL table's database stands for its schema", () => {
    expect(
      matchBiTable(
        {
          database: "shop",
          schema: null,
          table: "carts",
          engine: "mysql",
          host: null,
        },
        catalog,
      )?.dataAssetId,
    ).toBe("a3");
  });

  test("a name that still fits two tables matches neither", () => {
    expect(
      matchBiTable(
        {
          database: null,
          schema: "public",
          table: "orders",
          engine: null,
          host: null,
        },
        catalog,
      ),
    ).toBe(null);
  });
});

describe("keeping a tool's dashboards as it says", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("new ones made with their tables, known ones updated, gone ones deleted", async () => {
    const connection: DataBiConnection = new DataBiConnection();
    const kept: DataDashboard = new DataDashboard();
    const gone: DataDashboard = new DataDashboard();

    connection._id = ObjectID.generate().toString();
    connection.projectId = ObjectID.generate();
    kept._id = ObjectID.generate().toString();
    kept.externalId = "42";
    gone._id = ObjectID.generate().toString();
    gone.externalId = "99";

    jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([kept, gone]);
    const update: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    const create: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "create")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    const remove: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "deleteOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

    const result: { dashboardCount: number; matchedTableCount: number } =
      await DataBiSync.keep({
        connection,
        tool: DataBiTool.Metabase,
        read: [
          {
            externalId: "42",
            name: "Revenue",
            url: "https://metabase.acme.com/dashboard/42",
            folder: null,
            owner: null,
            changedAt: null,
            tables: [
              {
                database: "orders",
                schema: "public",
                table: "orders",
                engine: null,
                host: null,
              },
            ],
          },
          {
            externalId: "43",
            name: "Refunds",
            url: null,
            folder: "Finance",
            owner: null,
            changedAt: null,
            tables: [
              {
                database: null,
                schema: "public",
                table: "unknown",
                engine: null,
                host: null,
              },
            ],
          },
        ],
        catalog: {
          stores: [
            {
              dataStoreId: "s1",
              kind: DataStoreKind.PostgreSql,
              databaseName: "orders",
              serverAddress: null,
            },
          ],
          assets: [
            {
              dataAssetId: "3ae4c1a8-7a8b-4c4e-9a52-1d2d5e0f6a11",
              dataStoreId: "s1",
              schemaName: "public",
              name: "orders",
            },
          ],
          storeNames: new Map(),
        },
      });

    expect(result).toEqual({
      dashboardCount: 2,
      matchedTableCount: 1,
      error: null,
    });
    expect(update).toHaveBeenCalledTimes(1);

    const updated: JSONObject = update.mock.calls[0]![0]
      .data as unknown as JSONObject;

    expect(updated["name"]).toBe("Revenue");
    expect(updated["tableCount"]).toBe(1);
    expect((updated["dataAssets"] as Array<DataAsset>)[0]!._id).toBe(
      "3ae4c1a8-7a8b-4c4e-9a52-1d2d5e0f6a11",
    );

    const created: DataDashboard = create.mock.calls[0]![0]
      .data as DataDashboard;

    expect(created.externalId).toBe("43");
    expect(created.folder).toBe("Finance");
    expect(created.tableCount).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]![0].id.toString()).toBe(gone.id!.toString());
  });

  test("a read that fails keeps the last dashboards, and says why, without the credentials", async () => {
    const connection: DataBiConnection = new DataBiConnection();

    connection._id = ObjectID.generate().toString();
    connection.projectId = ObjectID.generate();
    connection.tool = DataBiTool.Looker;
    connection.baseUrl = "https://acme.cloud.looker.com";
    connection.credentials = JSON.stringify({
      clientId: "id",
      clientSecret: "s3cr3t-value",
    });

    jest
      .spyOn(DataBiConnectionService, "findOneById")
      .mockResolvedValue(connection);
    const update: jest.SpyInstance = jest
      .spyOn(DataBiConnectionService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    jest
      .spyOn(LookerConnector, "read")
      .mockRejectedValue(
        new Error("Looker answered 401: bad secret s3cr3t-value"),
      );

    const result: { error: string | null } = await DataBiSync.syncConnection(
      connection.id!,
    );

    expect(result.error).toBe("Looker answered 401: bad secret ****");
    expect(
      (update.mock.calls[0]![0].data as unknown as JSONObject)["lastSyncError"],
    ).toBe("Looker answered 401: bad secret ****");
  });
});

describe("the dashboards a table's alert lists", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("on the table, and on a table built from it, saying which", async () => {
    const tableId: ObjectID = ObjectID.generate();
    const downstreamId: ObjectID = ObjectID.generate();
    const edge: DataAssetLineage = new DataAssetLineage();
    const downstream: DataAsset = new DataAsset();

    edge.downstreamDataAssetId = downstreamId;
    downstream.assetKey = "analytics.orders_daily";
    edge.downstreamDataAsset = downstream;

    jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockResolvedValueOnce([edge])
      .mockResolvedValueOnce([]);

    const direct: DataDashboard = new DataDashboard();
    const built: DataDashboard = new DataDashboard();
    const tableAsset: DataAsset = new DataAsset();
    const downstreamAsset: DataAsset = new DataAsset();

    tableAsset._id = tableId.toString();
    downstreamAsset._id = downstreamId.toString();
    direct._id = ObjectID.generate().toString();
    direct.name = "Orders";
    direct.tool = DataBiTool.Metabase;
    direct.dataAssets = [tableAsset];
    built._id = ObjectID.generate().toString();
    built.name = "Revenue";
    built.tool = DataBiTool.Tableau;
    built.url = "https://tableau.acme.com/#/views/Revenue";
    built.dataAssets = [downstreamAsset];

    jest
      .spyOn(DataDashboardService, "findBy")
      .mockResolvedValue([direct, built]);

    const dashboards: Array<TableDashboard> = await DataTableDashboards.find({
      projectId: ObjectID.generate(),
      dataAssetId: tableId,
    });

    expect(dashboards).toEqual([
      expect.objectContaining({ name: "Orders", tool: "Metabase", via: null }),
      expect.objectContaining({
        name: "Revenue",
        tool: "Tableau",
        url: "https://tableau.acme.com/#/views/Revenue",
        via: {
          dataAssetId: downstreamId.toString(),
          table: "analytics.orders_daily",
        },
      }),
    ]);
  });
});
