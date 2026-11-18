import { describe, expect, test } from "@jest/globals";
import {
  BiToolRead,
  PowerBiConnector,
} from "../../../../Server/Utils/DataObservability/Bi/BiConnectors";
import {
  BiTableRef,
  getBiTableName,
} from "../../../../Server/Utils/DataObservability/Bi/BiTables";
import {
  getPowerBiDatasetFacts,
  getPowerBiTables,
  getPowerBiUpstream,
  PowerBiDataset,
  PowerBiScanRead,
  readPowerBiDatasource,
  readPowerBiScan,
  readSafeLocation,
} from "../../../../Server/Utils/DataObservability/Bi/PowerBiScan";
import { DataBiSource } from "../../../../Types/DataObservability/DataBiLineage";
import { JSONObject } from "../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";

/*
 * What Power BI's workspace scan says (#9507), read from payloads shaped as
 * GetScanResult returns them: each dataset's tables from its Power Query -
 * its shared queries too, as Microsoft's own sample reads its table - and
 * a composite model's upstream datasets; each dataset's data sources from
 * the scan's datasourceInstances, which need no tenant setting; and what
 * the scan said of the datasets' tables, so a read that found none can say
 * why.
 */

// A scan result as GetScanResult answers, after Microsoft's sample: a dataset whose table reads a shared query.
const SCAN: JSONObject = {
  workspaces: [
    {
      id: "d507422c-8d6d-4361-ac7a-30074a8cd0a1",
      name: "Facilities",
      type: "Workspace",
      state: "Active",
      isOnDedicatedCapacity: false,
      reports: [
        {
          id: "c6d072d1-ed20-4b60-8329-16c4b934203b",
          name: "Revenue by Site",
          datasetId: "E7E8A355-E77B-4418-A7B8-AE5972FDAA03",
          createdDateTime: "2020-06-16T08:22:49.14",
          modifiedDateTime: "2026-06-16T08:22:49.14",
          modifiedBy: "john@contoso.com",
          reportType: "PowerBIReport",
        },
        {
          id: "0b1f6a62-1c22-4b1e-9a77-3f0c8d2b7e10",
          name: "15 29 EMG NUO Master Checklist- GANTT View.xlsx",
          datasetId: "6d1b0b4e-9a5e-4a0b-8b7a-2c1c1f0e9d33",
          reportType: "PowerBIReport",
        },
        {
          id: "a3c0c5f1-1111-4c2a-9d1e-6f7a8b9c0d1e",
          name: "Site Composite",
          datasetId: "f00dfeed-0000-4000-8000-000000000001",
        },
      ],
      dashboards: [
        {
          id: "80814ece-9302-49e3-b6bc-bad2f7a86c1a",
          displayName: "Facilities Board",
          isReadOnly: false,
          tiles: [
            {
              id: "e687cc21-5b32-48f5-8c5e-4b844f190579",
              title: "Revenue",
              reportId: "c6d072d1-ed20-4b60-8329-16c4b934203b",
              datasetId: "e7e8a355-e77b-4418-a7b8-ae5972fdaa03",
            },
            {
              id: "1d2e3f40-0000-4000-8000-000000000002",
              title: "Checklist",
              datasetId: "6d1b0b4e-9a5e-4a0b-8b7a-2c1c1f0e9d33",
            },
            { id: "1d2e3f40-0000-4000-8000-000000000003", title: "A note" },
          ],
        },
      ],
      datasets: [
        {
          id: "e7e8a355-e77b-4418-a7b8-ae5972fdaa03",
          name: "ExportB",
          tables: [
            {
              name: "DW_Revenues",
              columns: [
                {
                  name: "RowNumber-2662979B-1795-4F74-8F37-6A1BA8059B61",
                  dataType: "Int64",
                  isHidden: true,
                },
              ],
              measures: [],
              isHidden: false,
              source: [
                {
                  expression:
                    "let\n    Source = Revenues,\n    Param = RevenuesParam\nin\n    Source",
                },
              ],
            },
          ],
          relationships: [],
          configuredBy: "john@contoso.com",
          targetStorageMode: "Abf",
          expressions: [
            {
              name: "Revenues",
              description: "revenues",
              expression:
                'let\n    Source = Sql.Database("sqlserver.database.windows.net", "DB"),\n    RevenuesTable = Source{[Schema="DB_SCHEMA",Item="DB_SCHEMA_ITEM"]}[Data]\nin\n    RevenuesTable',
            },
            {
              name: "RevenuesParam",
              description: "revenues param",
              expression:
                '"revenues param value" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
            },
          ],
          upstreamDataflows: [
            {
              targetDataflowId: "a842dbb1-32ca-46b0-9648-498b2c2d5e38",
              groupId: "b7416115-7421-42c0-b525-1505ce40d2f0",
            },
          ],
          datasourceUsages: [
            { datasourceInstanceId: "c79ad907-df19-43fe-a0f7-d9f365d67070" },
          ],
          misconfiguredDatasourceUsages: [
            { datasourceInstanceId: "80ec28bc-fe81-43ea-be52-a07a95cfbcab" },
          ],
        },
        {
          // An Excel workbook's dataset: Power BI cannot describe it.
          id: "6d1b0b4e-9a5e-4a0b-8b7a-2c1c1f0e9d33",
          name: "15 29 EMG NUO Master Checklist- GANTT View",
          ContentProviderType: "Excel",
          schemaRetrievalError:
            "Unsupported request. Excel full fidelity datasets are not supported",
          datasourceUsages: [
            { datasourceInstanceId: "2b5c0e2e-4f1d-4c33-9a7e-0d1f2e3c4b5a" },
          ],
        },
        {
          // A composite model over ExportB, with a table of its own.
          id: "f00dfeed-0000-4000-8000-000000000001",
          name: "Site Composite",
          tables: [
            {
              name: "Targets",
              source: [
                {
                  expression:
                    'let Source = PostgreSQL.Database("pg.acme.com", "plans"), T = Source{[Schema="public",Item="targets"]}[Data] in T',
                },
              ],
            },
          ],
          upstreamDatasets: [
            {
              targetDatasetId: "e7e8a355-e77b-4418-a7b8-ae5972fdaa03",
              groupId: "d507422c-8d6d-4361-ac7a-30074a8cd0a1",
            },
          ],
        },
      ],
      dataflows: [
        {
          objectId: "a842dbb1-32ca-46b0-9648-498b2c2d5e38",
          name: "Azure SQL",
          datasourceUsages: [
            { datasourceInstanceId: "c79ad907-df19-43fe-a0f7-d9f365d67070" },
          ],
        },
      ],
    },
  ],
  datasourceInstances: [
    {
      datasourceType: "Sql",
      connectionDetails: {
        server: "sqlserver.database.windows.net",
        database: "DB",
      },
      datasourceId: "c79ad907-df19-43fe-a0f7-d9f365d67070",
      gatewayId: "e820592e-f8cf-4a6f-b1ed-566799d29565",
    },
    {
      datasourceType: "SharePointList",
      connectionDetails: {
        url: "https://contoso.sharepoint.com/sites/facilities/?token=secret",
      },
      datasourceId: "2b5c0e2e-4f1d-4c33-9a7e-0d1f2e3c4b5a",
    },
  ],
  misconfiguredDatasourceInstances: [
    {
      datasourceType: "Sql",
      connectionDetails: {
        server: "sqlserver.database.windows.net",
        database: "Archive",
      },
      datasourceId: "80ec28bc-fe81-43ea-be52-a07a95cfbcab",
    },
  ],
};

function sourceNames(sources: Array<DataBiSource>): Array<string> {
  return sources.map((source: DataBiSource): string => {
    return [source.type, source.server, source.database, source.location]
      .filter(Boolean)
      .join(" | ");
  });
}

describe("a data source, as the scan describes it", () => {
  test("a database by its engine, server and database", () => {
    expect(
      readPowerBiDatasource({
        datasourceType: "Sql",
        connectionDetails: { server: "sql01.corp.acme.com", database: "Sales" },
      }),
    ).toEqual({
      type: "SQL Server",
      engine: "sqlserver",
      server: "sql01.corp.acme.com",
      database: "Sales",
      location: null,
    });
    expect(
      readPowerBiDatasource({
        datasourceType: "Oracle",
        connectionDetails: {
          server: "My-Oracle-Server",
          database: "My-Oracle-Database",
        },
      }),
    ).toMatchObject({ type: "Oracle", engine: "oracle" });
  });

  test("an extension's kind is its engine, and its path its server", () => {
    expect(
      readPowerBiDatasource({
        datasourceType: "Extension",
        connectionDetails: {
          kind: "Snowflake",
          path: "acme.snowflakecomputing.com;COMPUTE_WH",
        },
      }),
    ).toEqual({
      type: "Snowflake",
      engine: "snowflake",
      server: "acme.snowflakecomputing.com",
      database: null,
      location: null,
    });
    expect(
      readPowerBiDatasource({
        datasourceType: "Extension",
        connectionDetails: {
          kind: "GoogleBigQuery",
          path: "billing-project",
        },
      }),
    ).toMatchObject({ engine: "bigquery", server: null });
    expect(
      readPowerBiDatasource({
        datasourceType: "Extension",
        connectionDetails: {
          kind: "AzureDataExplorer",
          path: "https://myserver.kusto.windows.net",
        },
      }),
    ).toEqual({
      type: "AzureDataExplorer",
      engine: null,
      server: null,
      database: null,
      location: "https://myserver.kusto.windows.net",
    });
  });

  test("files, SharePoint, web pages and feeds by where they are", () => {
    expect(
      sourceNames(
        [
          {
            datasourceType: "File",
            connectionDetails: {
              path: "c:\\users\\username\\documents\\orders1.xlsx",
            },
          },
          {
            datasourceType: "File",
            connectionDetails: { path: "\\\\share\\exports\\orders.csv" },
          },
          {
            datasourceType: "SharePointList",
            connectionDetails: {
              url: "https://microsoft.sharepoint.com/hello/myproj/",
            },
          },
          {
            datasourceType: "Web",
            connectionDetails: {
              url: "https://contoso.sharepoint.com/sites/ops/Shared%20Documents/plan.xlsx",
            },
          },
          {
            datasourceType: "Web",
            connectionDetails: {
              url: "https://api.acme.com/v1/orders?apikey=abc",
            },
          },
          {
            datasourceType: "OData",
            connectionDetails: {
              url: "http://services.odata.org/MyOdata/MyOdata.svc",
            },
          },
          {
            datasourceType: "AzureBlobs",
            connectionDetails: {
              account: "myAccount",
              domain: "blob.core.windows.net",
            },
          },
          {
            datasourceType: "AnalysisServices",
            connectionDetails: {
              server: "powerbi://api.powerbi.com/v1.0/myorg/Finance",
              database: "Sales Model",
            },
          },
          {
            datasourceType: "Salesforce",
            connectionDetails: {
              classInfo: "report-detail",
              loginServer: "https://login.salesforce.com/",
            },
          },
        ].map((value: JSONObject): DataBiSource => {
          return readPowerBiDatasource(value)!;
        }),
      ),
    ).toEqual([
      "Excel file | c:\\users\\username\\documents\\orders1.xlsx",
      "CSV file | \\\\share\\exports\\orders.csv",
      "SharePoint | https://microsoft.sharepoint.com/hello/myproj",
      "SharePoint | https://contoso.sharepoint.com/sites/ops/Shared%20Documents/plan.xlsx",
      "Web | https://api.acme.com/v1/orders",
      "OData feed | http://services.odata.org/MyOdata/MyOdata.svc",
      "Azure Blob Storage | myAccount.blob.core.windows.net",
      "Power BI semantic model | powerbi://api.powerbi.com/v1.0/myorg/Finance / Sales Model",
      "Salesforce",
    ]);
  });

  test("a location never keeps what could get anyone in", () => {
    expect(
      readSafeLocation("https://user:pass@acme.com/data/x.csv?sig=abc#frag"),
    ).toBe("https://acme.com/data/x.csv");
    expect(
      readSafeLocation("Driver={ODBC Driver 18};Server=x;Pwd=secret"),
    ).toBeNull();
    expect(readSafeLocation("")).toBeNull();
    expect(readPowerBiDatasource({ connectionDetails: {} })).toBeNull();
  });
});

describe("reading a scan", () => {
  const scan: PowerBiScanRead = readPowerBiScan([SCAN], 2_000);
  const exportB: PowerBiDataset = scan.datasets.get(
    "e7e8a355-e77b-4418-a7b8-ae5972fdaa03",
  )!;

  test("a table that reads a shared query reads the shared query's table", () => {
    expect(exportB.tables.map(getBiTableName)).toEqual([
      "DB.DB_SCHEMA.DB_SCHEMA_ITEM",
    ]);
    expect(exportB).toMatchObject({
      name: "ExportB",
      workspace: "Facilities",
      onCapacity: false,
      hasTables: true,
      hasQueries: true,
      schemaError: null,
      readsDataflows: true,
    });
  });

  test("its data sources: the scan's instances it uses, misconfigured ones too, and its dataflows", () => {
    expect(sourceNames(exportB.sources)).toEqual([
      "SQL Server | sqlserver.database.windows.net | DB",
      "SQL Server | sqlserver.database.windows.net | Archive",
      "Dataflow | Azure SQL",
    ]);
  });

  test("a dataset Power BI cannot describe says why, and still says where its data is", () => {
    const workbook: PowerBiDataset = scan.datasets.get(
      "6d1b0b4e-9a5e-4a0b-8b7a-2c1c1f0e9d33",
    )!;

    expect(workbook).toMatchObject({
      tables: [],
      hasTables: false,
      hasQueries: false,
      schemaError:
        "Unsupported request. Excel full fidelity datasets are not supported",
    });
    // The SharePoint address without its query string.
    expect(sourceNames(workbook.sources)).toEqual([
      "SharePoint | https://contoso.sharepoint.com/sites/facilities",
    ]);
  });

  test("a composite model charts its upstream dataset's tables, and reads its sources", () => {
    const composite: PowerBiDataset = scan.datasets.get(
      "f00dfeed-0000-4000-8000-000000000001",
    )!;

    expect(composite.tables.map(getBiTableName)).toEqual([
      "plans.public.targets",
      "DB.DB_SCHEMA.DB_SCHEMA_ITEM",
    ]);
    expect(sourceNames(composite.sources)).toEqual([
      "PostgreSQL | pg.acme.com | plans",
      "SQL Server | sqlserver.database.windows.net | DB",
      "SQL Server | sqlserver.database.windows.net | Archive",
      "Dataflow | Azure SQL",
    ]);
  });

  test("reports chart their dataset, a dashboard its tiles' datasets, by id in any case", () => {
    expect(
      scan.items.map((item: PowerBiScanRead["items"][number]) => {
        return `${item.name}: ${item.datasetIds.join(", ")}`;
      }),
    ).toEqual([
      "Revenue by Site: e7e8a355-e77b-4418-a7b8-ae5972fdaa03",
      "15 29 EMG NUO Master Checklist- GANTT View.xlsx: 6d1b0b4e-9a5e-4a0b-8b7a-2c1c1f0e9d33",
      "Site Composite: f00dfeed-0000-4000-8000-000000000001",
      "Facilities Board: e7e8a355-e77b-4418-a7b8-ae5972fdaa03, 6d1b0b4e-9a5e-4a0b-8b7a-2c1c1f0e9d33",
    ]);
    expect(scan.items[0]).toMatchObject({
      url: "https://app.powerbi.com/groups/d507422c-8d6d-4361-ac7a-30074a8cd0a1/reports/c6d072d1-ed20-4b60-8329-16c4b934203b",
      folder: "Facilities",
      owner: "john@contoso.com",
    });
  });

  test("a dashboard is built on its datasets and their sources, and charts their tables", () => {
    const board: PowerBiScanRead["items"][number] = scan.items[3]!;

    expect(
      getPowerBiTables(scan.datasets, board.datasetIds).map(getBiTableName),
    ).toEqual(["DB.DB_SCHEMA.DB_SCHEMA_ITEM"]);
    expect(getPowerBiUpstream(scan.datasets, board.datasetIds)).toEqual({
      datasets: [
        { name: "ExportB", workspace: "Facilities" },
        {
          name: "15 29 EMG NUO Master Checklist- GANTT View",
          workspace: "Facilities",
        },
      ],
      sources: expect.arrayContaining([
        expect.objectContaining({ type: "SharePoint" }),
        expect.objectContaining({ type: "Dataflow", location: "Azure SQL" }),
      ]),
    });
  });

  test("what the scan said of the datasets' tables", () => {
    expect(getPowerBiDatasetFacts(Array.from(scan.datasets.values()))).toEqual({
      count: 3,
      withTables: 2,
      withQueries: 2,
      withSchemaError: 1,
      schemaError:
        "Unsupported request. Excel full fidelity datasets are not supported",
      readingDataflows: 1,
    });
  });

  test("with the detailed metadata setting off: no tables, but each dataset's sources", () => {
    const off: PowerBiScanRead = readPowerBiScan(
      [
        {
          workspaces: [
            {
              id: "w1",
              name: "Sales",
              reports: [{ id: "r1", name: "Pipeline", datasetId: "ds1" }],
              datasets: [
                {
                  id: "ds1",
                  name: "Pipeline",
                  datasourceUsages: [{ datasourceInstanceId: "src1" }],
                },
              ],
            },
          ],
          datasourceInstances: [
            {
              datasourceType: "Sql",
              connectionDetails: { server: "sql01", database: "Sales" },
              datasourceId: "SRC1",
            },
          ],
        },
      ],
      2_000,
    );
    const dataset: PowerBiDataset = off.datasets.get("ds1")!;

    expect(dataset).toMatchObject({ tables: [], hasTables: false });
    expect(sourceNames(dataset.sources)).toEqual([
      "SQL Server | sql01 | Sales",
    ]);
    expect(getPowerBiDatasetFacts([dataset])).toMatchObject({
      count: 1,
      withTables: 0,
      withQueries: 0,
    });
  });

  test("where Power BI lists no data source, the databases its queries connect to", () => {
    const read: PowerBiScanRead = readPowerBiScan(
      [
        {
          workspaces: [
            {
              id: "w1",
              datasets: [
                {
                  id: "ds1",
                  tables: [
                    {
                      name: "Orders",
                      source: [
                        {
                          expression:
                            'let Source = Snowflake.Databases("acme.snowflakecomputing.com", "WH"), DB = Source{[Name="ANALYTICS",Kind="Database"]}[Data], S = DB{[Name="PUBLIC",Kind="Schema"]}[Data], T = S{[Name="ORDERS",Kind="Table"]}[Data] in T',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      2_000,
    );

    expect(read.datasets.get("ds1")!.sources).toEqual([
      {
        type: "Snowflake",
        engine: "snowflake",
        server: "acme.snowflakecomputing.com",
        database: null,
        location: null,
      },
    ]);
  });

  test("no more items than asked for", () => {
    expect(readPowerBiScan([SCAN], 2).items.length).toBe(2);
  });
});

describe("Power BI's reader", () => {
  function transport(
    routes: { scanResult: JSONObject; scanStatus?: JSONObject },
    requests: Array<string> = [],
  ): (request: DataSourceHttpRequest) => Promise<DataSourceHttpResponse> {
    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      const url: string = request.url;
      const answer: (body: unknown) => DataSourceHttpResponse = (
        body: unknown,
      ): DataSourceHttpResponse => {
        return {
          statusCode: 200,
          bodyText: JSON.stringify(body),
          bodyJson: body,
        };
      };

      requests.push(url);

      if (url.startsWith("https://login.microsoftonline.com/")) {
        return answer({ access_token: "aad" });
      }

      if (url.includes("/admin/workspaces/modified")) {
        return answer([{ id: "d507422c-8d6d-4361-ac7a-30074a8cd0a1" }]);
      }

      if (url.includes("/admin/workspaces/getInfo")) {
        return answer({ id: "scan1", status: "NotStarted" });
      }

      if (url.includes("/scanStatus/")) {
        return answer(routes.scanStatus || { status: "Succeeded" });
      }

      if (url.includes("/scanResult/")) {
        return answer(routes.scanResult);
      }

      // Refreshes, refreshables and the activity log: nothing to say.
      return answer({
        value: [],
        activityEventEntities: [],
        lastResultSet: true,
      });
    };
  }

  test("each report and dashboard with its tables, what it is built on, and what the scan said", async () => {
    const requests: Array<string> = [];
    const read: BiToolRead = await PowerBiConnector.read({
      baseUrl: "",
      credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
      wait: async (): Promise<void> => {},
      now: new Date("2026-11-18T10:00:00.000Z"),
      transport: transport({ scanResult: SCAN }, requests),
    });

    // The scan asks for lineage, data sources, schemas and expressions.
    expect(
      requests.find((url: string): boolean => {
        return url.includes("/admin/workspaces/getInfo");
      }),
    ).toContain(
      "lineage=True&datasourceDetails=True&datasetSchema=True&datasetExpressions=True",
    );
    expect(
      read.dashboards.map((dashboard: BiToolRead["dashboards"][number]) => {
        return `${dashboard.name}: ${dashboard.tables
          .map((ref: BiTableRef): string => {
            return getBiTableName(ref);
          })
          .join(", ")}`;
      }),
    ).toEqual([
      "Revenue by Site: DB.DB_SCHEMA.DB_SCHEMA_ITEM",
      "15 29 EMG NUO Master Checklist- GANTT View.xlsx: ",
      "Site Composite: plans.public.targets, DB.DB_SCHEMA.DB_SCHEMA_ITEM",
      "Facilities Board: DB.DB_SCHEMA.DB_SCHEMA_ITEM",
    ]);
    expect(read.dashboards[1]!.upstream).toEqual({
      datasets: [
        {
          name: "15 29 EMG NUO Master Checklist- GANTT View",
          workspace: "Facilities",
        },
      ],
      sources: [
        {
          type: "SharePoint",
          engine: null,
          server: null,
          database: null,
          location: "https://contoso.sharepoint.com/sites/facilities",
        },
      ],
    });
    expect(read.datasetFacts).toEqual({
      count: 3,
      withTables: 2,
      withQueries: 2,
      withSchemaError: 1,
      schemaError:
        "Unsupported request. Excel full fidelity datasets are not supported",
      readingDataflows: 1,
    });
  });

  test("a scan Power BI failed says Power BI's reason", async () => {
    await expect(
      PowerBiConnector.read({
        baseUrl: "",
        credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
        wait: async (): Promise<void> => {},
        transport: transport({
          scanResult: SCAN,
          scanStatus: {
            status: "Failed",
            error: {
              code: "ScanFailed",
              message: "The workspace scan could not complete.",
            },
          },
        }),
      }),
    ).rejects.toThrow(
      "Power BI's workspace scan failed: The workspace scan could not complete.",
    );
  });
});
