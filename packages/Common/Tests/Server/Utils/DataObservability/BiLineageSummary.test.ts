import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  BiDashboardRead,
  BiToolRead,
  PowerBiConnector,
} from "../../../../Server/Utils/DataObservability/Bi/BiConnectors";
import {
  findBiSourceStore,
  getBiLineageProblems,
  getConnectHint,
  summarizeBiLineage,
} from "../../../../Server/Utils/DataObservability/Bi/BiLineageSummary";
import {
  BiSourceRead,
  collectBiSources,
  getBiDatabaseSource,
  getBiSourceFit,
} from "../../../../Server/Utils/DataObservability/Bi/BiSources";
import { BiTableRef } from "../../../../Server/Utils/DataObservability/Bi/BiTables";
import DataBiSync from "../../../../Server/Utils/DataObservability/Bi/DataBiSync";
import { readPowerQueryTables } from "../../../../Server/Utils/DataObservability/Bi/PowerQuery";
import OpenLineageIngest, {
  ProjectCatalog,
} from "../../../../Server/Utils/DataObservability/OpenLineageIngest";
import { UsageAsset } from "../../../../Server/Utils/DataObservability/TableUsageMatching";
import DataBiConnectionService from "../../../../Server/Services/DataBiConnectionService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import DataDashboard from "../../../../Models/DatabaseModels/DataDashboard";
import {
  DataBiDatasetFacts,
  DataBiLineageProblem,
  DataBiLineageSource,
  DataBiLineageSummary,
  DataBiSource,
  getDataBiSourceName,
  readDataBiLineageSummary,
  readDataDashboardUpstream,
} from "../../../../Types/DataObservability/DataBiLineage";
import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Why a BI tool's dashboards are, or are not, tied to watched tables
 * (#9507): the data sources behind them, whether OneUptime watches each,
 * and what keeps the rest off a table - Power BI's tenant settings, a
 * database not connected, tables not watched, dataflows, datasets Power BI
 * cannot describe, files - worst first, kept on the tool by each read,
 * and what each dashboard is built on, kept on the dashboard.
 */

const SQL01_SALES: DataBiSource = getBiDatabaseSource(
  "sqlserver",
  "sql01.corp.acme.com",
  "Sales",
);
const SHAREPOINT: DataBiSource = {
  type: "SharePoint",
  engine: null,
  server: null,
  database: null,
  location: "https://acme.sharepoint.com/sites/ops",
};

function catalog(data: Partial<ProjectCatalog> = {}): ProjectCatalog {
  return {
    stores: [
      {
        dataStoreId: "store-sales",
        kind: DataStoreKind.SqlServer,
        databaseName: "Sales",
        serverAddress: "sql01",
      },
    ],
    assets: [
      {
        dataAssetId: "asset-orders",
        dataStoreId: "store-sales",
        schemaName: "dbo",
        name: "Orders",
      },
    ],
    storeNames: new Map([["store-sales", "Sales DB"]]),
    ...data,
  };
}

function sqlTable(table: string, database: string = "Sales"): BiTableRef {
  return readPowerQueryTables(
    `let Source = Sql.Database("sql01.corp.acme.com", "${database}"), T = Source{[Schema="dbo",Item="${table}"]}[Data] in T`,
  )[0]!;
}

const FACTS: DataBiDatasetFacts = {
  count: 3,
  withTables: 3,
  withQueries: 3,
  withSchemaError: 0,
  schemaError: null,
  readingDataflows: 0,
};

describe("where a tool's data comes from", () => {
  test("a database source names OneUptime's engine only where OneUptime can watch it", () => {
    expect(SQL01_SALES).toEqual({
      type: "SQL Server",
      engine: "sqlserver",
      server: "sql01.corp.acme.com",
      database: "Sales",
      location: null,
    });
    expect(getBiDatabaseSource("teradata", "td01", null)).toMatchObject({
      type: "Teradata",
      engine: null,
    });
    expect(getBiDatabaseSource("postgres", "pg", "shop")).toMatchObject({
      type: "PostgreSQL",
      engine: "postgresql",
    });
  });

  test("a table fits a source of its engine and database, on its server", () => {
    expect(getBiSourceFit(SQL01_SALES, sqlTable("Orders"))).toBe(4);
    expect(getBiSourceFit(SQL01_SALES, sqlTable("Orders", "Archive"))).toBe(0);
    expect(getBiSourceFit(SHAREPOINT, sqlTable("Orders"))).toBe(0);
    expect(
      getBiSourceFit(
        getBiDatabaseSource("sqlserver", "sql02", "Sales"),
        sqlTable("Orders"),
      ),
    ).toBe(0);
  });

  test("each dataset counts once per source; a table goes with its source, or one made from its database", () => {
    const sources: Array<BiSourceRead> = collectBiSources([
      { sources: [SQL01_SALES], tables: [sqlTable("Orders")] },
      {
        sources: [SQL01_SALES, SHAREPOINT],
        tables: [sqlTable("Orders"), sqlTable("Refunds", "Archive")],
      },
      { sources: [SHAREPOINT], tables: [] },
    ]);

    expect(
      sources.map((read: BiSourceRead): string => {
        return `${getDataBiSourceName(read.source)} (${read.readerCount}): ${read.tables
          .map((ref: BiTableRef): string => {
            return ref.table;
          })
          .join(", ")}`;
      }),
    ).toEqual([
      "sql01.corp.acme.com / Sales (2): Orders",
      "https://acme.sharepoint.com/sites/ops (2): ",
      "sql01.corp.acme.com / Archive (1): Refunds",
    ]);
  });

  test("a tool with no datasets: each dashboard's tables' databases are its sources", () => {
    const sources: Array<BiSourceRead> = collectBiSources([
      {
        sources: [],
        tables: [
          {
            database: "analytics",
            schema: "public",
            table: "orders",
            engine: "postgres",
            host: "pg01",
          },
        ],
      },
      {
        sources: [],
        tables: [
          {
            database: "analytics",
            schema: "public",
            table: "refunds",
            engine: "postgres",
            host: "pg01",
          },
        ],
      },
    ]);

    expect(sources).toEqual([
      {
        source: {
          type: "PostgreSQL",
          engine: "postgresql",
          server: "pg01",
          database: "analytics",
          location: null,
        },
        readerCount: 2,
        tables: expect.arrayContaining([
          expect.objectContaining({ table: "orders" }),
          expect.objectContaining({ table: "refunds" }),
        ]),
      },
    ]);
  });
});

describe("whether OneUptime watches a source", () => {
  test("the same engine and database; a server narrows between several", () => {
    expect(findBiSourceStore(SQL01_SALES, catalog().stores)?.dataStoreId).toBe(
      "store-sales",
    );
    expect(
      findBiSourceStore(
        getBiDatabaseSource("sqlserver", "sql01", "Archive"),
        catalog().stores,
      ),
    ).toBeNull();
    expect(
      findBiSourceStore(
        getBiDatabaseSource("postgresql", "sql01", "Sales"),
        catalog().stores,
      ),
    ).toBeNull();
    expect(findBiSourceStore(SHAREPOINT, catalog().stores)).toBeNull();
    expect(
      findBiSourceStore(getBiDatabaseSource("sqlserver", "sql02", "Sales"), [
        ...catalog().stores,
        {
          dataStoreId: "store-sales-2",
          kind: DataStoreKind.SqlServer,
          databaseName: "Sales",
          serverAddress: "sql02.corp.acme.com",
        },
      ])?.dataStoreId,
    ).toBe("store-sales-2");
  });
});

describe("how to connect a database OneUptime does not watch", () => {
  test("its kind, and a connection string to start from, user and password left to fill in", () => {
    expect(
      getConnectHint(
        getBiDatabaseSource(
          "sqlserver",
          "tcp:sql01.corp.acme.com,1433",
          "Facilities",
        ),
      ),
    ).toEqual({
      connectKind: DataStoreKind.SqlServer,
      connectionExample:
        "mssql://USER:PASSWORD@sql01.corp.acme.com:1433/Facilities",
    });
    expect(
      getConnectHint(
        getBiDatabaseSource("postgresql", "pg.acme.com:6543", "shop"),
      ),
    ).toEqual({
      connectKind: DataStoreKind.PostgreSql,
      connectionExample:
        "postgres://USER:PASSWORD@pg.acme.com:6543/shop?sslmode=require",
    });
    // A warehouse connects by its own form, from its kind.
    expect(
      getConnectHint(
        getBiDatabaseSource("snowflake", "acme.snowflakecomputing.com", null),
      ),
    ).toEqual({
      connectKind: DataStoreKind.Snowflake,
      connectionExample: null,
    });
    expect(getConnectHint(SHAREPOINT)).toEqual({
      connectKind: null,
      connectionExample: null,
    });
    expect(
      getConnectHint(getBiDatabaseSource("teradata", "td01", null)),
    ).toEqual({
      connectKind: null,
      connectionExample: null,
    });
  });

  test("a database not connected says so in the summary; a watched one does not", () => {
    const summary: DataBiLineageSummary = summarizeBiLineage({
      dashboards: [{ tables: [] }],
      catalog: catalog(),
      sources: collectBiSources([
        {
          sources: [getBiDatabaseSource("sqlserver", "sql03", "Billing")],
          tables: [],
        },
        { sources: [SQL01_SALES], tables: [] },
      ]),
    });

    // As many readers each, so by name.
    expect(summary.sources).toEqual([
      expect.objectContaining({
        database: "Sales",
        dataStoreId: "store-sales",
        connectKind: null,
        connectionExample: null,
      }),
      expect.objectContaining({
        database: "Billing",
        dataStoreId: null,
        connectKind: DataStoreKind.SqlServer,
        connectionExample: "mssql://USER:PASSWORD@sql03:1433/Billing",
      }),
    ]);
    expect(summary.problems).toEqual([
      DataBiLineageProblem.DatabasesNotConnected,
    ]);
  });
});

describe("what keeps dashboards off their tables", () => {
  function problems(
    data: Partial<Parameters<typeof getBiLineageProblems>[0]>,
  ): Array<DataBiLineageProblem> {
    return getBiLineageProblems({
      dashboardCount: 10,
      storeCount: 1,
      datasets: null,
      sources: [],
      unwatchedTableCount: 0,
      ...data,
    });
  }

  function source(
    data: Partial<DataBiLineageSource> = {},
  ): DataBiLineageSource {
    return {
      ...SQL01_SALES,
      readerCount: 1,
      tableCount: 1,
      matchedTableCount: 0,
      dataStoreId: null,
      ...data,
    };
  }

  test("no database connected at all, first", () => {
    expect(problems({ storeCount: 0, sources: [source()] })).toEqual([
      DataBiLineageProblem.NoDatabases,
    ]);
  });

  test("Power BI sent no tables: its detailed metadata setting", () => {
    expect(
      problems({
        datasets: { ...FACTS, withTables: 0, withQueries: 0 },
        sources: [source()],
      }),
    ).toEqual([
      DataBiLineageProblem.NoTablesFromTool,
      DataBiLineageProblem.DatabasesNotConnected,
    ]);
  });

  test("Power BI sent tables but not their queries: its DAX and mashup expressions setting", () => {
    expect(problems({ datasets: { ...FACTS, withQueries: 0 } })).toEqual([
      DataBiLineageProblem.NoQueriesFromTool,
    ]);
  });

  test("datasets Power BI cannot describe are no setting's fault", () => {
    expect(
      problems({
        datasets: {
          ...FACTS,
          count: 2,
          withTables: 0,
          withQueries: 0,
          withSchemaError: 2,
          schemaError:
            "Unsupported request. RealTime dataset are not supported",
        },
      }),
    ).toEqual([DataBiLineageProblem.SchemaErrors]);
  });

  test("unwatched tables, dataflows and files, in that order", () => {
    expect(
      problems({
        datasets: {
          ...FACTS,
          readingDataflows: 1,
          withUnreadDataflows: 1,
          dataflowError: "Power BI answered 403: Forbidden",
          withPendingDataflows: 0,
        },
        unwatchedTableCount: 2,
        sources: [
          source({ dataStoreId: "store-sales" }),
          { ...source(), ...SHAREPOINT },
          {
            ...source(),
            type: "Dataflow",
            engine: null,
            server: null,
            database: null,
            location: "Azure SQL",
          },
        ],
      }),
    ).toEqual([
      DataBiLineageProblem.TablesNotWatched,
      DataBiLineageProblem.Dataflows,
      DataBiLineageProblem.NotDatabases,
    ]);
  });

  /*
   * Datasets built on dataflows are read through the dataflows' own
   * definitions now (#9551): reading one is no problem in itself, only a
   * dataflow whose definition Power BI would not give, or one still being
   * read within its hourly limit.
   */
  test("dataflows OneUptime read through are no problem; one it could not read, or is still reading, is", () => {
    const readThrough: DataBiDatasetFacts = {
      ...FACTS,
      readingDataflows: 3,
      withUnreadDataflows: 0,
      dataflowError: null,
      withPendingDataflows: 0,
    };

    expect(problems({ datasets: readThrough })).toEqual([]);
    expect(
      problems({ datasets: { ...readThrough, withPendingDataflows: 2 } }),
    ).toEqual([DataBiLineageProblem.Dataflows]);
    expect(
      problems({
        datasets: {
          ...readThrough,
          withUnreadDataflows: 1,
          dataflowError: "Power BI answered 404: Dataflow not found",
        },
      }),
    ).toEqual([DataBiLineageProblem.Dataflows]);
  });

  test("no dashboard, nothing to say", () => {
    expect(problems({ dashboardCount: 0, storeCount: 0 })).toEqual([]);
  });
});

describe("a tool's summary", () => {
  test("tables matched, sources with the watched database each is, tables not watched, and why", () => {
    const summary: DataBiLineageSummary = summarizeBiLineage({
      dashboards: [
        { tables: [sqlTable("Orders"), sqlTable("Customers")] },
        { tables: [sqlTable("Orders")] },
        { tables: [] },
      ],
      catalog: catalog(),
      sources: collectBiSources([
        {
          sources: [SQL01_SALES],
          tables: [sqlTable("Orders"), sqlTable("Customers")],
        },
        { sources: [SHAREPOINT], tables: [] },
      ]),
      datasets: { ...FACTS, count: 2, withTables: 1, withQueries: 1 },
    });

    expect(summary).toEqual({
      dashboardCount: 3,
      dashboardsOnWatchedTables: 2,
      tableCount: 2,
      matchedTableCount: 1,
      datasets: { ...FACTS, count: 2, withTables: 1, withQueries: 1 },
      sources: [
        {
          ...SQL01_SALES,
          readerCount: 1,
          tableCount: 2,
          matchedTableCount: 1,
          dataStoreId: "store-sales",
          connectKind: null,
          connectionExample: null,
        },
        {
          ...SHAREPOINT,
          readerCount: 1,
          tableCount: 0,
          matchedTableCount: 0,
          dataStoreId: null,
          // No database: nothing to connect.
          connectKind: null,
          connectionExample: null,
        },
      ],
      moreSourceCount: 0,
      unwatchedTables: ["Sales.dbo.Customers"],
      unknownEntitySets: [],
      problems: [
        DataBiLineageProblem.TablesNotWatched,
        DataBiLineageProblem.NotDatabases,
      ],
    });
    // The database's name is Data Security's record, which not everyone who reads the tool may read.
    expect(JSON.stringify(summary)).not.toContain("Sales DB");
    // Kept as JSON and read back as it was.
    expect(
      readDataBiLineageSummary(JSON.parse(JSON.stringify(summary))),
    ).toEqual(summary);
  });

  /*
   * A report on Dataverse's OData connectors names its tables by entity set
   * (#9696). In an environment whose tables keep no entity set name yet -
   * an older probe collects it, or it has not been collected since the
   * names were kept - they are told apart from tables the environment does
   * not watch, so See Why says to update the probe, not to watch them.
   */
  test("Dataverse tables named by an entity set no collection kept yet: their own reason, not tables not watched", () => {
    const tables: Array<BiTableRef> = readPowerQueryTables(
      'let Source = Cds.Entities("https://contoso.crm.dynamics.com/", [ReorderColumns=null, UseFormattedValue=null]), entities = Source{[Group="entities"]}[Data], accounts = entities{[EntitySetName="accounts"]}[Data], contacts = entities{[EntitySetName="contacts"]}[Data] in Table.Combine({accounts, contacts})',
    );
    const contoso: ProjectCatalog = catalog({
      stores: [
        {
          dataStoreId: "store-contoso",
          kind: DataStoreKind.Dataverse,
          databaseName: "contoso",
          serverAddress: "contoso.crm.dynamics.com",
        },
      ],
      assets: [
        {
          dataAssetId: "contoso-account",
          dataStoreId: "store-contoso",
          schemaName: "dbo",
          name: "account",
        },
        {
          dataAssetId: "contoso-contact",
          dataStoreId: "store-contoso",
          schemaName: "dbo",
          name: "contact",
        },
      ],
    });
    const waiting: DataBiLineageSummary = summarizeBiLineage({
      dashboards: [{ tables }],
      catalog: contoso,
    });

    expect(waiting).toMatchObject({
      tableCount: 2,
      matchedTableCount: 0,
      unwatchedTables: [],
      unknownEntitySets: ["accounts", "contacts"],
      problems: [DataBiLineageProblem.EntitySetsUnknown],
    });

    // Once a collection keeps the names: matched, and nothing to say.
    const named: DataBiLineageSummary = summarizeBiLineage({
      dashboards: [{ tables }],
      catalog: catalog({
        ...contoso,
        assets: contoso.assets.map((asset: UsageAsset): UsageAsset => {
          return { ...asset, entitySetName: `${asset.name}s` };
        }),
      }),
    });

    expect(named).toMatchObject({
      matchedTableCount: 2,
      unknownEntitySets: [],
      problems: [],
    });

    // An environment that keeps them, but not this one's: a table it does not watch.
    const unwatched: DataBiLineageSummary = summarizeBiLineage({
      dashboards: [{ tables }],
      catalog: catalog({
        ...contoso,
        assets: [{ ...contoso.assets[0]!, entitySetName: "accounts" }],
      }),
    });

    expect(unwatched).toMatchObject({
      matchedTableCount: 1,
      unwatchedTables: ["contacts"],
      unknownEntitySets: [],
      problems: [DataBiLineageProblem.TablesNotWatched],
    });
  });

  test("a summary kept before entity sets were told apart reads without them, and one with them reads them back", () => {
    const before: JSONObject = {
      dashboardCount: 1,
      unwatchedTables: ["accounts"],
      problems: [DataBiLineageProblem.TablesNotWatched],
    };

    expect(readDataBiLineageSummary(before)).not.toHaveProperty(
      "unknownEntitySets",
    );
    expect(
      readDataBiLineageSummary({
        ...before,
        unknownEntitySets: ["accounts", 7, ""],
        problems: [DataBiLineageProblem.EntitySetsUnknown],
      }),
    ).toMatchObject({
      unknownEntitySets: ["accounts"],
      problems: [DataBiLineageProblem.EntitySetsUnknown],
    });
  });

  test("the issue's case: hundreds of reports on datasets Power BI described without tables", () => {
    const summary: DataBiLineageSummary = summarizeBiLineage({
      dashboards: Array.from({ length: 783 }, () => {
        return { tables: [] };
      }),
      catalog: catalog({ stores: [], assets: [] }),
      sources: collectBiSources([
        { sources: [SQL01_SALES], tables: [] },
        { sources: [SHAREPOINT], tables: [] },
        { sources: [SHAREPOINT], tables: [] },
      ]),
      datasets: {
        count: 59,
        withTables: 0,
        withQueries: 0,
        withSchemaError: 0,
        schemaError: null,
        readingDataflows: 0,
      },
    });

    expect(summary).toMatchObject({
      dashboardCount: 783,
      dashboardsOnWatchedTables: 0,
      tableCount: 0,
      matchedTableCount: 0,
      problems: [
        DataBiLineageProblem.NoDatabases,
        DataBiLineageProblem.NoTablesFromTool,
        DataBiLineageProblem.NotDatabases,
      ],
    });
    // Most read first.
    expect(
      summary.sources.map((source: DataBiLineageSource): string => {
        return `${source.type} (${source.readerCount})`;
      }),
    ).toEqual(["SharePoint (2)", "SQL Server (1)"]);
  });

  test("a tool with no datasets: its tables' databases, counted by dashboard", () => {
    const summary: DataBiLineageSummary = summarizeBiLineage({
      dashboards: [
        {
          tables: [
            {
              database: "Sales",
              schema: "dbo",
              table: "Orders",
              engine: "sqlserver",
              host: "sql01",
            },
          ],
        },
      ],
      catalog: catalog(),
    });

    expect(summary).toMatchObject({
      datasets: null,
      matchedTableCount: 1,
      dashboardsOnWatchedTables: 1,
      sources: [
        {
          type: "SQL Server",
          readerCount: 1,
          tableCount: 1,
          matchedTableCount: 1,
          dataStoreId: "store-sales",
        },
      ],
      problems: [],
    });
  });

  test("a summary kept is read strictly: anything that does not fit is left out", () => {
    expect(readDataBiLineageSummary("nope")).toBeNull();
    expect(
      readDataBiLineageSummary({
        dashboardCount: -3,
        sources: [{ type: "" }, { type: "SQL Server", readerCount: "2" }],
        problems: ["NoTablesFromTool", "Gone"],
        unwatchedTables: ["a.b.c", 4],
      }),
    ).toEqual({
      dashboardCount: 0,
      dashboardsOnWatchedTables: 0,
      tableCount: 0,
      matchedTableCount: 0,
      datasets: null,
      sources: [
        {
          type: "SQL Server",
          engine: null,
          server: null,
          database: null,
          location: null,
          readerCount: 0,
          tableCount: 0,
          matchedTableCount: 0,
          dataStoreId: null,
          connectKind: null,
          connectionExample: null,
        },
      ],
      moreSourceCount: 0,
      unwatchedTables: ["a.b.c"],
      problems: [DataBiLineageProblem.NoTablesFromTool],
    });
    expect(
      readDataDashboardUpstream({
        datasets: [
          { name: "Sales", id: "ABC", sources: [SHAREPOINT, { type: "" }] },
          { workspace: "x" },
        ],
        sources: [SHAREPOINT, { location: "no type" }],
      }),
    ).toEqual({
      datasets: [
        { id: "abc", name: "Sales", workspace: null, sources: [SHAREPOINT] },
      ],
      sources: [SHAREPOINT],
    });
  });
});

describe("the read keeps the summary on the tool, and what each dashboard is built on", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a Power BI read writes Table Matching on the tool and Built On on each dashboard", async () => {
    const connection: DataBiConnection = new DataBiConnection();

    connection._id = ObjectID.generate().toString();
    connection.projectId = ObjectID.generate();
    connection.tool = DataBiTool.PowerBI;
    connection.credentials = JSON.stringify({
      tenantId: "t",
      clientId: "c",
      clientSecret: "s3cr3t",
    });

    const report: BiDashboardRead = {
      externalId: "r1",
      name: "Revenue",
      url: "https://app.powerbi.com/groups/w1/reports/r1",
      folder: "Finance",
      owner: null,
      changedAt: null,
      tables: [sqlTable("Orders")],
      upstream: {
        datasets: [
          {
            id: "ds1",
            name: "Sales Model",
            workspace: "Finance",
            sources: [SQL01_SALES],
          },
        ],
        sources: [SQL01_SALES],
      },
    };
    const read: BiToolRead = {
      dashboards: [report],
      usage: null,
      warnings: [],
      datasets: [],
      datasetFacts: { ...FACTS, count: 1, withTables: 1, withQueries: 1 },
      sources: collectBiSources([
        { sources: [SQL01_SALES], tables: [sqlTable("Orders")] },
      ]),
    };

    jest
      .spyOn(DataBiConnectionService, "findOneById")
      .mockResolvedValue(connection);
    const updateTool: jest.SpyInstance = jest
      .spyOn(DataBiConnectionService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    jest.spyOn(PowerBiConnector, "read").mockResolvedValue(read);
    jest.spyOn(OpenLineageIngest, "readCatalog").mockResolvedValue(catalog());
    jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([]);
    const create: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "create")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

    const result: { matchedTableCount: number; error: string | null } =
      await DataBiSync.syncConnection(connection.id!);

    expect(result).toMatchObject({ matchedTableCount: 1, error: null });

    const created: DataDashboard = create.mock.calls[0]![0]
      .data as DataDashboard;

    expect(readDataDashboardUpstream(created.upstream)).toEqual({
      datasets: [
        {
          id: "ds1",
          name: "Sales Model",
          workspace: "Finance",
          sources: [SQL01_SALES],
        },
      ],
      sources: [SQL01_SALES],
    });

    const written: JSONObject = updateTool.mock.calls[0]![0]
      .data as unknown as JSONObject;

    expect(readDataBiLineageSummary(written["lineageSummary"])).toMatchObject({
      dashboardCount: 1,
      dashboardsOnWatchedTables: 1,
      tableCount: 1,
      matchedTableCount: 1,
      sources: [
        expect.objectContaining({
          type: "SQL Server",
          dataStoreId: "store-sales",
        }),
      ],
      problems: [],
    });
    expect(JSON.stringify(written["lineageSummary"])).not.toContain("Sales DB");
  });

  test("a known dashboard is updated with what it is built on; a tool that says nothing leaves it as it was", async () => {
    const connection: DataBiConnection = new DataBiConnection();
    const known: DataDashboard = new DataDashboard();

    connection._id = ObjectID.generate().toString();
    connection.projectId = ObjectID.generate();
    known._id = ObjectID.generate().toString();
    known.externalId = "42";

    jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([known]);
    const update: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

    const base: BiDashboardRead = {
      externalId: "42",
      name: "Revenue",
      url: null,
      folder: null,
      owner: null,
      changedAt: null,
      tables: [],
    };

    await DataBiSync.keep({
      connection,
      tool: DataBiTool.PowerBI,
      read: [{ ...base, upstream: { datasets: [], sources: [SHAREPOINT] } }],
      catalog: catalog(),
    });
    await DataBiSync.keep({
      connection,
      tool: DataBiTool.Metabase,
      read: [base],
      catalog: catalog(),
    });

    expect(
      (update.mock.calls[0]![0].data as unknown as JSONObject)["upstream"],
    ).toEqual({ datasets: [], sources: [SHAREPOINT] });
    expect(
      "upstream" in (update.mock.calls[1]![0].data as unknown as JSONObject),
    ).toBe(false);
  });
});
