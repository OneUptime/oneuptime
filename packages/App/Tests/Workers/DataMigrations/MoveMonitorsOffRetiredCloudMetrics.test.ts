import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { MonitorFeedEventType } from "Common/Models/DatabaseModels/MonitorFeed";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorFeedService from "Common/Server/Services/MonitorFeedService";
import MonitorService from "Common/Server/Services/MonitorService";
import CloudResourceMetrics from "Common/Server/Utils/CloudConnection/CloudResourceMetrics";
import logger from "Common/Server/Utils/Logger";
import { Gray500, Yellow500 } from "Common/Types/BrandColors";
import {
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
  CloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { JSONObject } from "Common/Types/JSON";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "Common/Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import {
  CosmosLatencyEvidence,
  PUBSUB_MESSAGES_PUBLISHED_METRIC,
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  RetiredCloudMetric,
  RetiredCloudMetricKeptReason,
  RetiredCloudMetricQuery,
} from "Common/Utils/Metrics/RetiredCloudMetricMoves";
import MoveMonitorsOffRetiredCloudMetrics, {
  COSMOS_EVIDENCE_LOOK_BACK_MS,
  CosmosLatencyEvidenceFinder,
  NAMES_COSMOS_SERVER_SIDE_LATENCY,
  NAMES_PUBSUB_PUBLISH_OPERATIONS,
  PAGE_SIZE,
  findCosmosLatencyEvidence,
  readPlainAttributes,
} from "../../../FeatureSet/Workers/DataMigrations/MoveMonitorsOffRetiredCloudMetrics";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs";
import path from "path";

/*
 * MoveMonitorsOffRetiredCloudMetrics (#9739): the Metrics monitors that
 * read a metric its cloud deprecates - a Pub/Sub topic's
 * send_message_operation_count, a Cosmos DB account's ServerSideLatency -
 * move to what replaces it, as the connections stop reading the old ones.
 * How each query moves is pinned in Common (RetiredCloudMetricMoves.test).
 * Pinned here: which rows are read, which latency a Cosmos DB account's
 * monitor moves to and from what, what is written and only while the row
 * still holds what was read, what each monitor's feed says, and that one
 * failing row holds no other back.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "MoveMonitorsOffRetiredCloudMetrics";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const PROJECT_ID: string = "6b1f0a3c-2d4e-4f5a-9b6c-7d8e9f0a1b2c";
const MONITOR_A: string = "0a7d3c1e-1b2c-4d3e-8f4a-5b6c7d8e9f01";
const MONITOR_B: string = "0b8e4d2f-2c3d-4e4f-9a5b-6c7d8e9f0a12";
const MONITOR_C: string = "0c9f5e3a-3d4e-4f5a-8b6c-7d8e9f0a1b23";
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

const TOPIC_ATTRIBUTES: JSONObject = {
  "resource.gcp.resource_type": "pubsub_topic",
  "resource.project_id": "shop-prod",
  "resource.topic_id": "orders",
};
const COSMOS_ID: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.DocumentDB/databaseAccounts/orders-db";
const COSMOS_ATTRIBUTES: JSONObject = {
  "azuremonitor.resource_id": COSMOS_ID,
};
const COSMOS_LATENCY: string = "azure_serversidelatency_average";

const mockedLogger: { error: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; info: jest.Mock };

const STATUS: {
  online: ObjectID;
  offline: ObjectID;
  incident: ObjectID;
  alert: ObjectID;
} = {
  online: new ObjectID("5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
  offline: new ObjectID("6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e"),
  incident: new ObjectID("7c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f"),
  alert: new ObjectID("8d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a"),
};

function query(data: {
  variable: string;
  metricName: string;
  attributes: JSONObject;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: data.variable,
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        attributes: data.attributes as never,
        aggregateBy: {},
      },
    },
  } as MetricQueryConfigData;
}

function criteriaOn(alias: string, value: number): MonitorCriteria {
  const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: STATUS.offline,
    incidentSeverityId: STATUS.incident,
    alertSeverityId: STATUS.alert,
    monitorName: "orders",
    metricAlias: alias,
    filterType: FilterType.GreaterThanOrEqualTo,
    value,
    metricAggregationType: EvaluateOverTimeType.AnyValue,
  });
  const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
    onlineMonitorStatusId: STATUS.online,
    metricAlias: alias,
    filterType: FilterType.LessThan,
    value,
    recoveryValue: value,
  });
  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };

  return criteria;
}

function metricStep(data: {
  queries: Array<MetricQueryConfigData>;
  formulas?: Array<MetricFormulaConfigData> | undefined;
  criteria: MonitorCriteria;
}): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "orders",
    monitorType: MonitorType.Metrics,
    onlineMonitorStatusId: STATUS.online,
    offlineMonitorStatusId: STATUS.offline,
    defaultIncidentSeverityId: STATUS.incident,
    defaultAlertSeverityId: STATUS.alert,
  });

  step.setMetricMonitor({
    metricViewConfig: {
      queryConfigs: data.queries,
      formulaConfigs: data.formulas || [],
    },
    rollingTime: RollingTime.Past15Minutes,
  });
  step.setMonitorCriteria(data.criteria);

  return step;
}

// Monitor steps as the database holds them and hands them back.
function stored(steps: Array<MonitorStep>): JSONObject {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(steps);
  monitorSteps.setDefaultMonitorStatusId(STATUS.online);

  return JSON.parse(JSON.stringify(monitorSteps.toJSON())) as JSONObject;
}

function pubSubMonitor(threshold: number = 5): JSONObject {
  return stored([
    metricStep({
      queries: [
        query({
          variable: "a",
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          attributes: TOPIC_ATTRIBUTES,
        }),
      ],
      criteria: criteriaOn("a", threshold),
    }),
  ]);
}

function cosmosMonitor(): JSONObject {
  return stored([
    metricStep({
      queries: [
        query({
          variable: "latency",
          metricName: COSMOS_LATENCY,
          attributes: COSMOS_ATTRIBUTES,
        }),
      ],
      criteria: criteriaOn("latency", 50),
    }),
  ]);
}

// What stored steps say, read back: each step's metric names and thresholds.
function readOf(json: unknown): {
  metrics: Array<string>;
  thresholds: Array<unknown>;
} {
  const steps: Array<MonitorStep> = MonitorSteps.fromJSON(
    (typeof json === "string" ? JSON.parse(json) : json) as JSONObject,
  ).data!.monitorStepsInstanceArray;

  return {
    metrics: steps.flatMap((step: MonitorStep): Array<string> => {
      return step.data!.metricMonitor!.metricViewConfig.queryConfigs.map(
        (config: MetricQueryConfigData): string => {
          return String(config.metricQueryData.filterData.metricName);
        },
      );
    }),
    thresholds: steps.flatMap((step: MonitorStep): Array<unknown> => {
      return step
        .data!.monitorCriteria.data!.monitorCriteriaInstanceArray.flatMap(
          (instance: MonitorCriteriaInstance): Array<CriteriaFilter> => {
            return instance.data!.filters;
          },
        )
        .map((filter: CriteriaFilter): unknown => {
          return filter.value;
        });
    }),
  };
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

interface StoredRow {
  _id: string;
  projectId: string;
  monitorType: string;
  monitorSteps: unknown;
}

interface StubbedTable {
  statements: Array<Statement>;
  rows: Array<StoredRow>;
  failUpdatesFor: Set<string>;
  savedMeanwhile: Set<string>;
  returning: "pg" | "rows";
}

function sameJSON(a: unknown, b: unknown): boolean {
  const parsed: (value: unknown) => unknown = (value: unknown): unknown => {
    return typeof value === "string" ? JSON.parse(value) : value;
  };

  return JSON.stringify(parsed(a)) === JSON.stringify(parsed(b));
}

// A LIKE pattern of the form %text%, as Postgres matches it ("_" is any one character).
function matchesLike(text: string, like: string): boolean {
  const pattern: string = escapeRegExp(like.slice(1, -1)).replace(/_/g, ".");

  return new RegExp(pattern).test(text);
}

/*
 * Answers the migration's SELECT from `rows` - the monitor type it asks
 * for, steps whose text matches either LIKE, paged by id as Postgres would
 * - and its UPDATE as Postgres would: only while the row holds what the
 * statement says it read.
 */
function stubTable(): StubbedTable {
  const table: StubbedTable = {
    statements: [],
    rows: [],
    failUpdatesFor: new Set<string>(),
    savedMeanwhile: new Set<string>(),
    returning: "pg",
  };

  const run: jest.Mock = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      const statement: Statement = {
        sql: String(sql),
        parameters: (parameters as Array<unknown>) || [],
      };
      table.statements.push(statement);

      if (statement.sql.startsWith("SELECT")) {
        const limit: number = statement.parameters[0] as number;
        const monitorType: string = statement.parameters[1] as string;
        const likes: Array<string> = [
          statement.parameters[2] as string,
          statement.parameters[3] as string,
        ];
        const after: string | undefined = statement.parameters[4] as
          | string
          | undefined;

        return table.rows
          .filter((row: StoredRow) => {
            const text: string =
              typeof row.monitorSteps === "string"
                ? row.monitorSteps
                : JSON.stringify(row.monitorSteps);

            return (
              row.monitorSteps !== null &&
              row.monitorType === monitorType &&
              likes.some((like: string): boolean => {
                return matchesLike(text, like);
              }) &&
              (!after || row._id > after)
            );
          })
          .sort((a: StoredRow, b: StoredRow) => {
            return a._id < b._id ? -1 : 1;
          })
          .slice(0, limit);
      }

      const id: string = statement.parameters[1] as string;

      if (table.failUpdatesFor.has(id)) {
        throw new Error("could not write");
      }

      const row: StoredRow | undefined = table.rows.find(
        (candidate: StoredRow) => {
          return candidate._id === id;
        },
      );
      const holdsWhatWasRead: boolean =
        Boolean(row) &&
        !table.savedMeanwhile.has(id) &&
        sameJSON(row!.monitorSteps, statement.parameters[2]);

      if (holdsWhatWasRead) {
        row!.monitorSteps = JSON.parse(statement.parameters[0] as string);
      }

      const written: Array<{ _id: string }> = holdsWhatWasRead
        ? [{ _id: id }]
        : [];

      return table.returning === "pg" ? [written, written.length] : written;
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(
      MonitorService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "Monitor" },
      manager: { query: run },
    } as never);

  return table;
}

function updatesOf(table: StubbedTable): Array<Statement> {
  return table.statements.filter((statement: Statement) => {
    return statement.sql.startsWith("UPDATE");
  });
}

function selectsOf(table: StubbedTable): Array<Statement> {
  return table.statements.filter((statement: Statement) => {
    return statement.sql.startsWith("SELECT");
  });
}

interface FeedCall {
  monitorId: ObjectID;
  projectId: ObjectID;
  monitorFeedEventType: MonitorFeedEventType;
  displayColor: unknown;
  feedInfoInMarkdown: string;
}

function row(
  id: string,
  monitorSteps: unknown,
  monitorType: MonitorType = MonitorType.Metrics,
): StoredRow {
  return { _id: id, projectId: PROJECT_ID, monitorType, monitorSteps };
}

describe("MoveMonitorsOffRetiredCloudMetrics", () => {
  const migration: MoveMonitorsOffRetiredCloudMetrics =
    new MoveMonitorsOffRetiredCloudMetrics();

  let monitors: StubbedTable;
  let feed: Array<FeedCall>;
  let evidenceAsked: Array<{
    projectId: ObjectID;
    query: RetiredCloudMetricQuery;
    now: Date;
  }>;
  let evidence: CosmosLatencyEvidence | null | Error;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    monitors = stubTable();
    feed = [];
    evidenceAsked = [];
    evidence = { directPoints: 0, gatewayPoints: 0 };
    jest
      .spyOn(MonitorFeedService, "createMonitorFeedItem")
      .mockImplementation(async (data: unknown): Promise<void> => {
        feed.push(data as FeedCall);
      });
    MoveMonitorsOffRetiredCloudMetrics.findEvidence = (async (data: {
      projectId: ObjectID;
      query: RetiredCloudMetricQuery;
      now: Date;
    }): Promise<CosmosLatencyEvidence | null> => {
      evidenceAsked.push(data);

      if (evidence instanceof Error) {
        throw evidence;
      }

      return evidence;
    }) as CosmosLatencyEvidenceFinder;
    MoveMonitorsOffRetiredCloudMetrics.now = (): Date => {
      return NOW;
    };
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    function registeredMigrations(): Array<string> {
      return Array.from(
        indexSource
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .matchAll(/new\s+(\w+)\(\)/g),
      ).map((match: RegExpMatchArray) => {
        return match[1]!;
      });
    }

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    test("is registered exactly once, before the last slot, which AddAuditLogMcpClientColumns keeps", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(
        instantiations.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.length - 1,
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("which monitors are read", () => {
    test("only Metrics monitors whose steps name one of the two, a page at a time by id", async () => {
      await migration.migrate();

      expect(selectsOf(monitors)).toHaveLength(1);

      const [select] = selectsOf(monitors);

      expect(select!.sql).toContain(`FROM "Monitor"`);
      expect(select!.sql).toContain(`"monitorType" = $2`);
      expect(select!.sql).toContain(
        `("monitorSteps"::text LIKE $3 OR "monitorSteps"::text LIKE $4)`,
      );
      expect(select!.sql).toContain(`ORDER BY "_id" ASC LIMIT $1`);
      expect(select!.parameters).toEqual([
        PAGE_SIZE,
        MonitorType.Metrics,
        NAMES_PUBSUB_PUBLISH_OPERATIONS,
        NAMES_COSMOS_SERVER_SIDE_LATENCY,
      ]);
    });

    test("pages on past the first page, after its last id", async () => {
      for (let index: number = 0; index < PAGE_SIZE + 2; index++) {
        monitors.rows.push(
          row(
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            pubSubMonitor(),
          ),
        );
      }

      await migration.migrate();

      const selects: Array<Statement> = selectsOf(monitors);

      expect(selects).toHaveLength(2);
      expect(selects[1]!.parameters[4]).toBe(
        `00000000-0000-4000-8000-${String(PAGE_SIZE - 1).padStart(12, "0")}`,
      );
      expect(updatesOf(monitors)).toHaveLength(PAGE_SIZE + 2);
    });

    test("a monitor of another type, or one whose steps only name a metric in passing, is left alone", async () => {
      monitors.rows.push(
        row(MONITOR_A, pubSubMonitor(), MonitorType.Logs),
        row(
          MONITOR_B,
          stored([
            metricStep({
              queries: [
                query({
                  variable: "a",
                  // Its replacement: named like the latency, and no retired one.
                  metricName: "azure_serversidelatencydirect_average",
                  attributes: COSMOS_ATTRIBUTES,
                }),
              ],
              criteria: criteriaOn("a", 5),
            }),
          ]),
        ),
      );

      await migration.migrate();

      expect(updatesOf(monitors)).toEqual([]);
      expect(feed).toEqual([]);
      expect(evidenceAsked).toEqual([]);
    });
  });

  describe("a Pub/Sub monitor of the publish operations", () => {
    test("reads the messages published, its thresholds 60 times what they were, and its feed says so", async () => {
      monitors.rows.push(row(MONITOR_A, pubSubMonitor(5)));

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      expect(readOf(monitors.rows[0]!.monitorSteps)).toEqual({
        metrics: [PUBSUB_MESSAGES_PUBLISHED_METRIC],
        thresholds: [300, 300],
      });
      // No account's evidence is asked for a topic.
      expect(evidenceAsked).toEqual([]);

      expect(feed).toHaveLength(1);
      expect(feed[0]!).toMatchObject({
        monitorId: new ObjectID(MONITOR_A),
        projectId: new ObjectID(PROJECT_ID),
        monitorFeedEventType: MonitorFeedEventType.MonitorUpdated,
        displayColor: Gray500,
      });
      expect(feed[0]!.feedInfoInMarkdown).toBe(
        [
          "📊 **This monitor now reads what replaces a metric its cloud deprecates.**",
          "",
          "Google deprecates `pubsub.googleapis.com/topic/send_message_operation_count`, a Pub/Sub topic's publish operations, which OneUptime read as a rate a second. This monitor now reads `pubsub.googleapis.com/topic/message_sizes_count`, the messages the topic published, a minute at a time, so it fires when it did. Each threshold compared with it is 60 times what it was (5 is now 300, 5 is now 300).",
          "",
          "Review its criteria: its thresholds were set against the metric it read before.",
        ].join("\n"),
      );
    });

    test("a monitor saved since it was read is not written, nor told", async () => {
      monitors.rows.push(row(MONITOR_A, pubSubMonitor()));
      monitors.savedMeanwhile.add(MONITOR_A);

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      expect(readOf(monitors.rows[0]!.monitorSteps).metrics).toEqual([
        PUBSUB_PUBLISH_OPERATIONS_METRIC,
      ]);
      expect(feed).toEqual([]);
    });

    test("moved once, a second run moves and says nothing", async () => {
      monitors.rows.push(row(MONITOR_A, pubSubMonitor()));

      await migration.migrate();
      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      expect(feed).toHaveLength(1);
    });

    test("steps a driver hands back as text are read too, and written as JSON", async () => {
      monitors.rows.push(row(MONITOR_A, JSON.stringify(pubSubMonitor())));
      monitors.returning = "rows";

      await migration.migrate();

      expect(readOf(monitors.rows[0]!.monitorSteps).metrics).toEqual([
        PUBSUB_MESSAGES_PUBLISHED_METRIC,
      ]);
      expect(feed).toHaveLength(1);
    });
  });

  describe("a Cosmos DB monitor of ServerSideLatency", () => {
    test("reads the latency the account reported, asked of the account's own filter and the migration's clock", async () => {
      monitors.rows.push(row(MONITOR_A, cosmosMonitor()));
      evidence = { directPoints: 0, gatewayPoints: 4_000 };

      await migration.migrate();

      expect(evidenceAsked).toEqual([
        {
          projectId: new ObjectID(PROJECT_ID),
          query: {
            metric: RetiredCloudMetric.CosmosServerSideLatency,
            metricVariable: "latency",
            metricName: COSMOS_LATENCY,
            attributes: COSMOS_ATTRIBUTES,
          },
          now: NOW,
        },
      ]);
      expect(readOf(monitors.rows[0]!.monitorSteps)).toEqual({
        metrics: ["azure_serversidelatencygateway_average"],
        // Milliseconds both: its thresholds stay.
        thresholds: [50, 50],
      });
      expect(feed[0]!.displayColor).toBe(Gray500);
      expect(feed[0]!.feedInfoInMarkdown).toContain(
        "Microsoft removes `azure_serversidelatency_average`, a Cosmos DB account's server-side latency, from Azure Monitor. This monitor now reads `azure_serversidelatencygateway_average`, the latency of the account's requests in gateway mode, which it reports. Its thresholds are as they were: both are in milliseconds.",
      );
    });

    test("an account that reported both: the one with more points, the other named to add", async () => {
      monitors.rows.push(row(MONITOR_A, cosmosMonitor()));
      evidence = { directPoints: 9_000, gatewayPoints: 120 };

      await migration.migrate();

      expect(readOf(monitors.rows[0]!.monitorSteps).metrics).toEqual([
        "azure_serversidelatencydirect_average",
      ]);
      expect(feed[0]!.feedInfoInMarkdown).toContain(
        "The account reported `azure_serversidelatencygateway_average` too: its clients in the other mode are no longer read here, so add a criteria on it if they matter.",
      );
    });

    test("an account that reported neither is left as it is, still read for it, and told it moves once the account reports a latency", async () => {
      monitors.rows.push(row(MONITOR_A, cosmosMonitor()));
      const before: string = JSON.stringify(monitors.rows[0]!.monitorSteps);

      await migration.migrate();

      expect(updatesOf(monitors)).toEqual([]);
      expect(JSON.stringify(monitors.rows[0]!.monitorSteps)).toBe(before);
      expect(feed).toHaveLength(1);
      expect(feed[0]!.displayColor).toBe(Yellow500);
      expect(feed[0]!.feedInfoInMarkdown).toBe(
        [
          "⚠️ **This monitor reads a metric its cloud deprecates.**",
          "",
          "`azure_serversidelatency_average` is left as it is: the account reported neither latency in the last 30 days, so OneUptime cannot tell whether its clients connect in direct or gateway mode. OneUptime keeps reading it for this monitor, and moves the monitor to `azure_serversidelatencydirect_average` or `azure_serversidelatencygateway_average` once the account reports one of them.",
          "",
          "Review its criteria: its thresholds were set against the metric it read before.",
        ].join("\n"),
      );
    });

    test("evidence that cannot be read is no evidence: the monitor is told, and the next is moved", async () => {
      monitors.rows.push(
        row(MONITOR_A, cosmosMonitor()),
        row(MONITOR_B, pubSubMonitor()),
      );
      evidence = new Error("the metric store is down");

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      expect(
        feed.map((call: FeedCall) => {
          return [call.monitorId.toString(), call.displayColor];
        }),
      ).toEqual([
        [MONITOR_A, Yellow500],
        [MONITOR_B, Gray500],
      ]);
      expect(mockedLogger.error).toHaveBeenCalled();
    });

    test("one account's evidence serves every query of it in a monitor", async () => {
      monitors.rows.push(
        row(
          MONITOR_A,
          stored([
            metricStep({
              queries: [
                query({
                  variable: "a",
                  metricName: COSMOS_LATENCY,
                  attributes: COSMOS_ATTRIBUTES,
                }),
              ],
              criteria: criteriaOn("a", 50),
            }),
            metricStep({
              queries: [
                query({
                  variable: "a",
                  metricName: COSMOS_LATENCY,
                  attributes: COSMOS_ATTRIBUTES,
                }),
              ],
              criteria: criteriaOn("a", 200),
            }),
          ]),
        ),
      );
      evidence = { directPoints: 10, gatewayPoints: 0 };

      await migration.migrate();

      expect(evidenceAsked).toHaveLength(1);
      expect(readOf(monitors.rows[0]!.monitorSteps)).toEqual({
        metrics: [
          "azure_serversidelatencydirect_average",
          "azure_serversidelatencydirect_average",
        ],
        thresholds: [50, 50, 200, 200],
      });
    });
  });

  describe("a monitor of both, and one that fails", () => {
    test("what moves is written once; what stays is said beside it", async () => {
      monitors.rows.push(
        row(
          MONITOR_A,
          stored([
            metricStep({
              queries: [
                query({
                  variable: "a",
                  metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
                  attributes: TOPIC_ATTRIBUTES,
                }),
              ],
              criteria: criteriaOn("a", 1),
            }),
            metricStep({
              queries: [
                query({
                  variable: "b",
                  metricName: COSMOS_LATENCY,
                  attributes: COSMOS_ATTRIBUTES,
                }),
              ],
              criteria: criteriaOn("b", 50),
            }),
          ]),
        ),
      );

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      expect(readOf(monitors.rows[0]!.monitorSteps).metrics).toEqual([
        PUBSUB_MESSAGES_PUBLISHED_METRIC,
        COSMOS_LATENCY,
      ]);
      expect(feed).toHaveLength(1);
      expect(feed[0]!.displayColor).toBe(Yellow500);
      expect(feed[0]!.feedInfoInMarkdown).toContain(
        "This monitor now reads `pubsub.googleapis.com/topic/message_sizes_count`",
      );
      expect(feed[0]!.feedInfoInMarkdown).toContain(
        "`azure_serversidelatency_average` is left as it is",
      );
    });

    test("a row that cannot be written holds no other back, and is logged", async () => {
      monitors.rows.push(
        row(MONITOR_A, pubSubMonitor()),
        row(MONITOR_B, pubSubMonitor()),
        row(MONITOR_C, pubSubMonitor()),
      );
      monitors.failUpdatesFor.add(MONITOR_B);

      await migration.migrate();

      expect(
        monitors.rows.map((stored: StoredRow): Array<string> => {
          return readOf(stored.monitorSteps).metrics;
        }),
      ).toEqual([
        [PUBSUB_MESSAGES_PUBLISHED_METRIC],
        [PUBSUB_PUBLISH_OPERATIONS_METRIC],
        [PUBSUB_MESSAGES_PUBLISHED_METRIC],
      ]);
      expect(
        feed.map((call: FeedCall): string => {
          return call.monitorId.toString();
        }),
      ).toEqual([MONITOR_A, MONITOR_C]);
      expect(mockedLogger.error).toHaveBeenCalled();
      expect(mockedLogger.info).toHaveBeenCalledWith(
        "MoveMonitorsOffRetiredCloudMetrics: 2 monitor(s) moved off a metric their cloud deprecates; 0 left on one, still read for it; 1 could not be read or written.",
      );
    });

    test("a feed that cannot be told still leaves the monitor moved", async () => {
      monitors.rows.push(row(MONITOR_A, pubSubMonitor()));
      jest
        .spyOn(MonitorFeedService, "createMonitorFeedItem")
        .mockImplementation(async (): Promise<void> => {
          throw new Error("feed is down");
        });

      await migration.migrate();

      expect(readOf(monitors.rows[0]!.monitorSteps).metrics).toEqual([
        PUBSUB_MESSAGES_PUBLISHED_METRIC,
      ]);
      expect(mockedLogger.error).toHaveBeenCalled();
    });
  });

  test("rolls back nothing: a query moved back would read nothing", async () => {
    await expect(migration.rollback()).resolves.toBeUndefined();
  });

  test("its feed's words, for each reason a query stays", () => {
    const say: (reason: RetiredCloudMetricKeptReason) => string = (
      reason: RetiredCloudMetricKeptReason,
    ): string => {
      return MoveMonitorsOffRetiredCloudMetrics.getFeedMarkdown({
        moved: [],
        kept: [
          {
            metric: RetiredCloudMetric.PubSubPublishOperations,
            metricVariable: "a",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
            reason,
            replacements: [PUBSUB_MESSAGES_PUBLISHED_METRIC],
          },
        ],
      }).toString();
    };

    expect(say(RetiredCloudMetricKeptReason.ResponseCode)).toContain(
      "it reads publishes by their response code, which what replaces it does not have: it counts the messages published.",
    );
    expect(say(RetiredCloudMetricKeptReason.PointCount)).toContain(
      "it counts the metric's points, which a rate a second and a count a minute do not share.",
    );
    expect(say(RetiredCloudMetricKeptReason.ThresholdUnit)).toContain(
      "a threshold on it is in a unit of its own",
    );
    expect(say(RetiredCloudMetricKeptReason.Formula)).toContain(
      "a formula over it could not be read to divide it by 60.",
    );
    expect(say(RetiredCloudMetricKeptReason.ResponseCode)).toContain(
      "OneUptime keeps reading it for this monitor while its cloud publishes it: edit the monitor to read `pubsub.googleapis.com/topic/message_sizes_count` instead.",
    );
    // It is still read for the monitor (CloudRetiredMetricReads): never "no longer read".
    expect(say(RetiredCloudMetricKeptReason.PointCount)).not.toContain(
      "no longer reads",
    );
  });
});

describe("what is known of a Cosmos DB account's latencies", () => {
  const QUERY: RetiredCloudMetricQuery = {
    metric: RetiredCloudMetric.CosmosServerSideLatency,
    metricVariable: "a",
    metricName: COSMOS_LATENCY,
    attributes: COSMOS_ATTRIBUTES,
  };

  // What the migration asks the metric store: findReportedPoints' argument.
  type PointsQuestion = Parameters<
    typeof CloudResourceMetrics.findReportedPoints
  >[0];

  let pointsAsked: Array<PointsQuestion>;
  let points: Map<string, number>;
  let account: CloudResource | null;
  let accountAsked: Array<unknown>;

  beforeEach(() => {
    jest.restoreAllMocks();
    pointsAsked = [];
    points = new Map();
    account = null;
    accountAsked = [];
    jest
      .spyOn(CloudResourceMetrics, "findReportedPoints")
      .mockImplementation(
        async (data: PointsQuestion): Promise<Map<string, number>> => {
          pointsAsked.push(data);
          return points;
        },
      );
    jest.spyOn(CloudResourceService, "findOneBy").mockImplementation((async (
      data: unknown,
    ): Promise<CloudResource | null> => {
      accountAsked.push(data);
      return account;
    }) as never);
  });

  function accountRow(data: {
    readings?: JSONObject | undefined;
    kind?: string | undefined;
  }): CloudResource {
    const model: CloudResource = new CloudResource();
    model.id = ObjectID.generate();
    model.cloudReadings = data.readings || {};
    model.cloudProperties = data.kind ? { kind: data.kind } : {};
    return model;
  }

  test("the points each latency reported in the last 30 days, for the query's own filter, by its aggregation", async () => {
    points = new Map([["azure_serversidelatencydirect_average", 4_200]]);

    expect(
      await findCosmosLatencyEvidence({
        projectId: new ObjectID(PROJECT_ID),
        query: QUERY,
        now: NOW,
      }),
    ).toEqual({ directPoints: 4_200, gatewayPoints: 0, isGatewayOnly: false });
    expect(pointsAsked).toEqual([
      {
        projectId: new ObjectID(PROJECT_ID),
        attributes: COSMOS_ATTRIBUTES,
        names: [
          "azure_serversidelatencydirect_average",
          "azure_serversidelatencygateway_average",
        ],
        since: new Date(NOW.getTime() - COSMOS_EVIDENCE_LOOK_BACK_MS),
        until: NOW,
      },
    ]);
    expect(COSMOS_EVIDENCE_LOOK_BACK_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test("the account's own row, by the identifier its metrics name it by: its last read's latency, and its kind", async () => {
    account = accountRow({
      readings: {
        serversidelatencygateway: {
          value: 12,
          time: "2026-11-19T11:50:00.000Z",
        },
      },
      kind: "MongoDB",
    });

    expect(
      await findCosmosLatencyEvidence({
        projectId: new ObjectID(PROJECT_ID),
        query: QUERY,
        now: NOW,
      }),
    ).toEqual({ directPoints: 0, gatewayPoints: 1, isGatewayOnly: true });

    const resource: CloudMonitoredResource = resolveCloudMonitoredResource({
      metricName: COSMOS_LATENCY,
      attributes: COSMOS_ATTRIBUTES,
    })!;

    expect(accountAsked).toEqual([
      {
        query: {
          projectId: new ObjectID(PROJECT_ID),
          resourceIdentifier: buildCloudMonitoredResourceIdentifier(resource),
        },
        select: { _id: true, cloudReadings: true, cloudProperties: true },
        props: { isRoot: true },
      },
    ]);
  });

  test("an account of the API for NoSQL is no gateway-only one", async () => {
    account = accountRow({ kind: "GlobalDocumentDB" });

    expect(
      (
        await findCosmosLatencyEvidence({
          projectId: new ObjectID(PROJECT_ID),
          query: QUERY,
          now: NOW,
        })
      )?.isGatewayOnly,
    ).toBe(false);
  });

  test("a filter that is not all text says nothing, and asks nothing", async () => {
    expect(
      await findCosmosLatencyEvidence({
        projectId: new ObjectID(PROJECT_ID),
        query: {
          ...QUERY,
          attributes: {
            "azuremonitor.resource_id": { _type: "Search", value: "orders" },
          },
        },
        now: NOW,
      }),
    ).toBe(null);
    expect(pointsAsked).toEqual([]);
    expect(accountAsked).toEqual([]);
  });

  test("a query of no filter reads every account's: no row of its own", async () => {
    points = new Map([["azure_serversidelatencygateway_average", 3]]);

    expect(
      await findCosmosLatencyEvidence({
        projectId: new ObjectID(PROJECT_ID),
        query: { ...QUERY, attributes: undefined },
        now: NOW,
      }),
    ).toEqual({ directPoints: 0, gatewayPoints: 3, isGatewayOnly: false });
    expect(accountAsked).toEqual([]);
  });

  test("plain attributes: text values only, none for no filter", () => {
    expect(readPlainAttributes({ a: "1", b: "2" })).toEqual({ a: "1", b: "2" });
    expect(readPlainAttributes(undefined)).toEqual({});
    expect(readPlainAttributes(null)).toEqual({});
    expect(readPlainAttributes({ a: 1 })).toBe(null);
    expect(readPlainAttributes(["a"])).toBe(null);
    expect(readPlainAttributes("a")).toBe(null);
  });
});
