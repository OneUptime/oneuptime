import { describe, expect, test } from "@jest/globals";
import {
  BiTableRef,
  getBiTableKey,
  getBiTableName,
  readQualifiedName,
  readSqlTables,
} from "../../../../Server/Utils/DataObservability/Bi/BiTables";
import {
  readPowerQuery,
  readPowerQueryDataset,
  readPowerQueryParameter,
  readPowerQueryReferences,
  readPowerQueryTables,
  tokenizePowerQuery,
} from "../../../../Server/Utils/DataObservability/Bi/PowerQuery";

/*
 * The tables a Power BI dataset's Power Query (M) reads, as Power BI's
 * workspace scan returns its expressions (#9507): every connector Power BI
 * Desktop writes, navigation with and without Kind, SQL in a connector's
 * Query option and in Value.NativeQuery, parameters, and the shared
 * queries a table reads from - Microsoft's own scan sample reads its table
 * that way, and was read as reading nothing.
 */

function names(refs: Array<BiTableRef>): Array<string> {
  return refs.map(getBiTableName);
}

describe("reading SQL a query hands its database", () => {
  test("an old-style join's tables, after the commas, with their aliases", () => {
    expect(
      names(
        readSqlTables(
          "SELECT * FROM dbo.Orders o, dbo.Customers AS c, dbo.Refunds WHERE o.id = c.id GROUP BY a, b ORDER BY a, b",
        ),
      ),
    ).toEqual(["dbo.Orders", "dbo.Customers", "dbo.Refunds"]);
  });

  test("a list ends where the next clause starts, and a lateral join is no table", () => {
    expect(
      names(
        readSqlTables(
          "SELECT * FROM orders o, LATERAL FLATTEN(o.items) WHERE x IN (1, 2)",
        ),
      ),
    ).toEqual(["orders"]);
  });

  test("a linked server's four-part name keeps its database, schema and table", () => {
    expect(readQualifiedName("[LINKED].[Sales].[dbo].[Orders]")).toMatchObject({
      database: "Sales",
      schema: "dbo",
      table: "Orders",
      isDatabaseExact: true,
    });
  });

  test("a database the query names is exact; one a tool's connection labels is not", () => {
    expect(
      readQualifiedName("Sales.dbo.Orders", { database: "Production" })
        ?.isDatabaseExact,
    ).toBe(true);
    expect(
      readQualifiedName("dbo.Orders", { database: "Production" })
        ?.isDatabaseExact,
    ).toBeUndefined();
    expect(
      readQualifiedName("dbo.Orders", {
        database: "Sales",
        isDatabaseExact: true,
      })?.isDatabaseExact,
    ).toBe(true);
  });
});

describe("reading M's words", () => {
  test("strings with doubled quotes and escapes, quoted names, comments", () => {
    expect(
      tokenizePowerQuery(
        'let // a comment\n #"Changed Type" = "say ""hi""#(cr,lf)#(tab)x#(0041)" /* block */ in #"Changed Type"',
      ).map((token: { kind: string; value: string }): string => {
        return `${token.kind}:${token.value}`;
      }),
    ).toEqual([
      "name:let",
      "name:Changed Type",
      "punct:=",
      'string:say "hi"\r\n\txA',
      "name:in",
      "name:Changed Type",
    ]);
  });

  test("a URL in a string is no comment", () => {
    expect(
      tokenizePowerQuery('Web.Contents("https://acme.sharepoint.com/x")')[2],
    ).toEqual({ kind: "string", value: "https://acme.sharepoint.com/x" });
  });

  test("a text parameter's value; anything else is no parameter", () => {
    expect(
      readPowerQueryParameter(
        '"sql01.acme.com" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
      ),
    ).toBe("sql01.acme.com");
    expect(
      readPowerQueryParameter(
        '"revenues param value" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
      ),
    ).toBe("revenues param value");
    expect(
      readPowerQueryParameter('"x" meta [IsParameterQuery=false]'),
    ).toBeNull();
    expect(
      readPowerQueryParameter("42 meta [IsParameterQuery=true]"),
    ).toBeNull();
    expect(
      readPowerQueryParameter('let Source = Sql.Database("a", "b") in Source'),
    ).toBeNull();
  });

  test("the names an expression uses that it does not define", () => {
    expect(
      readPowerQueryReferences(
        "let\n    Source = Revenues,\n    Param = RevenuesParam,\n    Rows = fnClean(Source)\nin\n    Source",
      ),
    ).toEqual(["Revenues", "RevenuesParam", "fnClean"]);
  });
});

describe("each connector Power BI Desktop writes", () => {
  test("SQL Server: the schema and table in one step, the database from the call", () => {
    expect(
      readPowerQueryTables(
        'let\n    Source = Sql.Database("orders-db.database.windows.net", "orders"),\n    dbo_Orders = Source{[Schema="dbo",Item="Orders"]}[Data]\nin\n    dbo_Orders',
      ),
    ).toEqual([
      {
        database: "orders",
        schema: "dbo",
        table: "Orders",
        engine: "sqlserver",
        host: "orders-db.database.windows.net",
        isDatabaseExact: true,
      },
    ]);
  });

  test("SQL Server's Query option: the SQL's tables, in the call's database", () => {
    expect(
      readPowerQueryTables(
        'let\n    Source = Sql.Database("sql01", "Sales", [Query="SELECT o.*, c.name#(lf)FROM dbo.Orders o#(lf)JOIN [dbo].[Customers] c ON c.id = o.customer_id#(lf)JOIN Archive.dbo.Refunds r ON r.order_id = o.id"])\nin\n    Source',
      ).map((ref: BiTableRef): string => {
        return `${getBiTableName(ref)} @${ref.host} (${ref.engine})`;
      }),
    ).toEqual([
      "Sales.dbo.Orders @sql01 (sqlserver)",
      "Sales.dbo.Customers @sql01 (sqlserver)",
      "Archive.dbo.Refunds @sql01 (sqlserver)",
    ]);
  });

  test("SQL Server's server-wide connector: a Name with no Kind is the database", () => {
    expect(
      names(
        readPowerQueryTables(
          'let Source = Sql.Databases("sql01\\\\FINANCE"), Sales = Source{[Name="Sales"]}[Data], dbo_Orders = Sales{[Schema="dbo",Item="Orders"]}[Data] in dbo_Orders',
        ),
      ),
    ).toEqual(["Sales.dbo.Orders"]);
  });

  test("SQL Server and Oracle navigated a level at a time", () => {
    expect(
      names(
        readPowerQueryTables(
          'let Source = Sql.Database("sql01", "Sales", [HierarchicalNavigation=true]), dbo = Source{[Schema="dbo"]}[Data], Orders = dbo{[Name="Orders"]}[Data] in Orders',
        ),
      ),
    ).toEqual(["Sales.dbo.Orders"]);
    expect(
      readPowerQueryTables(
        'let Source = Oracle.Database("ora01:1521/FIN", [HierarchicalNavigation=true]), HR = Source{[Schema="HR"]}[Data], EMPLOYEES = HR{[Name="EMPLOYEES"]}[Data] in EMPLOYEES',
      ),
    ).toEqual([
      {
        database: null,
        schema: "HR",
        table: "EMPLOYEES",
        engine: "oracle",
        host: "ora01:1521/FIN",
      },
    ]);
  });

  test("PostgreSQL and MySQL: MySQL's schema is its database", () => {
    expect(
      readPowerQueryTables(
        'let Source = PostgreSQL.Database("pg.acme.com:5432", "shop"), public_orders = Source{[Schema="public",Item="orders"]}[Data] in public_orders',
      )[0],
    ).toMatchObject({
      database: "shop",
      schema: "public",
      table: "orders",
      engine: "postgresql",
      host: "pg.acme.com:5432",
    });
    expect(
      readPowerQueryTables(
        'let Source = MySQL.Database("mysql01", "shop", [ReturnSingleDatabase=true]), crm_contacts = Source{[Schema="crm",Item="contacts"]}[Data] in crm_contacts',
      )[0],
    ).toMatchObject({
      database: "crm",
      schema: "crm",
      table: "contacts",
      engine: "mysql",
    });
  });

  test("Redshift: a Name with no Kind is the schema, then the table", () => {
    expect(
      names(
        readPowerQueryTables(
          'let\n    Source = AmazonRedshift.Database("acme.redshift.amazonaws.com:5439", "dev"),\n    public = Source{[Name="public"]}[Data],\n    orders = public{[Name="orders"]}[Data],\n    refunds = public{[Name="refunds"]}[Data]\nin\n    Table.Combine({orders, refunds})',
        ),
      ),
    ).toEqual(["dev.public.orders", "dev.public.refunds"]);
  });

  test("Snowflake: database, schema and table each a step with its Kind; the warehouse is no database", () => {
    expect(
      readPowerQueryTables(
        'let\n    Source = Snowflake.Databases("acme.snowflakecomputing.com", "COMPUTE_WH", [Role="ANALYST"]),\n    ANALYTICS_Database = Source{[Name="ANALYTICS",Kind="Database"]}[Data],\n    PUBLIC_Schema = ANALYTICS_Database{[Name="PUBLIC",Kind="Schema"]}[Data],\n    ORDERS_Table = PUBLIC_Schema{[Name="ORDERS",Kind="Table"]}[Data],\n    REVENUE_View = PUBLIC_Schema{[Name="REVENUE",Kind="View"]}[Data]\nin\n    ORDERS_Table',
      ).map((ref: BiTableRef): string => {
        return `${getBiTableName(ref)} @${ref.host}`;
      }),
    ).toEqual([
      "ANALYTICS.PUBLIC.ORDERS @acme.snowflakecomputing.com",
      "ANALYTICS.PUBLIC.REVENUE @acme.snowflakecomputing.com",
    ]);
  });

  test("BigQuery: the project is a Name with no Kind", () => {
    expect(
      readPowerQueryTables(
        'let Source = GoogleBigQuery.Database([BillingProject="billing-123"]), #"acme-data" = Source{[Name="acme-data"]}[Data], sales_Schema = #"acme-data"{[Name="sales",Kind="Schema"]}[Data], orders_Table = sales_Schema{[Name="orders",Kind="Table"]}[Data] in orders_Table',
      ),
    ).toEqual([
      {
        database: "acme-data",
        schema: "sales",
        table: "orders",
        engine: "bigquery",
        host: null,
        isDatabaseExact: true,
      },
    ]);
  });

  test("Databricks: the catalog as the database, and a default catalog and schema in the options", () => {
    expect(
      names(
        readPowerQueryTables(
          'let\n    Source = Databricks.Catalogs("adb-123.4.azuredatabricks.net", "/sql/1.0/warehouses/abc", [Catalog=null, Database=null, EnableAutomaticProxyDiscovery=null, Implementation="2.0"]),\n    powerbi_Database = Source{[Name="powerbi",Kind="Database"]}[Data],\n    default_Schema = powerbi_Database{[Name="default",Kind="Schema"]}[Data],\n    dashboard_data_Table = default_Schema{[Name="dashboard_data",Kind="Table"]}[Data]\nin\n    dashboard_data_Table',
        ),
      ),
    ).toEqual(["powerbi.default.dashboard_data"]);
    expect(
      names(
        readPowerQueryTables(
          'let Source = Databricks.Catalogs("adb-1.azuredatabricks.net", "/sql/1.0/warehouses/abc", [Catalog="main", Database="sales"]), orders = Source{[Name="orders",Kind="Table"]}[Data] in orders',
        ),
      ),
    ).toEqual(["main.sales.orders"]);
  });

  test("Athena: Power Query's data catalog is no database OneUptime names", () => {
    expect(
      readPowerQueryTables(
        'let Source = AmazonAthena.Databases("athena-dsn"), AwsDataCatalog_Database = Source{[Name="AwsDataCatalog",Kind="Database"]}[Data], web_Schema = AwsDataCatalog_Database{[Name="web",Kind="Schema"]}[Data], visits_Table = web_Schema{[Name="visits",Kind="Table"]}[Data] in visits_Table',
      )[0],
    ).toMatchObject({
      database: null,
      schema: "web",
      table: "visits",
      engine: "athena",
    });
  });

  test("Dataverse: its tables in the dbo schema", () => {
    expect(
      readPowerQueryTables(
        'let Source = CommonDataService.Database("acme.crm.dynamics.com"), dbo_account = Source{[Schema="dbo",Item="account"]}[Data] in dbo_account',
      )[0],
    ).toMatchObject({
      schema: "dbo",
      table: "account",
      engine: "dataverse",
      host: "acme.crm.dynamics.com",
    });
  });
});

/*
 * Power BI on Dynamics 365 and Power Apps often reads Dataverse through
 * its OData connectors (#9554), which pick a table by its entity set -
 * accounts - not by the logical name OneUptime keeps it under. They read
 * as Dataverse, at the environment URL's host, each table marked as an
 * entity set, so it is matched through the environment's own names.
 */
describe("Dataverse's OData connectors", () => {
  // Microsoft's own example, from Dynamics 365 Human Resources' guide to its virtual tables in Power BI.
  const MICROSOFT_EXAMPLE: string = `let
  Source = Cds.Entities("https://contoso.crm.dynamics.com/", [ReorderColumns=null, UseFormattedValue=null]),
  entities = Source{[Group="entities"]}[Data],
  mshr_hcmworkerbaseentities = entities{[EntitySetName="mshr_hcmworkerbaseentities"]}[Data],
  selectedWorkerBaseEntityColumns=Table.SelectColumns(mshr_hcmworkerbaseentities,{"mshr_name","mshr_partynumber", "mshr_professionaltitle","mshr_birthdate"})
in
  selectedWorkerBaseEntityColumns`;

  test("Common Data Service (Legacy): the entity set, at the environment URL's host", () => {
    expect(readPowerQuery(MICROSOFT_EXAMPLE)).toEqual({
      tables: [
        {
          database: null,
          schema: null,
          table: "mshr_hcmworkerbaseentities",
          engine: "dataverse",
          host: "contoso.crm.dynamics.com",
          isEntitySet: true,
        },
      ],
      sources: [
        {
          engine: "dataverse",
          host: "contoso.crm.dynamics.com",
          database: null,
        },
      ],
    });
  });

  test("Dataverse.Contents, its URL a parameter, and each entity set a dataset's tables read", () => {
    const read: ReturnType<typeof readPowerQueryDataset> =
      readPowerQueryDataset({
        tables: [
          {
            name: "Accounts",
            sources: [
              'let Source = Dataverse.Contents(EnvironmentUrl), entities = Source{[Group="entities"]}[Data], accounts = entities{[EntitySetName="accounts"]}[Data], #"Removed Columns" = Table.RemoveColumns(accounts, {"address1_line3"}) in #"Removed Columns"',
            ],
          },
          {
            name: "Opportunities",
            sources: [
              'let Source = Dataverse.Contents(EnvironmentUrl), opportunities = Source{[Group="entities"]}[Data]{[EntitySetName="opportunities"]}[Data] in opportunities',
            ],
          },
        ],
        expressions: [
          {
            name: "EnvironmentUrl",
            expression:
              '"https://fabrikam.crm4.dynamics.com" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
          },
        ],
      });

    expect(
      read.tables.map((ref: BiTableRef): string => {
        return `${ref.table} @ ${ref.host} (${ref.isEntitySet ? "entity set" : "logical name"})`;
      }),
    ).toEqual([
      "accounts @ fabrikam.crm4.dynamics.com (entity set)",
      "opportunities @ fabrikam.crm4.dynamics.com (entity set)",
    ]);
  });

  test("an environment written without its scheme is still its host", () => {
    expect(
      readPowerQueryTables(
        'let Source = Cds.Entities("contoso.crm.dynamics.com"), contacts = Source{[Group="entities"]}[Data]{[EntitySetName="contacts"]}[Data] in contacts',
      )[0],
    ).toMatchObject({
      table: "contacts",
      host: "contoso.crm.dynamics.com",
      isEntitySet: true,
    });
  });

  test("only an entity set picks a table: a group, or a name with no meaning known, picks none", () => {
    expect(
      readPowerQueryTables(
        'let Source = Cds.Entities("https://contoso.crm.dynamics.com/"), entities = Source{[Group="entities"]}[Data] in entities',
      ),
    ).toEqual([]);
    expect(
      readPowerQueryTables(
        'let Source = Dataverse.Contents("https://contoso.crm.dynamics.com/"), x = Source{[Name="account"]}[Data] in x',
      ),
    ).toEqual([]);
  });

  test("a schema and a table in one step names the logical name, as the SQL connector does", () => {
    expect(
      readPowerQueryTables(
        'let Source = Dataverse.Contents("https://contoso.crm.dynamics.com"), dbo_account = Source{[Schema="dbo",Item="account"]}[Data] in dbo_account',
      ),
    ).toEqual([
      {
        database: null,
        schema: "dbo",
        table: "account",
        engine: "dataverse",
        host: "contoso.crm.dynamics.com",
      },
    ]);
  });

  test("another Cds or Dataverse function is no database, and navigation after it is not read", () => {
    expect(
      readPowerQueryTables(
        'let Source = Cds.Entities("https://contoso.crm.dynamics.com/"), Other = Cds.Metadata("https://contoso.crm.dynamics.com/"), x = Other{[EntitySetName="accounts"]}[Data] in x',
      ),
    ).toEqual([]);
  });

  test("an entity set keys apart from a table of the same letters", () => {
    expect(
      getBiTableKey({
        database: null,
        schema: null,
        table: "accounts",
        engine: "dataverse",
        host: null,
        isEntitySet: true,
      }),
    ).not.toBe(
      getBiTableKey({
        database: null,
        schema: null,
        table: "accounts",
        engine: null,
        host: null,
      }),
    );
  });
});

describe("SQL handed to a source", () => {
  test("Value.NativeQuery whose source has commas of its own reads the SQL, in the database navigated to", () => {
    expect(
      readPowerQueryTables(
        'let\n    Source = Value.NativeQuery(Snowflake.Databases("acme.snowflakecomputing.com","COMPUTE_WH"){[Name="ANALYTICS"]}[Data], "SELECT * FROM PUBLIC.ORDERS o JOIN PUBLIC.CUSTOMERS c ON c.ID = o.CUSTOMER_ID", null, [EnableFolding=true])\nin\n    Source',
      ).map((ref: BiTableRef): string => {
        return `${getBiTableName(ref)} (${ref.engine}, ${ref.isDatabaseExact ? "exact" : "label"})`;
      }),
    ).toEqual([
      "ANALYTICS.PUBLIC.ORDERS (snowflake, exact)",
      "ANALYTICS.PUBLIC.CUSTOMERS (snowflake, exact)",
    ]);
  });

  test("Value.NativeQuery on Redshift and PostgreSQL", () => {
    expect(
      names(
        readPowerQueryTables(
          'let Source = Value.NativeQuery(AmazonRedshift.Database("acme:5439","snowconvert"), "SELECT * FROM authors LIMIT 5", null, [EnableFolding=true]) in Source',
        ),
      ),
    ).toEqual(["snowconvert.authors"]);
    expect(
      names(
        readPowerQueryTables(
          'let Source = PostgreSQL.Database("pg", "shop"), Query = Value.NativeQuery(Source, "select * from public.orders -- every order", null, [EnableFolding=true]) in Query',
        ),
      ),
    ).toEqual(["shop.public.orders"]);
  });

  test("ODBC's own SQL, with no database known", () => {
    expect(
      readPowerQueryTables(
        'let Source = Odbc.Query("dsn=Warehouse", "SELECT * FROM sales.orders") in Source',
      ),
    ).toEqual([
      {
        database: null,
        schema: "sales",
        table: "orders",
        engine: null,
        host: null,
      },
    ]);
  });
});

describe("what is no database table", () => {
  test("Excel on SharePoint, a CSV, a folder and a web API read no table", () => {
    expect(
      readPowerQuery(
        'let\n    Source = Excel.Workbook(Web.Contents("https://acme.sharepoint.com/sites/ops/Shared Documents/15 29 EMG NUO Master Checklist- GANTT View.xlsx"), null, true),\n    Sheet1_Sheet = Source{[Item="Sheet1",Kind="Sheet"]}[Data],\n    Promoted = Table.PromoteHeaders(Sheet1_Sheet, [PromoteAllScalars=true])\nin\n    Promoted',
      ),
    ).toEqual({ tables: [], sources: [] });
    expect(
      readPowerQueryTables(
        'let Source = Csv.Document(File.Contents("C:\\\\data\\\\orders.csv"),[Delimiter=","]) in Source',
      ),
    ).toEqual([]);
    expect(
      readPowerQueryTables(
        'let Source = SharePoint.Files("https://acme.sharepoint.com/sites/ops", [ApiVersion = 15]), F = Source{[Name="report.xlsx",#"Folder Path"="https://acme.sharepoint.com/sites/ops/Shared Documents/"]}[Content] in F',
      ),
    ).toEqual([]);
  });

  test("navigation after a file is not read as a database's, even after a database was read", () => {
    expect(
      names(
        readPowerQueryTables(
          'let Orders = Sql.Database("sql01", "Sales"){[Schema="dbo",Item="Orders"]}[Data], Targets = Excel.Workbook(File.Contents("C:\\\\t.xlsx")){[Name="Targets"]}[Data] in Table.NestedJoin(Orders, {"id"}, Targets, {"id"}, "t")',
        ),
      ),
    ).toEqual(["Sales.dbo.Orders"]);
  });

  test("a dataflow's entities and a Power BI semantic model are no database table", () => {
    expect(
      readPowerQueryTables(
        'let Source = PowerPlatform.Dataflows(null), Workspaces = Source{[Id="Workspaces"]}[Data], ws = Workspaces{[workspaceId="9a1c"]}[Data], df = ws{[dataflowId="3b2e"]}[Data], Orders = df{[entity="Orders",version=""]}[Data] in Orders',
      ),
    ).toEqual([]);
    expect(
      readPowerQueryTables(
        'let Source = AnalysisServices.Database("powerbi://api.powerbi.com/v1.0/myorg/Finance", "Sales Model"), Model = Source{[Id="Model"]}[Data] in Model',
      ),
    ).toEqual([]);
  });

  test("a list of records is no navigation", () => {
    expect(
      readPowerQueryTables(
        'let Source = Sql.Database("sql01", "Sales"), Extra = Table.FromRecords({[Name="x"], [Name="y"]}) in Extra',
      ),
    ).toEqual([]);
  });
});

describe("a dataset's parameters and shared queries", () => {
  test("Microsoft's scan sample: a table reads a shared query, which reads SQL Server", () => {
    // As GetScanResult's sample response returns dataset ExportB.
    const read: ReturnType<typeof readPowerQueryDataset> =
      readPowerQueryDataset({
        tables: [
          {
            name: "DW_Revenues",
            sources: [
              "let\n    Source = Revenues,\n    Param = RevenuesParam\nin\n    Source",
            ],
          },
        ],
        expressions: [
          {
            name: "Revenues",
            expression:
              'let\n    Source = Sql.Database("sqlserver.database.windows.net", "DB"),\n    RevenuesTable = Source{[Schema="DB_SCHEMA",Item="DB_SCHEMA_ITEM"]}[Data]\nin\n    RevenuesTable',
          },
          {
            name: "RevenuesParam",
            expression:
              '"revenues param value" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
          },
        ],
      });

    expect(read.tables).toEqual([
      {
        database: "DB",
        schema: "DB_SCHEMA",
        table: "DB_SCHEMA_ITEM",
        engine: "sqlserver",
        host: "sqlserver.database.windows.net",
        isDatabaseExact: true,
      },
    ]);
    expect(read.sources).toEqual([
      {
        engine: "sqlserver",
        host: "sqlserver.database.windows.net",
        database: "DB",
      },
    ]);
  });

  test("parameters stand for a connector's server and database, and a navigation step's names", () => {
    expect(
      names(
        readPowerQueryDataset({
          tables: [
            {
              name: "Authors",
              sources: [
                'let\n    Source = Snowflake.Databases(SF_SERVER_LINK, SF_WAREHOUSE_NAME),\n    SourceSfDb = Source{[Name=SF_DB_NAME, Kind="Database"]}[Data],\n    SourceSfSchema = SourceSfDb{[Name="public", Kind="Schema"]}[Data],\n    SourceSfTbl = SourceSfSchema{[Name="AUTHORS", Kind="Table"]}[Data]\nin\n    SourceSfTbl',
              ],
            },
            {
              name: "Orders",
              sources: [
                'let Source = Sql.Database(#"Server Name", DatabaseName & "_prod"), T = Source{[Schema="dbo",Item="Orders"]}[Data] in T',
              ],
            },
          ],
          expressions: [
            {
              name: "SF_SERVER_LINK",
              expression:
                '"acme.snowflakecomputing.com" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
            },
            {
              name: "SF_WAREHOUSE_NAME",
              expression:
                '"WH" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
            },
            {
              name: "SF_DB_NAME",
              expression:
                '"SNOWCONVERT" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
            },
            {
              name: "Server Name",
              expression:
                '"sql01.corp.acme.com" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
            },
            {
              name: "DatabaseName",
              expression:
                '"Sales" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
            },
          ],
        }).tables,
      ),
    ).toEqual(["SNOWCONVERT.public.AUTHORS", "Sales_prod.dbo.Orders"]);
  });

  test("a staging query read by several tables, through another, is read once", () => {
    const read: ReturnType<typeof readPowerQueryDataset> =
      readPowerQueryDataset({
        tables: [
          {
            name: "Orders",
            sources: ['let Source = #"Staging Orders" in Source'],
          },
          {
            name: "Late Orders",
            sources: [
              'let Source = Table.SelectRows(#"Staging Orders", each [late]) in Source',
            ],
          },
        ],
        expressions: [
          {
            name: "Staging Orders",
            expression:
              'let Source = Connection, T = Source{[Schema="dbo",Item="Orders"]}[Data] in T',
          },
          {
            name: "Connection",
            expression: 'Sql.Database("sql01", "Sales")',
          },
          {
            name: "Unused",
            expression:
              'let Source = Sql.Database("sql02", "Other"), T = Source{[Schema="dbo",Item="Nope"]}[Data] in T',
          },
        ],
      });

    // The navigation reads the database the staging query's connection names.
    expect(names(read.tables)).toEqual(["Sales.dbo.Orders"]);
    expect(read.tables[0]).toMatchObject({
      engine: "sqlserver",
      host: "sql01",
      isDatabaseExact: true,
    });
    expect(read.sources).toEqual([
      { engine: "sqlserver", host: "sql01", database: "Sales" },
    ]);
  });

  test("a query that reads itself is read once, not forever", () => {
    expect(
      names(
        readPowerQueryDataset({
          tables: [{ name: "T", sources: ["A"] }],
          expressions: [
            { name: "A", expression: "let Source = B in Source" },
            {
              name: "B",
              expression:
                'let Source = A, X = Sql.Database("s", "d"){[Schema="dbo",Item="X"]}[Data] in X',
            },
          ],
        }).tables,
      ),
    ).toEqual(["d.dbo.X"]);
  });
});
