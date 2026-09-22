// Set required env vars before importing DatabaseMonitor (which reaches Config.ts).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import DatabaseMonitor from "../../../../../Utils/Monitors/MonitorTypes/DatabaseMonitor";
import {
  DatabaseHealthQuery,
  getDatabaseHealthQueries,
} from "../../../../../Utils/Monitors/MonitorTypes/DatabaseMonitor/DatabaseHealthQueries";
import { DatabaseMetricGroup } from "Common/Types/Monitor/DatabaseMetricCatalog";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupStatus,
  DatabaseMetricGroupUnavailableReason,
} from "Common/Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import {
  AZURE_SQL_DATABASE_MONITORING_REMEDIATION,
  SQL_SERVER_MONITORING_REMEDIATION,
  SqlServerEngineEdition,
} from "Common/Types/Monitor/DatabaseMonitor/SqlServerPlatform";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorStepDatabaseMonitor, {
  DEFAULT_DATABASE_METRIC_GROUPS,
  MonitorStepDatabaseMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDatabaseMonitor";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import logger from "Common/Server/Utils/Logger";
import * as mssql from "mssql";
import { DatabaseError } from "pg";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/3913
 *
 * "Database Health Monitor Fails to Collect Metrics - 'User Does Not Have
 * Permission' Despite Read Access". A SQL Server login with plain read
 * access got five groups reading "The user does not have permission to
 * perform this action." and nothing else - no GRANT, no hint which
 * permission was missing.
 *
 * Root cause, reproduced against SQL Server 2017, 2019 and 2022 as a
 * db_datareader login: SQL Server refuses a DMV read with TWO messages -
 * Msg 300 "VIEW SERVER STATE permission was denied on object 'server',
 * database 'master'." then Msg 297 "The user does not have permission to
 * perform this action." - and the mssql driver keeps only the LAST as
 * err.message, parking 300 on err.precedingErrors. The classifier matched
 * "permission was denied", which is only ever in the preceding error, so
 * every SQL Server permission failure was classified Error, and Error is
 * the reason that never carries the GRANT.
 *
 * The reporter was on Azure SQL Database (ProductVersion 12.0.2000.8, and
 * no sys.dm_hadr_database_replica_states), where the GRANT the monitor
 * would have shown - VIEW SERVER STATE - does not even exist.
 *
 * The fixtures below are built with the drivers' own error classes and
 * carry the exact numbers and texts those live servers returned.
 */

// ------------------------------------------------------------------ fixtures

type SqlServerErrorWithChain = mssql.RequestError & {
  precedingErrors?: Array<mssql.RequestError>;
};

/*
 * A RequestError the way the tedious driver builds one: the server's
 * message arrives as an Error with `info`, and RequestError copies
 * info.number onto `number`.
 */
const buildSqlServerError: (
  number: number,
  message: string,
) => SqlServerErrorWithChain = (
  number: number,
  message: string,
): SqlServerErrorWithChain => {
  const serverMessage: Error & { info?: Record<string, unknown> } = new Error(
    message,
  );
  serverMessage.info = {
    number,
    state: 1,
    class: number === 297 ? 16 : 14,
    message,
    serverName: "c57c783f5f28",
    procName: "",
    lineNumber: 1,
  };

  return new mssql.RequestError(serverMessage, "EREQUEST");
};

const MSG_297: string =
  "The user does not have permission to perform this action.";

/*
 * What SQL Server 2017 and 2019 raise for a server-scoped DMV read without
 * VIEW SERVER STATE (2022 names VIEW SERVER PERFORMANCE STATE).
 */
const serverStateDenied: (permission?: string) => SqlServerErrorWithChain = (
  permission: string = "VIEW SERVER STATE",
): SqlServerErrorWithChain => {
  const error: SqlServerErrorWithChain = buildSqlServerError(297, MSG_297);
  error.precedingErrors = [
    buildSqlServerError(
      300,
      `${permission} permission was denied on object 'server', database 'master'.`,
    ),
  ];
  return error;
};

/*
 * What SQL Server raises for a DATABASE-scoped DMV read
 * (sys.dm_hadr_database_replica_states) without VIEW DATABASE STATE. Azure
 * SQL Database refuses its DMVs the other way - Msg 300 naming VIEW SERVER
 * PERFORMANCE STATE, then 297 (user reports on Microsoft Q&A; Microsoft does
 * not document the text) - which is serverStateDenied().
 */
const databaseStateDenied: (database: string) => SqlServerErrorWithChain = (
  database: string,
): SqlServerErrorWithChain => {
  const error: SqlServerErrorWithChain = buildSqlServerError(297, MSG_297);
  error.precedingErrors = [
    buildSqlServerError(
      262,
      `VIEW DATABASE STATE permission denied in database '${database}'.`,
    ),
  ];
  return error;
};

const invalidObjectName: (name: string) => SqlServerErrorWithChain = (
  name: string,
): SqlServerErrorWithChain => {
  return buildSqlServerError(208, `Invalid object name '${name}'.`);
};

// mysql2 puts code, errno and sqlState on a plain Error.
const buildMySqlError: (input: {
  code: string;
  errno: number;
  message: string;
}) => Error = (input: {
  code: string;
  errno: number;
  message: string;
}): Error => {
  const error: Error & Record<string, unknown> = new Error(
    input.message,
  ) as Error & Record<string, unknown>;
  error["code"] = input.code;
  error["errno"] = input.errno;
  error["sqlState"] = "42000";
  error["sqlMessage"] = input.message;
  return error;
};

const buildPostgresError: (code: string, message: string) => DatabaseError = (
  code: string,
  message: string,
): DatabaseError => {
  const error: DatabaseError = new DatabaseError(message, 100, "error");
  error.code = code;
  return error;
};

// ---------------------------------------------------------- describeQueryError

describe("DatabaseMonitor.describeQueryError", () => {
  test("puts the preceding error that names the permission before the generic Msg 297", () => {
    expect(DatabaseMonitor.describeQueryError(serverStateDenied())).toBe(
      "VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.",
    );
  });

  test("keeps the SQL Server 2022 permission name as the server sent it", () => {
    expect(
      DatabaseMonitor.describeQueryError(
        serverStateDenied("VIEW SERVER PERFORMANCE STATE"),
      ),
    ).toContain("VIEW SERVER PERFORMANCE STATE permission was denied");
  });

  test("returns err.message alone when nothing preceded it", () => {
    expect(
      DatabaseMonitor.describeQueryError(
        invalidObjectName("sys.dm_hadr_database_replica_states"),
      ),
    ).toBe("Invalid object name 'sys.dm_hadr_database_replica_states'.");
  });

  test("says each message once", () => {
    const error: SqlServerErrorWithChain = buildSqlServerError(297, MSG_297);
    error.precedingErrors = [
      buildSqlServerError(297, MSG_297),
      buildSqlServerError(297, `  ${MSG_297}  `),
    ];

    expect(DatabaseMonitor.describeQueryError(error)).toBe(MSG_297);
  });

  test("keeps every distinct preceding message, in the order the server sent them", () => {
    const error: SqlServerErrorWithChain = buildSqlServerError(297, MSG_297);
    error.precedingErrors = [
      buildSqlServerError(300, "first."),
      buildSqlServerError(262, "second."),
    ];

    expect(DatabaseMonitor.describeQueryError(error)).toBe(
      `first. second. ${MSG_297}`,
    );
  });

  test("ignores preceding entries that carry no text", () => {
    const error: Error & { precedingErrors?: Array<unknown> } = new Error(
      MSG_297,
    );
    error.precedingErrors = [null, undefined, {}, { message: 42 }, "raw"];

    expect(DatabaseMonitor.describeQueryError(error)).toBe(MSG_297);
  });

  test("tolerates precedingErrors that is not an array", () => {
    const error: Error & { precedingErrors?: unknown } = new Error(MSG_297);
    error.precedingErrors = "not an array";

    expect(DatabaseMonitor.describeQueryError(error)).toBe(MSG_297);
  });

  test.each([
    [null, "SQL error"],
    [undefined, "SQL error"],
    [{}, "SQL error"],
    [new Error(""), "SQL error"],
    ["  driver said no  ", "driver said no"],
  ])(
    "never returns an empty explanation for %p",
    (thrown: unknown, expected: string) => {
      expect(DatabaseMonitor.describeQueryError(thrown)).toBe(expected);
    },
  );
});

// ---------------------------------------------------------- classifyQueryError

describe("DatabaseMonitor.classifyQueryError", () => {
  const classify: (
    databaseType: SqlDatabaseType,
    error: unknown,
  ) => DatabaseMetricGroupUnavailableReason = (
    databaseType: SqlDatabaseType,
    error: unknown,
  ): DatabaseMetricGroupUnavailableReason => {
    return DatabaseMonitor.classifyQueryError({
      databaseType,
      error,
      message: DatabaseMonitor.describeQueryError(error),
    });
  };

  describe("Microsoft SQL Server", () => {
    test("issue #3913: the Msg 297 the driver surfaced is a missing grant, not a generic error", () => {
      /*
       * The exact text in the reporter's screenshot, for all five groups.
       * Before the fix this was classified Error, which is why no GRANT
       * was ever shown next to it.
       */
      expect(DatabaseMonitor.classifyQueryFailure(MSG_297)).toBe(
        DatabaseMetricGroupUnavailableReason.MissingPermission,
      );
      expect(
        DatabaseMonitor.classifyQueryError({
          databaseType: SqlDatabaseType.MicrosoftSqlServer,
          error: serverStateDenied(),
          // err.message on its own, as the collector used to read it.
          message: MSG_297,
        }),
      ).toBe(DatabaseMetricGroupUnavailableReason.MissingPermission);
    });

    test.each([
      ["VIEW SERVER STATE (2017, 2019)", serverStateDenied()],
      [
        "VIEW SERVER PERFORMANCE STATE (2022)",
        serverStateDenied("VIEW SERVER PERFORMANCE STATE"),
      ],
      ["VIEW DATABASE STATE (262)", databaseStateDenied("orders")],
      [
        "SELECT on an object (229)",
        buildSqlServerError(
          229,
          "The SELECT permission was denied on the object 'database_files', database 'mssqlsystemresource', schema 'sys'.",
        ),
      ],
      [
        "database access (916)",
        buildSqlServerError(
          916,
          'The server principal "oneuptime_health" is not able to access the database "tempdb" under the current security context.',
        ),
      ],
      ["Msg 297 on its own", buildSqlServerError(297, MSG_297)],
    ])("a %s refusal is a missing grant", (_label: string, error: unknown) => {
      expect(classify(SqlDatabaseType.MicrosoftSqlServer, error)).toBe(
        DatabaseMetricGroupUnavailableReason.MissingPermission,
      );
    });

    test("classifies from the error NUMBER even when the text is not English", () => {
      /*
       * A server with a non-English default language translates the text
       * but not the number, which is why the numbers are checked first.
       */
      const error: SqlServerErrorWithChain = buildSqlServerError(
        297,
        "L'utilisateur n'a pas l'autorisation d'effectuer cette action.",
      );
      error.precedingErrors = [
        buildSqlServerError(300, "Autorisation VIEW SERVER STATE refusée."),
      ];

      expect(classify(SqlDatabaseType.MicrosoftSqlServer, error)).toBe(
        DatabaseMetricGroupUnavailableReason.MissingPermission,
      );
    });

    test.each([
      [
        "Invalid object name (208) - Azure SQL Database's missing HADR view",
        invalidObjectName("sys.dm_hadr_database_replica_states"),
      ],
      [
        "Invalid column name (207)",
        buildSqlServerError(207, "Invalid column name 'redo_queue_size'."),
      ],
      [
        "an Azure cross-database reference (40515)",
        buildSqlServerError(
          40515,
          "Reference to database and/or server name in 'tempdb.sys.dm_db_file_space_usage' is not supported in this version of SQL Server.",
        ),
      ],
    ])("%s is unsupported by the engine", (_label: string, error: unknown) => {
      expect(classify(SqlDatabaseType.MicrosoftSqlServer, error)).toBe(
        DatabaseMetricGroupUnavailableReason.NotSupportedByEngine,
      );
    });

    test("a request timeout is a timeout, whatever else the chain says", () => {
      const timeout: mssql.RequestError = new mssql.RequestError(
        "Timeout: Request failed to complete in 10000ms",
        "ETIMEOUT",
      );

      expect(classify(SqlDatabaseType.MicrosoftSqlServer, timeout)).toBe(
        DatabaseMetricGroupUnavailableReason.Timeout,
      );
    });

    test("an error number it does not know falls back to the text rules", () => {
      // 1205: chosen as deadlock victim. Neither a grant nor a capability.
      expect(
        classify(
          SqlDatabaseType.MicrosoftSqlServer,
          buildSqlServerError(
            1205,
            "Transaction (Process ID 52) was deadlocked on lock resources with another process and has been chosen as the deadlock victim.",
          ),
        ),
      ).toBe(DatabaseMetricGroupUnavailableReason.Error);
    });

    test("a syntax error is a bug in our SQL, not something the engine lacks", () => {
      /*
       * Every statement parses on every supported version, so Msg 102 must
       * surface as an Error rather than hide under "Not available on this
       * engine".
       */
      expect(
        classify(
          SqlDatabaseType.MicrosoftSqlServer,
          buildSqlServerError(102, "Incorrect syntax near 'FILTER'."),
        ),
      ).toBe(DatabaseMetricGroupUnavailableReason.Error);
    });

    test("msnodesqlv8's ODBC-prefixed text still reads as a missing grant without a number", () => {
      const error: Error = new Error(
        "[Microsoft][ODBC Driver 18 for SQL Server][SQL Server]The user does not have permission to perform this action.",
      );

      expect(classify(SqlDatabaseType.MicrosoftSqlServer, error)).toBe(
        DatabaseMetricGroupUnavailableReason.MissingPermission,
      );
    });
  });

  describe("MySQL", () => {
    test.each([
      [
        "SELECT on performance_schema.data_lock_waits (1142)",
        buildMySqlError({
          code: "ER_TABLEACCESS_DENIED_ERROR",
          errno: 1142,
          message:
            "SELECT command denied to user 'lowpriv'@'172.17.0.1' for table 'data_lock_waits'",
        }),
      ],
      [
        "PROCESS for INNODB_TRX (1227)",
        buildMySqlError({
          code: "ER_SPECIFIC_ACCESS_DENIED_ERROR",
          errno: 1227,
          message:
            "Access denied; you need (at least one of) the PROCESS privilege(s) for this operation",
        }),
      ],
      [
        "REPLICATION CLIENT for SHOW REPLICA STATUS (1227)",
        buildMySqlError({
          code: "ER_SPECIFIC_ACCESS_DENIED_ERROR",
          errno: 1227,
          message:
            "Access denied; you need (at least one of) the SUPER, REPLICATION CLIENT privilege(s) for this operation",
        }),
      ],
    ])("a refused %s is a missing grant", (_label: string, error: unknown) => {
      expect(classify(SqlDatabaseType.MySQL, error)).toBe(
        DatabaseMetricGroupUnavailableReason.MissingPermission,
      );
    });

    test("the 1142 text alone is a missing grant too - 'command denied' is not 'access denied'", () => {
      /*
       * The same bug on MySQL: before the fix the Locks group of a login
       * without SELECT on performance_schema was classified Error, and its
       * remediation ("needs SELECT on performance_schema.*") was withheld.
       */
      expect(
        DatabaseMonitor.classifyQueryFailure(
          "SELECT command denied to user 'lowpriv'@'172.17.0.1' for table 'data_lock_waits'",
        ),
      ).toBe(DatabaseMetricGroupUnavailableReason.MissingPermission);
    });

    test("a missing performance_schema table is unsupported by the engine", () => {
      expect(
        classify(
          SqlDatabaseType.MySQL,
          buildMySqlError({
            code: "ER_NO_SUCH_TABLE",
            errno: 1146,
            message: "Table 'performance_schema.data_lock_waits' doesn't exist",
          }),
        ),
      ).toBe(DatabaseMetricGroupUnavailableReason.NotSupportedByEngine);
    });

    test("MAX_EXECUTION_TIME is a timeout", () => {
      expect(
        classify(
          SqlDatabaseType.MySQL,
          buildMySqlError({
            code: "ER_QUERY_TIMEOUT",
            errno: 3024,
            message:
              "Query execution was interrupted, maximum statement execution time exceeded",
          }),
        ),
      ).toBe(DatabaseMetricGroupUnavailableReason.Timeout);
    });
  });

  describe("MySQL, classified from the code alone", () => {
    /*
     * With lc_messages = 'de_DE' MySQL localizes the text (verified on 8.4),
     * and none of the English text rules match any of these - so each case
     * below passes only if the mysql2 error code is what decides.
     */
    test.each([
      [
        "ER_TABLEACCESS_DENIED_ERROR (1142)",
        "ER_TABLEACCESS_DENIED_ERROR",
        1142,
        "SELECT Befehl nicht erlaubt fuer Benutzer 'lowpriv'@'172.17.0.1' auf Tabelle 'data_lock_waits'",
        DatabaseMetricGroupUnavailableReason.MissingPermission,
      ],
      [
        "ER_SPECIFIC_ACCESS_DENIED_ERROR (1227)",
        "ER_SPECIFIC_ACCESS_DENIED_ERROR",
        1227,
        "Kein Zugriff. Hierfuer wird mindestens eines dieser Rechte benoetigt: PROCESS",
        DatabaseMetricGroupUnavailableReason.MissingPermission,
      ],
      [
        "ER_NO_SUCH_TABLE (1146)",
        "ER_NO_SUCH_TABLE",
        1146,
        "Tabelle 'performance_schema.data_lock_waits' existiert nicht",
        DatabaseMetricGroupUnavailableReason.NotSupportedByEngine,
      ],
      [
        "ER_QUERY_TIMEOUT (3024)",
        "ER_QUERY_TIMEOUT",
        3024,
        "Abfrageausfuehrung wurde abgebrochen, maximale Ausfuehrungszeit ueberschritten",
        DatabaseMetricGroupUnavailableReason.Timeout,
      ],
    ])(
      "%s",
      (
        _label: string,
        code: string,
        errno: number,
        message: string,
        expected: DatabaseMetricGroupUnavailableReason,
      ) => {
        // The text alone is not enough - the code is what classifies it.
        expect(DatabaseMonitor.classifyQueryFailure(message)).toBe(
          DatabaseMetricGroupUnavailableReason.Error,
        );
        expect(
          classify(
            SqlDatabaseType.MySQL,
            buildMySqlError({ code, errno, message }),
          ),
        ).toBe(expected);
      },
    );

    test("a parse error is SHOW REPLICA STATUS on a MySQL that spells it SHOW SLAVE STATUS", () => {
      /*
       * MySQL before 8.0.22 and MariaDB before 10.5.1. The query table
       * documents this as NotSupportedByEngine; the text rule looks for
       * "syntax error", which MySQL never says, so without the code it was
       * (and still is) an Error.
       */
      const message: string =
        "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'REPLICA STATUS' at line 1";

      expect(
        classify(
          SqlDatabaseType.MySQL,
          buildMySqlError({ code: "ER_PARSE_ERROR", errno: 1064, message }),
        ),
      ).toBe(DatabaseMetricGroupUnavailableReason.NotSupportedByEngine);
      expect(classify(SqlDatabaseType.MySQL, new Error(message))).toBe(
        DatabaseMetricGroupUnavailableReason.Error,
      );
    });
  });

  describe("PostgreSQL", () => {
    test("insufficient_privilege (42501) is a missing grant", () => {
      expect(
        classify(
          SqlDatabaseType.PostgreSQL,
          buildPostgresError("42501", "permission denied for view pg_stat_x"),
        ),
      ).toBe(DatabaseMetricGroupUnavailableReason.MissingPermission);
    });

    test("undefined_table (42P01) is unsupported by the engine", () => {
      expect(
        classify(
          SqlDatabaseType.PostgreSQL,
          buildPostgresError(
            "42P01",
            'relation "pg_stat_checkpointer" does not exist',
          ),
        ),
      ).toBe(DatabaseMetricGroupUnavailableReason.NotSupportedByEngine);
    });

    test("query_canceled (57014) from statement_timeout is a timeout", () => {
      expect(
        classify(
          SqlDatabaseType.PostgreSQL,
          buildPostgresError(
            "57014",
            "canceling statement due to statement timeout",
          ),
        ),
      ).toBe(DatabaseMetricGroupUnavailableReason.Timeout);
    });
  });

  describe("PostgreSQL, classified from the SQLSTATE alone", () => {
    test.each([
      [
        "42501",
        "keine Berechtigung fuer Sicht pg_stat_x",
        DatabaseMetricGroupUnavailableReason.MissingPermission,
      ],
      [
        "42P01",
        "Relation \u00bbpg_stat_checkpointer\u00ab existiert nicht",
        DatabaseMetricGroupUnavailableReason.NotSupportedByEngine,
      ],
      [
        "57014",
        "storniere Anfrage wegen Zeitueberschreitung der Anweisung",
        DatabaseMetricGroupUnavailableReason.Timeout,
      ],
    ])(
      "SQLSTATE %s",
      (
        code: string,
        message: string,
        expected: DatabaseMetricGroupUnavailableReason,
      ) => {
        expect(DatabaseMonitor.classifyQueryFailure(message)).toBe(
          DatabaseMetricGroupUnavailableReason.Error,
        );
        expect(
          classify(
            SqlDatabaseType.PostgreSQL,
            buildPostgresError(code, message),
          ),
        ).toBe(expected);
      },
    );
  });

  test("SQL Server's ETIMEOUT code is a timeout even when the text does not say so", () => {
    const timeout: mssql.RequestError = new mssql.RequestError(
      "Anforderung abgebrochen",
      "ETIMEOUT",
    );

    expect(DatabaseMonitor.classifyQueryFailure(timeout.message)).toBe(
      DatabaseMetricGroupUnavailableReason.Error,
    );
    expect(classify(SqlDatabaseType.MicrosoftSqlServer, timeout)).toBe(
      DatabaseMetricGroupUnavailableReason.Timeout,
    );
  });

  test("an error code only counts for the engine whose driver produced it", () => {
    /*
     * "42501" is a PostgreSQL SQLSTATE; on a SQL Server check it means
     * nothing, and the text decides.
     */
    const error: Error & { code?: string } = new Error("connection reset");
    error.code = "42501";

    expect(classify(SqlDatabaseType.MicrosoftSqlServer, error)).toBe(
      DatabaseMetricGroupUnavailableReason.Error,
    );
    expect(classify(SqlDatabaseType.MySQL, error)).toBe(
      DatabaseMetricGroupUnavailableReason.Error,
    );
    expect(classify(SqlDatabaseType.PostgreSQL, error)).toBe(
      DatabaseMetricGroupUnavailableReason.MissingPermission,
    );
  });

  test.each([[{}], ["a string"], [42], [null]])(
    "never throws on a malformed precedingErrors (%p) - it runs inside the per-query catch",
    (precedingErrors: unknown) => {
      /*
       * Anything thrown while classifying escapes the per-query catch and
       * turns a database that answered into an offline check.
       */
      const error: Error & { number?: number; precedingErrors?: unknown } =
        new Error(MSG_297);
      error.number = 297;
      error.precedingErrors = precedingErrors;

      expect(classify(SqlDatabaseType.MicrosoftSqlServer, error)).toBe(
        DatabaseMetricGroupUnavailableReason.MissingPermission,
      );
    },
  );

  test.each([[null], [undefined], ["a string"], [42]])(
    "falls back to the text for a thrown %p",
    (thrown: unknown) => {
      expect(
        DatabaseMonitor.classifyQueryError({
          databaseType: SqlDatabaseType.MicrosoftSqlServer,
          error: thrown,
          message: MSG_297,
        }),
      ).toBe(DatabaseMetricGroupUnavailableReason.MissingPermission);
    },
  );
});

// -------------------------------------------- resolveRemediation / engine name

describe("DatabaseMonitor.resolveRemediation", () => {
  const sqlServerDmvQuery: DatabaseHealthQuery = getDatabaseHealthQueries(
    SqlDatabaseType.MicrosoftSqlServer,
  ).find((query: DatabaseHealthQuery) => {
    return query.id === "mssql-sessions";
  })!;

  test("shows the SQL Server grant on SQL Server", () => {
    for (const edition of [1, 2, 3, 4]) {
      expect(
        DatabaseMonitor.resolveRemediation({
          query: sqlServerDmvQuery,
          sqlServerEngineEdition: edition,
        }),
      ).toBe(SQL_SERVER_MONITORING_REMEDIATION);
    }
  });

  test("shows the database-level grant on Azure SQL Database, where VIEW SERVER STATE does not exist", () => {
    const remediation: string | undefined = DatabaseMonitor.resolveRemediation({
      query: sqlServerDmvQuery,
      sqlServerEngineEdition: SqlServerEngineEdition.AzureSqlDatabase,
    });

    expect(remediation).toBe(AZURE_SQL_DATABASE_MONITORING_REMEDIATION);
    expect(remediation).not.toContain("VIEW SERVER STATE");
  });

  test("shows the SQL Server grant on Managed Instance, which has server-level permissions", () => {
    expect(
      DatabaseMonitor.resolveRemediation({
        query: sqlServerDmvQuery,
        sqlServerEngineEdition: SqlServerEngineEdition.AzureSqlManagedInstance,
      }),
    ).toBe(SQL_SERVER_MONITORING_REMEDIATION);
  });

  test("shows the SQL Server grant when the edition is unknown", () => {
    // A probe row without engine_edition: what the version alone implied.
    expect(
      DatabaseMonitor.resolveRemediation({
        query: sqlServerDmvQuery,
        sqlServerEngineEdition: null,
      }),
    ).toBe(SQL_SERVER_MONITORING_REMEDIATION);
  });

  test("falls back to the plain remediation for a query with no Azure variant", () => {
    const query: DatabaseHealthQuery = {
      id: "no-azure-variant",
      group: DatabaseMetricGroup.Connections,
      sql: "SELECT 1",
      columnMappings: [],
      remediation: "GRANT something;",
    };

    expect(
      DatabaseMonitor.resolveRemediation({
        query,
        sqlServerEngineEdition: SqlServerEngineEdition.AzureSqlDatabase,
      }),
    ).toBe("GRANT something;");
  });

  test("has nothing to say for a query that needs no grant", () => {
    const sizeQuery: DatabaseHealthQuery = getDatabaseHealthQueries(
      SqlDatabaseType.MicrosoftSqlServer,
    ).find((query: DatabaseHealthQuery) => {
      return query.id === "mssql-storage-size";
    })!;

    expect(
      DatabaseMonitor.resolveRemediation({
        query: sizeQuery,
        sqlServerEngineEdition: SqlServerEngineEdition.AzureSqlDatabase,
      }),
    ).toBeUndefined();
  });
});

describe("DatabaseMonitor.describeEnginePlatform", () => {
  test.each([
    [SqlServerEngineEdition.AzureSqlDatabase, "Azure SQL Database"],
    [
      SqlServerEngineEdition.AzureSqlManagedInstance,
      "Azure SQL Managed Instance",
    ],
    [SqlServerEngineEdition.AzureSqlEdge, "Azure SQL Edge"],
    [3, "SQL Server"],
    [null, "SQL Server"],
  ])(
    "names the SQL Server platform for edition %p",
    (edition: number | null, expected: string) => {
      expect(
        DatabaseMonitor.describeEnginePlatform({
          databaseType: SqlDatabaseType.MicrosoftSqlServer,
          sqlServerEngineEdition: edition,
        }),
      ).toBe(expected);
    },
  );

  test("says nothing for the engines whose version string already names the product", () => {
    for (const databaseType of [
      SqlDatabaseType.PostgreSQL,
      SqlDatabaseType.MySQL,
    ]) {
      expect(
        DatabaseMonitor.describeEnginePlatform({
          databaseType,
          sqlServerEngineEdition: null,
        }),
      ).toBeUndefined();
    }
  });
});

describe("DatabaseMonitor.shouldRunQuery engine-edition gate", () => {
  const gated: DatabaseHealthQuery = {
    id: "gated",
    group: DatabaseMetricGroup.Replication,
    sql: "SELECT 1",
    columnMappings: [],
    skipOnSqlServerEngineEditions: [SqlServerEngineEdition.AzureSqlDatabase],
  };

  test("skips a query on an edition that does not have its view", () => {
    expect(
      DatabaseMonitor.shouldRunQuery({
        query: gated,
        serverVersionNum: null,
        isInRecovery: false,
        sqlServerEngineEdition: SqlServerEngineEdition.AzureSqlDatabase,
      }),
    ).toBe(false);
  });

  test("runs it on every other edition", () => {
    for (const edition of [
      2,
      3,
      4,
      SqlServerEngineEdition.AzureSqlManagedInstance,
      SqlServerEngineEdition.AzureSqlEdge,
    ]) {
      expect(
        DatabaseMonitor.shouldRunQuery({
          query: gated,
          serverVersionNum: null,
          isInRecovery: false,
          sqlServerEngineEdition: edition,
        }),
      ).toBe(true);
    }
  });

  test("runs it when the edition is unknown, like an unknown version", () => {
    for (const edition of [null, undefined]) {
      expect(
        DatabaseMonitor.shouldRunQuery({
          query: gated,
          serverVersionNum: null,
          isInRecovery: false,
          sqlServerEngineEdition: edition,
        }),
      ).toBe(true);
    }
  });
});

// ------------------------------------------------------------ execute(), end to end

type DatabaseMonitorPrivate = {
  openSession: (input: unknown) => Promise<unknown>;
};

interface FakeSession {
  executed: Array<string>;
  session: {
    runQuery: (sql: string) => Promise<Array<Record<string, unknown>>>;
    close: () => Promise<void>;
  };
}

/*
 * A session that answers each statement the way the live server did. The
 * responder sees the SQL and either returns rows or throws.
 */
const fakeSession: (
  respond: (sql: string) => Array<Record<string, unknown>>,
) => FakeSession = (
  respond: (sql: string) => Array<Record<string, unknown>>,
): FakeSession => {
  const executed: Array<string> = [];

  return {
    executed,
    session: {
      runQuery: async (
        sql: string,
      ): Promise<Array<Record<string, unknown>>> => {
        executed.push(sql);
        return respond(sql);
      },
      close: async (): Promise<void> => {},
    },
  };
};

const buildSqlServerConfig: () => MonitorStepDatabaseMonitor =
  (): MonitorStepDatabaseMonitor => {
    return {
      ...MonitorStepDatabaseMonitorUtil.getDefault(),
      databaseType: SqlDatabaseType.MicrosoftSqlServer,
      host: "reporter.database.windows.net",
      port: 1433,
      databaseName: "orders",
      username: "oneuptime_readonly",
      password: "super-secret",
      enabledMetricGroups: [...DEFAULT_DATABASE_METRIC_GROUPS],
    };
  };

const statusFor: (
  response: DatabaseMonitorResponse | null,
  group: DatabaseMetricGroup,
) => DatabaseMetricGroupStatus | undefined = (
  response: DatabaseMonitorResponse | null,
  group: DatabaseMetricGroup,
): DatabaseMetricGroupStatus | undefined => {
  return response?.unavailableGroups.find(
    (status: DatabaseMetricGroupStatus) => {
      return status.group === group;
    },
  );
};

const unavailableGroupNames: (
  response: DatabaseMonitorResponse | null,
) => Array<DatabaseMetricGroup> = (
  response: DatabaseMonitorResponse | null,
): Array<DatabaseMetricGroup> => {
  return (response?.unavailableGroups || []).map(
    (status: DatabaseMetricGroupStatus) => {
      return status.group;
    },
  );
};

const SIZE_ROW: Array<Record<string, unknown>> = [
  { database_size_bytes: "16777216" },
];

describe("DatabaseMonitor.execute - a SQL Server login with read access only (issue #3913)", () => {
  let fake: FakeSession;

  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const run: (
    respond: (sql: string) => Array<Record<string, unknown>>,
  ) => Promise<DatabaseMonitorResponse | null> = async (
    respond: (sql: string) => Array<Record<string, unknown>>,
  ): Promise<DatabaseMonitorResponse | null> => {
    fake = fakeSession(respond);

    jest
      .spyOn(
        DatabaseMonitor as unknown as DatabaseMonitorPrivate,
        "openSession",
      )
      .mockResolvedValue(fake.session as never);

    return await DatabaseMonitor.execute(buildSqlServerConfig(), {
      retry: 0,
      isOnlineCheckRequest: true,
    });
  };

  /*
   * db_datareader on SQL Server 2019, as observed: SERVERPROPERTY and
   * sys.database_files answer, every DMV raises 300 then 297 - except the
   * database-scoped HADR view, which raises 262 then 297.
   */
  const onPremReadOnly: (sql: string) => Array<Record<string, unknown>> = (
    sql: string,
  ): Array<Record<string, unknown>> => {
    if (sql.includes("SERVERPROPERTY")) {
      return [{ engine_version: "15.0.4490.9", engine_edition: 3 }];
    }
    if (sql.includes("sys.dm_hadr_database_replica_states")) {
      throw databaseStateDenied("orders");
    }
    if (sql.includes("sys.dm_")) {
      throw serverStateDenied();
    }
    if (sql.includes("sys.database_files")) {
      return SIZE_ROW;
    }
    throw new Error(`unexpected statement: ${sql}`);
  };

  test("stays online - a missing grant never takes the monitor down", async () => {
    const response: DatabaseMonitorResponse | null = await run(onPremReadOnly);

    expect(response?.isOnline).toBe(true);
    expect(response?.connectionError).toBeNull();
  });

  test("reports every DMV group as a MISSING GRANT, with the GRANT that fixes it", async () => {
    const response: DatabaseMonitorResponse | null = await run(onPremReadOnly);

    expect(unavailableGroupNames(response).sort()).toEqual(
      [
        DatabaseMetricGroup.Connections,
        DatabaseMetricGroup.Activity,
        DatabaseMetricGroup.Throughput,
        DatabaseMetricGroup.Locks,
        DatabaseMetricGroup.Storage,
        DatabaseMetricGroup.Replication,
      ].sort(),
    );

    for (const status of response?.unavailableGroups || []) {
      expect({
        group: status.group,
        reason: status.reason,
        remediation: status.remediation,
      }).toEqual({
        group: status.group,
        reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
        remediation: SQL_SERVER_MONITORING_REMEDIATION,
      });
    }
  });

  test("names the permission that is missing instead of only 'The user does not have permission'", async () => {
    const response: DatabaseMonitorResponse | null = await run(onPremReadOnly);

    expect(statusFor(response, DatabaseMetricGroup.Connections)?.message).toBe(
      "VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.",
    );

    // The monitored database's name is a configured secret-backed field.
    expect(statusFor(response, DatabaseMetricGroup.Replication)?.message).toBe(
      "VIEW DATABASE STATE permission denied in database '***'. The user does not have permission to perform this action.",
    );
  });

  test("redacts a secret that appears only in a PRECEDING error", async () => {
    /*
     * The preceding messages are new to the operator-facing text, so they
     * must go through the same redaction as err.message. Sanitizing before
     * joining - or joining only err.message - would let this through.
     */
    const response: DatabaseMonitorResponse | null = await run(
      (sql: string): Array<Record<string, unknown>> => {
        if (sql.includes("SERVERPROPERTY")) {
          return [{ engine_version: "16.0.4295.3", engine_edition: 3 }];
        }
        const error: SqlServerErrorWithChain = buildSqlServerError(
          297,
          MSG_297,
        );
        error.precedingErrors = [
          buildSqlServerError(
            300,
            "VIEW SERVER STATE permission was denied for login 'oneuptime_readonly' using password 'super-secret' on host reporter.database.windows.net.",
          ),
        ];
        throw error;
      },
    );

    const message: string =
      statusFor(response, DatabaseMetricGroup.Connections)?.message || "";

    expect(message).toContain("VIEW SERVER STATE permission was denied");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("oneuptime_readonly");
    expect(message).not.toContain("reporter.database.windows.net");
    expect(JSON.stringify(response)).not.toContain("super-secret");
  });

  test("still collects database size, which needs no grant", async () => {
    const response: DatabaseMonitorResponse | null = await run(onPremReadOnly);

    expect(response?.metrics[MonitorMetricType.DatabaseSizeBytes]).toBe(
      16777216,
    );
    // Collected AND unavailable: size came back, log and tempdb did not.
    expect(response?.collectedGroups).toEqual([DatabaseMetricGroup.Storage]);
    expect(statusFor(response, DatabaseMetricGroup.Storage)?.reason).toBe(
      DatabaseMetricGroupUnavailableReason.MissingPermission,
    );
    expect(
      MonitorMetricType.DatabaseLogSpaceUsedPercent in response!.metrics,
    ).toBe(false);
    expect(MonitorMetricType.DatabaseTempDbFreeBytes in response!.metrics).toBe(
      false,
    );
  });

  test("counts one failure per group, so Metric Groups Failed matches what the operator sees", async () => {
    const response: DatabaseMonitorResponse | null = await run(onPremReadOnly);

    expect(
      response?.metrics[MonitorMetricType.DatabaseMetricGroupsFailed],
    ).toBe(6);
    expect(response?.unavailableGroups).toHaveLength(6);
  });

  test("names the platform beside the version, and leaves the version as the server sent it", async () => {
    /*
     * engineVersion is read by criteria expressions and alert templates,
     * so it stays the raw ProductVersion; the platform is its own field.
     */
    const response: DatabaseMonitorResponse | null = await run(onPremReadOnly);

    expect(response?.engineVersion).toBe("15.0.4490.9");
    expect(response?.enginePlatform).toBe("SQL Server");
  });

  test("with VIEW SERVER STATE granted, every group is collected and nothing is reported missing", async () => {
    const response: DatabaseMonitorResponse | null = await run(
      (sql: string): Array<Record<string, unknown>> => {
        if (sql.includes("SERVERPROPERTY")) {
          return [{ engine_version: "16.0.4295.3", engine_edition: 3 }];
        }
        if (sql.includes("sys.dm_db_log_space_usage")) {
          return [{ log_space_used_percent: 5.67 }];
        }
        if (sql.includes("tempdb.sys.dm_db_file_space_usage")) {
          return [{ tempdb_free_bytes: "64225280" }];
        }
        if (sql.includes("sys.database_files")) {
          return SIZE_ROW;
        }
        return [{}];
      },
    );

    expect(response?.unavailableGroups).toEqual([]);
    expect(
      response?.metrics[MonitorMetricType.DatabaseMetricGroupsFailed],
    ).toBe(0);
    expect(response?.metrics[MonitorMetricType.DatabaseSizeBytes]).toBe(
      16777216,
    );
    expect(
      response?.metrics[MonitorMetricType.DatabaseLogSpaceUsedPercent],
    ).toBe(5.67);
    expect(response?.metrics[MonitorMetricType.DatabaseTempDbFreeBytes]).toBe(
      64225280,
    );
  });

  describe("on Azure SQL Database (the reporter's platform)", () => {
    /*
     * EngineEdition 5, ProductVersion 12.0.2000.8. A read-only user is
     * refused the DMVs with Msg 300 naming VIEW SERVER PERFORMANCE STATE,
     * then 297 - the same shape as SQL Server, as users report it - and the
     * HADR view does not exist at all (208).
     */
    const azureReadOnly: (sql: string) => Array<Record<string, unknown>> = (
      sql: string,
    ): Array<Record<string, unknown>> => {
      if (sql.includes("SERVERPROPERTY")) {
        return [
          {
            engine_version: "12.0.2000.8",
            engine_edition: SqlServerEngineEdition.AzureSqlDatabase,
          },
        ];
      }
      if (sql.includes("sys.dm_hadr_database_replica_states")) {
        throw invalidObjectName("sys.dm_hadr_database_replica_states");
      }
      if (sql.includes("sys.dm_")) {
        throw serverStateDenied("VIEW SERVER PERFORMANCE STATE");
      }
      if (sql.includes("sys.database_files")) {
        return SIZE_ROW;
      }
      throw new Error(`unexpected statement: ${sql}`);
    };

    test("shows the Azure grant, never the VIEW SERVER STATE that does not exist there", async () => {
      const response: DatabaseMonitorResponse | null = await run(azureReadOnly);

      expect(response?.unavailableGroups.length).toBeGreaterThan(0);

      for (const status of response?.unavailableGroups || []) {
        expect({
          group: status.group,
          reason: status.reason,
          remediation: status.remediation,
        }).toEqual({
          group: status.group,
          reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
          remediation: AZURE_SQL_DATABASE_MONITORING_REMEDIATION,
        });
      }
    });

    test("does not run the HADR query at all, so Replication is not reported as a failure", async () => {
      const response: DatabaseMonitorResponse | null = await run(azureReadOnly);

      expect(
        fake.executed.some((sql: string) => {
          return sql.includes("sys.dm_hadr_database_replica_states");
        }),
      ).toBe(false);
      expect(unavailableGroupNames(response)).not.toContain(
        DatabaseMetricGroup.Replication,
      );
      expect(response?.collectedGroups).not.toContain(
        DatabaseMetricGroup.Replication,
      );
    });

    test("reports the five groups a grant can fix, and nothing else", async () => {
      const response: DatabaseMonitorResponse | null = await run(azureReadOnly);

      expect(unavailableGroupNames(response).sort()).toEqual(
        [
          DatabaseMetricGroup.Connections,
          DatabaseMetricGroup.Activity,
          DatabaseMetricGroup.Throughput,
          DatabaseMetricGroup.Locks,
          DatabaseMetricGroup.Storage,
        ].sort(),
      );
      expect(
        response?.metrics[MonitorMetricType.DatabaseMetricGroupsFailed],
      ).toBe(5);
      expect(response?.metrics[MonitorMetricType.DatabaseSizeBytes]).toBe(
        16777216,
      );
    });

    test("names the platform as Azure SQL Database, beside the bare 12.0.2000.8 it reports", async () => {
      const response: DatabaseMonitorResponse | null = await run(azureReadOnly);

      expect(response?.engineVersion).toBe("12.0.2000.8");
      expect(response?.enginePlatform).toBe("Azure SQL Database");
    });

    test("with the grant in place, a fully collected Azure database reports zero failed groups", async () => {
      /*
       * Before the fix this was impossible on Azure: the HADR query ran on
       * every check and failed with "Invalid object name", so Metric Groups
       * Failed never dropped below 1 and a Database Collection Error
       * criterion fired forever.
       */
      const response: DatabaseMonitorResponse | null = await run(
        (sql: string): Array<Record<string, unknown>> => {
          if (sql.includes("SERVERPROPERTY")) {
            return [
              {
                engine_version: "12.0.2000.8",
                engine_edition: SqlServerEngineEdition.AzureSqlDatabase,
              },
            ];
          }
          if (sql.includes("sys.dm_hadr_database_replica_states")) {
            throw invalidObjectName("sys.dm_hadr_database_replica_states");
          }
          if (sql.includes("sys.database_files")) {
            return SIZE_ROW;
          }
          return [{}];
        },
      );

      expect(response?.unavailableGroups).toEqual([]);
      expect(
        response?.metrics[MonitorMetricType.DatabaseMetricGroupsFailed],
      ).toBe(0);
    });
  });

  test.each([
    ["null", null],
    ["a bare string", "driver exploded"],
    ["an object with a non-iterable precedingErrors", { precedingErrors: {} }],
  ])(
    "a catalog query that throws %s still leaves the database online",
    async (_label: string, thrown: unknown) => {
      const response: DatabaseMonitorResponse | null = await run(
        (sql: string): Array<Record<string, unknown>> => {
          if (sql.includes("SERVERPROPERTY")) {
            return [{ engine_version: "16.0.4295.3", engine_edition: 3 }];
          }
          throw thrown;
        },
      );

      expect(response?.isOnline).toBe(true);
      expect(response?.unavailableGroups.length).toBeGreaterThan(0);
      for (const status of response?.unavailableGroups || []) {
        expect(status.message.length).toBeGreaterThan(0);
      }
    },
  );

  test("a probe row without engine_edition behaves exactly as SQL Server always did", async () => {
    /*
     * An Azure database answered by a probe query that predates the
     * edition column must not skip Replication or switch grants on a
     * guess.
     */
    const response: DatabaseMonitorResponse | null = await run(
      (sql: string): Array<Record<string, unknown>> => {
        if (sql.includes("SERVERPROPERTY")) {
          return [{ engine_version: "16.0.4295.3" }];
        }
        return onPremReadOnly(sql);
      },
    );

    expect(
      fake.executed.some((sql: string) => {
        return sql.includes("sys.dm_hadr_database_replica_states");
      }),
    ).toBe(true);
    expect(
      statusFor(response, DatabaseMetricGroup.Connections)?.remediation,
    ).toBe(SQL_SERVER_MONITORING_REMEDIATION);
    expect(response?.engineVersion).toBe("16.0.4295.3");
    expect(response?.enginePlatform).toBe("SQL Server");
  });
});

describe("DatabaseMonitor.execute - a server that does not speak English", () => {
  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("still reports a missing grant with its GRANT, from the driver's error code", async () => {
    /*
     * Pins the wiring: execute() must hand the driver's error object to
     * the classifier, not just its text. With German messages the text
     * matches no rule at all.
     */
    const fake: FakeSession = fakeSession(
      (sql: string): Array<Record<string, unknown>> => {
        if (sql.includes("INNODB_TRX")) {
          throw buildMySqlError({
            code: "ER_SPECIFIC_ACCESS_DENIED_ERROR",
            errno: 1227,
            message:
              "Kein Zugriff. Hierfuer wird mindestens eines dieser Rechte benoetigt: PROCESS",
          });
        }
        if (sql.includes("VERSION()")) {
          return [{ engine_version: "8.4.11" }];
        }
        return [{}];
      },
    );

    jest
      .spyOn(
        DatabaseMonitor as unknown as DatabaseMonitorPrivate,
        "openSession",
      )
      .mockResolvedValue(fake.session as never);

    const response: DatabaseMonitorResponse | null =
      await DatabaseMonitor.execute(
        {
          ...buildSqlServerConfig(),
          databaseType: SqlDatabaseType.MySQL,
          port: 3306,
        },
        { retry: 0, isOnlineCheckRequest: true },
      );

    expect(statusFor(response, DatabaseMetricGroup.Activity)).toEqual(
      expect.objectContaining({
        reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
        remediation: "GRANT PROCESS ON *.* TO '<monitoring_user>'@'%';",
      }),
    );
  });
});

describe("DatabaseMonitor.execute - a MySQL login with SELECT on its database only", () => {
  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("shows the grant for each refused group, as observed on MySQL 8.4", async () => {
    const fake: FakeSession = fakeSession(
      (sql: string): Array<Record<string, unknown>> => {
        if (sql.includes("performance_schema.data_lock_waits")) {
          throw buildMySqlError({
            code: "ER_TABLEACCESS_DENIED_ERROR",
            errno: 1142,
            message:
              "SELECT command denied to user 'oneuptime_readonly'@'172.17.0.1' for table 'data_lock_waits'",
          });
        }
        if (sql.includes("INNODB_TRX")) {
          throw buildMySqlError({
            code: "ER_SPECIFIC_ACCESS_DENIED_ERROR",
            errno: 1227,
            message:
              "Access denied; you need (at least one of) the PROCESS privilege(s) for this operation",
          });
        }
        if (sql.includes("SHOW REPLICA STATUS")) {
          throw buildMySqlError({
            code: "ER_SPECIFIC_ACCESS_DENIED_ERROR",
            errno: 1227,
            message:
              "Access denied; you need (at least one of) the SUPER, REPLICATION CLIENT privilege(s) for this operation",
          });
        }
        if (sql.includes("VERSION()")) {
          return [{ engine_version: "8.4.11" }];
        }
        return [{}];
      },
    );

    jest
      .spyOn(
        DatabaseMonitor as unknown as DatabaseMonitorPrivate,
        "openSession",
      )
      .mockResolvedValue(fake.session as never);

    const response: DatabaseMonitorResponse | null =
      await DatabaseMonitor.execute(
        {
          ...buildSqlServerConfig(),
          databaseType: SqlDatabaseType.MySQL,
          port: 3306,
        },
        { retry: 0, isOnlineCheckRequest: true },
      );

    const locks: DatabaseMetricGroupStatus | undefined = statusFor(
      response,
      DatabaseMetricGroup.Locks,
    );
    expect(locks?.reason).toBe(
      DatabaseMetricGroupUnavailableReason.MissingPermission,
    );
    expect(locks?.remediation).toContain("SELECT on performance_schema");
    // The other Locks statement answered, so the group is also collected.
    expect(response?.collectedGroups).toContain(DatabaseMetricGroup.Locks);
    // The login name is a configured secret-backed field.
    expect(locks?.message).not.toContain("oneuptime_readonly");

    expect(statusFor(response, DatabaseMetricGroup.Activity)?.remediation).toBe(
      "GRANT PROCESS ON *.* TO '<monitoring_user>'@'%';",
    );
    expect(
      statusFor(response, DatabaseMetricGroup.Replication)?.remediation,
    ).toBe("GRANT REPLICATION CLIENT ON *.* TO '<monitoring_user>'@'%';");
    // MySQL's engine string is untouched, and it gets no platform.
    expect(response?.engineVersion).toBe("8.4.11");
    expect(response?.enginePlatform).toBeUndefined();
  });
});
