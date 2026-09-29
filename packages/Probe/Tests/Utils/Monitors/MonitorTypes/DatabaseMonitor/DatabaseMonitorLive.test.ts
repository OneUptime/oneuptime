// Set required env vars before importing DatabaseMonitor (which reaches Config.ts).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import DatabaseMonitor from "../../../../../Utils/Monitors/MonitorTypes/DatabaseMonitor";
import { DatabaseMetricGroup } from "Common/Types/Monitor/DatabaseMetricCatalog";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupStatus,
  DatabaseMetricGroupUnavailableReason,
} from "Common/Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import { SQL_SERVER_MONITORING_REMEDIATION } from "Common/Types/Monitor/DatabaseMonitor/SqlServerPlatform";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorStepDatabaseMonitor, {
  DEFAULT_DATABASE_METRIC_GROUPS,
  MonitorStepDatabaseMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDatabaseMonitor";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import * as mssql from "mssql";
import {
  Connection as MySqlConnection,
  createConnection as createMySqlConnection,
} from "mysql2/promise";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Issue #3913 against REAL servers - the check the unit tests cannot make.
 *
 * Every assertion here ran green against SQL Server 2017, 2019 and 2022,
 * MySQL 8.4 and PostgreSQL 16 in Docker before this file was committed, and
 * the SQL Server "read only" case is the reporter's situation exactly: a
 * login with db_datareader and nothing else. Skipped unless asked for,
 * because CI has no database servers:
 *
 *   docker run -d -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='<pw>' -p 14339:1433 \
 *     mcr.microsoft.com/mssql/server:2022-latest     # and :2019, :2017
 *   docker run -d -e MYSQL_ROOT_PASSWORD='<pw>' -p 13384:3306 mysql:8.4
 *   docker run -d -e POSTGRES_PASSWORD='<pw>' -p 15432:5432 postgres:16
 *
 *   RUN_DATABASE_HEALTH_LIVE_TESTS=true \
 *   DATABASE_HEALTH_LIVE_MSSQL_PORTS=14339,14319,14317 \
 *   DATABASE_HEALTH_LIVE_MSSQL_SA_PASSWORD='<pw>' \
 *   DATABASE_HEALTH_LIVE_MYSQL_PORT=13384 DATABASE_HEALTH_LIVE_MYSQL_ROOT_PASSWORD='<pw>' \
 *   DATABASE_HEALTH_LIVE_POSTGRES_PORT=15432 DATABASE_HEALTH_LIVE_POSTGRES_PASSWORD='<pw>' \
 *   npx jest Tests/Utils/Monitors/MonitorTypes/DatabaseMonitor/DatabaseMonitorLive.test.ts
 *
 * Each engine runs only when its port is set. The tests create their own
 * database and login, and put the grants back the way they found them.
 */

const LIVE: boolean = process.env["RUN_DATABASE_HEALTH_LIVE_TESTS"] === "true";
const HOST: string = process.env["DATABASE_HEALTH_LIVE_HOST"] || "127.0.0.1";

const MSSQL_PORTS: Array<number> = (
  process.env["DATABASE_HEALTH_LIVE_MSSQL_PORTS"] || ""
)
  .split(",")
  .map((port: string) => {
    return parseInt(port.trim(), 10);
  })
  .filter((port: number) => {
    return Number.isFinite(port);
  });
const MYSQL_PORT: number = parseInt(
  process.env["DATABASE_HEALTH_LIVE_MYSQL_PORT"] || "",
  10,
);
const POSTGRES_PORT: number = parseInt(
  process.env["DATABASE_HEALTH_LIVE_POSTGRES_PORT"] || "",
  10,
);

const describeIf: (condition: boolean) => typeof describe.skip = (
  condition: boolean,
): typeof describe.skip => {
  return condition ? describe : describe.skip;
};

const MONITOR_DATABASE: string = "oneuptime_health_live";
const MONITOR_LOGIN: string = "oneuptime_health_live";
const MONITOR_PASSWORD: string = "Live!Monitor#3913pw";
const LIVE_TIMEOUT_MS: number = 120000;

const DMV_GROUPS: Array<DatabaseMetricGroup> = [
  DatabaseMetricGroup.Connections,
  DatabaseMetricGroup.Activity,
  DatabaseMetricGroup.Throughput,
  DatabaseMetricGroup.Locks,
  DatabaseMetricGroup.Storage,
  DatabaseMetricGroup.Replication,
];

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

const runMonitor: (
  overrides: Partial<MonitorStepDatabaseMonitor>,
) => Promise<DatabaseMonitorResponse | null> = async (
  overrides: Partial<MonitorStepDatabaseMonitor>,
): Promise<DatabaseMonitorResponse | null> => {
  return await DatabaseMonitor.execute(
    {
      ...MonitorStepDatabaseMonitorUtil.getDefault(),
      host: HOST,
      databaseName: MONITOR_DATABASE,
      username: MONITOR_LOGIN,
      password: MONITOR_PASSWORD,
      enabledMetricGroups: [...DEFAULT_DATABASE_METRIC_GROUPS],
      ...overrides,
    },
    { retry: 0, isOnlineCheckRequest: true },
  );
};

// ------------------------------------------------------------- SQL Server

describeIf(LIVE && MSSQL_PORTS.length > 0)(
  "live: Microsoft SQL Server, a login with read access only",
  () => {
    /*
     * A loop, not describe.each: .each throws on an empty table even inside
     * a skipped describe, and the table IS empty wherever the servers are
     * not configured - CI included.
     */
    for (const port of MSSQL_PORTS) {
      describe(`server on port ${port}`, () => {
        const saPassword: string =
          process.env["DATABASE_HEALTH_LIVE_MSSQL_SA_PASSWORD"] || "";

        const asSa: (database: string, sql: string) => Promise<void> = async (
          database: string,
          sql: string,
        ): Promise<void> => {
          const pool: mssql.ConnectionPool = new mssql.ConnectionPool({
            server: HOST,
            port,
            user: "sa",
            password: saPassword,
            database,
            options: { encrypt: false, trustServerCertificate: true },
          });
          await pool.connect();
          try {
            await pool.request().query(sql);
          } finally {
            await pool.close();
          }
        };

        const revokeServerGrants: () => Promise<void> =
          async (): Promise<void> => {
            await asSa(
              "master",
              `REVOKE VIEW SERVER STATE FROM [${MONITOR_LOGIN}];`,
            );
            // 2022 and later only; older versions do not know the permission.
            await asSa(
              "master",
              `REVOKE VIEW SERVER PERFORMANCE STATE FROM [${MONITOR_LOGIN}];`,
            ).catch(() => {});
          };

        const monitor: () => Promise<DatabaseMonitorResponse | null> =
          async (): Promise<DatabaseMonitorResponse | null> => {
            return await runMonitor({
              databaseType: SqlDatabaseType.MicrosoftSqlServer,
              port,
            });
          };

        beforeAll(async () => {
          await asSa(
            "master",
            `IF DB_ID('${MONITOR_DATABASE}') IS NULL CREATE DATABASE [${MONITOR_DATABASE}];
           IF SUSER_ID('${MONITOR_LOGIN}') IS NULL CREATE LOGIN [${MONITOR_LOGIN}] WITH PASSWORD = '${MONITOR_PASSWORD}', CHECK_POLICY = OFF;`,
          );
          await asSa(
            MONITOR_DATABASE,
            `IF USER_ID('${MONITOR_LOGIN}') IS NULL CREATE USER [${MONITOR_LOGIN}] FOR LOGIN [${MONITOR_LOGIN}];
           ALTER ROLE db_datareader ADD MEMBER [${MONITOR_LOGIN}];
           REVOKE VIEW DATABASE STATE FROM [${MONITOR_LOGIN}];`,
          );
          await revokeServerGrants();
        }, LIVE_TIMEOUT_MS);

        afterAll(async () => {
          await revokeServerGrants();
        }, LIVE_TIMEOUT_MS);

        test(
          "stays online and reports every DMV group as a missing grant, with the GRANT",
          async () => {
            const response: DatabaseMonitorResponse | null = await monitor();

            expect(response?.isOnline).toBe(true);

            for (const group of DMV_GROUPS) {
              const status: DatabaseMetricGroupStatus | undefined = statusFor(
                response,
                group,
              );

              expect({
                group,
                reason: status?.reason,
                remediation: status?.remediation,
              }).toEqual({
                group,
                reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
                remediation: SQL_SERVER_MONITORING_REMEDIATION,
              });
            }

            expect(response?.unavailableGroups).toHaveLength(DMV_GROUPS.length);
          },
          LIVE_TIMEOUT_MS,
        );

        test(
          "says WHICH permission was refused, not only 'The user does not have permission'",
          async () => {
            const response: DatabaseMonitorResponse | null = await monitor();

            // 2017/2019 say VIEW SERVER STATE, 2022 VIEW SERVER PERFORMANCE STATE.
            expect(
              statusFor(response, DatabaseMetricGroup.Connections)?.message,
            ).toMatch(
              /^VIEW SERVER (PERFORMANCE )?STATE permission was denied on object 'server', database 'master'\. The user does not have permission to perform this action\.$/,
            );
            expect(
              statusFor(response, DatabaseMetricGroup.Replication)?.message,
            ).toMatch(/VIEW DATABASE (PERFORMANCE )?STATE permission denied/);
          },
          LIVE_TIMEOUT_MS,
        );

        test(
          "reads the engine edition as a read-only login and names the platform",
          async () => {
            const response: DatabaseMonitorResponse | null = await monitor();

            /*
             * The containers are SQL Server Developer Edition (EngineEdition
             * 3). engineVersion stays the bare ProductVersion that
             * expressions and templates already read.
             */
            expect(response?.enginePlatform).toBe("SQL Server");
            expect(response?.engineVersion).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
          },
          LIVE_TIMEOUT_MS,
        );

        test(
          "collects database size, which needs no grant",
          async () => {
            const response: DatabaseMonitorResponse | null = await monitor();

            expect(response?.collectedGroups).toEqual([
              DatabaseMetricGroup.Storage,
            ]);
            expect(
              response?.metrics[MonitorMetricType.DatabaseSizeBytes],
            ).toBeGreaterThan(0);
          },
          LIVE_TIMEOUT_MS,
        );

        test(
          "after the GRANT it shows, every group is collected",
          async () => {
            // Exactly the statement the monitor told the operator to run.
            await asSa(
              "master",
              SQL_SERVER_MONITORING_REMEDIATION.replace(
                "[<monitoring_login>]",
                `[${MONITOR_LOGIN}]`,
              ),
            );

            try {
              const response: DatabaseMonitorResponse | null = await monitor();

              expect(response?.unavailableGroups).toEqual([]);
              expect(
                response?.metrics[MonitorMetricType.DatabaseMetricGroupsFailed],
              ).toBe(0);
              for (const group of DMV_GROUPS) {
                expect(response?.collectedGroups).toContain(group);
              }
              expect(
                response?.metrics[
                  MonitorMetricType.DatabaseLogSpaceUsedPercent
                ],
              ).toBeGreaterThan(0);
              expect(
                response?.metrics[MonitorMetricType.DatabaseTempDbFreeBytes],
              ).toBeGreaterThan(0);
            } finally {
              await revokeServerGrants();
            }
          },
          LIVE_TIMEOUT_MS,
        );
      });
    }
  },
);

// ------------------------------------------------------------------ MySQL

describeIf(LIVE && Number.isFinite(MYSQL_PORT))(
  "live: MySQL, a login with SELECT on its database only",
  () => {
    const rootPassword: string =
      process.env["DATABASE_HEALTH_LIVE_MYSQL_ROOT_PASSWORD"] || "";

    const asRoot: (statements: Array<string>) => Promise<void> = async (
      statements: Array<string>,
    ): Promise<void> => {
      const connection: MySqlConnection = await createMySqlConnection({
        host: HOST,
        port: MYSQL_PORT,
        user: "root",
        password: rootPassword,
      });
      try {
        for (const statement of statements) {
          await connection.query(statement).catch((err: unknown) => {
            // REVOKE of a privilege never granted is an error; ignore it.
            if (!statement.startsWith("REVOKE")) {
              throw err;
            }
          });
        }
      } finally {
        await connection.end();
      }
    };

    const revokeMonitoringGrants: () => Promise<void> =
      async (): Promise<void> => {
        await asRoot([
          `REVOKE PROCESS, REPLICATION CLIENT ON *.* FROM '${MONITOR_LOGIN}'@'%'`,
          `REVOKE SELECT ON performance_schema.* FROM '${MONITOR_LOGIN}'@'%'`,
        ]);
      };

    beforeAll(async () => {
      await asRoot([
        `CREATE DATABASE IF NOT EXISTS ${MONITOR_DATABASE}`,
        `CREATE USER IF NOT EXISTS '${MONITOR_LOGIN}'@'%' IDENTIFIED BY '${MONITOR_PASSWORD}'`,
        `GRANT SELECT ON ${MONITOR_DATABASE}.* TO '${MONITOR_LOGIN}'@'%'`,
      ]);
      await revokeMonitoringGrants();
    }, LIVE_TIMEOUT_MS);

    afterAll(async () => {
      await revokeMonitoringGrants();
    }, LIVE_TIMEOUT_MS);

    const monitor: () => Promise<DatabaseMonitorResponse | null> =
      async (): Promise<DatabaseMonitorResponse | null> => {
        return await runMonitor({
          databaseType: SqlDatabaseType.MySQL,
          port: MYSQL_PORT,
        });
      };

    test(
      "reports each refused group as a missing grant with the grant that fixes it",
      async () => {
        const response: DatabaseMonitorResponse | null = await monitor();

        expect(response?.isOnline).toBe(true);

        const locks: DatabaseMetricGroupStatus | undefined = statusFor(
          response,
          DatabaseMetricGroup.Locks,
        );
        expect(locks?.reason).toBe(
          DatabaseMetricGroupUnavailableReason.MissingPermission,
        );
        expect(locks?.message).toContain("command denied");
        expect(locks?.remediation).toContain("SELECT on performance_schema");

        expect(statusFor(response, DatabaseMetricGroup.Activity)).toEqual(
          expect.objectContaining({
            reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
            remediation: "GRANT PROCESS ON *.* TO '<monitoring_user>'@'%';",
          }),
        );
        expect(statusFor(response, DatabaseMetricGroup.Replication)).toEqual(
          expect.objectContaining({
            reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
            remediation:
              "GRANT REPLICATION CLIENT ON *.* TO '<monitoring_user>'@'%';",
          }),
        );
      },
      LIVE_TIMEOUT_MS,
    );

    test(
      "with the documented grants, nothing is reported missing",
      async () => {
        await asRoot([
          `GRANT PROCESS, REPLICATION CLIENT ON *.* TO '${MONITOR_LOGIN}'@'%'`,
          `GRANT SELECT ON performance_schema.* TO '${MONITOR_LOGIN}'@'%'`,
        ]);

        try {
          const response: DatabaseMonitorResponse | null = await monitor();

          expect(response?.unavailableGroups).toEqual([]);
        } finally {
          await revokeMonitoringGrants();
        }
      },
      LIVE_TIMEOUT_MS,
    );
  },
);

// ------------------------------------------------------------- PostgreSQL

describeIf(LIVE && Number.isFinite(POSTGRES_PORT))(
  "live: PostgreSQL, a role with CONNECT only",
  () => {
    const adminPassword: string =
      process.env["DATABASE_HEALTH_LIVE_POSTGRES_PASSWORD"] || "";

    const asAdmin: (
      database: string,
      statements: Array<string>,
    ) => Promise<void> = async (
      database: string,
      statements: Array<string>,
    ): Promise<void> => {
      const client: Client = new Client({
        host: HOST,
        port: POSTGRES_PORT,
        user: "postgres",
        password: adminPassword,
        database,
      });
      await client.connect();
      try {
        for (const statement of statements) {
          await client.query(statement);
        }
      } finally {
        await client.end();
      }
    };

    beforeAll(async () => {
      const client: Client = new Client({
        host: HOST,
        port: POSTGRES_PORT,
        user: "postgres",
        password: adminPassword,
        database: "postgres",
      });
      await client.connect();
      try {
        const exists: { rowCount: number | null } = await client.query(
          `SELECT 1 FROM pg_database WHERE datname = '${MONITOR_DATABASE}'`,
        );
        if (!exists.rowCount) {
          await client.query(`CREATE DATABASE ${MONITOR_DATABASE}`);
        }
        const role: { rowCount: number | null } = await client.query(
          `SELECT 1 FROM pg_roles WHERE rolname = '${MONITOR_LOGIN}'`,
        );
        if (!role.rowCount) {
          await client.query(
            `CREATE ROLE ${MONITOR_LOGIN} LOGIN PASSWORD '${MONITOR_PASSWORD}'`,
          );
        }
        await client.query(`REVOKE pg_monitor FROM ${MONITOR_LOGIN}`);
      } finally {
        await client.end();
      }
    }, LIVE_TIMEOUT_MS);

    afterAll(async () => {
      await asAdmin("postgres", [`REVOKE pg_monitor FROM ${MONITOR_LOGIN}`]);
    }, LIVE_TIMEOUT_MS);

    const monitor: () => Promise<DatabaseMonitorResponse | null> =
      async (): Promise<DatabaseMonitorResponse | null> => {
        return await runMonitor({
          databaseType: SqlDatabaseType.PostgreSQL,
          port: POSTGRES_PORT,
        });
      };

    test(
      "refuses to record the silently-scoped groups and names pg_monitor",
      async () => {
        const response: DatabaseMonitorResponse | null = await monitor();

        expect(response?.isOnline).toBe(true);

        for (const group of [
          DatabaseMetricGroup.Connections,
          DatabaseMetricGroup.Activity,
          DatabaseMetricGroup.Locks,
        ]) {
          expect({
            group,
            reason: statusFor(response, group)?.reason,
            namesRole:
              statusFor(response, group)?.remediation?.includes(
                "pg_monitor",
              ) === true,
          }).toEqual({
            group,
            reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
            namesRole: true,
          });
        }

        // Readable by any role that can connect.
        expect(response?.collectedGroups).toContain(
          DatabaseMetricGroup.Storage,
        );
        expect(response?.collectedGroups).toContain(
          DatabaseMetricGroup.Throughput,
        );
      },
      LIVE_TIMEOUT_MS,
    );

    test(
      "with pg_monitor, nothing is reported missing",
      async () => {
        await asAdmin("postgres", [`GRANT pg_monitor TO ${MONITOR_LOGIN}`]);

        try {
          const response: DatabaseMonitorResponse | null = await monitor();

          expect(response?.unavailableGroups).toEqual([]);
        } finally {
          await asAdmin("postgres", [
            `REVOKE pg_monitor FROM ${MONITOR_LOGIN}`,
          ]);
        }
      },
      LIVE_TIMEOUT_MS,
    );
  },
);
