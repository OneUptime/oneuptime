// Set required env vars before importing anything that reaches Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  DatabaseHealthQuery,
  DatabaseQueryColumnMapping,
  getDatabaseHealthQueries,
  getProbeQuery,
} from "../../../../../Utils/Monitors/MonitorTypes/DatabaseMonitor/DatabaseHealthQueries";
import {
  DatabaseMetricDefinition,
  DatabaseMetricGroup,
  getDatabaseMetricByMetricType,
  getDatabaseMetricsForEngine,
} from "Common/Types/Monitor/DatabaseMetricCatalog";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import SqlDatabaseType, {
  SqlDatabaseTypeUtil,
} from "Common/Types/Monitor/SqlDatabaseType";
import { describe, expect, test } from "@jest/globals";

/*
 * These tests police the RELATIONSHIP between the query table and the metric
 * catalog. They cannot tell you a column name is wrong - only a live server
 * can, and every statement in the table has been run against one - but they
 * do catch the class of mistake that silently ships: a query that produces a
 * metric its engine is not declared to support, or a metric filed under a
 * collection group that no query in that group actually produces.
 */

const ENGINES: Array<SqlDatabaseType> =
  SqlDatabaseTypeUtil.getSupportedDatabaseTypes();

describe("DatabaseHealthQueries", () => {
  test("every supported engine has queries, and unsupported engines have none", () => {
    for (const engine of ENGINES) {
      expect(getDatabaseHealthQueries(engine).length).toBeGreaterThan(0);
    }

    expect(
      getDatabaseHealthQueries("Cassandra" as SqlDatabaseType),
    ).toHaveLength(0);
  });

  test("every supported engine has a probe query, and it is a bare SELECT", () => {
    for (const engine of ENGINES) {
      const probeQuery: string = getProbeQuery(engine);
      expect(probeQuery.trim().toUpperCase().startsWith("SELECT")).toBe(true);
    }
  });

  test("the PostgreSQL probe query carries the stats-access preflight", () => {
    /*
     * The preflight is the only thing standing between an under-privileged
     * monitor and a permanent, confident "1 connection". If this assertion
     * ever fails, the monitor has gone back to reporting numbers it is not
     * entitled to read.
     */
    const probeQuery: string = getProbeQuery(SqlDatabaseType.PostgreSQL);
    expect(probeQuery).toContain("has_stats_access");
    expect(probeQuery).toContain("pg_monitor");
    expect(probeQuery).toContain("pg_read_all_stats");
  });

  describe.each(ENGINES)("%s", (engine: SqlDatabaseType) => {
    const queries: Array<DatabaseHealthQuery> =
      getDatabaseHealthQueries(engine);

    test("query ids are unique", () => {
      const ids: Array<string> = queries.map((query: DatabaseHealthQuery) => {
        return query.id;
      });

      expect(new Set(ids).size).toBe(ids.length);
    });

    test("every query is a single read-only statement", () => {
      const forbidden: Array<string> = [
        "INSERT",
        "UPDATE",
        "DELETE",
        "DROP",
        "ALTER",
        "CREATE",
        "TRUNCATE",
        "GRANT",
        "REVOKE",
        "EXEC",
      ];

      for (const query of queries) {
        const upperCased: string = query.sql.toUpperCase();

        for (const keyword of forbidden) {
          expect({
            id: query.id,
            containsWriteKeyword: new RegExp(`\\b${keyword}\\b`).test(
              upperCased,
            ),
          }).toEqual({ id: query.id, containsWriteKeyword: false });
        }

        /*
         * One statement per query. The drivers are configured to reject
         * stacked statements, but a stray semicolon would turn a silent
         * driver rejection into a confusing per-group failure.
         */
        expect({
          id: query.id,
          trailingStatements: query.sql.replace(/;\s*$/, "").includes(";"),
        }).toEqual({ id: query.id, trailingStatements: false });
      }
    });

    test("every mapped column produces a metric this engine is declared to support", () => {
      for (const query of queries) {
        for (const mapping of query.columnMappings) {
          const definition: DatabaseMetricDefinition | null =
            getDatabaseMetricByMetricType(mapping.metricType);

          expect({
            query: query.id,
            column: mapping.column,
            inCatalog: definition !== null,
          }).toEqual({
            query: query.id,
            column: mapping.column,
            inCatalog: true,
          });

          expect({
            query: query.id,
            metric: mapping.metricType,
            supportsEngine: definition?.engines.includes(engine),
          }).toEqual({
            query: query.id,
            metric: mapping.metricType,
            supportsEngine: true,
          });
        }
      }
    });

    test("a metric is produced by the collection group the catalog files it under", () => {
      /*
       * A query's group is what an operator switches off. If the catalog
       * says database size is Storage but the only query producing it is
       * tagged Throughput, then disabling Throughput silently takes size
       * with it and enabling Storage does nothing - which is exactly the
       * mismatch this assertion was written after finding.
       */
      for (const query of queries) {
        for (const mapping of query.columnMappings) {
          const definition: DatabaseMetricDefinition | null =
            getDatabaseMetricByMetricType(mapping.metricType);

          expect({
            query: query.id,
            metric: mapping.metricType,
            group: query.group,
          }).toEqual({
            query: query.id,
            metric: mapping.metricType,
            group: definition?.group,
          });
        }
      }
    });

    test("every column mapping is distinct within a query", () => {
      for (const query of queries) {
        const columns: Array<string> = query.columnMappings.map(
          (mapping: DatabaseQueryColumnMapping) => {
            return mapping.column.toLowerCase();
          },
        );

        expect({ id: query.id, unique: new Set(columns).size }).toEqual({
          id: query.id,
          unique: columns.length,
        });
      }
    });

    test("every mapped column is actually selected by its query", () => {
      /*
       * Catches the rename that updates the SQL but not the mapping (or the
       * other way round), which would otherwise show up only as a metric
       * that quietly stopped being written.
       */
      for (const query of queries) {
        /*
         * SHOW statements name no columns - the engine decides them - so
         * there is nothing in the SQL text to match against.
         */
        if (query.sql.trim().toUpperCase().startsWith("SHOW")) {
          continue;
        }

        for (const mapping of query.columnMappings) {
          expect({
            query: query.id,
            column: mapping.column,
            selected: query.sql
              .toLowerCase()
              .includes(mapping.column.toLowerCase()),
          }).toEqual({
            query: query.id,
            column: mapping.column,
            selected: true,
          });
        }
      }
    });

    test("groups used by queries are real collection groups", () => {
      const validGroups: Array<DatabaseMetricGroup> =
        Object.values(DatabaseMetricGroup);

      for (const query of queries) {
        expect(validGroups).toContain(query.group);
      }
    });

    test("version gates are ordered and non-overlapping where both are set", () => {
      for (const query of queries) {
        if (
          query.minServerVersionNum !== undefined &&
          query.maxServerVersionNum !== undefined
        ) {
          expect(query.minServerVersionNum).toBeLessThanOrEqual(
            query.maxServerVersionNum,
          );
        }
      }
    });
  });

  test("PostgreSQL gates the checkpoint counters so exactly one variant runs per version", () => {
    /*
     * PostgreSQL 17 moved the checkpoint counters out of pg_stat_bgwriter
     * into pg_stat_checkpointer and renamed them. Both variants exist in the
     * table; running both on any version would report one as a failed group.
     */
    const queries: Array<DatabaseHealthQuery> = getDatabaseHealthQueries(
      SqlDatabaseType.PostgreSQL,
    );

    const legacy: DatabaseHealthQuery | undefined = queries.find(
      (query: DatabaseHealthQuery) => {
        return query.id === "pg-checkpoints-legacy";
      },
    );
    const modern: DatabaseHealthQuery | undefined = queries.find(
      (query: DatabaseHealthQuery) => {
        return query.id === "pg-checkpoints-modern";
      },
    );

    expect(legacy).toBeDefined();
    expect(modern).toBeDefined();
    expect(legacy?.sql).toContain("pg_stat_bgwriter");
    expect(modern?.sql).toContain("pg_stat_checkpointer");

    // The gates must abut, leaving no version served by both or by neither.
    expect(legacy?.maxServerVersionNum).toBe(169999);
    expect(modern?.minServerVersionNum).toBe(170000);
  });

  test("PostgreSQL replication queries are split by recovery state", () => {
    /*
     * pg_current_wal_lsn() and pg_stat_replication are primary-only;
     * pg_last_xact_replay_timestamp() is standby-only. Running the wrong one
     * raises an error rather than returning nothing, so the split is a
     * correctness gate.
     */
    const queries: Array<DatabaseHealthQuery> = getDatabaseHealthQueries(
      SqlDatabaseType.PostgreSQL,
    );

    const primary: DatabaseHealthQuery | undefined = queries.find(
      (query: DatabaseHealthQuery) => {
        return query.id === "pg-replication-primary";
      },
    );
    const standby: DatabaseHealthQuery | undefined = queries.find(
      (query: DatabaseHealthQuery) => {
        return query.id === "pg-replication-standby";
      },
    );

    expect(primary?.runOnlyWhenInRecovery).toBe(false);
    expect(standby?.runOnlyWhenInRecovery).toBe(true);
  });

  test("the PostgreSQL queries that silently under-report are the ones flagged for preflight", () => {
    const queries: Array<DatabaseHealthQuery> = getDatabaseHealthQueries(
      SqlDatabaseType.PostgreSQL,
    );

    for (const query of queries) {
      /*
       * pg_stat_activity and pg_locks are the two views that return only the
       * caller's own rows without pg_monitor. Any query reading either must
       * be gated, or it will record confident, wrong numbers.
       */
      const readsRestrictedView: boolean =
        query.sql.includes("pg_stat_activity") ||
        query.sql.includes("pg_locks");

      if (readsRestrictedView) {
        expect({
          id: query.id,
          gated: query.requiresPostgresStatsAccess === true,
        }).toEqual({ id: query.id, gated: true });
      }
    }
  });

  test("every query needing a grant explains which one", () => {
    for (const engine of ENGINES) {
      for (const query of getDatabaseHealthQueries(engine)) {
        if (query.remediation !== undefined) {
          expect(query.remediation.length).toBeGreaterThan(10);
        }
      }
    }

    /*
     * SQL Server's server-scoped DMVs are useless without VIEW SERVER STATE,
     * and that is the single most common reason a SQL Server health monitor
     * comes back half empty - so those queries must carry the fix.
     */
    const sqlServerQueries: Array<DatabaseHealthQuery> =
      getDatabaseHealthQueries(SqlDatabaseType.MicrosoftSqlServer);

    const dmvQueries: Array<DatabaseHealthQuery> = sqlServerQueries.filter(
      (query: DatabaseHealthQuery) => {
        return query.sql.includes("sys.dm_");
      },
    );

    expect(dmvQueries.length).toBeGreaterThan(0);

    for (const query of dmvQueries) {
      if (query.id === "mssql-storage") {
        // Database-scoped; readable without VIEW SERVER STATE.
        continue;
      }

      expect({
        id: query.id,
        mentionsGrant:
          query.remediation?.includes("VIEW SERVER STATE") === true,
      }).toEqual({ id: query.id, mentionsGrant: true });
    }
  });

  test("every metric an engine claims to support is actually produced for it", () => {
    /*
     * The mirror of the mapping test above, and the direction that actually
     * shipped a gap: the catalog listed MySQL under replication lag while
     * the MySQL query table had no Replication group at all, so the metric
     * was advertised in the criteria picker and could never have a value.
     *
     * Derived metrics are the exception - they are computed by the collector
     * from raw columns rather than mapped from one - so they are listed
     * here explicitly rather than skipped by a pattern, which would let a
     * genuine gap hide behind a naming coincidence.
     */
    const derivedByEngine: Record<string, Array<MonitorMetricType>> = {
      /*
       * Written by the collector on every check rather than read from the
       * database, so it belongs to every engine.
       */
      [SqlDatabaseType.PostgreSQL]: [
        MonitorMetricType.DatabaseMetricGroupsFailed,
        MonitorMetricType.DatabaseConnectionsUsedPercent,
        MonitorMetricType.DatabaseCacheHitPercent,
        MonitorMetricType.DatabaseTransactionsTotal,
        MonitorMetricType.DatabaseRollbackPercent,
      ],
      [SqlDatabaseType.MySQL]: [
        MonitorMetricType.DatabaseMetricGroupsFailed,
        MonitorMetricType.DatabaseConnectionsUsedPercent,
        MonitorMetricType.DatabaseCacheHitPercent,
      ],
      [SqlDatabaseType.MicrosoftSqlServer]: [
        MonitorMetricType.DatabaseMetricGroupsFailed,
        MonitorMetricType.DatabaseCacheHitPercent,
      ],
    };

    for (const engine of ENGINES) {
      const produced: Set<MonitorMetricType> = new Set<MonitorMetricType>([
        ...getDatabaseHealthQueries(engine).flatMap(
          (query: DatabaseHealthQuery) => {
            return query.columnMappings.map(
              (mapping: DatabaseQueryColumnMapping) => {
                return mapping.metricType;
              },
            );
          },
        ),
        ...(derivedByEngine[engine] || []),
      ]);

      for (const metric of getDatabaseMetricsForEngine(engine)) {
        expect({
          engine,
          metric: metric.metricType,
          produced: produced.has(metric.metricType),
        }).toEqual({ engine, metric: metric.metricType, produced: true });
      }
    }
  });

  test("MySQL never claims to produce a deadlock counter", () => {
    /*
     * Stock MySQL exposes no deadlock counter - confirmed on 8.4.11, where
     * performance_schema.global_status has no row matching '%deadlock%'.
     * A mapping claiming otherwise would write a permanently absent series
     * and make the Locks card look broken on MySQL.
     */
    for (const query of getDatabaseHealthQueries(SqlDatabaseType.MySQL)) {
      expect(query.sql.toLowerCase()).not.toContain("deadlock");
    }
  });
});
