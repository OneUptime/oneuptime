import SqlServerPlatformUtil, {
  AZURE_SQL_DATABASE_MONITORING_GRANT,
  AZURE_SQL_DATABASE_MONITORING_REMEDIATION,
  AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT,
  SQL_SERVER_MONITORING_GRANT,
  SQL_SERVER_MONITORING_REMEDIATION,
  SqlServerEngineEdition,
} from "../../../../Types/Monitor/DatabaseMonitor/SqlServerPlatform";
import { describe, expect, test } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/3913
 *
 * The reporter's SQL Server was an Azure SQL Database - ProductVersion
 * 12.0.2000.8, no sys.dm_hadr_database_replica_states - where the grant the
 * monitor would have suggested, VIEW SERVER STATE, cannot be granted at all.
 * These pin how the platform is told apart and which grant each one gets.
 */

describe("SqlServerEngineEdition", () => {
  test("carries Microsoft's documented SERVERPROPERTY('EngineEdition') values", () => {
    expect(SqlServerEngineEdition.AzureSqlDatabase).toBe(5);
    expect(SqlServerEngineEdition.AzureSqlManagedInstance).toBe(8);
    expect(SqlServerEngineEdition.AzureSqlEdge).toBe(9);
  });
});

describe("SqlServerPlatformUtil.isAzureSqlDatabase", () => {
  test("is true only for edition 5", () => {
    expect(SqlServerPlatformUtil.isAzureSqlDatabase(5)).toBe(true);

    /*
     * Managed Instance and Edge DO have server-level permissions, so they
     * take the SQL Server grant; so does anything unknown.
     */
    for (const edition of [1, 2, 3, 4, 6, 8, 9, 11, 12, 0, -5, 5.5]) {
      expect({
        edition,
        isAzureSqlDatabase: SqlServerPlatformUtil.isAzureSqlDatabase(edition),
      }).toEqual({ edition, isAzureSqlDatabase: false });
    }
  });

  test("an edition that was never read is not Azure SQL Database", () => {
    expect(SqlServerPlatformUtil.isAzureSqlDatabase(null)).toBe(false);
    expect(SqlServerPlatformUtil.isAzureSqlDatabase(undefined)).toBe(false);
  });
});

describe("SqlServerPlatformUtil.getPlatformName", () => {
  test.each([
    [5, "Azure SQL Database"],
    [8, "Azure SQL Managed Instance"],
    [9, "Azure SQL Edge"],
    [2, "SQL Server"],
    [3, "SQL Server"],
    [4, "SQL Server"],
    [null, "SQL Server"],
    [undefined, "SQL Server"],
  ])(
    "names edition %p as %s",
    (edition: number | null | undefined, name: string) => {
      expect(SqlServerPlatformUtil.getPlatformName(edition)).toBe(name);
    },
  );
});

const STATEMENT_KEYWORD: RegExp = /GRANT|ALTER/;

describe("SQL Server monitoring grants", () => {
  test("SQL Server and Managed Instance get the server-level grant", () => {
    expect(SQL_SERVER_MONITORING_GRANT).toBe(
      "GRANT VIEW SERVER STATE TO [<monitoring_login>];",
    );
  });

  test("the SQL Server remediation says to run it in master, where alone it works", () => {
    /*
     * Run from any other database, a server-scope GRANT fails with Msg 4621
     * "Permissions at the server scope can only be granted when the current
     * database is master" (verified on 2017 and 2022) - and the operator
     * reading a collection issue is usually connected to the monitored one.
     */
    expect(SQL_SERVER_MONITORING_REMEDIATION).toBe(
      "GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master",
    );
    expect(
      SQL_SERVER_MONITORING_REMEDIATION.startsWith(SQL_SERVER_MONITORING_GRANT),
    ).toBe(true);
  });

  test("Azure SQL Database gets the database-level grant, for a database USER", () => {
    expect(AZURE_SQL_DATABASE_MONITORING_GRANT).toBe(
      "GRANT VIEW DATABASE STATE TO [<monitoring_user>];",
    );
  });

  test("the Basic/S0/S1/elastic pool fallback is the server role, for a LOGIN, in master", () => {
    expect(AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT).toBe(
      "ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER [<monitoring_login>];",
    );
  });

  test("the Azure remediation puts each statement on its own line, under a line saying where it runs", () => {
    expect(AZURE_SQL_DATABASE_MONITORING_REMEDIATION.split("\n")).toEqual([
      "-- In the monitored database:",
      AZURE_SQL_DATABASE_MONITORING_GRANT,
      "-- Basic, S0, S1, elastic pools, or if that is not enough: in master, for the login:",
      AZURE_SQL_DATABASE_SERVER_STATE_READER_GRANT,
    ]);
  });

  test("no statement of a remediation hides inside a comment", () => {
    /*
     * The summary renders a remediation as copyable code. A statement that
     * trails a `--` on the same line is a comment, and copying it runs
     * nothing - which is how the Azure fallback used to be written.
     */
    for (const remediation of [
      SQL_SERVER_MONITORING_REMEDIATION,
      AZURE_SQL_DATABASE_MONITORING_REMEDIATION,
    ]) {
      for (const line of remediation.split("\n")) {
        const comment: string = line.includes("--")
          ? line.slice(line.indexOf("--"))
          : "";

        expect({
          line,
          commentHidesAStatement: STATEMENT_KEYWORD.test(comment),
        }).toEqual({ line, commentHidesAStatement: false });
      }
    }
  });

  test("the Azure remediation never suggests a server-level permission Azure SQL Database does not have", () => {
    expect(AZURE_SQL_DATABASE_MONITORING_REMEDIATION).not.toContain(
      "VIEW SERVER STATE",
    );
    expect(AZURE_SQL_DATABASE_MONITORING_REMEDIATION).not.toMatch(
      /GRANT VIEW SERVER/,
    );
  });
});
