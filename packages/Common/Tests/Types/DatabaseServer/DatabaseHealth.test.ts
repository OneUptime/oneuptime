import MetricMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import {
  DATABASE_HEALTH_CATEGORY_ORDER,
  DATABASE_HEALTH_REASONS,
  DATABASE_STATUS_DEGRADED,
  DATABASE_STATUS_HEALTHY,
  DATABASE_STATUS_NO_ENGINE_METRICS,
  DATABASE_STATUS_REPORTING,
  DATABASE_STATUS_STOPPED,
  DATABASE_STATUS_UNHEALTHY,
  DatabaseHealthAssessment,
  DatabaseHealthFinding,
  DatabaseHealthRow,
  DatabaseHealthSeverity,
  DatabaseHealthText,
  REASON_ENGINE_METRICS_STOPPED,
  assessDatabase,
  compareDatabasesByUrgency,
  formatDatabaseHealthBytes,
  formatDatabaseHealthPercent,
  formatDatabaseHealthRatio,
  getDatabaseEngineHealthVerdict,
  getDatabaseEngineMetricsState,
  judgeDatabaseAlertTemplate,
  judgeDatabaseEngineReadings,
} from "../../../Types/DatabaseServer/DatabaseHealth";
import {
  DATABASE_ENGINE_READINGS_STALE_MS,
  DatabaseEngineReadingQuery,
  DatabaseEngineReadings,
  getDatabaseEngineReadingKey,
  getDatabaseEngineReadingQueries,
} from "../../../Types/DatabaseServer/DatabaseEngineReadings";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import {
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  DATABASE_ALERT_METRICS,
  DatabaseAlertQuery,
  DatabaseAlertTemplate,
  DatabaseAlertTemplateArgs,
  getAllDatabaseAlertTemplates,
  getDatabaseAlertTemplateById,
  getDatabaseAlertTemplates,
  getDatabaseEnginesWithAlertTemplates,
} from "../../../Types/Monitor/DatabaseAlertTemplates";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A database's health is its engine's alert templates judged against what
 * the engine last reported. These hold the rules to that, end to end:
 *
 *   - every template that has a line has words, and every line is the
 *     template's own - proved against the real metric criteria evaluator
 *     the monitor runs, over seeded random readings on both sides of each
 *     line, formulas and two-condition breaches included;
 *   - each engine's lines, worded as a DBA reads them, the most urgent
 *     first, one finding per category;
 *   - what a database without fresh readings, without engine metrics, or
 *     whose engine metrics stopped says instead.
 */

const NOW: Date = new Date("2026-11-03T10:00:00.000Z");
const INSTANCE: string = "db.prod.internal:5432";

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

// What a calm engine reports: every reading query, nowhere near a line.
const CALM_VALUES: Record<string, number> = {
  // PostgreSQL
  "Count|postgresql.connection.max|": 1,
  "Sum|postgresql.backends|": 20,
  "Sum|postgresql.connection.max|": 100,
  "Max|postgresql.wal.delay|operation=replay": 0.4,
  "Max|postgresql.replication.data_delay|": 2048,
  "Max|postgresql.db_size|": 12_000_000_000,
  // PostgreSQL: the Database Agent's own SQL checks.
  "Min|postgresql.uptime|": 86_400,
  "Max|postgresql.xid.oldest_age|": 120_000_000,
  "Max|postgresql.transaction.longest_duration|": 4,
  "Max|postgresql.sessions.waiting_on_lock|": 0,
  // MySQL / MariaDB
  "Count|mysql.uptime|": 1,
  "Min|mysql.uptime|": 86_400,
  "Max|mysql.threads|kind=connected": 22,
  "Max|mysql.threads|kind=running": 3,
  "Sum|mysql.buffer_pool.data_pages|status=dirty": 120,
  "Sum|mysql.buffer_pool.pages|kind=total": 8192,
  "Max|mysql.replica.time_behind_source|": 0,
  // Redis / Valkey
  "Count|redis.uptime|": 1,
  "Min|redis.uptime|": 86_400,
  "Sum|redis.memory.used|": 120_000_000,
  "Sum|redis.maxmemory|": 1_000_000_000,
  "Avg|redis.memory.fragmentation_ratio|": 1.08,
  "Avg|redis.memory.used|": 120_000_000,
  "Max|redis.clients.connected|": 42,
  // MongoDB
  "Count|mongodb.database.count|": 1,
  "Min|mongodb.uptime|": 86_400_000,
  "Sum|mongodb.connection.count|type=current": 40,
  "Sum|mongodb.connection.count|type=available": 800,
  // SQL Server
  "Count|sqlserver.user.connection.count|": 1,
  "Min|sqlserver.page.buffer_cache.hit_ratio|": 99.6,
  "Min|sqlserver.page.life_expectancy|": 4200,
  "Max|sqlserver.processes.blocked|": 0,
  "Max|sqlserver.memory.grants.pending.count|": 0,
  // Oracle
  "Count|oracledb.sessions.usage|": 6,
  "Max|oracledb.tablespace.utilization|": 0.41,
  // Elasticsearch / OpenSearch
  "Count|elasticsearch.cluster.health|": 3,
  "Max|elasticsearch.cluster.health|status=red": 0,
  "Max|elasticsearch.cluster.health|status=yellow": 0,
  "Max|elasticsearch.cluster.pending_tasks|": 0,
  "Max|jvm.memory.heap.utilization|": 0.52,
  // Memcached
  "Count|memcached.threads|": 1,
  "Max|memcached.connections.current|": 12,
  // CouchDB
  "Count|couchdb.database.open|": 1,
  "Max|couchdb.average_request_time|": 24,
};

const ENGINES: Array<string> = [
  "postgresql",
  "mysql",
  "mariadb",
  "redis",
  "valkey",
  "mongodb",
  "microsoft.sql_server",
  "oracle.db",
  "elasticsearch",
  "opensearch",
  "memcached",
  "couchdb",
];

function readingsWith(
  overrides: Record<string, number>,
  at: string = minutesAgo(1),
): DatabaseEngineReadings {
  return {
    instances: {
      [INSTANCE]: { at: at, values: { ...CALM_VALUES, ...overrides } },
    },
  };
}

function connectedRow(
  dbSystem: string,
  overrides: Record<string, number> = {},
  extra: Partial<DatabaseHealthRow> = {},
): DatabaseHealthRow {
  return {
    dbSystem: dbSystem,
    otelCollectorStatus: "connected",
    collectorLastSeenAt: minutesAgo(3),
    engineReadings: readingsWith(overrides),
    engineReadingsAt: minutesAgo(1),
    ...extra,
  };
}

function assess(row: DatabaseHealthRow): DatabaseHealthAssessment {
  return assessDatabase(row, { now: NOW });
}

function key(
  metricName: string,
  aggregation: string,
  attributes: Record<string, string> = {},
): string {
  return getDatabaseEngineReadingKey({
    metricName: metricName,
    aggregationType:
      aggregation as unknown as DatabaseAlertQuery["aggregationType"],
    attributes: attributes,
  });
}

function template(id: string): DatabaseAlertTemplate {
  const found: DatabaseAlertTemplate | undefined =
    getDatabaseAlertTemplateById(id);
  if (!found) {
    throw new Error(`No template ${id}`);
  }
  return found;
}

function reasonsOf(
  assessment: DatabaseHealthAssessment,
): Array<DatabaseHealthText> {
  return assessment.reasons;
}

const JUDGED_TEMPLATES: Array<DatabaseAlertTemplate> =
  getAllDatabaseAlertTemplates().filter(
    (candidate: DatabaseAlertTemplate): boolean => {
      return !candidate.criteria.triggerOnNoData;
    },
  );

describe("DatabaseHealth - the rules are the alert templates", () => {
  test("every template with a line has words, and every word set names a template", () => {
    const ids: Array<string> = JUDGED_TEMPLATES.map(
      (candidate: DatabaseAlertTemplate): string => {
        return candidate.id;
      },
    );
    expect(Object.keys(DATABASE_HEALTH_REASONS).sort()).toEqual(
      [...ids].sort(),
    );
  });

  test.each(
    getAllDatabaseAlertTemplates().map(
      (candidate: DatabaseAlertTemplate): [string, DatabaseAlertTemplate] => {
        return [candidate.id, candidate];
      },
    ),
  )(
    "%s: the monitor it builds is exactly the lines it exposes",
    (_id: string, candidate: DatabaseAlertTemplate) => {
      const step: MonitorStep = candidate.getMonitorStep(buildArgs());
      const viewConfig: MetricsViewConfig =
        step.data!.metricMonitor!.metricViewConfig;

      expect(step.data!.metricMonitor!.rollingTime).toBe(candidate.rollingTime);
      expect(
        viewConfig.queryConfigs.map(
          (
            queryConfig: MetricQueryConfigData,
          ): [string, string, string, Record<string, unknown>] => {
            const attributes: Record<string, unknown> = {
              ...(queryConfig.metricQueryData.filterData.attributes || {}),
            };
            // The scope getMonitorStep adds, and the page never needs.
            delete attributes["oneuptime.database.server.id"];
            return [
              queryConfig.metricAliasData!.metricVariable!,
              String(queryConfig.metricQueryData.filterData.metricName),
              String(queryConfig.metricQueryData.filterData.aggegationType),
              attributes,
            ];
          },
        ),
      ).toEqual(
        candidate.queries.map(
          (
            query: DatabaseAlertQuery,
          ): [string, string, string, Record<string, unknown>] => {
            return [
              query.alias,
              query.metricName,
              String(query.aggregationType),
              { ...(query.attributes || {}) },
            ];
          },
        ),
      );
      expect(
        viewConfig.formulaConfigs.map(
          (formulaConfig: MetricFormulaConfigData): [string, string] => {
            return [
              formulaConfig.metricAliasData!.metricVariable!,
              formulaConfig.metricFormulaData.metricFormula,
            ];
          },
        ),
      ).toEqual(
        candidate.formula
          ? [[candidate.formula.alias, candidate.formula.expression]]
          : [],
      );

      const unhealthy: MonitorCriteriaInstance = getUnhealthy(step);
      const [first, second] = unhealthy.data!.filters;
      expect([
        first!.metricMonitorOptions?.metricAlias,
        first!.filterType,
        Number(first!.value),
      ]).toEqual([
        candidate.criteria.metricAlias,
        candidate.criteria.filterType,
        candidate.criteria.threshold,
      ]);
      if (candidate.criteria.additionalFilter) {
        expect([
          second!.metricMonitorOptions?.metricAlias,
          second!.filterType,
          Number(second!.value),
          unhealthy.data!.filterCondition,
        ]).toEqual([
          candidate.criteria.additionalFilter.metricAlias,
          candidate.criteria.additionalFilter.filterType,
          Number(candidate.criteria.additionalFilter.value),
          FilterCondition.All,
        ]);
      } else {
        expect(second).toBeUndefined();
      }
    },
  );

  test("the calm readings cover every query a template reads", () => {
    for (const query of getDatabaseEngineReadingQueries()) {
      expect(Object.keys(CALM_VALUES)).toContain(query.key);
    }
  });

  test("covers the nine engines the templates were written for", () => {
    expect(getDatabaseEnginesWithAlertTemplates()).toEqual([
      "postgresql",
      "mysql",
      "redis",
      "mongodb",
      "microsoft.sql_server",
      "oracle.db",
      "elasticsearch",
      "memcached",
      "couchdb",
    ]);
  });

  test.each(ENGINES)(
    "%s: calm readings are Healthy, with every one of its lines judged",
    (engine: string) => {
      const assessment: DatabaseHealthAssessment = assess(connectedRow(engine));
      expect(assessment.state).toBe("healthy");
      expect(assessment.status).toEqual({ text: DATABASE_STATUS_HEALTHY });
      expect(assessment.tone).toBe("positive");
      expect(assessment.findings).toEqual([]);
      expect(
        assessment.judgements
          .map((judgement: { template: DatabaseAlertTemplate }): string => {
            return judgement.template.id;
          })
          .sort(),
      ).toEqual(
        getDatabaseAlertTemplates(engine)
          .filter((candidate: DatabaseAlertTemplate): boolean => {
            return !candidate.criteria.triggerOnNoData;
          })
          .map((candidate: DatabaseAlertTemplate): string => {
            return candidate.id;
          })
          .sort(),
      );
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The real monitor, for the parity proof
 * ---------------------------------------------------------------------------
 */

const NATIVE_UNITS_BY_METRIC_NAME: Record<string, string> = {};
for (const metric of DATABASE_ALERT_METRICS) {
  NATIVE_UNITS_BY_METRIC_NAME[metric.metricName.toLowerCase()] = metric.unit;
}

function buildArgs(): DatabaseAlertTemplateArgs {
  return {
    databaseServerId: "d0000000-0000-4000-8000-000000000042",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "orders-db",
  };
}

function getUnhealthy(step: MonitorStep): MonitorCriteriaInstance {
  return step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray.find(
    (instance: MonitorCriteriaInstance): boolean => {
      return Boolean(instance.data?.createIncidents);
    },
  )!;
}

// The monitor's response to ten minutes of the same reading of each query.
function buildResponse(
  step: MonitorStep,
  aliasValues: Record<string, number>,
): MetricMonitorResponse {
  const viewConfig: MetricsViewConfig =
    step.data!.metricMonitor!.metricViewConfig;
  const start: number = Date.UTC(2026, 10, 3, 9, 50, 0);

  const results: Array<AggregatedResult> = viewConfig.queryConfigs.map(
    (queryConfig: MetricQueryConfigData): AggregatedResult => {
      const value: number =
        aliasValues[queryConfig.metricAliasData?.metricVariable || ""]!;
      const data: Array<AggregateModel> = [];
      for (let minute: number = 0; minute < 10; minute++) {
        data.push({
          timestamp: new Date(start + minute * 60000),
          value: value,
        } as AggregateModel);
      }
      return { data: data };
    },
  );

  viewConfig.formulaConfigs.forEach(
    (formulaConfig: MetricFormulaConfigData, index: number) => {
      results.push(
        MetricFormulaEvaluator.evaluateFormula({
          formula: formulaConfig.metricFormulaData.metricFormula,
          queryConfigs: viewConfig.queryConfigs,
          formulaConfigs: viewConfig.formulaConfigs.slice(0, index),
          results: results,
        }),
      );
    },
  );

  return {
    projectId: ObjectID.generate(),
    metricResult: results,
    metricViewConfig: viewConfig,
    monitorId: ObjectID.generate(),
    nativeUnitsByMetricName: NATIVE_UNITS_BY_METRIC_NAME,
  };
}

async function monitorBreaches(
  candidate: DatabaseAlertTemplate,
  aliasValues: Record<string, number>,
): Promise<boolean> {
  const step: MonitorStep = candidate.getMonitorStep(buildArgs());
  const response: MetricMonitorResponse = buildResponse(step, aliasValues);
  const instance: MonitorCriteriaInstance = getUnhealthy(step);
  const met: Array<boolean> = [];
  for (const filter of instance.data!.filters) {
    const rootCause: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response,
        criteriaFilter: JSON.parse(JSON.stringify(filter)) as CriteriaFilter,
        monitorStep: step,
      });
    met.push(rootCause !== null);
  }
  return instance.data!.filterCondition === FilterCondition.All
    ? met.every((value: boolean): boolean => {
        return value;
      })
    : met.some((value: boolean): boolean => {
        return value;
      });
}

function pageBreaches(
  candidate: DatabaseAlertTemplate,
  aliasValues: Record<string, number>,
): boolean | null {
  const values: Record<string, number> = {};
  for (const query of candidate.queries) {
    values[getDatabaseEngineReadingKey(query)] = aliasValues[query.alias]!;
  }
  const judged: { value: number; isBreached: boolean } | null =
    judgeDatabaseAlertTemplate({
      template: candidate,
      instances: [{ at: minutesAgo(1), values: values }],
    });
  return judged ? judged.isBreached : null;
}

/*
 * Readings that put a template's compared value at `target`: the query
 * itself, or the inputs of its formula, solved for the target. A formula of
 * another shape fails here, so a template that adds one gets a solver.
 */
function aliasValuesFor(
  candidate: DatabaseAlertTemplate,
  target: number,
  random: SeededRandom,
): Record<string, number> {
  const values: Record<string, number> = {};
  const aliases: Array<string> = candidate.queries.map(
    (query: DatabaseAlertQuery): string => {
      return query.alias;
    },
  );

  if (!candidate.formula) {
    for (const alias of aliases) {
      values[alias] = target;
    }
    const additional: CriteriaFilterLike | undefined =
      candidate.criteria.additionalFilter;
    if (additional) {
      // The second condition, on either side of its own line.
      values[additional.metricAlias] =
        Number(additional.value) * (random() < 0.5 ? 0.6 : 1.4);
    }
    return values;
  }

  const expression: string = candidate.formula.expression;
  const [first, second] = aliases;

  if (expression === `(${first} / ${second}) * 100`) {
    const denominator: number = 50 + random(5000);
    values[second!] = denominator;
    values[first!] = (denominator * target) / 100;
    return values;
  }

  if (expression === `(${first} / (${first} + ${second})) * 100`) {
    const current: number = 10 + random(5000);
    values[first!] = current;
    values[second!] = target > 0 ? (current * (100 - target)) / target : 1;
    return values;
  }

  if (expression === `${first} * 100`) {
    values[first!] = target / 100;
    return values;
  }

  throw new Error(`No solver for the formula "${expression}"`);
}

interface CriteriaFilterLike {
  metricAlias: string;
  filterType: FilterType;
  value: number | string;
}

describe("DatabaseHealth - the page's lines are the monitor's (seeded property test)", () => {
  test.each(
    JUDGED_TEMPLATES.map(
      (candidate: DatabaseAlertTemplate): [string, DatabaseAlertTemplate] => {
        return [candidate.id, candidate];
      },
    ),
  )(
    "%s: the page and the monitor agree on both sides of the line",
    async (_id: string, candidate: DatabaseAlertTemplate) => {
      const random: SeededRandom = seededRandom(
        candidate.id.length * 7919 + 17,
      );
      const threshold: number = candidate.criteria.threshold;
      const factors: Array<number> = [0, 0.5, 0.9, 0.999, 1, 1.001, 1.1, 2];
      for (let draw: number = 0; draw < 24; draw++) {
        factors.push(0.5 + random());
      }

      const seen: Set<boolean> = new Set<boolean>();
      for (const factor of factors) {
        const target: number = candidate.criteria.isBinaryMetric
          ? factor >= 1
            ? 1
            : 0
          : threshold * factor;
        const aliasValues: Record<string, number> = aliasValuesFor(
          candidate,
          target,
          random,
        );
        const page: boolean | null = pageBreaches(candidate, aliasValues);
        const monitor: boolean = await monitorBreaches(candidate, aliasValues);
        if (page === null) {
          // Only a formula with no answer is not judged; the monitor never fires on it.
          expect(monitor).toBe(false);
          continue;
        }
        expect({ factor: factor, page: page }).toEqual({
          factor: factor,
          page: monitor,
        });
        seen.add(page);
      }
      // Both sides of the line were drawn: the agreement is never vacuous.
      expect(Array.from(seen).sort()).toEqual([false, true]);
    },
  );

  test("exactly at a line counts as crossing it for 'at or above', never for 'below'", () => {
    const random: SeededRandom = seededRandom(5);
    for (const candidate of JUDGED_TEMPLATES) {
      if (candidate.formula) {
        continue;
      }
      const atLine: boolean | null = pageBreaches(
        candidate,
        aliasValuesFor(candidate, candidate.criteria.threshold, random),
      );
      if (candidate.criteria.additionalFilter) {
        continue;
      }
      expect({ id: candidate.id, atLine: atLine }).toEqual({
        id: candidate.id,
        atLine:
          candidate.criteria.filterType === FilterType.GreaterThanOrEqualTo,
      });
    }
  });
});

describe("DatabaseHealth - what the engine metrics' status says", () => {
  test("never reported: no engine metrics, nothing judged", () => {
    const assessment: DatabaseHealthAssessment = assess({
      dbSystem: "postgresql",
      otelCollectorStatus: null,
      collectorLastSeenAt: null,
      // Readings a foreign writer left behind are not the truth either.
      engineReadings: readingsWith({ "Sum|postgresql.backends|": 99 }),
    });
    expect(assessment.state).toBe("no-engine-metrics");
    expect(assessment.status).toEqual({
      text: DATABASE_STATUS_NO_ENGINE_METRICS,
    });
    expect(assessment.tone).toBe("neutral");
    expect(assessment.severity).toBeNull();
    expect(assessment.findings).toEqual([]);
    expect(assessment.engineMetrics).toBe("not-connected");
  });

  test("a row from before the column's default was dropped reads 'disconnected' but never reported", () => {
    expect(
      getDatabaseEngineMetricsState({
        otelCollectorStatus: "disconnected",
        collectorLastSeenAt: null,
      }),
    ).toBe("not-connected");
    expect(
      assess({ dbSystem: "mysql", otelCollectorStatus: "disconnected" }).state,
    ).toBe("no-engine-metrics");
  });

  test("reported, then stopped: Engine metrics stopped, critical, with when they last arrived", () => {
    const assessment: DatabaseHealthAssessment = assess({
      dbSystem: "postgresql",
      otelCollectorStatus: "disconnected",
      collectorLastSeenAt: minutesAgo(31),
      engineReadings: readingsWith(
        { "Sum|postgresql.backends|": 99 },
        minutesAgo(27),
      ),
      engineReadingsAt: minutesAgo(27),
    });
    expect(assessment.state).toBe("stopped");
    expect(assessment.status).toEqual({ text: DATABASE_STATUS_STOPPED });
    expect(assessment.tone).toBe("danger");
    expect(assessment.severity).toBe(DatabaseHealthSeverity.Critical);
    // What it last reported (99% of max_connections) is not judged.
    expect(assessment.judgements).toEqual([]);
    expect(assessment.findings).toEqual([
      {
        key: "engine-metrics",
        category: "Availability",
        severity: DatabaseHealthSeverity.Critical,
        reasons: [{ text: REASON_ENGINE_METRICS_STOPPED }],
        templateIds: ["database-postgresql-engine-metrics-stopped"],
        lastReportAt: new Date(minutesAgo(27)),
      },
    ]);
    expect(assessment.lastReportAt!.toISOString()).toBe(minutesAgo(27));
  });

  test("stopped names the Engine Metrics Stopped template of a fork's family", () => {
    expect(
      assess({
        dbSystem: "valkey",
        otelCollectorStatus: "disconnected",
        collectorLastSeenAt: minutesAgo(40),
      }).findings[0]!.templateIds,
    ).toEqual(["database-redis-engine-metrics-stopped"]);
  });

  test("an engine without recommended alerts that stopped says so too", () => {
    const assessment: DatabaseHealthAssessment = assess({
      dbSystem: "cockroachdb",
      otelCollectorStatus: "disconnected",
      collectorLastSeenAt: minutesAgo(40),
    });
    expect(assessment.state).toBe("stopped");
    expect(assessment.findings[0]!.templateIds).toEqual([]);
  });

  test("connected without readings: Reporting, never a guessed Healthy", () => {
    const assessment: DatabaseHealthAssessment = assess({
      dbSystem: "postgresql",
      otelCollectorStatus: "connected",
      collectorLastSeenAt: minutesAgo(2),
    });
    expect(assessment.state).toBe("reporting");
    expect(assessment.status).toEqual({ text: DATABASE_STATUS_REPORTING });
    expect(assessment.tone).toBe("neutral");
    expect(assessment.hasFreshReadings).toBe(false);
  });

  test("connected with readings older than fifteen minutes: Reporting, the old numbers not judged", () => {
    const old: string = new Date(
      NOW.getTime() - DATABASE_ENGINE_READINGS_STALE_MS - 60 * 1000,
    ).toISOString();
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow(
        "postgresql",
        {},
        {
          engineReadings: readingsWith({ "Sum|postgresql.backends|": 99 }, old),
        },
      ),
    );
    expect(assessment.state).toBe("reporting");
    expect(assessment.findings).toEqual([]);
  });

  test("an engine with no recommended alerts is Reporting whatever it sends", () => {
    for (const engine of ["cockroachdb", "clickhouse", "sap.hana", ""]) {
      expect(assess(connectedRow(engine)).state).toBe("reporting");
    }
  });
});

describe("DatabaseHealth - PostgreSQL", () => {
  test("connections at 96%: both connection lines crossed, said once, critical", () => {
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow("postgresql", {
        "Sum|postgresql.backends|": 192,
        "Sum|postgresql.connection.max|": 200,
      }),
    );
    expect(assessment.state).toBe("unhealthy");
    expect(assessment.status).toEqual({ text: DATABASE_STATUS_UNHEALTHY });
    expect(assessment.tone).toBe("danger");
    expect(assessment.findings).toEqual([
      {
        key: "connections",
        category: "Connections",
        severity: DatabaseHealthSeverity.Critical,
        reasons: [
          {
            text: "Connections at {{percent}} of max_connections",
            values: { percent: "96%" },
          },
        ],
        templateIds: [
          "database-postgresql-connections-exhausted",
          "database-postgresql-connections-high",
        ],
      },
    ]);
  });

  test("connections at 84%: the early warning only", () => {
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow("postgresql", {
        "Sum|postgresql.backends|": 84,
        "Sum|postgresql.connection.max|": 100,
      }),
    );
    expect(assessment.state).toBe("degraded");
    expect(assessment.status).toEqual({ text: DATABASE_STATUS_DEGRADED });
    expect(assessment.findings[0]!.severity).toBe(
      DatabaseHealthSeverity.Warning,
    );
    expect(assessment.findings[0]!.templateIds).toEqual([
      "database-postgresql-connections-high",
    ]);
  });

  test("94.6% reads 94%, never the critical line's 95%", () => {
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow("postgresql", {
        "Sum|postgresql.backends|": 946,
        "Sum|postgresql.connection.max|": 1000,
      }),
    );
    expect(assessment.findings[0]!.severity).toBe(
      DatabaseHealthSeverity.Warning,
    );
    expect(reasonsOf(assessment)[0]!.values).toEqual({ percent: "94%" });
  });

  test("backends summed across databases and members, as the template sums them", () => {
    const assessment: DatabaseHealthAssessment = assess({
      dbSystem: "postgresql",
      otelCollectorStatus: "connected",
      collectorLastSeenAt: minutesAgo(1),
      engineReadings: {
        instances: {
          "pg-0:5432": {
            at: minutesAgo(1),
            values: {
              ...CALM_VALUES,
              "Sum|postgresql.backends|": 90,
              "Sum|postgresql.connection.max|": 100,
            },
          },
          "pg-1:5432": {
            at: minutesAgo(2),
            values: {
              ...CALM_VALUES,
              "Sum|postgresql.backends|": 10,
              "Sum|postgresql.connection.max|": 100,
            },
          },
        },
      },
    });
    // 100 of 200: neither line, though one member alone is at 90%.
    expect(assessment.state).toBe("healthy");
  });

  test("a member that went quiet no longer counts", () => {
    const assessment: DatabaseHealthAssessment = assess({
      dbSystem: "postgresql",
      otelCollectorStatus: "connected",
      collectorLastSeenAt: minutesAgo(1),
      engineReadings: {
        instances: {
          "pg-0:5432": {
            at: minutesAgo(1),
            values: {
              ...CALM_VALUES,
              "Sum|postgresql.backends|": 90,
              "Sum|postgresql.connection.max|": 100,
            },
          },
          "pg-1:5432": {
            at: minutesAgo(20),
            values: {
              ...CALM_VALUES,
              "Sum|postgresql.backends|": 10,
              "Sum|postgresql.connection.max|": 100,
            },
          },
        },
      },
    });
    expect(reasonsOf(assessment)[0]!.values).toEqual({ percent: "90%" });
  });

  test.each([
    [45, "A replica {{seconds}} s behind", { seconds: "45" }],
    [200, "A replica {{minutes}} min behind", { minutes: "3" }],
    [7300, "A replica {{hours}} h behind", { hours: "2" }],
  ])(
    "replay lag of %s s reads in the unit that fits",
    (lag: number, text: string, values: Record<string, string>) => {
      const assessment: DatabaseHealthAssessment = assess(
        connectedRow("postgresql", {
          "Max|postgresql.wal.delay|operation=replay": lag,
        }),
      );
      expect(assessment.findings).toEqual([
        {
          key: "replication",
          category: "Replication",
          severity: DatabaseHealthSeverity.Warning,
          reasons: [{ text: text, values: values }],
          templateIds: ["database-postgresql-replica-replay-lag"],
        },
      ]);
    },
  );

  test("WAL behind in bytes, and the largest database past its budget", () => {
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow("postgresql", {
        "Max|postgresql.replication.data_delay|": 1_250_000_000,
        "Max|postgresql.db_size|": 512_400_000_000,
      }),
    );
    expect(reasonsOf(assessment)).toEqual([
      {
        text: "A replica {{size}} of WAL behind",
        values: { size: "1.2 GB" },
      },
      { text: "Largest database {{size}}", values: { size: "512.4 GB" } },
    ]);
  });
});

describe("DatabaseHealth - PostgreSQL's own SQL checks", () => {
  test("a restart, read from the uptime the agent's query reports", () => {
    expect(
      reasonsOf(
        assess(connectedRow("postgresql", { "Min|postgresql.uptime|": 150 })),
      ),
    ).toEqual([
      // 150 s of uptime read a minute ago: three minutes ago.
      { text: "Restarted {{minutes}} min ago", values: { minutes: "3" } },
    ]);
  });

  test("transaction ID age: a billion is a warning, 1.5 billion critical, said once as a share of wraparound", () => {
    const warning: DatabaseHealthAssessment = assess(
      connectedRow("postgresql", {
        "Max|postgresql.xid.oldest_age|": 1_100_000_000,
      }),
    );
    expect(warning.state).toBe("degraded");
    expect(warning.findings).toEqual([
      {
        key: "availability",
        category: "Availability",
        severity: DatabaseHealthSeverity.Warning,
        reasons: [
          {
            text: "Transaction IDs at {{percent}} of wraparound",
            values: { percent: "51%" },
          },
        ],
        templateIds: ["database-postgresql-xid-age-high"],
      },
    ]);

    const critical: DatabaseHealthAssessment = assess(
      connectedRow("postgresql", {
        "Max|postgresql.xid.oldest_age|": 1_600_000_000,
      }),
    );
    expect(critical.state).toBe("unhealthy");
    expect(critical.findings[0]!.severity).toBe(
      DatabaseHealthSeverity.Critical,
    );
    expect(critical.findings[0]!.templateIds).toEqual([
      "database-postgresql-xid-wraparound-near",
      "database-postgresql-xid-age-high",
    ]);
    expect(reasonsOf(critical)).toEqual([
      {
        text: "Transaction IDs at {{percent}} of wraparound",
        values: { percent: "74%" },
      },
    ]);
  });

  test("a transaction open for two hours, and sessions waiting on its locks", () => {
    expect(
      reasonsOf(
        assess(
          connectedRow("postgresql", {
            "Max|postgresql.transaction.longest_duration|": 7300,
            "Max|postgresql.sessions.waiting_on_lock|": 3,
          }),
        ),
      ),
    ).toEqual([
      { text: "A transaction open for {{hours}} h", values: { hours: "2" } },
      {
        text: "{{count}} sessions waiting on locks",
        values: { count: "3" },
        plural: { one: "{{count}} session waiting on a lock", count: 3 },
      },
    ]);
  });

  test("an open transaction of minutes, and a moment's lock wait, are no problem by themselves", () => {
    expect(
      assess(
        connectedRow("postgresql", {
          "Max|postgresql.transaction.longest_duration|": 1200,
        }),
      ).state,
    ).toBe("healthy");
  });

  test("a collector without the agent's SQL checks is still judged by the receiver's lines", () => {
    const values: Record<string, number> = { ...CALM_VALUES };
    for (const name of [
      "Min|postgresql.uptime|",
      "Max|postgresql.xid.oldest_age|",
      "Max|postgresql.transaction.longest_duration|",
      "Max|postgresql.sessions.waiting_on_lock|",
    ]) {
      delete values[name];
    }
    values["Sum|postgresql.backends|"] = 97;
    const assessment: DatabaseHealthAssessment = assess({
      dbSystem: "postgresql",
      otelCollectorStatus: "connected",
      collectorLastSeenAt: minutesAgo(1),
      engineReadings: {
        instances: { [INSTANCE]: { at: minutesAgo(1), values: values } },
      },
    });
    expect(assessment.state).toBe("unhealthy");
    expect(
      assessment.judgements.map(
        (judgement: { template: DatabaseAlertTemplate }): string => {
          return judgement.template.id;
        },
      ),
    ).not.toContain("database-postgresql-long-running-transaction");
  });
});

describe("DatabaseHealth - MySQL and MariaDB", () => {
  test.each(["mysql", "mariadb"])(
    "%s: every line, each in its category, the most urgent order",
    (engine: string) => {
      const assessment: DatabaseHealthAssessment = assess(
        connectedRow(engine, {
          "Min|mysql.uptime|": 120,
          "Max|mysql.threads|kind=connected": 140,
          "Max|mysql.threads|kind=running": 55,
          "Sum|mysql.buffer_pool.data_pages|status=dirty": 7000,
          "Max|mysql.replica.time_behind_source|": 45,
        }),
      );
      expect(assessment.state).toBe("degraded");
      expect(
        assessment.findings.map((finding: DatabaseHealthFinding): string => {
          return finding.key;
        }),
      ).toEqual(["availability", "connections", "replication", "performance"]);
      expect(reasonsOf(assessment)).toEqual([
        // Read a minute ago at 120 s of uptime: three minutes ago.
        { text: "Restarted {{minutes}} min ago", values: { minutes: "3" } },
        {
          text: "{{count}} connections, near max_connections",
          values: { count: "140" },
        },
        {
          text: "Replica {{seconds}} s behind its source",
          values: { seconds: "45" },
        },
        {
          text: "{{count}} threads running",
          values: { count: "55" },
          plural: { one: "{{count}} thread running", count: 55 },
        },
        {
          text: "{{percent}} of the buffer pool dirty",
          values: { percent: "85%" },
        },
      ]);
    },
  );

  test("a restart under a minute ago says so", () => {
    const assessment: DatabaseHealthAssessment = assessDatabase(
      {
        ...connectedRow("mysql", { "Min|mysql.uptime|": 12 }),
        engineReadings: readingsWith(
          { "Min|mysql.uptime|": 12 },
          new Date(NOW.getTime() - 10 * 1000).toISOString(),
        ),
      },
      { now: NOW },
    );
    expect(reasonsOf(assessment)).toEqual([
      { text: "Restarted less than a minute ago" },
    ]);
  });

  test("ten minutes of uptime is no restart", () => {
    expect(
      assess(connectedRow("mysql", { "Min|mysql.uptime|": 600 })).state,
    ).toBe("healthy");
  });
});

describe("DatabaseHealth - Redis and Valkey", () => {
  test.each(["redis", "valkey"])(
    "%s: memory near maxmemory, fragmented, near maxclients",
    (engine: string) => {
      const assessment: DatabaseHealthAssessment = assess(
        connectedRow(engine, {
          "Sum|redis.memory.used|": 950_000_000,
          "Sum|redis.maxmemory|": 1_000_000_000,
          "Avg|redis.memory.fragmentation_ratio|": 1.86,
          "Avg|redis.memory.used|": 950_000_000,
          "Max|redis.clients.connected|": 9500,
        }),
      );
      expect(assessment.state).toBe("degraded");
      expect(reasonsOf(assessment)).toEqual([
        {
          text: "{{count}} clients connected",
          values: { count: "9500" },
          plural: { one: "{{count}} client connected", count: 9500 },
        },
        {
          text: "Memory at {{percent}} of maxmemory",
          values: { percent: "95%" },
        },
        {
          text: "Memory fragmentation ratio {{ratio}}",
          values: { ratio: "1.8" },
        },
      ]);
    },
  );

  test("no maxmemory set (0): the memory line is not judged, nothing divides by zero", () => {
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow("redis", {
        "Sum|redis.memory.used|": 950_000_000,
        "Sum|redis.maxmemory|": 0,
      }),
    );
    expect(assessment.state).toBe("healthy");
    expect(
      assessment.judgements.some(
        (judgement: { template: DatabaseAlertTemplate }): boolean => {
          return (
            judgement.template.id === "database-redis-memory-near-maxmemory"
          );
        },
      ),
    ).toBe(false);
  });

  test("a small instance's high fragmentation ratio is no problem", () => {
    expect(
      assess(
        connectedRow("redis", {
          "Avg|redis.memory.fragmentation_ratio|": 4.2,
          "Avg|redis.memory.used|": 30_000_000,
        }),
      ).state,
    ).toBe("healthy");
  });

  test("a restart reads from its uptime", () => {
    expect(
      reasonsOf(assess(connectedRow("redis", { "Min|redis.uptime|": 240 }))),
    ).toEqual([
      { text: "Restarted {{minutes}} min ago", values: { minutes: "5" } },
    ]);
  });
});

describe("DatabaseHealth - MongoDB", () => {
  test("connections at 95% of what it accepts: critical", () => {
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow("mongodb", {
        "Sum|mongodb.connection.count|type=current": 950,
        "Sum|mongodb.connection.count|type=available": 50,
      }),
    );
    expect(assessment.state).toBe("unhealthy");
    expect(reasonsOf(assessment)).toEqual([
      {
        text: "Connections at {{percent}} of what it accepts",
        values: { percent: "95%" },
      },
    ]);
  });

  test("uptime in milliseconds: five minutes up reads as a restart six minutes ago", () => {
    expect(
      reasonsOf(
        assess(connectedRow("mongodb", { "Min|mongodb.uptime|": 300_000 })),
      ),
    ).toEqual([
      { text: "Restarted {{minutes}} min ago", values: { minutes: "6" } },
    ]);
  });
});

describe("DatabaseHealth - SQL Server", () => {
  test("cache, memory and blocking lines", () => {
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow("microsoft.sql_server", {
        "Min|sqlserver.page.buffer_cache.hit_ratio|": 85.2,
        "Min|sqlserver.page.life_expectancy|": 120,
        "Max|sqlserver.processes.blocked|": 3,
        "Max|sqlserver.memory.grants.pending.count|": 1,
      }),
    );
    expect(assessment.state).toBe("degraded");
    expect(
      assessment.findings.map((finding: DatabaseHealthFinding): string => {
        return finding.category;
      }),
    ).toEqual(["Memory", "Performance"]);
    expect(reasonsOf(assessment)).toEqual([
      {
        text: "Page life expectancy {{seconds}} s",
        values: { seconds: "120" },
      },
      {
        text: "{{count}} queries waiting for memory",
        values: { count: "1" },
        plural: { one: "{{count}} query waiting for memory", count: 1 },
      },
      {
        text: "Buffer cache hit ratio {{percent}}",
        values: { percent: "85%" },
      },
      {
        text: "{{count}} blocked sessions",
        values: { count: "3" },
        plural: { one: "{{count}} blocked session", count: 3 },
      },
    ]);
  });

  test("a hit ratio of exactly 90% is above the line", () => {
    expect(
      assess(
        connectedRow("microsoft.sql_server", {
          "Min|sqlserver.page.buffer_cache.hit_ratio|": 90,
        }),
      ).state,
    ).toBe("healthy");
  });
});

describe("DatabaseHealth - Oracle", () => {
  test("the fullest tablespace at 93%: critical, its share read as a percent", () => {
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow("oracle.db", {
        "Max|oracledb.tablespace.utilization|": 0.934,
      }),
    );
    expect(assessment.state).toBe("unhealthy");
    expect(assessment.findings).toEqual([
      {
        key: "storage",
        category: "Storage",
        severity: DatabaseHealthSeverity.Critical,
        reasons: [
          {
            text: "Fullest tablespace {{percent}} full",
            values: { percent: "93%" },
          },
        ],
        templateIds: ["database-oracle-tablespace-nearly-full"],
      },
    ]);
  });
});

describe("DatabaseHealth - Elasticsearch and OpenSearch", () => {
  test.each(["elasticsearch", "opensearch"])(
    "%s: red is critical before what else needs a look",
    (engine: string) => {
      const assessment: DatabaseHealthAssessment = assess(
        connectedRow(engine, {
          "Max|elasticsearch.cluster.health|status=red": 1,
          "Max|elasticsearch.cluster.pending_tasks|": 12,
          "Max|jvm.memory.heap.utilization|": 0.91,
        }),
      );
      expect(assessment.state).toBe("unhealthy");
      expect(
        assessment.findings.map(
          (finding: DatabaseHealthFinding): [string, string] => {
            return [finding.category, finding.severity];
          },
        ),
      ).toEqual([
        ["Availability", "critical"],
        ["Memory", "warning"],
        ["Performance", "warning"],
      ]);
      expect(reasonsOf(assessment)).toEqual([
        { text: "Cluster health red" },
        { text: "JVM heap at {{percent}}", values: { percent: "91%" } },
        {
          text: "{{count}} cluster tasks pending",
          values: { count: "12" },
          plural: { one: "{{count}} cluster task pending", count: 12 },
        },
      ]);
    },
  );

  test("yellow is a warning", () => {
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow("elasticsearch", {
        "Max|elasticsearch.cluster.health|status=yellow": 1,
      }),
    );
    expect(assessment.state).toBe("degraded");
    expect(reasonsOf(assessment)).toEqual([{ text: "Cluster health yellow" }]);
  });
});

describe("DatabaseHealth - Memcached and CouchDB", () => {
  test("Memcached near its connection limit", () => {
    expect(
      reasonsOf(
        assess(
          connectedRow("memcached", {
            "Max|memcached.connections.current|": 950,
          }),
        ),
      ),
    ).toEqual([
      {
        text: "{{count}} connections, near the limit",
        values: { count: "950" },
      },
    ]);
  });

  test("CouchDB requests averaging past a second", () => {
    expect(
      reasonsOf(
        assess(
          connectedRow("couchdb", {
            "Max|couchdb.average_request_time|": 1580,
          }),
        ),
      ),
    ).toEqual([
      { text: "Requests averaging {{seconds}} s", values: { seconds: "1.5" } },
    ]);
  });
});

describe("DatabaseHealth - findings, verdict and urgency", () => {
  test("critical findings come before warnings, then the alerts' category order", () => {
    const assessment: DatabaseHealthAssessment = assess(
      connectedRow("postgresql", {
        "Max|postgresql.db_size|": 600_000_000_000,
        "Max|postgresql.wal.delay|operation=replay": 31,
        "Sum|postgresql.backends|": 99,
        "Sum|postgresql.connection.max|": 100,
      }),
    );
    expect(
      assessment.findings.map((finding: DatabaseHealthFinding): string => {
        return finding.key;
      }),
    ).toEqual(["connections", "replication", "storage"]);
    expect(DATABASE_HEALTH_CATEGORY_ORDER).toEqual([
      "Availability",
      "Connections",
      "Replication",
      "Memory",
      "Performance",
      "Storage",
    ]);
  });

  test("the stored verdict: unhealthy, degraded, healthy, or nothing judged", () => {
    const judge: (row: DatabaseHealthRow) => string | null = (
      row: DatabaseHealthRow,
    ): string | null => {
      return getDatabaseEngineHealthVerdict(
        judgeDatabaseEngineReadings({
          dbSystem: row.dbSystem,
          readings: row.engineReadings,
          now: NOW,
        }),
      );
    };
    expect(
      judge(
        connectedRow("oracle.db", {
          "Max|oracledb.tablespace.utilization|": 0.95,
        }),
      ),
    ).toBe("unhealthy");
    expect(
      judge(connectedRow("mysql", { "Max|mysql.threads|kind=running": 80 })),
    ).toBe("degraded");
    expect(judge(connectedRow("redis"))).toBe("healthy");
    expect(judge(connectedRow("cockroachdb"))).toBeNull();
    expect(
      judge({ dbSystem: "postgresql", engineReadings: undefined }),
    ).toBeNull();
  });

  test("databases by urgency: critical, then warnings by how many reasons, then by name as people number them", () => {
    const rows: Array<{ assessment: DatabaseHealthAssessment; name: string }> =
      [
        { name: "db-10", assessment: assess(connectedRow("redis")) },
        {
          name: "db-2",
          assessment: assess(
            connectedRow("mysql", { "Max|mysql.threads|kind=running": 80 }),
          ),
        },
        {
          name: "db-3",
          assessment: assess(
            connectedRow("mysql", {
              "Max|mysql.threads|kind=running": 80,
              "Max|mysql.replica.time_behind_source|": 60,
            }),
          ),
        },
        {
          name: "db-1",
          assessment: assess({
            dbSystem: "postgresql",
            otelCollectorStatus: "disconnected",
            collectorLastSeenAt: minutesAgo(50),
          }),
        },
        { name: "db-9", assessment: assess(connectedRow("redis")) },
      ];
    expect(
      [...rows]
        .sort(compareDatabasesByUrgency)
        .map((row: { name: string }): string => {
          return row.name;
        }),
    ).toEqual(["db-1", "db-3", "db-2", "db-9", "db-10"]);
  });
});

describe("DatabaseHealth - values as reasons write them", () => {
  test.each([
    [96, "96%"],
    [94.99, "94%"],
    [95, "95%"],
    [0.4, "0%"],
    [-3, "0%"],
  ])("percent %s -> %s", (value: number, expected: string) => {
    expect(formatDatabaseHealthPercent(value)).toBe(expected);
  });

  test.each([
    [1.86, "1.8"],
    [1.5, "1.5"],
    [2, "2.0"],
  ])("ratio %s -> %s", (value: number, expected: string) => {
    expect(formatDatabaseHealthRatio(value)).toBe(expected);
  });

  test.each([
    [1_250_000_000, "1.2 GB"],
    [1_000_000_000, "1 GB"],
    [512_000_000_000, "512 GB"],
    [2_400_000_000_000, "2.4 TB"],
    [310_000_000, "310 MB"],
    [4_500, "4.5 kB"],
    [512, "512 B"],
  ])("bytes %s -> %s", (value: number, expected: string) => {
    expect(formatDatabaseHealthBytes(value)).toBe(expected);
  });
});

describe("DatabaseHealth - a record never makes a page throw", () => {
  test.each([
    [null],
    ["readings"],
    [42],
    [{ instances: null }],
    [{ instances: { a: { at: "nope", values: { k: "x" } } } }],
    [{ instances: { a: { at: minutesAgo(1), values: { k: Number.NaN } } } }],
  ])("%j", (engineReadings: unknown) => {
    const assessment: DatabaseHealthAssessment = assess({
      dbSystem: "postgresql",
      otelCollectorStatus: "connected",
      collectorLastSeenAt: minutesAgo(1),
      engineReadings: engineReadings,
      engineReadingsAt: "not a date",
    });
    expect(assessment.state).toBe("reporting");
  });

  test("a template that names a query nobody reported is skipped, the rest still judged", () => {
    const values: Record<string, number> = { ...CALM_VALUES };
    delete values[key("redis.maxmemory", "Sum")];
    values[key("redis.clients.connected", "Max")] = 9001;
    const assessment: DatabaseHealthAssessment = assess({
      dbSystem: "redis",
      otelCollectorStatus: "connected",
      collectorLastSeenAt: minutesAgo(1),
      engineReadings: {
        instances: { [INSTANCE]: { at: minutesAgo(1), values: values } },
      },
    });
    expect(assessment.state).toBe("degraded");
    expect(
      assessment.judgements.map(
        (judgement: { template: DatabaseAlertTemplate }): string => {
          return judgement.template.id;
        },
      ),
    ).not.toContain("database-redis-memory-near-maxmemory");
  });

  test("an Engine Metrics Stopped template is never judged from readings", () => {
    const heartbeat: DatabaseAlertTemplate = template(
      "database-postgresql-engine-metrics-stopped",
    );
    expect(
      judgeDatabaseAlertTemplate({
        template: heartbeat,
        instances: [{ at: minutesAgo(1), values: { ...CALM_VALUES } }],
      }),
    ).toBeNull();
  });

  test("the reading queries the rules fold are the templates' own", () => {
    for (const candidate of JUDGED_TEMPLATES) {
      for (const query of candidate.queries) {
        expect(
          getDatabaseEngineReadingQueries().some(
            (readingQuery: DatabaseEngineReadingQuery): boolean => {
              return (
                readingQuery.key === getDatabaseEngineReadingKey(query) &&
                readingQuery.aggregationType === query.aggregationType &&
                readingQuery.metricName === query.metricName
              );
            },
          ),
        ).toBe(true);
      }
    }
  });
});
