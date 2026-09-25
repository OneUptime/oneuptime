import fs from "fs";
import path from "path";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MetricMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MonitorStepResourceIdentity from "../../../Server/Utils/Monitor/MonitorStepResourceIdentity";
import { SeriesResourceRefs } from "../../../Server/Utils/Monitor/SeriesResourceLabels";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  DATABASE_ALERT_METRICS,
  DATABASE_SERVER_ID_SCOPE_ATTRIBUTE,
  DatabaseAlertMetric,
  DatabaseAlertTemplate,
  DatabaseAlertTemplateArgs,
  UNALERTABLE_DATABASE_COUNTERS,
  getAllDatabaseAlertTemplates,
  getDatabaseAlertMetric,
  getDatabaseAlertTemplateById,
  getDatabaseAlertTemplates,
  getDatabaseEnginesWithAlertTemplates,
} from "../../../Types/Monitor/DatabaseAlertTemplates";
import {
  DATABASE_SERVER_METRICS,
  DatabaseServerMetricDefinition,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import {
  DatabaseSystemDescriptor,
  getDatabaseSystemDescriptor,
} from "../../../Types/DatabaseServer/DatabaseSystem";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricViewConfigUtil from "../../../Types/Monitor/MonitorStepMetricViewConfigUtil";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricValueFormatter from "../../../Utils/Monitor/MetricValueFormatter";
import ValueFormatter from "../../../Utils/ValueFormatter";
import { describe, expect, test } from "@jest/globals";

/*
 * The database alert library is the only way a Database's Alerts and
 * Incidents tabs fill up without a user hand-building a Metrics monitor with
 * a UUID filter they had to copy from the Documentation tab. Everything that
 * can go wrong with it is silent:
 *
 *   - a query that forgets the database scope watches the whole project and
 *     links its alerts to nothing;
 *   - a metric name the receiver does not emit (a typo, an optional metric
 *     nobody enabled, a counter) is a monitor that never fires — or, for a
 *     cumulative counter, fires once and never clears;
 *   - a criteria alias that matches no query falls back to query slot 0 and
 *     thresholds the wrong number;
 *   - a template offered to the wrong engine is a PostgreSQL monitor on a
 *     Redis server.
 *
 * So these assert all of it, for every template, and then EVALUATE the
 * templates against synthetic receiver data through the real metric criteria
 * evaluator and formula engine, so "fires when X, recovers when Y" is proven
 * rather than described.
 */

const DATABASE_SERVER_ID: string = "d0000000-0000-4000-8000-000000000042";

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..", "..");

function buildArgs(
  overrides?: Partial<DatabaseAlertTemplateArgs>,
): DatabaseAlertTemplateArgs {
  return {
    databaseServerId: DATABASE_SERVER_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "PostgreSQL db.prod:5432",
    ...overrides,
  };
}

function getTemplate(id: string): DatabaseAlertTemplate {
  const template: DatabaseAlertTemplate | undefined =
    getDatabaseAlertTemplateById(id);

  if (!template) {
    throw new Error(`No database alert template ${id}`);
  }

  return template;
}

function getViewConfig(step: MonitorStep): MetricsViewConfig {
  const viewConfig: MetricsViewConfig | undefined =
    step.data?.metricMonitor?.metricViewConfig;

  if (!viewConfig) {
    throw new Error("The template built no metric monitor config");
  }

  return viewConfig;
}

function getCriteriaInstances(
  step: MonitorStep,
): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

function getUnhealthy(step: MonitorStep): MonitorCriteriaInstance {
  return getCriteriaInstances(step).find(
    (instance: MonitorCriteriaInstance): boolean => {
      return Boolean(instance.data?.createIncidents);
    },
  )!;
}

function getHealthy(step: MonitorStep): MonitorCriteriaInstance {
  return getCriteriaInstances(step).find(
    (instance: MonitorCriteriaInstance): boolean => {
      return !instance.data?.createIncidents;
    },
  )!;
}

const ALL_TEMPLATES: Array<DatabaseAlertTemplate> =
  getAllDatabaseAlertTemplates();

const TEMPLATE_CASES: Array<[string, DatabaseAlertTemplate]> =
  ALL_TEMPLATES.map(
    (template: DatabaseAlertTemplate): [string, DatabaseAlertTemplate] => {
      return [template.id, template];
    },
  );

describe("DatabaseAlertTemplates — the library", () => {
  test("ships templates for the engines the collector receivers cover", () => {
    expect(ALL_TEMPLATES.length).toBeGreaterThanOrEqual(30);
    expect(getDatabaseEnginesWithAlertTemplates().sort()).toEqual(
      [
        "couchdb",
        "elasticsearch",
        "memcached",
        "microsoft.sql_server",
        "mongodb",
        "mysql",
        "oracle.db",
        "postgresql",
        "redis",
      ].sort(),
    );
  });

  test("ids are unique and self-prefixed", () => {
    const ids: Array<string> = ALL_TEMPLATES.map(
      (template: DatabaseAlertTemplate): string => {
        return template.id;
      },
    );

    expect(new Set<string>(ids).size).toBe(ids.length);

    for (const id of ids) {
      expect(id.startsWith("database-")).toBe(true);
    }
  });

  test("names are unique within the set one database is offered", () => {
    /*
     * A database only ever sees one engine's set, so that is where a name
     * collision would produce two indistinguishable cards (and two monitors
     * named alike). Across engines "Engine Metrics Stopped" repeats on
     * purpose.
     */
    for (const engine of getDatabaseEnginesWithAlertTemplates()) {
      const names: Array<string> = getDatabaseAlertTemplates(engine).map(
        (template: DatabaseAlertTemplate): string => {
          return template.name;
        },
      );

      expect(new Set<string>(names).size).toBe(names.length);
    }
  });

  test.each(TEMPLATE_CASES)(
    "%s is a complete Metrics template",
    (_id: string, template: DatabaseAlertTemplate) => {
      expect(template.monitorType).toBe(MonitorType.Metrics);
      expect(template.name.trim().length).toBeGreaterThan(0);
      expect(template.description.trim().length).toBeGreaterThan(20);
      expect(["Critical", "Warning"]).toContain(template.severity);
      expect([
        "Availability",
        "Connections",
        "Replication",
        "Memory",
        "Performance",
        "Storage",
      ]).toContain(template.category);
      expect(template.metricNames.length).toBeGreaterThan(0);
    },
  );

  test("every engine offers an Engine Metrics Stopped template first", () => {
    /*
     * The closest thing to "database down" the engine telemetry can express,
     * and the most important card on the page — so it leads every engine's
     * list, and is Critical.
     */
    for (const engine of getDatabaseEnginesWithAlertTemplates()) {
      const templates: Array<DatabaseAlertTemplate> =
        getDatabaseAlertTemplates(engine);

      expect(templates[0]!.name).toBe("Engine Metrics Stopped");
      expect(templates[0]!.severity).toBe("Critical");
      expect(templates[0]!.category).toBe("Availability");
    }
  });
});

describe("DatabaseAlertTemplates — engine matching", () => {
  test("an engine gets exactly the templates of the receivers that monitor it", () => {
    for (const engine of getDatabaseEnginesWithAlertTemplates()) {
      const descriptor: DatabaseSystemDescriptor | null =
        getDatabaseSystemDescriptor(engine);

      expect(descriptor).not.toBeNull();

      const offered: Array<DatabaseAlertTemplate> =
        getDatabaseAlertTemplates(engine);

      expect(offered.length).toBeGreaterThan(0);

      for (const template of offered) {
        expect(descriptor!.receiverTypes).toContain(template.receiver);
      }

      // ...and nothing written against another receiver.
      for (const template of ALL_TEMPLATES) {
        if (!descriptor!.receiverTypes.includes(template.receiver)) {
          expect(offered).not.toContain(template);
        }
      }
    }
  });

  test("every template's engine is a known engine its receiver monitors", () => {
    for (const template of ALL_TEMPLATES) {
      const descriptor: DatabaseSystemDescriptor | null =
        getDatabaseSystemDescriptor(template.engine);

      expect(descriptor).not.toBeNull();
      expect(descriptor!.system).toBe(template.engine);
      expect(descriptor!.receiverTypes).toContain(template.receiver);
    }
  });

  test("never offers one engine's templates to another", () => {
    const postgresIds: Set<string> = new Set<string>(
      getDatabaseAlertTemplates("postgresql").map(
        (template: DatabaseAlertTemplate): string => {
          return template.id;
        },
      ),
    );

    for (const engine of ["redis", "mysql", "mongodb"]) {
      for (const template of getDatabaseAlertTemplates(engine)) {
        expect(postgresIds.has(template.id)).toBe(false);
      }
    }
  });

  test("accepts aliases and any casing of the engine", () => {
    const expected: Array<string> = getDatabaseAlertTemplates("postgresql").map(
      (template: DatabaseAlertTemplate): string => {
        return template.id;
      },
    );

    for (const spelling of ["postgres", "PostgreSQL", "  pg  "]) {
      expect(
        getDatabaseAlertTemplates(spelling).map(
          (template: DatabaseAlertTemplate): string => {
            return template.id;
          },
        ),
      ).toEqual(expected);
    }
  });

  test("a fork the family's receiver monitors gets the family's templates", () => {
    const mysqlIds: Array<string> = getDatabaseAlertTemplates("mysql").map(
      (template: DatabaseAlertTemplate): string => {
        return template.id;
      },
    );
    const redisIds: Array<string> = getDatabaseAlertTemplates("redis").map(
      (template: DatabaseAlertTemplate): string => {
        return template.id;
      },
    );

    expect(
      getDatabaseAlertTemplates("mariadb").map(
        (template: DatabaseAlertTemplate): string => {
          return template.id;
        },
      ),
    ).toEqual(mysqlIds);
    expect(
      getDatabaseAlertTemplates("valkey").map(
        (template: DatabaseAlertTemplate): string => {
          return template.id;
        },
      ),
    ).toEqual(redisIds);
  });

  test("an engine no template receiver covers gets nothing, never a guess", () => {
    for (const engine of ["cassandra", "clickhouse", "neo4j", "sqlite"]) {
      expect(getDatabaseAlertTemplates(engine)).toEqual([]);
    }
  });

  test("a wire-compatible engine the receiver does not monitor gets nothing", () => {
    /*
     * CockroachDB speaks the PostgreSQL protocol, but the `postgresql`
     * receiver does not monitor it — PostgreSQL templates on it would query
     * metrics nobody emits. Only asserted when the engine is known at all.
     */
    if (getDatabaseSystemDescriptor("cockroachdb")) {
      expect(getDatabaseAlertTemplates("cockroachdb")).toEqual([]);
    }
  });

  test("an unknown, empty or missing engine gets nothing", () => {
    for (const engine of [null, undefined, "", "   ", "not-a-database"]) {
      expect(getDatabaseAlertTemplates(engine)).toEqual([]);
    }
  });
});

describe("DatabaseAlertTemplates — every metric is one the receiver emits and a static threshold can use", () => {
  test("the metric registry has no duplicates and names real engines", () => {
    const names: Array<string> = DATABASE_ALERT_METRICS.map(
      (metric: DatabaseAlertMetric): string => {
        return metric.metricName;
      },
    );

    expect(new Set<string>(names).size).toBe(names.length);

    for (const metric of DATABASE_ALERT_METRICS) {
      expect(getDatabaseSystemDescriptor(metric.engine)).not.toBeNull();
      expect(metric.unit.length).toBeGreaterThan(0);
    }
  });

  test.each(TEMPLATE_CASES)(
    "%s reads only registered, thresholdable metrics of its own engine",
    (_id: string, template: DatabaseAlertTemplate) => {
      for (const metricName of template.metricNames) {
        const metric: DatabaseAlertMetric | undefined =
          getDatabaseAlertMetric(metricName);

        expect(metric).toBeDefined();
        expect(metric!.engine).toBe(template.engine);

        /*
         * THE rule of this library: the monitor path has no rate, so a
         * cumulative counter compared against a threshold fires once and
         * never clears.
         */
        expect(metric!.kind).not.toBe("counter");
      }
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s reads metric names carrying its receiver's prefix",
    (_id: string, template: DatabaseAlertTemplate) => {
      const descriptor: DatabaseSystemDescriptor = getDatabaseSystemDescriptor(
        template.engine,
      )!;

      for (const metricName of template.metricNames) {
        /*
         * The Elasticsearch receiver also emits the node JVM's `jvm.*`
         * metrics in the same batch — the one sanctioned exception.
         */
        if (
          template.engine === "elasticsearch" &&
          metricName.startsWith("jvm.")
        ) {
          continue;
        }

        expect(
          descriptor.receiverMetricPrefixes.some((prefix: string): boolean => {
            return metricName.startsWith(prefix);
          }),
        ).toBe(true);
      }
    },
  );

  test("no template reads a counter the library documents as unalertable", () => {
    const counters: Set<string> = new Set<string>(
      UNALERTABLE_DATABASE_COUNTERS.map(
        (counter: { metricName: string }): string => {
          return counter.metricName;
        },
      ),
    );

    expect(counters.size).toBeGreaterThan(5);

    for (const template of ALL_TEMPLATES) {
      for (const metricName of template.metricNames) {
        expect(counters.has(metricName)).toBe(false);
      }
    }

    // ...and none of them is registered as thresholdable.
    for (const counter of UNALERTABLE_DATABASE_COUNTERS) {
      expect(getDatabaseAlertMetric(counter.metricName)).toBeUndefined();
    }
  });

  test("agrees with the Overview's metric catalog about which metrics are counters", () => {
    /*
     * DatabaseServerMetricCatalog charts a "counter" as a rate. If it calls a
     * metric a counter, no template may threshold it; if it calls one a gauge,
     * the registry here must not disagree.
     */
    for (const definition of DATABASE_SERVER_METRICS) {
      const metric: DatabaseAlertMetric | undefined = getDatabaseAlertMetric(
        definition.metricName,
      );

      if (!metric) {
        continue;
      }

      if (definition.kind === "counter") {
        expect(metric.kind).toBe("counter");
      } else {
        expect(metric.kind).not.toBe("counter");
      }
    }

    const catalogCounters: Array<string> = DATABASE_SERVER_METRICS.filter(
      (definition: DatabaseServerMetricDefinition): boolean => {
        return definition.kind === "counter";
      },
    ).map((definition: DatabaseServerMetricDefinition): string => {
      return definition.metricName;
    });

    for (const template of ALL_TEMPLATES) {
      for (const metricName of template.metricNames) {
        expect(catalogCounters).not.toContain(metricName);
      }
    }
  });

  test("an uptime ('elapsed') metric is only ever used to detect a restart", () => {
    for (const template of ALL_TEMPLATES) {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const usesElapsed: boolean = template.metricNames.some(
        (metricName: string): boolean => {
          return getDatabaseAlertMetric(metricName)?.kind === "elapsed";
        },
      );

      if (!usesElapsed) {
        continue;
      }

      const filter: CriteriaFilter = getUnhealthy(step).data!.filters[0]!;

      // A heartbeat (fires only on no data) or a "below" comparison.
      expect(
        filter.metricMonitorOptions?.onNoDataPolicy === NoDataPolicy.Trigger ||
          filter.filterType === FilterType.LessThan,
      ).toBe(true);
    }
  });

  test("a template reading an optional metric says so, naming the metric", () => {
    for (const template of ALL_TEMPLATES) {
      for (const metricName of template.metricNames) {
        const metric: DatabaseAlertMetric = getDatabaseAlertMetric(metricName)!;

        if (metric.enabledByDefault) {
          continue;
        }

        expect(template.description).toContain(metricName);
        expect(template.description.toLowerCase()).toContain("enable");
      }
    }
  });

  test("every metric names the receiver that monitors its engine", () => {
    for (const metric of DATABASE_ALERT_METRICS) {
      expect(
        getDatabaseSystemDescriptor(metric.engine)!.receiverTypes,
      ).toContain(metric.receiver);
    }

    for (const template of ALL_TEMPLATES) {
      for (const metricName of template.metricNames) {
        expect(getDatabaseAlertMetric(metricName)!.receiver).toBe(
          template.receiver,
        );
      }
    }
  });

  function agentConfigPath(receiver: string): string {
    return path.join(
      REPO_ROOT,
      "agents",
      "DatabaseAgent",
      "configs",
      `${receiver}.yaml`,
    );
  }

  // Every regex metacharacter, backslash included, taken literally.
  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function metricSwitchPattern(metricName: string, enabled: boolean): RegExp {
    return new RegExp(
      `\\n\\s+${escapeRegExp(metricName)}:\\s*\\n\\s+enabled:\\s*${
        enabled ? "true" : "false"
      }`,
    );
  }

  test("every optional metric is switched on by the Database Agent's config for its receiver", () => {
    /*
     * The descriptions promise "the Database Agent enables it". This reads the
     * agent's actual collector config and holds the promise to it: an
     * optional metric the agent does not switch on would make its template
     * silently inert for every agent user.
     */
    const optional: Array<DatabaseAlertMetric> = DATABASE_ALERT_METRICS.filter(
      (metric: DatabaseAlertMetric): boolean => {
        return !metric.enabledByDefault;
      },
    );

    expect(optional.length).toBeGreaterThan(0);

    for (const metric of optional) {
      const configPath: string = agentConfigPath(metric.receiver);

      expect(fs.existsSync(configPath)).toBe(true);
      expect(fs.readFileSync(configPath, "utf8")).toMatch(
        metricSwitchPattern(metric.metricName, true),
      );
    }
  });

  test("no default-on metric a template reads is switched off by a Database Agent config", () => {
    for (const metric of DATABASE_ALERT_METRICS) {
      const configPath: string = agentConfigPath(metric.receiver);

      if (!fs.existsSync(configPath)) {
        // No agent config for this receiver: nothing can switch it off.
        continue;
      }

      expect(fs.readFileSync(configPath, "utf8")).not.toMatch(
        metricSwitchPattern(metric.metricName, false),
      );
    }
  });
});

/*
 * Default-on in the receivers' metadata, yet measured never to arrive on the
 * Database Agent's default setups (collector-contrib 0.161.0): SQL Server
 * 2022 on Linux, connected directly, reads sys.dm_os_performance_counters,
 * which has none of the first three (Windows performance counters only);
 * Oracle Free 23 connected to its pluggable database (FREEPDB1) returned
 * none of the last three. The Overview's catalog leaves the same ones out.
 */
const NEVER_ARRIVE_ON_AGENT_SETUPS: Array<string> = [
  "sqlserver.transaction.rate",
  "sqlserver.transaction_log.usage",
  "sqlserver.lock.wait_time.avg",
  "oracledb.sessions.limit",
  "oracledb.processes.usage",
  "oracledb.processes.limit",
];

/*
 * Every metric seen arriving in those two runs, from the agent's own configs
 * (agents/DatabaseAgent/configs/sqlserver.yaml and oracledb.yaml).
 */
const SEEN_ARRIVING_FROM_AGENT: Record<string, Array<string>> = {
  sqlserver: [
    "sqlserver.batch.request.rate",
    "sqlserver.batch.sql_compilation.rate",
    "sqlserver.batch.sql_recompilation.rate",
    "sqlserver.cpu.utilization",
    "sqlserver.database.io",
    "sqlserver.database.latency",
    "sqlserver.deadlock.rate",
    "sqlserver.lock.wait.rate",
    "sqlserver.memory.grants.pending.count",
    "sqlserver.page.buffer_cache.hit_ratio",
    "sqlserver.page.life_expectancy",
    "sqlserver.processes.blocked",
    "sqlserver.user.connection.count",
  ],
  oracledb: [
    "oracledb.cpu_time",
    "oracledb.db.time",
    "oracledb.enqueue_deadlocks",
    "oracledb.exchange_deadlocks",
    "oracledb.executions",
    "oracledb.hard_parses",
    "oracledb.logical_reads",
    "oracledb.parse_calls",
    "oracledb.pga_memory",
    "oracledb.physical_reads",
    "oracledb.sessions.usage",
    "oracledb.sga.limit",
    "oracledb.sga.usage",
    "oracledb.tablespace.utilization",
    "oracledb.tablespace_size.limit",
    "oracledb.tablespace_size.usage",
    "oracledb.user_commits",
    "oracledb.user_rollbacks",
  ],
};

describe("DatabaseAlertTemplates — only metrics that arrive on the Database Agent's default setup", () => {
  test.each(NEVER_ARRIVE_ON_AGENT_SETUPS)(
    "%s (never arrives on the agent's default setup) is neither registered nor read",
    (metricName: string) => {
      expect(getDatabaseAlertMetric(metricName)).toBeUndefined();

      for (const template of ALL_TEMPLATES) {
        expect(template.metricNames).not.toContain(metricName);
      }
    },
  );

  test.each(Object.keys(SEEN_ARRIVING_FROM_AGENT))(
    "every metric a %s template reads was seen arriving from the agent",
    (receiver: string) => {
      const templates: Array<DatabaseAlertTemplate> = ALL_TEMPLATES.filter(
        (template: DatabaseAlertTemplate): boolean => {
          return template.receiver === receiver;
        },
      );

      expect(templates.length).toBeGreaterThan(1);

      for (const template of templates) {
        for (const metricName of template.metricNames) {
          expect(SEEN_ARRIVING_FROM_AGENT[receiver]).toContain(metricName);
        }
      }
    },
  );

  test("no template thresholds a SQL Server '/sec' metric, a since-start total over a direct connection", () => {
    /*
     * Measured: sqlserver.batch.request.rate read 8, 13, 18, 23 on
     * consecutive 10-second scrapes of an idle server — the counter's raw
     * value, not a per-second rate. A threshold on one fires on the first
     * deadlock and never clears.
     */
    const sqlServerRate: RegExp = /^sqlserver\..*\.rate$/;

    for (const template of ALL_TEMPLATES) {
      for (const metricName of template.metricNames) {
        expect(sqlServerRate.test(metricName)).toBe(false);
      }
    }

    expect(getDatabaseAlertMetric("sqlserver.deadlock.rate")).toBeUndefined();
    expect(
      UNALERTABLE_DATABASE_COUNTERS.some(
        (counter: { metricName: string }): boolean => {
          return counter.metricName === "sqlserver.deadlock.rate";
        },
      ),
    ).toBe(true);
  });

  test("every Engine Metrics Stopped heartbeat reads a metric the receiver emits by default", () => {
    /*
     * The heartbeat going silent IS the alert. One that only an agent
     * config switches on would fire, forever, the moment it was created on a
     * database fed by a team's own collector that left it off.
     */
    for (const engine of getDatabaseEnginesWithAlertTemplates()) {
      const heartbeat: DatabaseAlertTemplate =
        getDatabaseAlertTemplates(engine)[0]!;

      expect(heartbeat.name).toBe("Engine Metrics Stopped");

      for (const metricName of heartbeat.metricNames) {
        expect(getDatabaseAlertMetric(metricName)!.enabledByDefault).toBe(true);
      }
    }
  });

  test("SQL Server's and Oracle's sets, in display order", () => {
    expect(
      getDatabaseAlertTemplates("microsoft.sql_server").map(
        (template: DatabaseAlertTemplate): string => {
          return template.id;
        },
      ),
    ).toEqual([
      "database-sqlserver-engine-metrics-stopped",
      "database-sqlserver-buffer-cache-hit-ratio-low",
      "database-sqlserver-page-life-expectancy-low",
      "database-sqlserver-sessions-blocked",
      "database-sqlserver-memory-grants-pending",
    ]);

    expect(
      getDatabaseAlertTemplates("oracle.db").map(
        (template: DatabaseAlertTemplate): string => {
          return template.id;
        },
      ),
    ).toEqual([
      "database-oracle-engine-metrics-stopped",
      "database-oracle-tablespace-nearly-full",
    ]);
  });
});

describe("DatabaseAlertTemplates — the monitor step each template builds", () => {
  test.each(TEMPLATE_CASES)(
    "%s passes monitor validation as a Metrics monitor",
    (_id: string, template: DatabaseAlertTemplate) => {
      const steps: MonitorSteps = new MonitorSteps();
      steps.data = {
        monitorStepsInstanceArray: [template.getMonitorStep(buildArgs())],
        defaultMonitorStatusId: ObjectID.generate(),
      };

      expect(MonitorSteps.getValidationError(steps, MonitorType.Metrics)).toBe(
        null,
      );
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s scopes EVERY query to the one database, and nothing else",
    (_id: string, template: DatabaseAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const viewConfig: MetricsViewConfig = getViewConfig(step);

      expect(viewConfig.queryConfigs.length).toBe(template.metricNames.length);

      viewConfig.queryConfigs.forEach(
        (queryConfig: MetricQueryConfigData, index: number) => {
          expect(queryConfig.metricQueryData.filterData.metricName).toBe(
            template.metricNames[index],
          );
          expect(
            (
              queryConfig.metricQueryData.filterData.attributes as Record<
                string,
                unknown
              >
            )[DATABASE_SERVER_ID_SCOPE_ATTRIBUTE],
          ).toBe(DATABASE_SERVER_ID);
        },
      );

      /*
       * Not scoped by primaryEntityId: a user's collector that keeps a
       * service.name makes that Service the rows' primary entity, and the
       * monitor would match nothing.
       */
      expect(step.data?.metricMonitor?.telemetryServiceIds || []).toEqual([]);
    },
  );

  test("the scope follows the database it is built for", () => {
    const otherId: string = "d0000000-0000-4000-8000-0000000000ff";

    for (const template of ALL_TEMPLATES) {
      const step: MonitorStep = template.getMonitorStep(
        buildArgs({ databaseServerId: otherId }),
      );

      for (const queryConfig of getViewConfig(step).queryConfigs) {
        expect(
          (
            queryConfig.metricQueryData.filterData.attributes as Record<
              string,
              unknown
            >
          )[DATABASE_SERVER_ID_SCOPE_ATTRIBUTE],
        ).toBe(otherId);
      }
    }
  });

  test.each(TEMPLATE_CASES)(
    "%s is ungrouped, so every alert reads as this database",
    (_id: string, template: DatabaseAlertTemplate) => {
      expect(
        MonitorStep.getGroupByAttributeKeys(
          template.getMonitorStep(buildArgs()),
        ),
      ).toEqual([]);
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s has distinct aliases, and every criteria alias resolves to one",
    (_id: string, template: DatabaseAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const viewConfig: MetricsViewConfig = getViewConfig(step);

      const aliases: Array<string> = [
        ...viewConfig.queryConfigs.map(
          (queryConfig: MetricQueryConfigData): string => {
            return queryConfig.metricAliasData?.metricVariable || "";
          },
        ),
        ...viewConfig.formulaConfigs.map(
          (formulaConfig: MetricFormulaConfigData): string => {
            return formulaConfig.metricAliasData.metricVariable || "";
          },
        ),
      ];

      expect(aliases).not.toContain("");
      expect(new Set<string>(aliases).size).toBe(aliases.length);

      const offered: Array<string> =
        MonitorStepMetricViewConfigUtil.getMetricVariables(step.data);

      for (const instance of getCriteriaInstances(step)) {
        for (const filter of instance.data?.filters || []) {
          expect(filter.checkOn).toBe(CheckOn.MetricValue);
          expect(offered).toContain(filter.metricMonitorOptions?.metricAlias);
        }
      }
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s ships one breach and one recovery criteria",
    (_id: string, template: DatabaseAlertTemplate) => {
      const args: DatabaseAlertTemplateArgs = buildArgs();
      const step: MonitorStep = template.getMonitorStep(args);
      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);

      expect(instances.length).toBe(2);

      const unhealthy: MonitorCriteriaInstance = getUnhealthy(step);
      const healthy: MonitorCriteriaInstance = getHealthy(step);

      expect(unhealthy.data!.createIncidents).toBe(true);
      expect(unhealthy.data!.createAlerts).toBe(true);
      expect(unhealthy.data!.monitorStatusId).toEqual(
        args.offlineMonitorStatusId,
      );
      expect(unhealthy.data!.incidents[0]!.title).toBe(
        `[Database] ${template.name} - ${args.monitorName}`,
      );
      expect(unhealthy.data!.incidents[0]!.autoResolveIncident).toBe(true);
      expect(unhealthy.data!.alerts[0]!.autoResolveAlert).toBe(true);
      expect(unhealthy.data!.name.trim().length).toBeGreaterThan(0);
      expect(unhealthy.data!.description).toMatch(/^Triggers when /);
      expect(unhealthy.data!.description).not.toContain("undefined");

      expect(healthy.data!.name).toBe("Healthy");
      expect(healthy.data!.createIncidents).toBe(false);
      expect(healthy.data!.createAlerts).toBe(false);
      expect(healthy.data!.monitorStatusId).toEqual(args.onlineMonitorStatusId);

      // Recovery never also fires on missing data.
      for (const filter of healthy.data!.filters) {
        expect(filter.metricMonitorOptions?.onNoDataPolicy).toBeUndefined();
      }
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s survives the JSON round trip a saved monitor takes",
    (_id: string, template: DatabaseAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const restored: MonitorStep = MonitorStep.fromJSON(step.toJSON());

      expect(
        restored.data?.metricMonitor?.metricViewConfig.queryConfigs.map(
          (queryConfig: MetricQueryConfigData) => {
            return queryConfig.metricQueryData.filterData;
          },
        ),
      ).toEqual(
        getViewConfig(step).queryConfigs.map(
          (queryConfig: MetricQueryConfigData) => {
            return queryConfig.metricQueryData.filterData;
          },
        ),
      );

      expect(
        getUnhealthy(restored).data!.filters[0]!.metricMonitorOptions,
      ).toEqual(getUnhealthy(step).data!.filters[0]!.metricMonitorOptions);
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s links what it opens to the database (MonitorStepResourceIdentity)",
    (_id: string, template: DatabaseAlertTemplate) => {
      const monitor: Monitor = new Monitor();
      monitor.monitorType = template.monitorType;
      monitor.projectId = ObjectID.generate();
      monitor.monitorSteps = new MonitorSteps();
      monitor.monitorSteps.data = {
        monitorStepsInstanceArray: [template.getMonitorStep(buildArgs())],
        defaultMonitorStatusId: ObjectID.generate(),
      };

      const refs: SeriesResourceRefs =
        MonitorStepResourceIdentity.extractResourceRefsFromMonitor({
          monitor: monitor,
        });

      expect(refs.databaseServerIds).toEqual([DATABASE_SERVER_ID]);
      // ...and claims no other resource.
      expect(refs.serviceIds).toEqual([]);
      expect(refs.hostNames).toEqual([]);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * Behaviour: run templates against synthetic receiver data through the real
 * formula engine and metric criteria evaluator.
 * ---------------------------------------------------------------------------
 */

type SamplesByAlias = Record<string, Array<number>>;

/*
 * The native unit of every metric a template reads, keyed the way the worker
 * loads it from MetricType (lowercased name → the receiver's own unit). The
 * evaluator falls back to it when a query carries no legend unit, and the
 * alert and incident text is formatted in it.
 */
const NATIVE_UNITS_BY_METRIC_NAME: Record<string, string> = {};

for (const metric of DATABASE_ALERT_METRICS) {
  NATIVE_UNITS_BY_METRIC_NAME[metric.metricName.toLowerCase()] = metric.unit;
}

/*
 * What the telemetry worker hands the evaluator: one aggregated result per
 * query (in query order), then one per formula, evaluated by the same
 * MetricFormulaEvaluator the worker uses.
 */
function buildResponse(
  step: MonitorStep,
  samplesByAlias: SamplesByAlias,
): MetricMonitorResponse {
  const viewConfig: MetricsViewConfig = getViewConfig(step);
  const start: number = Date.UTC(2026, 0, 1, 12, 0, 0);

  const results: Array<AggregatedResult> = viewConfig.queryConfigs.map(
    (queryConfig: MetricQueryConfigData): AggregatedResult => {
      const samples: Array<number> =
        samplesByAlias[queryConfig.metricAliasData?.metricVariable || ""] || [];

      return {
        data: samples.map((value: number, index: number): AggregateModel => {
          return {
            timestamp: new Date(start + index * 60000),
            value: value,
          } as AggregateModel;
        }),
      };
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

// The root cause one criteria filter writes, or null when it is not met.
async function getRootCause(
  step: MonitorStep,
  filter: CriteriaFilter,
  response: MetricMonitorResponse,
): Promise<string | null> {
  return await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: response,
    // A copy: the evaluator writes its context back onto the filter.
    criteriaFilter: JSON.parse(JSON.stringify(filter)) as CriteriaFilter,
    monitorStep: step,
  });
}

async function isInstanceMet(
  step: MonitorStep,
  instance: MonitorCriteriaInstance,
  response: MetricMonitorResponse,
): Promise<boolean> {
  const results: Array<boolean> = [];

  for (const filter of instance.data!.filters) {
    const rootCause: string | null = await getRootCause(step, filter, response);

    results.push(rootCause !== null);
  }

  return instance.data!.filterCondition === FilterCondition.All
    ? results.every((met: boolean): boolean => {
        return met;
      })
    : results.some((met: boolean): boolean => {
        return met;
      });
}

async function evaluate(
  templateId: string,
  samplesByAlias: SamplesByAlias,
): Promise<{ breached: boolean; healthy: boolean }> {
  const step: MonitorStep = getTemplate(templateId).getMonitorStep(buildArgs());
  const response: MetricMonitorResponse = buildResponse(step, samplesByAlias);

  return {
    breached: await isInstanceMet(step, getUnhealthy(step), response),
    healthy: await isInstanceMet(step, getHealthy(step), response),
  };
}

/*
 * One datapoint row as ingest stores it: the metric, its datapoint
 * attributes plus the database stamp every resource block of the batch
 * carries, and the one-minute bucket the scrape lands in.
 */
interface ReceiverRow {
  minute: number;
  metricName: string;
  attributes: Record<string, string>;
  value: number;
}

function foldBucket(
  values: Array<number>,
  aggregationType: MetricsAggregationType,
): number {
  switch (aggregationType) {
    case MetricsAggregationType.Sum:
      return values.reduce((total: number, value: number): number => {
        return total + value;
      }, 0);
    case MetricsAggregationType.Avg:
      return (
        values.reduce((total: number, value: number): number => {
          return total + value;
        }, 0) / values.length
      );
    case MetricsAggregationType.Min:
      return Math.min(...values);
    case MetricsAggregationType.Max:
      return Math.max(...values);
    case MetricsAggregationType.Count:
      return values.length;
    default:
      throw new Error(`No test fold for ${aggregationType}`);
  }
}

/*
 * What the worker's ClickHouse query does with raw rows: keep the rows of the
 * query's metric whose attributes match every filter (the database scope
 * included), and fold each minute bucket with the query's aggregation. The
 * templates' aggregation contract is about exactly this step, so a receiver
 * quirk — a metric recorded twice in one scrape — has to go through it to be
 * caught.
 */
function aggregateRows(
  step: MonitorStep,
  rows: Array<ReceiverRow>,
): SamplesByAlias {
  const samplesByAlias: SamplesByAlias = {};

  for (const queryConfig of getViewConfig(step).queryConfigs) {
    const filterData: MetricQueryConfigData["metricQueryData"]["filterData"] =
      queryConfig.metricQueryData.filterData;
    const filters: Record<string, unknown> = (filterData.attributes ||
      {}) as Record<string, unknown>;
    const valuesByMinute: Map<number, Array<number>> = new Map<
      number,
      Array<number>
    >();

    for (const row of rows) {
      const matches: boolean =
        row.metricName === filterData.metricName &&
        Object.keys(filters).every((key: string): boolean => {
          return row.attributes[key] === filters[key];
        });

      if (!matches) {
        continue;
      }

      valuesByMinute.set(row.minute, [
        ...(valuesByMinute.get(row.minute) || []),
        row.value,
      ]);
    }

    samplesByAlias[queryConfig.metricAliasData!.metricVariable!] = Array.from(
      valuesByMinute.keys(),
    )
      .sort((a: number, b: number): number => {
        return a - b;
      })
      .map((minute: number): number => {
        return foldBucket(
          valuesByMinute.get(minute)!,
          filterData.aggegationType as MetricsAggregationType,
        );
      });
  }

  return samplesByAlias;
}

async function evaluateRows(
  templateId: string,
  rows: Array<ReceiverRow>,
): Promise<{ breached: boolean; healthy: boolean }> {
  const step: MonitorStep = getTemplate(templateId).getMonitorStep(buildArgs());

  return await evaluate(templateId, aggregateRows(step, rows));
}

// Rows a receiver records on every scrape of a ten-minute window.
function everyMinute(
  rows: Array<Omit<ReceiverRow, "minute">>,
  minutes: number = 10,
): Array<ReceiverRow> {
  const all: Array<ReceiverRow> = [];

  for (let minute: number = 0; minute < minutes; minute++) {
    for (const row of rows) {
      all.push({
        ...row,
        minute: minute,
        attributes: {
          ...row.attributes,
          [DATABASE_SERVER_ID_SCOPE_ATTRIBUTE]: DATABASE_SERVER_ID,
        },
      });
    }
  }

  return all;
}

describe("DatabaseAlertTemplates — behaviour against receiver data", () => {
  describe("PostgreSQL connections vs max_connections (a same-scrape Sum/Sum ratio)", () => {
    test("fires at 96% of max_connections, summed across databases and scrapes", async () => {
      /*
       * Three databases' backends per scrape, two scrapes per bucket: the
       * worker's Sum folds 2 × (60 + 20 + 16) = 192 backends over 2 × 100 =
       * 200 max_connections — 96%, exactly as if nothing had been summed.
       */
      expect(
        await evaluate("database-postgresql-connections-exhausted", {
          pg_backends: [192, 192, 194],
          pg_max_connections: [200, 200, 200],
        }),
      ).toEqual({ breached: true, healthy: false });
    });

    test("recovers well below the limit", async () => {
      expect(
        await evaluate("database-postgresql-connections-exhausted", {
          pg_backends: [100, 90, 80],
          pg_max_connections: [200, 200, 200],
        }),
      ).toEqual({ breached: false, healthy: true });
    });

    test("holds its status inside the recovery dead band instead of flapping", async () => {
      // 93%: below the 95% breach, above the 85.5% recovery.
      expect(
        await evaluate("database-postgresql-connections-exhausted", {
          pg_backends: [186, 186, 186],
          pg_max_connections: [200, 200, 200],
        }),
      ).toEqual({ breached: false, healthy: false });
    });

    test("a single spike does not fire the sustained warning", async () => {
      expect(
        await evaluate("database-postgresql-connections-high", {
          pg_backends: [100, 170, 100],
          pg_max_connections: [200, 200, 200],
        }),
      ).toEqual({ breached: false, healthy: false });

      expect(
        await evaluate("database-postgresql-connections-high", {
          pg_backends: [170, 172, 180],
          pg_max_connections: [200, 200, 200],
        }),
      ).toEqual({ breached: true, healthy: false });
    });
  });

  describe("PostgreSQL replica replay lag", () => {
    test("fires when the worst replica stays 30 s or more behind", async () => {
      expect(
        await evaluate("database-postgresql-replica-replay-lag", {
          pg_replay_lag: [45, 60, 38],
        }),
      ).toEqual({ breached: true, healthy: false });
    });

    test("recovers when replicas catch up", async () => {
      expect(
        await evaluate("database-postgresql-replica-replay-lag", {
          pg_replay_lag: [0, 1, 2],
        }),
      ).toEqual({ breached: false, healthy: true });
    });

    test("the slowest replica's replay delay fires, whatever the other operations read", async () => {
      /*
       * postgresql.wal.delay as the receiver records it: seconds as a
       * double, one row per replica and operation.
       */
      const replica: (
        client: string,
        replay: number,
      ) => Array<Omit<ReceiverRow, "minute">> = (
        client: string,
        replay: number,
      ): Array<Omit<ReceiverRow, "minute">> => {
        return [
          {
            metricName: "postgresql.wal.delay",
            attributes: { operation: "write", replication_client: client },
            value: 0.002,
          },
          {
            metricName: "postgresql.wal.delay",
            attributes: { operation: "flush", replication_client: client },
            value: 0.004,
          },
          {
            metricName: "postgresql.wal.delay",
            attributes: { operation: "replay", replication_client: client },
            value: replay,
          },
        ];
      };

      expect(
        await evaluateRows(
          "database-postgresql-replica-replay-lag",
          everyMinute(
            [...replica("10.0.0.7", 0.3), ...replica("10.0.0.8", 45.5)],
            5,
          ),
        ),
      ).toEqual({ breached: true, healthy: false });

      expect(
        await evaluateRows(
          "database-postgresql-replica-replay-lag",
          everyMinute(
            [...replica("10.0.0.7", 0.3), ...replica("10.0.0.8", 0.6)],
            5,
          ),
        ),
      ).toEqual({ breached: false, healthy: true });
    });

    test("reads the replay operation only", () => {
      const step: MonitorStep = getTemplate(
        "database-postgresql-replica-replay-lag",
      ).getMonitorStep(buildArgs());

      expect(
        getViewConfig(step).queryConfigs[0]!.metricQueryData.filterData
          .attributes,
      ).toEqual({
        operation: "replay",
        [DATABASE_SERVER_ID_SCOPE_ATTRIBUTE]: DATABASE_SERVER_ID,
      });
      expect(
        getViewConfig(step).queryConfigs[0]!.metricQueryData.filterData
          .aggegationType,
      ).toBe(MetricsAggregationType.Max);
    });
  });

  describe("Engine Metrics Stopped (the receiver's heartbeat going silent)", () => {
    test.each(
      getDatabaseEnginesWithAlertTemplates().map((engine: string): string => {
        return getDatabaseAlertTemplates(engine)[0]!.id;
      }),
    )(
      "%s fires on a silent window and is healthy while data flows",
      async (templateId: string) => {
        const step: MonitorStep =
          getTemplate(templateId).getMonitorStep(buildArgs());
        const alias: string =
          getViewConfig(step).queryConfigs[0]!.metricAliasData!.metricVariable!;

        expect(await evaluate(templateId, { [alias]: [] })).toEqual({
          breached: true,
          healthy: false,
        });

        expect(await evaluate(templateId, { [alias]: [2, 2, 2] })).toEqual({
          breached: false,
          healthy: true,
        });
      },
    );

    test("carries the Trigger no-data policy on the breach side only", () => {
      for (const engine of getDatabaseEnginesWithAlertTemplates()) {
        const step: MonitorStep =
          getDatabaseAlertTemplates(engine)[0]!.getMonitorStep(buildArgs());

        expect(
          getUnhealthy(step).data!.filters[0]!.metricMonitorOptions
            ?.onNoDataPolicy,
        ).toBe(NoDataPolicy.Trigger);
      }
    });
  });

  describe("Server Restarted (uptime)", () => {
    test("fires on the first young uptime sample in the window", async () => {
      expect(
        await evaluate("database-mysql-restarted", {
          mysql_uptime: [86400, 86460, 45],
        }),
      ).toEqual({ breached: true, healthy: false });
    });

    test("is healthy once the whole window has aged past the dead band", async () => {
      expect(
        await evaluate("database-redis-restarted", {
          redis_uptime: [7200, 7260, 7320],
        }),
      ).toEqual({ breached: false, healthy: true });
    });

    test("uses MongoDB's millisecond uptime unit", async () => {
      expect(
        await evaluate("database-mongodb-restarted", {
          mongodb_uptime: [120000],
        }),
      ).toEqual({ breached: true, healthy: false });

      // 30 minutes in ms: long past ten minutes.
      expect(
        await evaluate("database-mongodb-restarted", {
          mongodb_uptime: [1800000, 1860000],
        }),
      ).toEqual({ breached: false, healthy: true });
    });

    test("reads the post-restart value of a bucket (Min), and fires on AnyValue", () => {
      for (const id of [
        "database-mysql-restarted",
        "database-redis-restarted",
        "database-mongodb-restarted",
      ]) {
        const step: MonitorStep = getTemplate(id).getMonitorStep(buildArgs());

        expect(
          getViewConfig(step).queryConfigs[0]!.metricQueryData.filterData
            .aggegationType,
        ).toBe(MetricsAggregationType.Min);
        expect(
          getUnhealthy(step).data!.filters[0]!.metricMonitorOptions
            ?.metricAggregationType,
        ).toBe(EvaluateOverTimeType.AnyValue);
        expect(
          getHealthy(step).data!.filters[0]!.metricMonitorOptions
            ?.metricAggregationType,
        ).toBe(EvaluateOverTimeType.AllValues);
      }
    });
  });

  describe("Redis memory fragmentation (two conditions)", () => {
    const GB: number = 1073741824;
    const MB: number = 1048576;

    test("fires on a high ratio on a large instance", async () => {
      expect(
        await evaluate("database-redis-memory-fragmentation", {
          redis_fragmentation_ratio: [1.9, 2.1, 2.0],
          redis_fragmentation_memory_used: [4 * GB, 4 * GB, 4 * GB],
        }),
      ).toEqual({ breached: true, healthy: false });
    });

    test("ignores the naturally high ratio of a tiny instance", async () => {
      expect(
        await evaluate("database-redis-memory-fragmentation", {
          redis_fragmentation_ratio: [6.5, 7.0, 6.8],
          redis_fragmentation_memory_used: [2 * MB, 2 * MB, 2 * MB],
        }),
      ).toEqual({ breached: false, healthy: true });
    });

    test("recovers when the ratio clears, whatever the size", async () => {
      expect(
        await evaluate("database-redis-memory-fragmentation", {
          redis_fragmentation_ratio: [1.05, 1.1, 1.08],
          redis_fragmentation_memory_used: [4 * GB, 4 * GB, 4 * GB],
        }),
      ).toEqual({ breached: false, healthy: true });
    });
  });

  describe("Redis memory near maxmemory", () => {
    test("fires at 95% of maxmemory", async () => {
      expect(
        await evaluate("database-redis-memory-near-maxmemory", {
          redis_memory_used: [950, 960, 955],
          redis_maxmemory: [1000, 1000, 1000],
        }),
      ).toEqual({ breached: true, healthy: false });
    });

    test("never fires on a server with no maxmemory set (maxmemory = 0)", async () => {
      /*
       * Division by zero is not finite, so the formula engine drops those
       * points: an unlimited server has no "near the limit" and the criteria
       * sees no data — which it ignores rather than breaching on.
       */
      expect(
        await evaluate("database-redis-memory-near-maxmemory", {
          redis_memory_used: [950, 960, 955],
          redis_maxmemory: [0, 0, 0],
        }),
      ).toEqual({ breached: false, healthy: false });
    });
  });

  describe("MongoDB connections vs the connections it can accept", () => {
    test("fires at 95% of current + available", async () => {
      expect(
        await evaluate("database-mongodb-connections-exhausted", {
          mongodb_connections_current: [950, 960, 970],
          mongodb_connections_available: [50, 40, 30],
        }),
      ).toEqual({ breached: true, healthy: false });
    });

    test("is unaffected by MongoDB repeating the server-wide counts per database", async () => {
      // Four databases each report 100 current / 900 available: still 10%.
      expect(
        await evaluate("database-mongodb-connections-exhausted", {
          mongodb_connections_current: [400, 400, 400],
          mongodb_connections_available: [3600, 3600, 3600],
        }),
      ).toEqual({ breached: false, healthy: true });
    });
  });

  describe("MySQL", () => {
    test("dirty pages at 80% of the buffer pool fire; a full but clean pool does not", async () => {
      expect(
        await evaluate("database-mysql-buffer-pool-dirty", {
          mysql_buffer_pool_dirty: [800, 810, 820],
          mysql_buffer_pool_size: [1000, 1000, 1000],
        }),
      ).toEqual({ breached: true, healthy: false });

      expect(
        await evaluate("database-mysql-buffer-pool-dirty", {
          mysql_buffer_pool_dirty: [50, 40, 60],
          mysql_buffer_pool_size: [1000, 1000, 1000],
        }),
      ).toEqual({ breached: false, healthy: true });
    });

    /*
     * Regression (e2e, collector-contrib 0.161.0): offered to MariaDB 11.4,
     * the template opened an alert reading "232167.26% (dirty 37666816 /
     * size 16224)" for a pool 18% dirty, and it never cleared: the mysql
     * receiver reports MariaDB's mysql.buffer_pool.limit as the pool's PAGE
     * count (8112), not its 134217728 bytes. One scrape of each server,
     * every buffer-pool metric exactly as ClickHouse stored it.
     */
    const MARIADB_11_4_SCRAPE: Array<Omit<ReceiverRow, "minute">> = [
      { metricName: "mysql.buffer_pool.limit", attributes: {}, value: 8112 },
      {
        metricName: "mysql.buffer_pool.usage",
        attributes: { status: "dirty" },
        value: 16203776,
      },
      {
        metricName: "mysql.buffer_pool.usage",
        attributes: { status: "clean" },
        value: 4653056,
      },
      {
        metricName: "mysql.buffer_pool.data_pages",
        attributes: { status: "dirty" },
        value: 989,
      },
      {
        metricName: "mysql.buffer_pool.data_pages",
        attributes: { status: "clean" },
        value: 284,
      },
      {
        metricName: "mysql.buffer_pool.pages",
        attributes: { kind: "total" },
        value: 8112,
      },
      {
        metricName: "mysql.buffer_pool.pages",
        attributes: { kind: "data" },
        value: 1273,
      },
      {
        metricName: "mysql.buffer_pool.pages",
        attributes: { kind: "free" },
        value: 6839,
      },
      {
        metricName: "mysql.buffer_pool.pages",
        attributes: { kind: "misc" },
        value: 0,
      },
    ];

    const MYSQL_8_4_SCRAPE: Array<Omit<ReceiverRow, "minute">> = [
      {
        metricName: "mysql.buffer_pool.limit",
        attributes: {},
        value: 134217728,
      },
      {
        metricName: "mysql.buffer_pool.usage",
        attributes: { status: "dirty" },
        value: 0,
      },
      {
        metricName: "mysql.buffer_pool.usage",
        attributes: { status: "clean" },
        value: 19431424,
      },
      {
        metricName: "mysql.buffer_pool.data_pages",
        attributes: { status: "dirty" },
        value: 0,
      },
      {
        metricName: "mysql.buffer_pool.data_pages",
        attributes: { status: "clean" },
        value: 1186,
      },
      {
        metricName: "mysql.buffer_pool.pages",
        attributes: { kind: "total" },
        value: 8192,
      },
      {
        metricName: "mysql.buffer_pool.pages",
        attributes: { kind: "data" },
        value: 1186,
      },
      {
        metricName: "mysql.buffer_pool.pages",
        attributes: { kind: "free" },
        value: 7006,
      },
      {
        metricName: "mysql.buffer_pool.pages",
        attributes: { kind: "misc" },
        value: 0,
      },
    ];

    // The same scrape with `dirtyPages` of the pool's pages dirty.
    function withDirtyPages(
      scrape: Array<Omit<ReceiverRow, "minute">>,
      dirtyPages: number,
    ): Array<Omit<ReceiverRow, "minute">> {
      return scrape.map(
        (row: Omit<ReceiverRow, "minute">): Omit<ReceiverRow, "minute"> => {
          if (
            row.metricName === "mysql.buffer_pool.data_pages" &&
            row.attributes["status"] === "dirty"
          ) {
            return { ...row, value: dirtyPages };
          }
          if (
            row.metricName === "mysql.buffer_pool.usage" &&
            row.attributes["status"] === "dirty"
          ) {
            return { ...row, value: dirtyPages * 16384 };
          }
          return row;
        },
      );
    }

    test("MariaDB 12% dirty is healthy, though its buffer_pool.limit is a page count", async () => {
      expect(
        await evaluateRows(
          "database-mysql-buffer-pool-dirty",
          everyMinute(MARIADB_11_4_SCRAPE),
        ),
      ).toEqual({ breached: false, healthy: true });
    });

    test("MariaDB 80% dirty fires", async () => {
      expect(
        await evaluateRows(
          "database-mysql-buffer-pool-dirty",
          everyMinute(withDirtyPages(MARIADB_11_4_SCRAPE, 6500)),
        ),
      ).toEqual({ breached: true, healthy: false });
    });

    test("MySQL 8.4, clean, is healthy; 80% dirty fires", async () => {
      expect(
        await evaluateRows(
          "database-mysql-buffer-pool-dirty",
          everyMinute(MYSQL_8_4_SCRAPE),
        ),
      ).toEqual({ breached: false, healthy: true });
      expect(
        await evaluateRows(
          "database-mysql-buffer-pool-dirty",
          everyMinute(withDirtyPages(MYSQL_8_4_SCRAPE, 6554)),
        ),
      ).toEqual({ breached: true, healthy: false });
    });

    test("reads dirty data pages over the pool's TOTAL pages, never the byte metrics", () => {
      const template: DatabaseAlertTemplate = getTemplate(
        "database-mysql-buffer-pool-dirty",
      );
      expect(template.metricNames).toEqual([
        "mysql.buffer_pool.data_pages",
        "mysql.buffer_pool.pages",
      ]);
      expect(
        getViewConfig(template.getMonitorStep(buildArgs())).queryConfigs.map(
          (queryConfig: MetricQueryConfigData) => {
            const attributes: Record<string, unknown> = {
              ...(queryConfig.metricQueryData.filterData.attributes as Record<
                string,
                unknown
              >),
            };
            delete attributes[DATABASE_SERVER_ID_SCOPE_ATTRIBUTE];
            return [
              queryConfig.metricQueryData.filterData.metricName,
              attributes,
            ];
          },
        ),
      ).toEqual([
        ["mysql.buffer_pool.data_pages", { status: "dirty" }],
        // Unpinned, total + data + free + misc would halve the ratio.
        ["mysql.buffer_pool.pages", { kind: "total" }],
      ]);
    });

    test("filters the thread kind it thresholds", () => {
      const running: MonitorStep = getTemplate(
        "database-mysql-threads-running-high",
      ).getMonitorStep(buildArgs());
      const connected: MonitorStep = getTemplate(
        "database-mysql-connections-high",
      ).getMonitorStep(buildArgs());

      expect(
        (
          getViewConfig(running).queryConfigs[0]!.metricQueryData.filterData
            .attributes as Record<string, unknown>
        )["kind"],
      ).toBe("running");
      expect(
        (
          getViewConfig(connected).queryConfigs[0]!.metricQueryData.filterData
            .attributes as Record<string, unknown>
        )["kind"],
      ).toBe("connected");
    });

    test("replica lag fires at 30 s and recovers at 0", async () => {
      expect(
        await evaluate("database-mysql-replica-lag", {
          mysql_replica_lag: [40, 55, 31],
        }),
      ).toEqual({ breached: true, healthy: false });
      expect(
        await evaluate("database-mysql-replica-lag", {
          mysql_replica_lag: [0, 0, 0],
        }),
      ).toEqual({ breached: false, healthy: true });
    });
  });

  describe("SQL Server", () => {
    test("blocked sessions seen throughout the window fire; a short burst does not", async () => {
      expect(
        await evaluate("database-sqlserver-sessions-blocked", {
          sqlserver_processes_blocked: [1, 3, 2],
        }),
      ).toEqual({ breached: true, healthy: false });

      // One minute of blocking is ordinary lock contention, not a chain.
      expect(
        await evaluate("database-sqlserver-sessions-blocked", {
          sqlserver_processes_blocked: [0, 6, 0],
        }),
      ).toEqual({ breached: false, healthy: false });

      expect(
        await evaluate("database-sqlserver-sessions-blocked", {
          sqlserver_processes_blocked: [0, 0, 0],
        }),
      ).toEqual({ breached: false, healthy: true });
    });

    test("blocked sessions keep the worst scrape of each minute, over ten minutes", () => {
      const step: MonitorStep = getTemplate(
        "database-sqlserver-sessions-blocked",
      ).getMonitorStep(buildArgs());

      expect(
        getViewConfig(step).queryConfigs[0]!.metricQueryData.filterData
          .aggegationType,
      ).toBe(MetricsAggregationType.Max);
      expect(step.data!.metricMonitor!.rollingTime).toBe(
        RollingTime.Past10Minutes,
      );
    });

    test("queries waiting for a memory grant fire when sustained and recover at 0", async () => {
      expect(
        await evaluate("database-sqlserver-memory-grants-pending", {
          sqlserver_memory_grants_pending: [2, 4, 1],
        }),
      ).toEqual({ breached: true, healthy: false });
      expect(
        await evaluate("database-sqlserver-memory-grants-pending", {
          sqlserver_memory_grants_pending: [0, 0, 0],
        }),
      ).toEqual({ breached: false, healthy: true });
    });

    test("page life expectancy fires LOW and recovers high", async () => {
      expect(
        await evaluate("database-sqlserver-page-life-expectancy-low", {
          sqlserver_page_life_expectancy: [120, 90, 60],
        }),
      ).toEqual({ breached: true, healthy: false });
      expect(
        await evaluate("database-sqlserver-page-life-expectancy-low", {
          sqlserver_page_life_expectancy: [3000, 3100, 3200],
        }),
      ).toEqual({ breached: false, healthy: true });
    });
  });

  describe("Oracle tablespace fullness (a 0..1 share, compared in percent)", () => {
    test("the fullest tablespace at 93% fires", async () => {
      expect(
        await evaluate("database-oracle-tablespace-nearly-full", {
          oracle_tablespace_utilization: [0.93, 0.95, 0.94],
        }),
      ).toEqual({ breached: true, healthy: false });
    });

    test("recovers well below the threshold and holds inside the dead band", async () => {
      expect(
        await evaluate("database-oracle-tablespace-nearly-full", {
          oracle_tablespace_utilization: [0.5, 0.52, 0.51],
        }),
      ).toEqual({ breached: false, healthy: true });

      // 85%: below the 90% breach, above the 81% recovery.
      expect(
        await evaluate("database-oracle-tablespace-nearly-full", {
          oracle_tablespace_utilization: [0.85, 0.85, 0.85],
        }),
      ).toEqual({ breached: false, healthy: false });
    });

    test("a raw 0..1 value is never compared against 90 directly", async () => {
      /*
       * Without the percentage formula a full tablespace (1.0) would sit far
       * below a threshold of 90 and never fire.
       */
      expect(
        await evaluate("database-oracle-tablespace-nearly-full", {
          oracle_tablespace_utilization: [1, 1, 1],
        }),
      ).toEqual({ breached: true, healthy: false });

      const step: MonitorStep = getTemplate(
        "database-oracle-tablespace-nearly-full",
      ).getMonitorStep(buildArgs());

      expect(getUnhealthy(step).data!.filters[0]!.metricMonitorOptions).toEqual(
        expect.objectContaining({
          metricAlias: "oracle_tablespace_percent",
        }),
      );
      expect(
        getViewConfig(step).queryConfigs[0]!.metricQueryData.filterData
          .aggegationType,
      ).toBe(MetricsAggregationType.Max);
    });
  });

  describe("Elasticsearch cluster health (a 0/1 status series)", () => {
    test("red fires on 1 and recovers on 0 with no dead band", async () => {
      expect(
        await evaluate("database-elasticsearch-cluster-red", {
          elasticsearch_health_red: [1, 1, 1],
        }),
      ).toEqual({ breached: true, healthy: false });
      expect(
        await evaluate("database-elasticsearch-cluster-red", {
          elasticsearch_health_red: [0, 0, 0],
        }),
      ).toEqual({ breached: false, healthy: true });

      const step: MonitorStep = getTemplate(
        "database-elasticsearch-cluster-red",
      ).getMonitorStep(buildArgs());

      expect(getHealthy(step).data!.filters[0]!.value).toBe(1);
      expect(getHealthy(step).data!.filters[0]!.filterType).toBe(
        FilterType.LessThan,
      );
    });

    test("yellow filters the yellow status", () => {
      const step: MonitorStep = getTemplate(
        "database-elasticsearch-cluster-yellow",
      ).getMonitorStep(buildArgs());

      expect(
        (
          getViewConfig(step).queryConfigs[0]!.metricQueryData.filterData
            .attributes as Record<string, unknown>
        )["status"],
      ).toBe("yellow");
    });
  });

  describe("Elasticsearch JVM heap (the receiver records heap.used twice per scrape)", () => {
    const GIB: number = 1073741824;

    /*
     * One scrape of a healthy three-node cluster exactly as the v0.161.0
     * receiver records it: per node, from _nodes/stats, heap max, heap used
     * and heap utilization (a 0..1 share); and once more at CLUSTER level,
     * from _cluster/stats, jvm.memory.heap.used for the whole cluster — with
     * no matching heap.max. Both resource blocks carry the database stamp.
     */
    function clusterScrape(
      utilizationByNode: Array<number>,
    ): Array<Omit<ReceiverRow, "minute">> {
      const rows: Array<Omit<ReceiverRow, "minute">> = [];
      let clusterUsed: number = 0;

      utilizationByNode.forEach((utilization: number, index: number) => {
        const node: Record<string, string> = {
          "elasticsearch.node.name": `node-${index + 1}`,
        };
        const used: number = utilization * 4 * GIB;
        clusterUsed += used;

        rows.push(
          {
            metricName: "jvm.memory.heap.max",
            attributes: node,
            value: 4 * GIB,
          },
          { metricName: "jvm.memory.heap.used", attributes: node, value: used },
          {
            metricName: "jvm.memory.heap.utilization",
            attributes: node,
            value: utilization,
          },
        );
      });

      rows.push({
        metricName: "jvm.memory.heap.used",
        attributes: {},
        value: clusterUsed,
      });

      return rows;
    }

    test("the fixture holds the trap: Σ heap.used / Σ heap.max reads 100% on a cluster at 50%", () => {
      const rows: Array<ReceiverRow> = everyMinute(
        clusterScrape([0.5, 0.5, 0.5]),
        1,
      );
      const sum: (metricName: string) => number = (
        metricName: string,
      ): number => {
        return rows
          .filter((row: ReceiverRow): boolean => {
            return row.metricName === metricName;
          })
          .reduce((total: number, row: ReceiverRow): number => {
            return total + row.value;
          }, 0);
      };

      expect(
        (sum("jvm.memory.heap.used") / sum("jvm.memory.heap.max")) * 100,
      ).toBe(100);
    });

    test("a cluster at 50% heap is healthy", async () => {
      expect(
        await evaluateRows(
          "database-elasticsearch-jvm-heap-high",
          everyMinute(clusterScrape([0.5, 0.5, 0.5])),
        ),
      ).toEqual({ breached: false, healthy: true });
    });

    test("a single-node cluster at 50% heap is healthy too", async () => {
      expect(
        await evaluateRows(
          "database-elasticsearch-jvm-heap-high",
          everyMinute(clusterScrape([0.5])),
        ),
      ).toEqual({ breached: false, healthy: true });
    });

    test("one node held at 90% fires, even while the cluster average is low", async () => {
      expect(
        await evaluateRows(
          "database-elasticsearch-jvm-heap-high",
          everyMinute(clusterScrape([0.3, 0.9, 0.3])),
        ),
      ).toEqual({ breached: true, healthy: false });
    });

    test("holds its status inside the recovery dead band", async () => {
      // 80%: below the 85% breach, above the 76.5% recovery.
      expect(
        await evaluateRows(
          "database-elasticsearch-jvm-heap-high",
          everyMinute(clusterScrape([0.8, 0.5, 0.5])),
        ),
      ).toEqual({ breached: false, healthy: false });
    });

    test("reads the per-node utilization with Max, compared in percent", () => {
      const step: MonitorStep = getTemplate(
        "database-elasticsearch-jvm-heap-high",
      ).getMonitorStep(buildArgs());

      expect(
        getViewConfig(step).queryConfigs.map(
          (queryConfig: MetricQueryConfigData) => {
            return [
              queryConfig.metricQueryData.filterData.metricName,
              queryConfig.metricQueryData.filterData.aggegationType,
            ];
          },
        ),
      ).toEqual([["jvm.memory.heap.utilization", MetricsAggregationType.Max]]);
      expect(getUnhealthy(step).data!.filters[0]!.metricMonitorOptions).toEqual(
        expect.objectContaining({ metricAlias: "elasticsearch_heap_percent" }),
      );
    });
  });

  describe("Redis fragmentation reads as the ratio it is, not a percentage", () => {
    test("the alert text says 1.62 against 1.5, never 162% against 150%", async () => {
      /*
       * redis.memory.fragmentation_ratio has the dimensionless unit "1" and
       * a `_ratio` name, which the notification formatter otherwise takes for
       * a 0..1 fraction and renders ×100. It is not one: healthy is ~1.0.
       */
      const step: MonitorStep = getTemplate(
        "database-redis-memory-fragmentation",
      ).getMonitorStep(buildArgs());
      const rootCause: string | null = await getRootCause(
        step,
        getUnhealthy(step).data!.filters[0]!,
        buildResponse(step, {
          redis_fragmentation_ratio: [1.62, 1.62, 1.62],
          redis_fragmentation_memory_used: [4294967296, 4294967296, 4294967296],
        }),
      );

      expect(rootCause).not.toBeNull();
      expect(rootCause).toContain("1.62");
      expect(rootCause).toContain("1.5");
      expect(rootCause).not.toContain("%");
      expect(rootCause).not.toContain("162");
    });

    test.each(TEMPLATE_CASES)(
      "%s never compares a raw >1 ratio the formatter would render ×100",
      (_id: string, template: DatabaseAlertTemplate) => {
        const step: MonitorStep = template.getMonitorStep(buildArgs());

        for (const queryConfig of getViewConfig(step).queryConfigs) {
          const metricName: string = queryConfig.metricQueryData.filterData
            .metricName as string;
          const nativeUnit: string | undefined =
            getDatabaseAlertMetric(metricName)?.unit;

          if (
            nativeUnit !== "1" ||
            !ValueFormatter.isFractionMetric(metricName)
          ) {
            continue;
          }

          /*
           * A genuine 0..1 share (a `.utilization`) is compared through a
           * ×100 formula instead; anything else must say it is no fraction.
           */
          if (metricName.endsWith(".utilization")) {
            continue;
          }

          expect(queryConfig.metricAliasData?.legendUnit).toBeDefined();
          expect(queryConfig.metricAliasData?.legendUnit).not.toBe("1");
        }
      },
    );
  });

  describe("byte thresholds read as the round figure their label names", () => {
    /*
     * The alert text formats bytes on the dashboard's decimal ladder
     * (1,000 B = 1 KB), so a "1 GB" threshold written as 1073741824 reached
     * on-call as "1.07 GB". Every byte threshold is the decimal figure its
     * label names.
     */
    function byteComparisons(
      template: DatabaseAlertTemplate,
    ): Array<{ threshold: number; label: string }> {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const unhealthy: MonitorCriteriaInstance = getUnhealthy(step);
      const comparisons: Array<{ threshold: number; label: string }> = [];

      for (const filter of unhealthy.data!.filters) {
        const queryConfig: MetricQueryConfigData | undefined = getViewConfig(
          step,
        ).queryConfigs.find((candidate: MetricQueryConfigData): boolean => {
          return (
            candidate.metricAliasData?.metricVariable ===
            filter.metricMonitorOptions?.metricAlias
          );
        });
        const metricName: string | undefined = queryConfig?.metricQueryData
          .filterData.metricName as string | undefined;

        if (
          !metricName ||
          getDatabaseAlertMetric(metricName)?.unit !== "By" ||
          queryConfig?.metricAliasData?.legendUnit
        ) {
          continue;
        }

        comparisons.push({
          threshold: Number(filter.value),
          // The breach's name carries its own label; a second filter's is in the description.
          label: `${unhealthy.data!.name} ${unhealthy.data!.description}`,
        });
      }

      return comparisons;
    }

    test.each(TEMPLATE_CASES)(
      "%s names each byte threshold as the alert text renders it",
      (_id: string, template: DatabaseAlertTemplate) => {
        for (const comparison of byteComparisons(template)) {
          expect(comparison.label).toContain(
            MetricValueFormatter.format({
              value: comparison.threshold,
              unit: "By",
            }),
          );
        }
      },
    );

    test("the byte-lag alert says 1 GB, the figure its name promises", async () => {
      const step: MonitorStep = getTemplate(
        "database-postgresql-replication-byte-lag",
      ).getMonitorStep(buildArgs());
      const rootCause: string | null = await getRootCause(
        step,
        getUnhealthy(step).data!.filters[0]!,
        buildResponse(step, {
          pg_replication_delay: [1500000000, 1600000000, 1700000000],
        }),
      );

      expect(rootCause).toContain("1 GB");
      expect(rootCause).not.toContain("1.07 GB");
    });
  });
});

/*
 * Receiver behaviour the metadata does not show, each measured against the
 * v0.161.0 source. A template reading any of these watches nothing.
 */
describe("DatabaseAlertTemplates — signals that can never fire are not offered", () => {
  test("no template reads mysql.buffer_pool.limit, a page count on MariaDB", () => {
    expect(getDatabaseAlertMetric("mysql.buffer_pool.limit")).toBeUndefined();
    for (const template of ALL_TEMPLATES) {
      expect(template.metricNames).not.toContain("mysql.buffer_pool.limit");
    }
  });

  test("no template reads mongodb.health, which can only ever read 1", () => {
    /*
     * The receiver records mongodb.health from serverStatus's `ok` — only
     * after serverStatus SUCCEEDED (it returns early on the error the Go
     * driver makes of an ok:0 reply). A member in RECOVERING or ROLLBACK
     * still answers ok:1, and a server that is down emits nothing, which
     * "Engine Metrics Stopped" already covers.
     */
    expect(getDatabaseAlertTemplateById("database-mongodb-unhealthy")).toBe(
      undefined,
    );
    expect(getDatabaseAlertMetric("mongodb.health")).toBeUndefined();

    for (const template of ALL_TEMPLATES) {
      expect(template.metricNames).not.toContain("mongodb.health");
    }
  });

  test("no template reads postgresql.wal.lag, which a default-on feature gate replaces", () => {
    /*
     * `postgresqlreceiver.preciselagmetrics` is a BETA gate in 0.161.0 —
     * enabled by default — under which the receiver records
     * postgresql.wal.delay INSTEAD of postgresql.wal.lag. wal.delay is off
     * by default, so the Database Agent enables it.
     */
    expect(getDatabaseAlertMetric("postgresql.wal.lag")).toBeUndefined();

    for (const template of ALL_TEMPLATES) {
      expect(template.metricNames).not.toContain("postgresql.wal.lag");
    }

    expect(
      getTemplate("database-postgresql-replica-replay-lag").metricNames,
    ).toEqual(["postgresql.wal.delay"]);
    expect(getDatabaseAlertMetric("postgresql.wal.delay")).toEqual(
      expect.objectContaining({ kind: "gauge", unit: "s" }),
    );
  });

  test("no template sums a metric the receiver records at two levels in one scrape", () => {
    /*
     * The Elasticsearch receiver records jvm.memory.heap.used per node AND
     * once more for the whole cluster (from _cluster/stats), in the same
     * scrape and with the same stamp: any Sum over it double counts.
     */
    const recordedTwicePerScrape: Array<string> = ["jvm.memory.heap.used"];

    for (const template of ALL_TEMPLATES) {
      for (const queryConfig of getViewConfig(
        template.getMonitorStep(buildArgs()),
      ).queryConfigs) {
        const filterData: MetricQueryConfigData["metricQueryData"]["filterData"] =
          queryConfig.metricQueryData.filterData;

        if (recordedTwicePerScrape.includes(filterData.metricName as string)) {
          expect(filterData.aggegationType).not.toBe(
            MetricsAggregationType.Sum,
          );
        }
      }
    }
  });
});
