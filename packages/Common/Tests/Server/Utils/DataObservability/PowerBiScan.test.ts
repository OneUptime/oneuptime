import { describe, expect, test } from "@jest/globals";
import {
  BiDashboardRead,
  BiToolRead,
  PowerBiConnector,
} from "../../../../Server/Utils/DataObservability/Bi/BiConnectors";
import { BiReadKeptStateError } from "../../../../Server/Utils/DataObservability/Bi/BiReadState";
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

  test("a Dataverse environment by its host alone, however its connector writes it (#9554)", () => {
    const contoso: DataBiSource = {
      type: "Microsoft Dataverse",
      engine: "dataverse",
      server: "contoso.crm.dynamics.com",
      database: null,
      location: null,
    };

    // Common Data Service (Legacy), whose data source kind is Cds, as an extension or as its own type.
    expect(
      readPowerBiDatasource({
        datasourceType: "Extension",
        connectionDetails: {
          kind: "Cds",
          path: "https://contoso.crm.dynamics.com/",
        },
      }),
    ).toEqual(contoso);
    expect(
      readPowerBiDatasource({
        datasourceType: "Cds",
        connectionDetails: { url: "https://contoso.crm.dynamics.com/" },
      }),
    ).toEqual(contoso);
    // The Dataverse connector's SQL endpoint, on the port it falls back to.
    expect(
      readPowerBiDatasource({
        datasourceType: "CommonDataService",
        connectionDetails: { server: "contoso.crm.dynamics.com,5558" },
      }),
    ).toEqual(contoso);
    expect(
      readPowerBiDatasource({
        datasourceType: "Extension",
        connectionDetails: {
          kind: "CommonDataService",
          path: "contoso.crm.dynamics.com",
        },
      }),
    ).toEqual(contoso);
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
        {
          id: "e7e8a355-e77b-4418-a7b8-ae5972fdaa03",
          name: "ExportB",
          workspace: "Facilities",
          sources: [
            expect.objectContaining({ database: "DB" }),
            expect.objectContaining({ database: "Archive" }),
            expect.objectContaining({
              type: "Dataflow",
              location: "Azure SQL",
            }),
          ],
        },
        {
          id: "6d1b0b4e-9a5e-4a0b-8b7a-2c1c1f0e9d33",
          name: "15 29 EMG NUO Master Checklist- GANTT View",
          workspace: "Facilities",
          sources: [expect.objectContaining({ type: "SharePoint" })],
        },
      ],
      // Every dataset's sources together, each once.
      sources: [
        expect.objectContaining({ database: "DB" }),
        expect.objectContaining({ database: "Archive" }),
        expect.objectContaining({ type: "Dataflow", location: "Azure SQL" }),
        expect.objectContaining({ type: "SharePoint" }),
      ],
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
      // ExportB, and the composite model built on it.
      readingDataflows: 2,
      // Power BI names the dataflow, but no query names an entity of it: nothing to read through.
      withUnreadDataflows: 0,
      withPendingDataflows: 0,
      dataflowError: null,
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
        // Read each time, so a test can say Running before it says Succeeded.
        const status: JSONObject | undefined = routes.scanStatus;

        return answer(status || { status: "Succeeded" });
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
    const sharePoint: DataBiSource = {
      type: "SharePoint",
      engine: null,
      server: null,
      database: null,
      location: "https://contoso.sharepoint.com/sites/facilities",
    };

    expect(read.dashboards[1]!.upstream).toEqual({
      datasets: [
        {
          id: "6d1b0b4e-9a5e-4a0b-8b7a-2c1c1f0e9d33",
          name: "15 29 EMG NUO Master Checklist- GANTT View",
          workspace: "Facilities",
          sources: [sharePoint],
        },
      ],
      sources: [sharePoint],
    });
    expect(read.datasetFacts).toEqual({
      count: 3,
      withTables: 2,
      withQueries: 2,
      withSchemaError: 1,
      schemaError:
        "Unsupported request. Excel full fidelity datasets are not supported",
      // ExportB, and the composite model built on it.
      readingDataflows: 2,
      // Power BI names the dataflow, but no query names an entity of it: nothing to read through.
      withUnreadDataflows: 0,
      withPendingDataflows: 0,
      dataflowError: null,
    });
  });

  test("a scan that takes minutes is waited for, not failed after one (#9552)", async () => {
    let now: number = Date.parse("2026-11-18T10:00:00.000Z");
    let statusAsks: number = 0;
    const waits: Array<number> = [];
    const read: BiToolRead = await PowerBiConnector.read({
      baseUrl: "",
      credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
      isScheduled: true,
      now: new Date(now),
      clock: (): number => {
        return now;
      },
      wait: async (ms: number): Promise<void> => {
        waits.push(ms);
        now += ms;
      },
      transport: transport({
        scanResult: SCAN,
        get scanStatus(): JSONObject {
          statusAsks++;
          // Running for about six minutes, as a big tenant's scan with schemas and expressions can.
          return { status: statusAsks < 14 ? "Running" : "Succeeded" };
        },
      }),
    });

    expect(read.dashboards).toHaveLength(4);
    expect(statusAsks).toBe(14);
    expect(
      waits.reduce((total: number, ms: number): number => {
        return total + ms;
      }, 0),
    ).toBeGreaterThan(5 * 60 * 1000);
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

/*
 * A big tenant's hourly read scanned every workspace, every hour (#9552).
 * Now a read keeps each workspace as scanned, and the next asks Power BI
 * only for those changed since a half hour before the last read began,
 * and scans only those - the whole tenant once a day, for the hourly read.
 */
describe("Power BI's reader, scanning only what changed", () => {
  const START: Date = new Date("2026-11-19T08:00:00.000Z");
  const HOUR: number = 60 * 60 * 1000;

  function workspaceOf(id: string, reports: Array<string>): JSONObject {
    return {
      id,
      name: `Workspace ${id}`,
      state: "Active",
      isOnDedicatedCapacity: false,
      reports: reports.map((name: string, index: number): JSONObject => {
        return {
          id: `${id}-r${index}`,
          name,
          datasetId: `${id}-ds`,
        };
      }),
      datasets: [
        {
          id: `${id}-ds`,
          name: `Model ${id}`,
          tables: [
            {
              name: "Orders",
              source: [
                {
                  expression: `let Source = Sql.Database("sql01", "${id}"), T = Source{[Schema="dbo",Item="Orders"]}[Data] in T`,
                },
              ],
            },
          ],
        },
      ],
    };
  }

  interface Tenant {
    workspaces: Map<string, JSONObject>;
    // What admin/workspaces/modified lists when asked for changes.
    changed: Array<string>;
    // Workspaces whose scan Power BI fails.
    failing: Set<string>;
    // Workspaces whose scan Power BI is still running (#9697).
    slow: Set<string>;
    // Every scan started, by its id, across reads: Power BI keeps them.
    scans: Map<string, Array<string>>;
    requests: Array<string>;
    scanned: Array<Array<string>>;
  }

  function tenant(workspaces: Array<JSONObject>): Tenant {
    return {
      workspaces: new Map(
        workspaces.map((workspace: JSONObject): [string, JSONObject] => {
          return [workspace["id"] as string, workspace];
        }),
      ),
      changed: [],
      failing: new Set(),
      slow: new Set(),
      scans: new Map(),
      requests: [],
      scanned: [],
    };
  }

  function transportOf(
    fake: Tenant,
  ): (request: DataSourceHttpRequest) => Promise<DataSourceHttpResponse> {
    const scans: Map<string, Array<string>> = fake.scans;

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

      fake.requests.push(url);

      if (url.startsWith("https://login.microsoftonline.com/")) {
        return answer({ access_token: "aad" });
      }

      if (url.includes("/admin/workspaces/modified")) {
        return answer(
          (url.includes("modifiedSince=")
            ? fake.changed
            : Array.from(fake.workspaces.keys())
          ).map((id: string): JSONObject => {
            return { id };
          }),
        );
      }

      if (url.includes("/admin/workspaces/getInfo")) {
        const ids: Array<string> = (
          JSON.parse(request.body as string) as { workspaces: Array<string> }
        ).workspaces;
        const scanId: string = `scan-${scans.size + 1}`;

        scans.set(scanId, ids);
        fake.scanned.push(ids);

        return answer({ id: scanId, status: "NotStarted" });
      }

      if (url.includes("/scanStatus/")) {
        const ids: Array<string> = scans.get(url.split("/").pop()!)!;

        return answer(
          ids.some((id: string): boolean => {
            return fake.failing.has(id);
          })
            ? {
                status: "Failed",
                error: { message: "The workspace scan could not complete." },
              }
            : ids.some((id: string): boolean => {
                  return fake.slow.has(id);
                })
              ? { status: "Running" }
              : { status: "Succeeded" },
        );
      }

      if (url.includes("/scanResult/")) {
        const ids: Array<string> = scans.get(url.split("/").pop()!)!;

        return answer({
          workspaces: ids
            .map((id: string): JSONObject | undefined => {
              return fake.workspaces.get(id);
            })
            .filter(Boolean),
        });
      }

      return answer({
        value: [],
        activityEventEntities: [],
        lastResultSet: true,
      });
    };
  }

  async function readAt(
    fake: Tenant,
    at: Date,
    readState: JSONObject | null | undefined,
    isScheduled: boolean = false,
  ): Promise<BiToolRead> {
    fake.requests.length = 0;
    fake.scanned.length = 0;

    // Time passes only while the read waits, from the read's start.
    let clock: number = at.getTime();

    return await PowerBiConnector.read({
      baseUrl: "",
      credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
      readState,
      isScheduled,
      now: at,
      wait: async (ms: number): Promise<void> => {
        clock += ms;
      },
      clock: (): number => {
        return clock;
      },
      transport: transportOf(fake),
    });
  }

  function reportNames(read: BiToolRead): Array<string> {
    return read.dashboards.map((dashboard: BiDashboardRead): string => {
      return dashboard.name;
    });
  }

  function listing(fake: Tenant): string {
    return fake.requests.find((url: string): boolean => {
      return url.includes("/admin/workspaces/modified");
    })!;
  }

  test("the first read scans the whole tenant, and keeps each workspace", async () => {
    const fake: Tenant = tenant([
      workspaceOf("sales", ["Pipeline"]),
      workspaceOf("finance", ["Budget"]),
    ]);
    const read: BiToolRead = await readAt(fake, START, undefined);

    expect(listing(fake)).not.toContain("modifiedSince");
    expect(fake.scanned).toEqual([["sales", "finance"]]);
    expect(reportNames(read)).toEqual(["Pipeline", "Budget"]);
    expect(read.readState).toMatchObject({
      version: 2,
      scannedFrom: START.toISOString(),
      fullScanAt: START.toISOString(),
      pendingWorkspaceIds: [],
      hasEveryWorkspace: true,
    });
    // Each workspace with when its scan started: how old it is, for the daily read (#9901).
    expect(
      (read.readState!["workspaces"] as Array<JSONObject>).map(
        (workspace: JSONObject): unknown => {
          return workspace["scannedAt"];
        },
      ),
    ).toEqual([START.toISOString(), START.toISOString()]);
  });

  test("the next asks only for what changed since a half hour before the last read began, and keeps the rest", async () => {
    const fake: Tenant = tenant([
      workspaceOf("sales", ["Pipeline"]),
      workspaceOf("finance", ["Budget"]),
    ]);
    const first: BiToolRead = await readAt(fake, START, undefined);

    fake.workspaces.set(
      "finance",
      workspaceOf("finance", ["Budget", "Forecast"]),
    );
    fake.changed = ["finance"];

    const next: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + HOUR),
      first.readState,
      true,
    );

    expect(listing(fake)).toContain(
      `modifiedSince=${encodeURIComponent("2026-11-19T07:30:00.000Z")}`,
    );
    // Only the workspace that changed is scanned; the other is kept as it was.
    expect(fake.scanned).toEqual([["finance"]]);
    expect(reportNames(next)).toEqual(["Pipeline", "Budget", "Forecast"]);
    // Its reports still chart their tables.
    expect(next.dashboards[0]!.tables.map(getBiTableName)).toEqual([
      "sales.dbo.Orders",
    ]);
    expect(next.readState).toMatchObject({
      scannedFrom: new Date(START.getTime() + HOUR).toISOString(),
      fullScanAt: START.toISOString(),
    });
  });

  test("nothing changed: no scan at all, and every report as it was", async () => {
    const fake: Tenant = tenant([workspaceOf("sales", ["Pipeline"])]);
    const first: BiToolRead = await readAt(fake, START, undefined);
    const next: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + HOUR),
      first.readState,
      true,
    );

    expect(fake.scanned).toEqual([]);
    expect(
      fake.requests.filter((url: string): boolean => {
        return url.includes("/admin/workspaces/getInfo");
      }),
    ).toEqual([]);
    expect(reportNames(next)).toEqual(["Pipeline"]);
  });

  test("the hourly read scans the whole tenant once a day, which drops a workspace that is gone", async () => {
    const fake: Tenant = tenant([
      workspaceOf("sales", ["Pipeline"]),
      workspaceOf("finance", ["Budget"]),
    ]);
    const first: BiToolRead = await readAt(fake, START, undefined);

    fake.workspaces.delete("finance");

    const asked: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + 25 * HOUR),
      first.readState,
      false,
    );

    // A read someone asked for scans only what changed.
    expect(listing(fake)).toContain("modifiedSince");
    expect(reportNames(asked)).toEqual(["Pipeline", "Budget"]);

    const daily: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + 25 * HOUR),
      asked.readState,
      true,
    );

    expect(listing(fake)).not.toContain("modifiedSince");
    expect(reportNames(daily)).toEqual(["Pipeline"]);
    expect(daily.readState).toMatchObject({
      fullScanAt: new Date(START.getTime() + 25 * HOUR).toISOString(),
    });
  });

  test("a workspace Power BI says is deleted holds nothing", async () => {
    const fake: Tenant = tenant([
      workspaceOf("sales", ["Pipeline"]),
      workspaceOf("finance", ["Budget"]),
    ]);
    const first: BiToolRead = await readAt(fake, START, undefined);

    fake.workspaces.set("finance", {
      ...workspaceOf("finance", ["Budget"]),
      state: "Deleted",
    });
    fake.changed = ["finance"];

    const next: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + HOUR),
      first.readState,
    );

    expect(reportNames(next)).toEqual(["Pipeline"]);
  });

  test("a scan that fails keeps what was read before, says so, and is scanned again by the next read", async () => {
    const fake: Tenant = tenant([
      workspaceOf("sales", ["Pipeline"]),
      workspaceOf("finance", ["Budget"]),
    ]);
    const first: BiToolRead = await readAt(fake, START, undefined);

    fake.workspaces.set(
      "finance",
      workspaceOf("finance", ["Budget", "Forecast"]),
    );
    fake.changed = ["finance"];
    fake.failing.add("finance");

    const failed: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + HOUR),
      first.readState,
    );

    expect(reportNames(failed)).toEqual(["Pipeline", "Budget"]);
    expect(failed.warnings).toContain(
      "1 workspace was not scanned this time: Power BI's workspace scan failed: The workspace scan could not complete. The next read scans it again, and until then it shows what was read before.",
    );
    expect(failed.readState).toMatchObject({
      pendingWorkspaceIds: ["finance"],
    });

    // Power BI lists no change since; the next read scans it all the same.
    fake.changed = [];
    fake.failing.clear();

    const recovered: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + 2 * HOUR),
      failed.readState,
    );

    expect(fake.scanned).toEqual([["finance"]]);
    expect(reportNames(recovered)).toEqual(["Pipeline", "Budget", "Forecast"]);
    expect(recovered.readState).toMatchObject({ pendingWorkspaceIds: [] });
  });

  function asked(fake: Tenant, path: string): Array<string> {
    return fake.requests
      .filter((url: string): boolean => {
        return url.includes(path);
      })
      .map((url: string): string => {
        return url.split("/").pop()!;
      });
  }

  test("a scan that outlasts the read's wait is picked up by the next read: its result is read, and no scan starts for its workspaces (#9697)", async () => {
    const fake: Tenant = tenant([
      workspaceOf("sales", ["Pipeline"]),
      workspaceOf("finance", ["Budget"]),
    ]);
    const first: BiToolRead = await readAt(fake, START, undefined);

    fake.workspaces.set(
      "finance",
      workspaceOf("finance", ["Budget", "Forecast"]),
    );
    fake.changed = ["finance"];
    fake.slow.add("finance");

    const waited: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + HOUR),
      first.readState,
      true,
    );

    // The read waited its 20 minutes; the workspace shows what was read of it before.
    expect(reportNames(waited)).toEqual(["Pipeline", "Budget"]);
    expect(waited.warnings).toContain(
      "Power BI was still scanning 1 workspace when the read stopped waiting after 20 minutes. The next read reads that scan once Power BI has finished it, and until then the workspace shows what was read before.",
    );
    expect(waited.readState).toMatchObject({
      pendingWorkspaceIds: [],
      pendingScans: [
        {
          scanId: "scan-2",
          workspaceIds: ["finance"],
          startedAt: new Date(START.getTime() + HOUR).toISOString(),
        },
      ],
    });

    // Power BI finishes it after the read stopped waiting; nothing changed since.
    fake.slow.clear();
    fake.changed = [];

    const next: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + 2 * HOUR),
      waited.readState,
      true,
    );

    expect(fake.scanned).toEqual([]);
    expect(asked(fake, "/admin/workspaces/getInfo")).toEqual([]);
    expect(asked(fake, "/scanStatus/")).toEqual(["scan-2"]);
    expect(asked(fake, "/scanResult/")).toEqual(["scan-2"]);
    expect(reportNames(next)).toEqual(["Pipeline", "Budget", "Forecast"]);
    expect(next.warnings).toEqual([]);
    expect(next.readState).toMatchObject({
      pendingWorkspaceIds: [],
      pendingScans: [],
    });
  });

  test("a first read whose scans all outlast its wait fails, but keeps them: the next read reads them rather than scanning again", async () => {
    const fake: Tenant = tenant([
      workspaceOf("sales", ["Pipeline"]),
      workspaceOf("finance", ["Budget"]),
    ]);

    fake.slow.add("sales");

    let kept: BiReadKeptStateError | null = null;

    try {
      await readAt(fake, START, undefined, true);
    } catch (error) {
      kept = error as BiReadKeptStateError;
    }

    expect(kept).toBeInstanceOf(BiReadKeptStateError);
    expect(kept!.message).toBe(
      "Power BI was still scanning 2 workspaces when the read stopped waiting after 20 minutes. The next read reads those scans once Power BI has finished them, rather than scanning again.",
    );
    expect(kept!.readState).toMatchObject({
      fullScanAt: START.toISOString(),
      workspaces: [],
      pendingWorkspaceIds: [],
      pendingScans: [{ scanId: "scan-1", workspaceIds: ["sales", "finance"] }],
    });

    fake.slow.clear();

    const next: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + HOUR),
      kept!.readState,
      true,
    );

    expect(fake.scanned).toEqual([]);
    expect(reportNames(next)).toEqual(["Pipeline", "Budget"]);
  });

  test("a scan Power BI no longer keeps the result of is not asked about: its workspaces are scanned anew", async () => {
    const fake: Tenant = tenant([
      workspaceOf("sales", ["Pipeline"]),
      workspaceOf("finance", ["Budget"]),
    ]);
    const first: BiToolRead = await readAt(fake, START, undefined);

    fake.changed = ["finance"];
    fake.slow.add("finance");

    const waited: BiToolRead = await readAt(
      fake,
      new Date(START.getTime() + HOUR),
      first.readState,
      true,
    );

    fake.slow.clear();
    fake.changed = [];

    // A day after it started: past the 23 hours it is asked about for.
    await readAt(
      fake,
      new Date(START.getTime() + 25 * HOUR),
      waited.readState,
      false,
    );

    expect(asked(fake, "/scanStatus/")).not.toContain("scan-2");
    expect(fake.scanned).toEqual([["finance"]]);
  });

  test("a state that cannot be read is no state: the read scans the whole tenant", async () => {
    const fake: Tenant = tenant([workspaceOf("sales", ["Pipeline"])]);

    await readAt(fake, START, { version: 99, workspaces: [] });

    expect(listing(fake)).not.toContain("modifiedSince");
    expect(fake.scanned).toEqual([["sales"]]);
  });
});

/*
 * A report on a dataset built on a dataflow (#9551), read end to end: the
 * scan names the dataflow and the dataset's query names its entity; the
 * dataflow's definition, exported once, says which tables the entity
 * reads, and the report charts them. It is exported again only when the
 * scan says the dataflow changed, and Power BI's refusal is said.
 */
describe("Power BI's reader, through a dataset's dataflow", () => {
  const WORKSPACE: string = "6e2f9a10-0000-4000-8000-00000000aaaa";
  const DATAFLOW: string = "2c4d6e8f-0000-4000-8000-00000000bbbb";

  function tenantScan(modifiedDateTime: string): JSONObject {
    return {
      workspaces: [
        {
          id: WORKSPACE,
          name: "Sales",
          state: "Active",
          reports: [
            {
              id: "r-orders",
              name: "Orders by Region",
              datasetId: "ds-orders",
            },
          ],
          datasets: [
            {
              id: "ds-orders",
              name: "Orders Model",
              tables: [
                {
                  name: "Orders",
                  source: [
                    {
                      expression: `let\n    Source = PowerPlatform.Dataflows(null),\n    Workspaces = Source{[Id="Workspaces"]}[Data],\n    ws = Workspaces{[workspaceId="${WORKSPACE}"]}[Data],\n    df = ws{[dataflowId="${DATAFLOW}"]}[Data],\n    Orders = df{[entity="Orders",version=""]}[Data]\nin\n    Orders`,
                    },
                  ],
                },
              ],
              upstreamDataflows: [
                { targetDataflowId: DATAFLOW, groupId: WORKSPACE },
              ],
            },
          ],
          dataflows: [
            {
              objectId: DATAFLOW,
              name: "Sales Staging",
              modifiedDateTime,
            },
          ],
        },
      ],
    };
  }

  const EXPORTED: JSONObject = {
    name: "Sales Staging",
    version: "1.0",
    "pbi:mashup": {
      fastCombine: false,
      allowNativeQueries: false,
      queriesMetadata: { Orders: { queryName: "Orders", loadEnabled: true } },
      document:
        'section Section1;\r\nshared Orders = let\r\n  Source = Sql.Database("sql01.corp.acme.com", "Sales"),\r\n  #"Navigation 1" = Source{[Schema = "dbo", Item = "Orders"]}[Data]\r\nin\r\n  #"Navigation 1";\r\n',
    },
    entities: [{ $type: "LocalEntity", name: "Orders" }],
  };

  function dataflowTransport(data: {
    scan: JSONObject;
    exported: JSONObject | { status: number; message: string };
    requests: Array<string>;
  }): (request: DataSourceHttpRequest) => Promise<DataSourceHttpResponse> {
    const answer: (body: unknown) => DataSourceHttpResponse = (
      body: unknown,
    ): DataSourceHttpResponse => {
      return {
        statusCode: 200,
        bodyText: JSON.stringify(body),
        bodyJson: body,
      };
    };
    // Power BI's sign-in, scanner, refreshes and activity log, as the reader asks them.
    const base: (
      request: DataSourceHttpRequest,
    ) => Promise<DataSourceHttpResponse> = async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      const url: string = request.url;

      data.requests.push(url);

      if (url.startsWith("https://login.microsoftonline.com/")) {
        return answer({ access_token: "aad" });
      }

      if (url.includes("/admin/workspaces/modified")) {
        return answer([{ id: WORKSPACE }]);
      }

      if (url.includes("/admin/workspaces/getInfo")) {
        return answer({ id: "scan1", status: "NotStarted" });
      }

      if (url.includes("/scanStatus/")) {
        return answer({ status: "Succeeded" });
      }

      if (url.includes("/scanResult/")) {
        return answer(data.scan);
      }

      return answer({
        value: [],
        activityEventEntities: [],
        lastResultSet: true,
      });
    };

    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      if (request.url.includes("/admin/dataflows/")) {
        data.requests.push(request.url);

        if ("status" in data.exported) {
          const body: JSONObject = {
            error: { code: "Forbidden", message: data.exported.message },
          };

          return {
            statusCode: data.exported.status as number,
            bodyText: JSON.stringify(body),
            bodyJson: body,
          };
        }

        // As a file: with a byte order mark before its JSON.
        return {
          statusCode: 200,
          bodyText: `\uFEFF${JSON.stringify(data.exported)}`,
          bodyJson: undefined,
        };
      }

      return await base(request);
    };
  }

  async function readWith(data: {
    scan: JSONObject;
    exported: JSONObject | { status: number; message: string };
    readState?: JSONObject | null | undefined;
    now?: Date | undefined;
  }): Promise<{ read: BiToolRead; requests: Array<string> }> {
    const requests: Array<string> = [];
    const read: BiToolRead = await PowerBiConnector.read({
      baseUrl: "",
      credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
      wait: async (): Promise<void> => {},
      now: data.now || new Date("2026-11-19T08:00:00.000Z"),
      readState: data.readState,
      transport: dataflowTransport({
        scan: data.scan,
        exported: data.exported,
        requests,
      }),
    });

    return { read, requests };
  }

  function exports(requests: Array<string>): Array<string> {
    return requests.filter((url: string): boolean => {
      return url.includes("/admin/dataflows/");
    });
  }

  test("the report charts the tables the dataflow's entity reads, and is built on its database", async () => {
    const { read, requests } = await readWith({
      scan: tenantScan("2026-11-18T16:00:00.000Z"),
      exported: EXPORTED,
    });

    expect(exports(requests)).toEqual([
      `https://api.powerbi.com/v1.0/myorg/admin/dataflows/${DATAFLOW}/export`,
    ]);
    expect(read.dashboards[0]!.tables.map(getBiTableName)).toEqual([
      "Sales.dbo.Orders",
    ]);
    expect(read.dashboards[0]!.tables[0]).toMatchObject({
      engine: "sqlserver",
      host: "sql01.corp.acme.com",
      isDatabaseExact: true,
    });
    expect(sourceNames(read.dashboards[0]!.upstream!.sources)).toEqual([
      "SQL Server | sql01.corp.acme.com | Sales",
      "Dataflow | Sales Staging",
    ]);
    expect(read.datasetFacts).toMatchObject({
      readingDataflows: 1,
      withUnreadDataflows: 0,
      withPendingDataflows: 0,
      dataflowError: null,
    });
    // Where the data comes from: the database, with the table read from it.
    expect(
      (read.sources || []).map(
        (found: NonNullable<BiToolRead["sources"]>[number]) => {
          return `${found.source.type}: ${found.tables.map(getBiTableName).join(", ")}`;
        },
      ),
    ).toEqual(["SQL Server: Sales.dbo.Orders", "Dataflow: "]);
  });

  test("the definition is kept: not exported again while the dataflow is unchanged, and again once it changes", async () => {
    const first: { read: BiToolRead } = await readWith({
      scan: tenantScan("2026-11-18T16:00:00.000Z"),
      exported: EXPORTED,
    });
    const unchanged: { read: BiToolRead; requests: Array<string> } =
      await readWith({
        scan: tenantScan("2026-11-18T16:00:00.000Z"),
        exported: EXPORTED,
        readState: first.read.readState,
        now: new Date("2026-11-19T09:00:00.000Z"),
      });

    expect(exports(unchanged.requests)).toEqual([]);
    expect(unchanged.read.dashboards[0]!.tables.map(getBiTableName)).toEqual([
      "Sales.dbo.Orders",
    ]);

    const changedScan: JSONObject = tenantScan("2026-11-19T08:30:00.000Z");
    const changed: { requests: Array<string> } = await readWith({
      scan: changedScan,
      exported: EXPORTED,
      // The scan's workspace changed: a whole read, so the new time is seen.
      readState: null,
      now: new Date("2026-11-19T10:00:00.000Z"),
    });

    expect(exports(changed.requests)).toHaveLength(1);
  });

  test("Power BI's refusal is said, with its words, and the report keeps no table it cannot be sure of", async () => {
    const { read } = await readWith({
      scan: tenantScan("2026-11-18T16:00:00.000Z"),
      exported: {
        status: 403,
        message: "API is not accessible for application",
      },
    });

    expect(read.dashboards[0]!.tables).toEqual([]);
    expect(read.datasetFacts).toMatchObject({
      readingDataflows: 1,
      withUnreadDataflows: 1,
      withPendingDataflows: 0,
      dataflowError:
        "Power BI answered 403: API is not accessible for application.",
    });
    expect(read.readState).toMatchObject({
      dataflows: {
        [DATAFLOW]: {
          entities: null,
          error: "Power BI answered 403: API is not accessible for application",
        },
      },
    });
  });
});
