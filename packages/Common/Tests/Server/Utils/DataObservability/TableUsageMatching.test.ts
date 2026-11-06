import { describe, expect, test } from "@jest/globals";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  DataAssetAccessKind,
  getAccessKindOfOperation,
  normalizeOperation,
} from "../../../../Types/DataObservability/DataAssetUsage";
import {
  findUsageAsset,
  findUsageStore,
  getStoreKindOfDbSystem,
  matchSpanTableUsage,
  parseCollectionName,
  readNamespaceDatabase,
  SpanTableUsageRow,
  UsageAsset,
  UsageStore,
} from "../../../../Server/Utils/DataObservability/TableUsageMatching";

/*
 * A table's page lists the services that write and read it. Listing a
 * staging service as writing production is worse than listing nothing, so
 * every rule that ties a span to a table is pinned here, and so is every
 * case where it must give up.
 */

const ORDERS_STORE: UsageStore = {
  dataStoreId: "store-orders",
  kind: DataStoreKind.PostgreSql,
  databaseName: "orders",
  serverAddress: "orders-db.internal",
};

const BILLING_STORE: UsageStore = {
  dataStoreId: "store-billing",
  kind: DataStoreKind.MySql,
  databaseName: "billing",
  serverAddress: "billing-db",
};

const ASSETS: Array<UsageAsset> = [
  {
    dataAssetId: "asset-orders",
    dataStoreId: "store-orders",
    schemaName: "public",
    name: "orders",
  },
  {
    dataAssetId: "asset-archive-orders",
    dataStoreId: "store-orders",
    schemaName: "archive",
    name: "orders",
  },
  {
    dataAssetId: "asset-line-items",
    dataStoreId: "store-orders",
    schemaName: "public",
    name: "line_items",
  },
  {
    dataAssetId: "asset-invoices",
    dataStoreId: "store-billing",
    schemaName: "billing",
    name: "invoices",
  },
];

function row(overrides: Partial<SpanTableUsageRow> = {}): SpanTableUsageRow {
  return {
    serviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    dbSystem: "postgresql",
    dbNamespace: "orders",
    serverAddress: "orders-db.internal",
    collection: "orders",
    operation: "INSERT",
    callCount: 10,
    errorCount: 0,
    lastSeenAt: new Date("2026-11-03T12:00:00.000Z"),
    ...overrides,
  };
}

describe("operations", () => {
  test("a statement's verb says whether it reads or writes", () => {
    expect(getAccessKindOfOperation("INSERT")).toBe(DataAssetAccessKind.Write);
    expect(getAccessKindOfOperation("update")).toBe(DataAssetAccessKind.Write);
    expect(getAccessKindOfOperation("DELETE")).toBe(DataAssetAccessKind.Write);
    expect(getAccessKindOfOperation("MERGE")).toBe(DataAssetAccessKind.Write);
    expect(getAccessKindOfOperation("COPY")).toBe(DataAssetAccessKind.Write);
    expect(getAccessKindOfOperation("SELECT")).toBe(DataAssetAccessKind.Read);
    expect(getAccessKindOfOperation("select count(*)")).toBe(
      DataAssetAccessKind.Read,
    );
  });

  test("a verb that is neither, or none, says nothing", () => {
    for (const value of ["BEGIN", "SET", "", "   ", null, undefined, 42]) {
      expect(getAccessKindOfOperation(value)).toBe(null);
    }
  });

  test("an operation is kept as its first word, upper case, bounded", () => {
    expect(normalizeOperation(" select * from orders")).toBe("SELECT");
    expect(normalizeOperation("x".repeat(200))?.length).toBe(32);
    expect(normalizeOperation("'; DROP")).toBe(null);
  });
});

describe("names", () => {
  test("database systems, old and new names, map to store kinds", () => {
    expect(getStoreKindOfDbSystem("postgresql")).toBe(DataStoreKind.PostgreSql);
    expect(getStoreKindOfDbSystem("MySQL")).toBe(DataStoreKind.MySql);
    expect(getStoreKindOfDbSystem("mariadb")).toBe(DataStoreKind.MySql);
    expect(getStoreKindOfDbSystem("mssql")).toBe(DataStoreKind.SqlServer);
    expect(getStoreKindOfDbSystem("microsoft.sql_server")).toBe(
      DataStoreKind.SqlServer,
    );
    expect(getStoreKindOfDbSystem("cassandra")).toBe(null);
    expect(getStoreKindOfDbSystem("")).toBe(null);
  });

  test("a namespace names its database, SQL Server's after its instance", () => {
    expect(readNamespaceDatabase("Orders")).toBe("orders");
    expect(readNamespaceDatabase("SQLEXPRESS|orders")).toBe("orders");
    expect(readNamespaceDatabase("")).toBe(null);
    expect(readNamespaceDatabase(undefined)).toBe(null);
  });

  test("a collection names a table, with or without its schema, quoted or not", () => {
    expect(parseCollectionName("orders")).toEqual({
      schema: null,
      table: "orders",
    });
    expect(parseCollectionName("public.Orders")).toEqual({
      schema: "public",
      table: "orders",
    });
    expect(parseCollectionName('"public"."Line.Items"')).toEqual({
      schema: "public",
      table: "line.items",
    });
    expect(parseCollectionName("[dbo].[orders]")).toEqual({
      schema: "dbo",
      table: "orders",
    });
    expect(parseCollectionName("`billing`.`invoices`")).toEqual({
      schema: "billing",
      table: "invoices",
    });
    expect(parseCollectionName("orders_db.dbo.orders")).toEqual({
      schema: "dbo",
      table: "orders",
    });
  });

  test("anything that is not a plain name names no table", () => {
    for (const value of [
      "",
      "orders, line_items",
      "(select 1)",
      "orders o",
      "a.b.c.d",
      "orders.",
      null,
    ]) {
      expect(parseCollectionName(value)).toBe(null);
    }
  });
});

describe("findUsageStore", () => {
  test("the store whose engine and database the span names", () => {
    expect(
      findUsageStore({
        row: row(),
        stores: [ORDERS_STORE, BILLING_STORE],
      })?.dataStoreId,
    ).toBe("store-orders");
  });

  test("a span with no database goes to the project's only store of that engine", () => {
    expect(
      findUsageStore({
        row: row({ dbNamespace: "" }),
        stores: [ORDERS_STORE, BILLING_STORE],
      })?.dataStoreId,
    ).toBe("store-orders");

    expect(
      findUsageStore({
        row: row({ dbNamespace: "" }),
        stores: [ORDERS_STORE, { ...ORDERS_STORE, dataStoreId: "store-other" }],
      }),
    ).toBe(null);
  });

  test("two stores with the same database name are told apart by host, or not at all", () => {
    const staging: UsageStore = {
      ...ORDERS_STORE,
      dataStoreId: "store-orders-staging",
      serverAddress: "orders-db.staging",
    };

    expect(
      findUsageStore({
        row: row({ serverAddress: "ORDERS-DB.STAGING:5432" }),
        stores: [ORDERS_STORE, staging],
      })?.dataStoreId,
    ).toBe("store-orders-staging");

    expect(
      findUsageStore({
        row: row({ serverAddress: "10.0.0.7" }),
        stores: [ORDERS_STORE, staging],
      }),
    ).toBe(null);

    expect(
      findUsageStore({
        row: row({ serverAddress: "" }),
        stores: [ORDERS_STORE, staging],
      }),
    ).toBe(null);
  });

  test("no store for another engine, an unknown system or a database nobody collects", () => {
    expect(
      findUsageStore({
        row: row({ dbSystem: "mysql" }),
        stores: [ORDERS_STORE],
      }),
    ).toBe(null);
    expect(
      findUsageStore({
        row: row({ dbSystem: "redis" }),
        stores: [ORDERS_STORE],
      }),
    ).toBe(null);
    expect(
      findUsageStore({
        row: row({ dbNamespace: "inventory" }),
        stores: [ORDERS_STORE],
      }),
    ).toBe(null);
  });
});

describe("findUsageAsset", () => {
  test("a schema-qualified name finds that schema's table", () => {
    expect(
      findUsageAsset({
        store: ORDERS_STORE,
        collection: { schema: "archive", table: "orders" },
        assets: ASSETS,
      })?.dataAssetId,
    ).toBe("asset-archive-orders");
  });

  test("a bare name finds the only table of that name, else the default schema's", () => {
    expect(
      findUsageAsset({
        store: ORDERS_STORE,
        collection: { schema: null, table: "line_items" },
        assets: ASSETS,
      })?.dataAssetId,
    ).toBe("asset-line-items");

    expect(
      findUsageAsset({
        store: ORDERS_STORE,
        collection: { schema: null, table: "orders" },
        assets: ASSETS,
      })?.dataAssetId,
    ).toBe("asset-orders");
  });

  test("MySQL's default schema is the store's database", () => {
    expect(
      findUsageAsset({
        store: BILLING_STORE,
        collection: { schema: null, table: "invoices" },
        assets: [
          ...ASSETS,
          {
            dataAssetId: "asset-other-invoices",
            dataStoreId: "store-billing",
            schemaName: "legacy",
            name: "invoices",
          },
        ],
      })?.dataAssetId,
    ).toBe("asset-invoices");
  });

  test("a table of another store, or of no store, is no match", () => {
    expect(
      findUsageAsset({
        store: ORDERS_STORE,
        collection: { schema: null, table: "invoices" },
        assets: ASSETS,
      }),
    ).toBe(null);
    expect(
      findUsageAsset({
        store: ORDERS_STORE,
        collection: { schema: "public", table: "missing" },
        assets: ASSETS,
      }),
    ).toBe(null);
  });
});

describe("matchSpanTableUsage", () => {
  test("an INSERT into a collected table is a write by that service", () => {
    expect(
      matchSpanTableUsage({
        row: row(),
        stores: [ORDERS_STORE, BILLING_STORE],
        assets: ASSETS,
      }),
    ).toEqual({
      asset: ASSETS[0],
      accessKind: DataAssetAccessKind.Write,
      operation: "INSERT",
    });
  });

  test("a SELECT is a read", () => {
    expect(
      matchSpanTableUsage({
        row: row({ operation: "SELECT", collection: "public.line_items" }),
        stores: [ORDERS_STORE],
        assets: ASSETS,
      })?.accessKind,
    ).toBe(DataAssetAccessKind.Read);
  });

  test("an operation that neither reads nor writes, or no table, matches nothing", () => {
    expect(
      matchSpanTableUsage({
        row: row({ operation: "BEGIN" }),
        stores: [ORDERS_STORE],
        assets: ASSETS,
      }),
    ).toBe(null);
    expect(
      matchSpanTableUsage({
        row: row({ collection: "" }),
        stores: [ORDERS_STORE],
        assets: ASSETS,
      }),
    ).toBe(null);
  });
});
