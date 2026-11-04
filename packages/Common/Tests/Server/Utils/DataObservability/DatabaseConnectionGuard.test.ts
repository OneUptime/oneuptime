import { describe, expect, test } from "@jest/globals";
import {
  assertDatabaseConnectionAllowed,
  getDatabaseConnectionHosts,
} from "../../../../Server/Utils/DataObservability/DatabaseConnectionGuard";

/*
 * A connection string is a tenant's input, and a driver opens its own
 * socket. So before OneUptime's servers connect, every host the string can
 * reach - as the driver itself reads it, query-string overrides and host
 * lists included - is held to the guard every HTTP data source is.
 */

describe("the hosts a connection string can reach", () => {
  test("PostgreSQL's, as its driver reads them: a host in the query counts", () => {
    expect(
      getDatabaseConnectionHosts({
        engine: "postgresql",
        connectionString: "postgres://reader:pw@db.example.com:5432/orders",
      }),
    ).toEqual(["db.example.com"]);
    expect(
      getDatabaseConnectionHosts({
        engine: "postgresql",
        connectionString: "postgres://reader:pw@/orders?host=10.0.0.5",
      }),
    ).toEqual(["10.0.0.5"]);
    expect(() => {
      return getDatabaseConnectionHosts({
        engine: "postgresql",
        connectionString: "postgres://reader:pw@/orders?host=/var/run/postgresql",
      });
    }).toThrow(/local socket/);
  });

  test("MySQL's: its driver takes options from the query, so host and socketPath count", () => {
    expect(
      getDatabaseConnectionHosts({
        engine: "mysql",
        connectionString: "mysql://reader:pw@db.example.com:3306/orders",
      }),
    ).toEqual(["db.example.com"]);
    expect(
      getDatabaseConnectionHosts({
        engine: "mysql",
        connectionString:
          "mariadb://reader:pw@db.example.com:3306/orders?host=169.254.169.254",
      }),
    ).toEqual(["169.254.169.254"]);
    expect(() => {
      return getDatabaseConnectionHosts({
        engine: "mysql",
        connectionString:
          "mysql://reader:pw@db.example.com/orders?socketPath=/tmp/mysql.sock",
      });
    }).toThrow(/local socket/);
  });

  test("SQL Server's, in each form it is written", () => {
    expect(
      getDatabaseConnectionHosts({
        engine: "sqlserver",
        connectionString: "mssql://reader:pw@db.example.com:1433/orders",
      }),
    ).toEqual(["db.example.com"]);
    expect(
      getDatabaseConnectionHosts({
        engine: "sqlserver",
        connectionString:
          "Server=db.example.com,1433;Database=orders;User Id=reader;Password=pw;",
      })[0],
    ).toContain("db.example.com");
  });

  test("Oracle's: Easy Connect's list, and every host of a full descriptor", () => {
    expect(
      getDatabaseConnectionHosts({
        engine: "oracle",
        connectionString: "oracle://reader:pw@db.example.com:1521/ORCLPDB1",
      }),
    ).toEqual(["db.example.com"]);
    expect(
      getDatabaseConnectionHosts({
        engine: "oracle",
        connectionString: JSON.stringify({
          user: "reader",
          password: "pw",
          connectString:
            "(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=a.example.com)(PORT=1521))(ADDRESS=(PROTOCOL=TCP)(HOST=10.0.0.9)(PORT=1521)))(CONNECT_DATA=(SERVICE_NAME=X)))",
        }),
      }),
    ).toEqual(["a.example.com", "10.0.0.9"]);
  });

  test("every host of a MongoDB replica set; nothing for an engine that guards each request", () => {
    expect(
      getDatabaseConnectionHosts({
        engine: "mongodb",
        connectionString:
          "mongodb://reader:pw@a.example.com:27017,b.example.com:27018/shop",
      }),
    ).toEqual(["a.example.com", "b.example.com"]);
    expect(
      getDatabaseConnectionHosts({
        engine: "clickhouse",
        connectionString: "clickhouse://reader:pw@c.example.com:8443/x",
      }),
    ).toEqual([]);
  });
});

describe("what OneUptime's servers refuse", () => {
  test.each([
    ["postgres://reader:pw@127.0.0.1:5432/orders", "postgresql"],
    ["postgres://reader:pw@/orders?host=169.254.169.254", "postgresql"],
    ["mysql://reader:pw@public.example.com/o?host=127.0.0.1", "mysql"],
    ["mssql://reader:pw@169.254.169.254:1433/orders", "sqlserver"],
    ["oracle://reader:pw@127.0.0.1:1521/X", "oracle"],
    ["mongodb://reader:pw@8.8.8.8:27017,127.0.0.1:27017/shop", "mongodb"],
  ] as Array<[string, "postgresql"]>)(
    "%s",
    async (connectionString: string, engine: "postgresql") => {
      await expect(
        assertDatabaseConnectionAllowed({ engine, connectionString }),
      ).rejects.toThrow(/not allowed/);
    },
  );

  test("a public address passes", async () => {
    await expect(
      assertDatabaseConnectionAllowed({
        engine: "postgresql",
        connectionString: "postgres://reader:pw@8.8.8.8:5432/orders",
      }),
    ).resolves.toBeUndefined();
  });
});
