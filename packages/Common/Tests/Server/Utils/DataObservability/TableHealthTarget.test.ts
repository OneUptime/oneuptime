import { describe, expect, test } from "@jest/globals";
import {
  readConnectionTarget,
  readTableHealthTarget,
} from "../../../../Server/Utils/DataObservability/TableHealthTarget";

/*
 * What a collection says about the database it read travels with the
 * snapshot, from a probe in the customer's network too. It must name the
 * database, host and port - what spans name - and never any credential.
 */

describe("readConnectionTarget", () => {
  test("a PostgreSQL URL gives its database, host and port, and not its password", () => {
    const target: ReturnType<typeof readConnectionTarget> =
      readConnectionTarget({
        engine: "postgresql",
        connectionString:
          "postgres://reader:s3cret@orders-db.internal:6543/orders?sslmode=require",
      });

    expect(target).toEqual({
      databaseName: "orders",
      host: "orders-db.internal",
      port: 6543,
    });
    expect(JSON.stringify(target)).not.toContain("s3cret");
    expect(JSON.stringify(target)).not.toContain("reader");
  });

  test("libpq's key=value form is read too", () => {
    expect(
      readConnectionTarget({
        engine: "postgresql",
        connectionString:
          "host=10.0.0.5 port=5432 dbname='orders' user=reader password='p w'",
      }),
    ).toEqual({ databaseName: "orders", host: "10.0.0.5", port: 5432 });
  });

  test("a MySQL URL, with no port", () => {
    expect(
      readConnectionTarget({
        engine: "mysql",
        connectionString: "mysql://reader:pw@billing-db/billing",
      }),
    ).toEqual({ databaseName: "billing", host: "billing-db", port: null });
  });

  test("a SQL Server connection string, its instance left off the host", () => {
    expect(
      readConnectionTarget({
        engine: "sqlserver",
        connectionString:
          "Server=sql01\\SQLEXPRESS,1433;Database=orders;User Id=reader;Password=pw;",
      }),
    ).toMatchObject({ databaseName: "orders", host: "sql01" });
  });

  test("a Unix socket is no host, and an empty string no target", () => {
    expect(
      readConnectionTarget({
        engine: "postgresql",
        connectionString: "postgresql:///orders?host=/var/run/postgresql",
      }),
    ).toEqual({ databaseName: "orders", host: null, port: null });

    expect(
      readConnectionTarget({ engine: "postgresql", connectionString: "  " }),
    ).toBe(null);
  });
});

describe("readTableHealthTarget", () => {
  test("a probe's report is checked, not trusted as sent", () => {
    expect(
      readTableHealthTarget({
        databaseName: "orders",
        host: "orders-db",
        port: 5432,
        password: "never kept",
      }),
    ).toEqual({ databaseName: "orders", host: "orders-db", port: 5432 });

    expect(
      readTableHealthTarget({
        databaseName: "orders; DROP",
        host: "x".repeat(300),
        port: 99999,
      }),
    ).toBe(null);
  });

  test("a target naming neither database nor host, or not an object, is none", () => {
    for (const value of [null, undefined, "orders", [], { port: 5432 }]) {
      expect(readTableHealthTarget(value)).toBe(null);
    }
  });
});
