import { describe, expect, test } from "@jest/globals";
import {
  BiCatalog,
  isSameBiHost,
  matchBiTable,
  matchBiTables,
  readBiEngine,
  readBiHost,
} from "../../../../Server/Utils/DataObservability/Bi/BiMatching";
import { BiTableRef } from "../../../../Server/Utils/DataObservability/Bi/BiTables";
import { readPowerQueryTables } from "../../../../Server/Utils/DataObservability/Bi/PowerQuery";
import { UsageAsset } from "../../../../Server/Utils/DataObservability/TableUsageMatching";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * Which watched table a BI tool's table is (#9507): never another engine's,
 * never another database's where the tool names the database as its server
 * does, a server matched by its short name or its full one, and the
 * engine's default schema where a query names none - each table matched
 * once per catalog, however many dashboards read it.
 */

function ref(data: Partial<BiTableRef> & { table: string }): BiTableRef {
  return {
    database: null,
    schema: null,
    engine: null,
    host: null,
    ...data,
  };
}

const CATALOG: BiCatalog = {
  stores: [
    {
      dataStoreId: "sales",
      kind: DataStoreKind.SqlServer,
      databaseName: "Sales",
      serverAddress: "sql01",
    },
    {
      dataStoreId: "archive",
      kind: DataStoreKind.SqlServer,
      databaseName: "Archive",
      serverAddress: "sql02.corp.acme.com",
    },
    {
      dataStoreId: "pg",
      kind: DataStoreKind.PostgreSql,
      databaseName: "shop",
      serverAddress: "pg.acme.com",
    },
    {
      dataStoreId: "snow",
      kind: DataStoreKind.Snowflake,
      databaseName: "ANALYTICS",
      serverAddress: "acme.snowflakecomputing.com",
    },
    {
      dataStoreId: "rs",
      kind: DataStoreKind.AwsRedshiftCluster,
      databaseName: "dev",
      serverAddress: "acme.redshift.amazonaws.com",
    },
    {
      dataStoreId: "unnamed",
      kind: DataStoreKind.SqlServer,
      databaseName: null,
      serverAddress: null,
    },
  ],
  assets: [
    {
      dataAssetId: "archive-orders",
      dataStoreId: "archive",
      schemaName: "dbo",
      name: "Orders",
    },
    {
      dataAssetId: "sales-customers",
      dataStoreId: "sales",
      schemaName: "dbo",
      name: "Customers",
    },
    {
      dataAssetId: "sales-audit-customers",
      dataStoreId: "sales",
      schemaName: "audit",
      name: "Customers",
    },
    {
      dataAssetId: "pg-orders",
      dataStoreId: "pg",
      schemaName: "public",
      name: "orders",
    },
    {
      dataAssetId: "snow-orders",
      dataStoreId: "snow",
      schemaName: "PUBLIC",
      name: "ORDERS",
    },
    {
      dataAssetId: "rs-events",
      dataStoreId: "rs",
      schemaName: "public",
      name: "events",
    },
    {
      dataAssetId: "unnamed-invoices",
      dataStoreId: "unnamed",
      schemaName: "dbo",
      name: "Invoices",
    },
  ],
};

function matched(
  table: BiTableRef,
  catalog: BiCatalog = CATALOG,
): string | null {
  return matchBiTable(table, catalog)?.dataAssetId || null;
}

describe("a server, as one name", () => {
  test("without its scheme, protocol, instance, port or path", () => {
    expect(readBiHost("tcp:SQL01.corp.acme.com,1433")).toBe(
      "sql01.corp.acme.com",
    );
    expect(readBiHost("sql01\\FINANCE")).toBe("sql01");
    expect(readBiHost("pg.acme.com:5432")).toBe("pg.acme.com");
    expect(readBiHost("ora01:1521/FIN")).toBe("ora01");
    expect(readBiHost("https://acme.crm.dynamics.com/")).toBe(
      "acme.crm.dynamics.com",
    );
    expect(readBiHost("acme.snowflakecomputing.com;WH")).toBe(
      "acme.snowflakecomputing.com",
    );
  });

  test("a short name is its full one; an address is only itself", () => {
    expect(isSameBiHost("sql01", "SQL01.corp.acme.com")).toBe(true);
    expect(isSameBiHost("tcp:sql01,1433", "sql01")).toBe(true);
    expect(isSameBiHost("sql01.corp.acme.com", "sql01.other.acme.com")).toBe(
      false,
    );
    expect(isSameBiHost("10.0.0.5", "10.0.0.6")).toBe(false);
    expect(isSameBiHost("10", "10.0.0.6")).toBe(false);
    expect(isSameBiHost(null, "sql01")).toBe(false);
  });

  test("an engine as each tool names it", () => {
    expect(readBiEngine("postgres")).toBe("postgresql");
    expect(readBiEngine("MSSQL")).toBe("sqlserver");
    expect(readBiEngine("bigquery-cloud-sdk")).toBe("bigquery");
    expect(readBiEngine("awsathena")).toBe("athena");
    expect(readBiEngine("h2")).toBeNull();
    expect(readBiEngine(null)).toBeNull();
  });
});

describe("what rules a watched table out", () => {
  test("another database, where the tool names it as its server does", () => {
    // A Power BI report on Sales.dbo.Orders, where only Archive.dbo.Orders is watched (regression: it matched Archive's).
    const [orders] = readPowerQueryTables(
      'let Source = Sql.Database("sql01", "Sales"), T = Source{[Schema="dbo",Item="Orders"]}[Data] in T',
    );

    expect(orders!.isDatabaseExact).toBe(true);
    expect(matched(orders!)).toBeNull();
    // The same report on Archive matches it.
    expect(
      matched(
        readPowerQueryTables(
          'let Source = Sql.Database("sql02", "Archive"), T = Source{[Schema="dbo",Item="Orders"]}[Data] in T',
        )[0]!,
      ),
    ).toBe("archive-orders");
  });

  test("a database a tool's connection only labels still narrows, and rules nothing out", () => {
    expect(
      matched(
        ref({
          database: "Production",
          schema: "dbo",
          table: "Orders",
          engine: "sqlserver",
        }),
      ),
    ).toBe("archive-orders");
  });

  test("a watched database whose name is not known is not ruled out", () => {
    expect(
      matched(
        ref({
          database: "Billing",
          schema: "dbo",
          table: "Invoices",
          engine: "sqlserver",
          isDatabaseExact: true,
        }),
      ),
    ).toBe("unnamed-invoices");
  });

  test("another engine: Snowflake's ORDERS is not PostgreSQL's orders", () => {
    expect(
      matched(ref({ schema: "public", table: "orders", engine: "snowflake" })),
    ).toBe("snow-orders");
    expect(
      matched(ref({ schema: "public", table: "orders", engine: "postgres" })),
    ).toBe("pg-orders");
    // An engine nobody watches matches nothing; one OneUptime does not know rules nothing out.
    expect(
      matched(ref({ schema: "public", table: "events", engine: "mysql" })),
    ).toBeNull();
    expect(
      matched(ref({ schema: "public", table: "events", engine: "h2" })),
    ).toBe("rs-events");
  });

  test("Redshift read through PostgreSQL's connector is still Redshift", () => {
    expect(
      matched(
        readPowerQueryTables(
          'let Source = PostgreSQL.Database("acme.redshift.amazonaws.com:5439", "dev"), T = Source{[Schema="public",Item="events"]}[Data] in T',
        )[0]!,
      ),
    ).toBe("rs-events");
  });
});

describe("what narrows the rest", () => {
  test("the server, by its short name or its full one", () => {
    const catalog: BiCatalog = {
      stores: [
        {
          dataStoreId: "east",
          kind: DataStoreKind.SqlServer,
          databaseName: "Sales",
          serverAddress: "sql-east.corp.acme.com",
        },
        {
          dataStoreId: "west",
          kind: DataStoreKind.SqlServer,
          databaseName: "Sales",
          serverAddress: "sql-west.corp.acme.com",
        },
      ],
      assets: [
        {
          dataAssetId: "east-orders",
          dataStoreId: "east",
          schemaName: "dbo",
          name: "Orders",
        },
        {
          dataAssetId: "west-orders",
          dataStoreId: "west",
          schemaName: "dbo",
          name: "Orders",
        },
      ],
    };

    expect(
      matched(
        readPowerQueryTables(
          'let Source = Sql.Database("tcp:sql-west,1433", "Sales"), T = Source{[Schema="dbo",Item="Orders"]}[Data] in T',
        )[0]!,
        catalog,
      ),
    ).toBe("west-orders");
  });

  test("a query that names no schema reads the engine's default one", () => {
    // SELECT * FROM Customers in Sales reads dbo.Customers, not audit.Customers.
    expect(
      matched(
        readPowerQueryTables(
          'let Source = Sql.Database("sql01", "Sales", [Query="SELECT * FROM Customers"]) in Source',
        )[0]!,
      ),
    ).toBe("sales-customers");
  });

  test("a name that still fits two tables matches neither", () => {
    expect(matched(ref({ table: "Customers" }))).toBeNull();
  });
});

/*
 * Power BI's OData connectors to Dataverse name a table by its entity set
 * (#9554). It is the watched table whose logical name the environment
 * itself gives that entity set - in the environment at the host the
 * connector named - and nothing when no such name is known: an entity
 * set's name is never read as a table's.
 */
describe("a Dataverse table named by its entity set", () => {
  const DATAVERSE: BiCatalog = {
    stores: [
      {
        dataStoreId: "contoso",
        kind: DataStoreKind.Dataverse,
        databaseName: "contoso",
        serverAddress: "contoso.crm.dynamics.com",
      },
      {
        dataStoreId: "contoso-dev",
        kind: DataStoreKind.Dataverse,
        databaseName: "contoso-dev",
        serverAddress: "contoso-dev.crm.dynamics.com",
      },
      {
        dataStoreId: "sql",
        kind: DataStoreKind.SqlServer,
        databaseName: "Sales",
        serverAddress: "sql01",
      },
    ],
    assets: [
      {
        dataAssetId: "contoso-account",
        dataStoreId: "contoso",
        schemaName: "dbo",
        name: "account",
      },
      {
        dataAssetId: "contoso-opportunity",
        dataStoreId: "contoso",
        schemaName: "dbo",
        name: "opportunity",
      },
      {
        dataAssetId: "dev-account",
        dataStoreId: "contoso-dev",
        schemaName: "dbo",
        name: "account",
      },
      // A SQL Server table spelled as an entity set: never an entity set's table.
      {
        dataAssetId: "sql-accounts",
        dataStoreId: "sql",
        schemaName: "dbo",
        name: "accounts",
      },
    ],
    dataverseEntitySets: new Map([
      [
        "contoso",
        new Map([
          ["accounts", "account"],
          ["opportunities", "opportunity"],
          // An entity set a maker renamed: its name is not its table's plural.
          ["deals", "cr123_deal"],
        ]),
      ],
      ["contoso-dev", new Map([["accounts", "account"]])],
    ]),
  };

  function entitySet(table: string, host: string | null): BiTableRef {
    return ref({ table, engine: "dataverse", host, isEntitySet: true });
  }

  test("is the table whose logical name the environment gives it, at the connector's host", () => {
    expect(
      matchBiTable(entitySet("accounts", "contoso.crm.dynamics.com"), DATAVERSE)
        ?.dataAssetId,
    ).toBe("contoso-account");
    expect(
      matchBiTable(
        entitySet("Opportunities", "contoso.crm.dynamics.com"),
        DATAVERSE,
      )?.dataAssetId,
    ).toBe("contoso-opportunity");
  });

  test("two environments with the same entity set: each its own table", () => {
    expect(
      matchBiTable(
        entitySet("accounts", "contoso-dev.crm.dynamics.com"),
        DATAVERSE,
      )?.dataAssetId,
    ).toBe("dev-account");
  });

  test("another environment, an unknown host, a table not watched or no names known: no table", () => {
    expect(
      matchBiTable(
        entitySet("accounts", "fabrikam.crm.dynamics.com"),
        DATAVERSE,
      ),
    ).toBeNull();
    expect(matchBiTable(entitySet("accounts", null), DATAVERSE)).toBeNull();
    // The environment names the entity set, but OneUptime does not watch its table.
    expect(
      matchBiTable(entitySet("deals", "contoso.crm.dynamics.com"), DATAVERSE),
    ).toBeNull();
    // An entity set the environment never named is not guessed from its letters.
    expect(
      matchBiTable(
        entitySet("contacts", "contoso.crm.dynamics.com"),
        DATAVERSE,
      ),
    ).toBeNull();
    expect(
      matchBiTable(entitySet("accounts", "contoso.crm.dynamics.com"), {
        stores: DATAVERSE.stores,
        assets: DATAVERSE.assets,
      }),
    ).toBeNull();
  });

  test("Power BI's own M, read and matched end to end", () => {
    const tables: Array<BiTableRef> = readPowerQueryTables(
      'let Source = Cds.Entities("https://contoso.crm.dynamics.com/", [ReorderColumns=null, UseFormattedValue=null]), entities = Source{[Group="entities"]}[Data], accounts = entities{[EntitySetName="accounts"]}[Data] in accounts',
    );

    expect(
      matchBiTables(tables, DATAVERSE).map((asset: UsageAsset): string => {
        return asset.dataAssetId;
      }),
    ).toEqual(["contoso-account"]);
  });

  test("a table named by its logical name still matches as before", () => {
    expect(
      matchBiTable(
        ref({
          schema: "dbo",
          table: "account",
          engine: "dataverse",
          host: "contoso.crm.dynamics.com",
        }),
        DATAVERSE,
      )?.dataAssetId,
    ).toBe("contoso-account");
  });
});

describe("matching many", () => {
  test("each watched table once, however many dashboards read it", () => {
    const refs: Array<BiTableRef> = [
      ref({ schema: "public", table: "orders", engine: "postgresql" }),
      ref({ schema: "PUBLIC", table: "orders", engine: "postgresql" }),
      ref({ schema: "dbo", table: "Nowhere" }),
    ];

    expect(
      matchBiTables(refs, CATALOG).map((asset: UsageAsset): string => {
        return asset.dataAssetId;
      }),
    ).toEqual(["pg-orders"]);
  });

  test("a large catalog is indexed once: thousands of tables against tens of thousands, quickly", () => {
    const assets: Array<UsageAsset> = [];

    for (let index: number = 0; index < 50_000; index++) {
      assets.push({
        dataAssetId: `a${index}`,
        dataStoreId: "sales",
        schemaName: "dbo",
        name: `table_${index}`,
      });
    }

    const refs: Array<BiTableRef> = [];

    for (let index: number = 0; index < 20_000; index++) {
      refs.push(
        ref({
          database: "Sales",
          schema: "dbo",
          table: `table_${index % 5_000}`,
          engine: "sqlserver",
          isDatabaseExact: true,
        }),
      );
    }

    const timed: FastestRun<Array<UsageAsset>> = fastestRun({
      run: (): Array<UsageAsset> => {
        /*
         * A new catalog each attempt: matchBiTables keeps a catalog's index
         * and its matches by the catalog itself, so the same one would be
         * indexed and matched only once.
         */
        const catalog: BiCatalog = { stores: CATALOG.stores, assets };

        return matchBiTables(refs, catalog);
      },
      limitInMs: 5_000,
    });

    expect(timed.result.length).toBe(5_000);
    expect(timed.inMs).toBeLessThan(5_000);
  });
});
