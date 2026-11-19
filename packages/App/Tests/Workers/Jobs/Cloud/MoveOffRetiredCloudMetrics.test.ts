import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MonitorFeedEventType } from "Common/Models/DatabaseModels/MonitorFeed";
import DashboardService from "Common/Server/Services/DashboardService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorFeedService from "Common/Server/Services/MonitorFeedService";
import MonitorService from "Common/Server/Services/MonitorService";
import ServiceLevelObjectiveFeedService from "Common/Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import CloudRetiredMetricReads from "Common/Server/Utils/CloudConnection/CloudRetiredMetricReads";
import { Gray500, Yellow500 } from "Common/Types/BrandColors";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
} from "Common/Types/Cloud/CloudAddedMetrics";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_HOUR } from "Common/Utils/CronTime";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import {
  CosmosLatencyEvidence,
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  RetiredCloudMetricQuery,
} from "Common/Utils/Metrics/RetiredCloudMetricMoves";
import MoveMonitorsOffRetiredCloudMetrics from "../../../../FeatureSet/Workers/DataMigrations/MoveMonitorsOffRetiredCloudMetrics";
import {
  MOVE_OFF_RETIRED_CLOUD_METRICS_JOB_NAME,
  moveOffRetiredCloudMetrics,
} from "../../../../FeatureSet/Workers/Jobs/Cloud/MoveOffRetiredCloudMetrics";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import fs from "fs";
import path from "path";

/*
 * #9739's gap, end to end. #9954 moved each Metrics monitor off Cosmos
 * DB's ServerSideLatency to the latency its account reported, then the
 * connections stopped reading the old metric. An account that reported
 * neither latency when the migration ran - idle, or new - kept its monitor
 * on the old metric, which then got no new points: the monitor went quiet.
 *
 * Pinned here, for such an account:
 *
 *   1. the migration leaves its monitor as it is, and tells it once;
 *   2. its connection keeps reading ServerSideLatency of that account
 *      alone (CloudRetiredMetricReads), so the monitor has points to judge;
 *   3. every hour the job tries the move again, telling nothing while it
 *      still cannot move it;
 *   4. once the account reports a latency, the job moves the monitor to it,
 *      only while the row still holds what was read, and its feed says so;
 *   5. then the connection stops reading the old metric for it.
 *
 * The job registers itself through RunCron, mocked to capture it.
 */

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

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

// What the job registered when it was loaded: its name, its schedule and what it runs.
const REGISTERED: Array<unknown> =
  (RunCron as unknown as jest.Mock).mock.calls[0] || [];
const runJob: () => Promise<void> = REGISTERED[2] as () => Promise<void>;

const PROJECT_ID: string = "6b1f0a3c-2d4e-4f5a-9b6c-7d8e9f0a1b2c";
const MONITOR_ID: string = "0a7d3c1e-1b2c-4d3e-8f4a-5b6c7d8e9f01";
const PUBSUB_MONITOR_ID: string = "0b8e4d2f-2c3d-4e4f-9a5b-6c7d8e9f0a12";
const COSMOS_ID: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.DocumentDB/databaseAccounts/new-orders-db";
const TOPIC: JSONObject = {
  "resource.gcp.resource_type": "pubsub_topic",
  "resource.project_id": "shop-prod",
  "resource.topic_id": "orders",
};
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

interface StoredRow {
  _id: string;
  projectId: string;
  monitorType: string;
  monitorSteps: unknown;
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

// ILIKE as Postgres reads its pattern: "%" anything, "_" one character, "\_" an underscore.
function matchesLike(text: string, like: string): boolean {
  let pattern: string = "";

  for (let index: number = 0; index < like.length; index++) {
    const char: string = like[index]!;

    if (char === "\\" && index + 1 < like.length) {
      pattern += escapeRegExp(like[index + 1]!);
      index++;
    } else if (char === "%") {
      pattern += ".*";
    } else if (char === "_") {
      pattern += ".";
    } else {
      pattern += escapeRegExp(char);
    }
  }

  return new RegExp(`^${pattern}$`, "is").test(text);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function steps(metricName: string, attributes: JSONObject): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      defaultMonitorStatusId: { _type: "ObjectID", value: "online" },
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: "step-1",
            metricMonitor: {
              metricViewConfig: {
                queryConfigs: [
                  {
                    metricAliasData: { metricVariable: "latency" },
                    metricQueryData: {
                      filterData: {
                        metricName,
                        attributes,
                        aggegationType: "Avg",
                      },
                      groupByAttributeKeys:
                        metricName === PUBSUB_PUBLISH_OPERATIONS_METRIC
                          ? ["response_code"]
                          : [],
                    },
                  },
                ],
                formulaConfigs: [],
              },
              rollingTime: "Past 15 Minutes",
            },
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      id: "unhealthy",
                      filterCondition: "Any",
                      filters: [
                        {
                          checkOn: "Metric Value",
                          filterType: "Greater Than",
                          value: 50,
                          metricMonitorOptions: {
                            metricAlias: "latency",
                            metricAggregationType: "Any Value",
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  };
}

// What is at a path of keys in parsed JSON, or undefined.
function dig(value: unknown, keys: Array<string | number>): unknown {
  let current: unknown = value;

  for (const key of keys) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string | number, unknown>)[key];
  }

  return current;
}

// The metric a stored monitor's first query reads.
function metricNameOf(row: StoredRow): string {
  return String(
    dig(JSON.parse(textOf(row.monitorSteps)), [
      "value",
      "monitorStepsInstanceArray",
      0,
      "value",
      "metricMonitor",
      "metricViewConfig",
      "queryConfigs",
      0,
      "metricQueryData",
      "filterData",
      "metricName",
    ]),
  );
}

let monitors: Array<StoredRow>;
let statements: Array<Statement>;
let savedMeanwhile: Set<string>;
let monitorFeed: Array<{
  monitorId: ObjectID;
  displayColor: unknown;
  feedInfoInMarkdown: string;
  monitorFeedEventType: MonitorFeedEventType;
}>;
let sloFeed: Array<unknown>;
let evidence: CosmosLatencyEvidence | null;
let evidenceAsked: Array<RetiredCloudMetricQuery>;

// The Monitor table, as the migration, the job and the reads' finder ask it.
async function monitorTable(
  sql: string,
  parameters: Array<unknown>,
): Promise<unknown> {
  statements.push({ sql, parameters });

  if (sql.startsWith("UPDATE")) {
    const id: string = parameters[1] as string;
    const row: StoredRow | undefined = monitors.find((candidate: StoredRow) => {
      return candidate._id === id;
    });
    const holds: boolean =
      Boolean(row) &&
      !savedMeanwhile.has(id) &&
      JSON.stringify(JSON.parse(textOf(row!.monitorSteps))) ===
        JSON.stringify(JSON.parse(parameters[2] as string));

    if (holds) {
      row!.monitorSteps = JSON.parse(parameters[0] as string);
    }

    const written: Array<{ _id: string }> = holds ? [{ _id: id }] : [];

    return [written, written.length];
  }

  // The reads' finder: one project's rows, by its id.
  if (sql.startsWith(`SELECT "monitorSteps"`)) {
    return monitors
      .filter((row: StoredRow) => {
        return (
          row.projectId === parameters[0] &&
          row.monitorType === parameters[1] &&
          [parameters[2], parameters[3]].some((like: unknown): boolean => {
            return matchesLike(textOf(row.monitorSteps), String(like));
          })
        );
      })
      .map((row: StoredRow) => {
        return { monitorSteps: row.monitorSteps };
      });
  }

  // The move's pages, by id.
  const after: string | undefined = parameters[4] as string | undefined;

  return monitors
    .filter((row: StoredRow) => {
      return (
        row.monitorType === parameters[1] &&
        [parameters[2], parameters[3]].some((like: unknown): boolean => {
          return matchesLike(textOf(row.monitorSteps), String(like));
        }) &&
        (!after || row._id > after)
      );
    })
    .slice(0, parameters[0] as number);
}

// A table with no row that names a deprecated metric.
async function emptyTable(
  sql: string,
  parameters: Array<unknown>,
): Promise<unknown> {
  statements.push({ sql, parameters });
  return [];
}

async function readsOfTheProject(
  provider: CloudProvider,
): Promise<Array<CloudAddedMetric>> {
  // Ten minutes on a project at a time; each step here is a new read.
  CloudRetiredMetricReads.forget();

  return await CloudRetiredMetricReads.find({
    projectId: new ObjectID(PROJECT_ID),
    provider,
    now: NOW,
  });
}

beforeEach(() => {
  monitors = [];
  statements = [];
  savedMeanwhile = new Set<string>();
  monitorFeed = [];
  sloFeed = [];
  evidence = null;
  evidenceAsked = [];
  CloudRetiredMetricReads.forget();

  jest
    .spyOn(
      MonitorService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "Monitor" },
      manager: { query: monitorTable },
    } as never);

  for (const [service, tableName] of [
    [DashboardService, "Dashboard"],
    [ServiceLevelObjectiveService, "ServiceLevelObjective"],
  ] as const) {
    jest
      .spyOn(service as unknown as DatabaseService<BaseModel>, "getRepository")
      .mockReturnValue({
        metadata: { tableName },
        manager: { query: emptyTable },
      } as never);
  }

  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockImplementation((async (data: never) => {
      monitorFeed.push(data);
    }) as never);
  jest
    .spyOn(
      ServiceLevelObjectiveFeedService,
      "createServiceLevelObjectiveFeedItem",
    )
    .mockImplementation((async (data: never) => {
      sloFeed.push(data);
    }) as never);

  MoveMonitorsOffRetiredCloudMetrics.now = () => {
    return NOW;
  };
  MoveMonitorsOffRetiredCloudMetrics.findEvidence = async (data: {
    query: RetiredCloudMetricQuery;
  }): Promise<CosmosLatencyEvidence | null> => {
    evidenceAsked.push(data.query);
    return evidence;
  };
});

afterEach(() => {
  CloudRetiredMetricReads.forget();
  jest.restoreAllMocks();
});

describe("Cloud:MoveOffRetiredCloudMetrics", () => {
  test("runs every hour, not on startup, and the worker loads it", () => {
    expect(MOVE_OFF_RETIRED_CLOUD_METRICS_JOB_NAME).toBe(
      "Cloud:MoveOffRetiredCloudMetrics",
    );
    expect(REGISTERED[0]).toBe(MOVE_OFF_RETIRED_CLOUD_METRICS_JOB_NAME);
    expect(REGISTERED[1]).toEqual({
      schedule: EVERY_HOUR,
      runOnStartup: false,
    });
    expect(runJob).toBe(moveOffRetiredCloudMetrics);

    const index: string = fs.readFileSync(
      path.join(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      "utf-8",
    );

    expect(index).toContain(
      'import "./Jobs/Cloud/MoveOffRetiredCloudMetrics";',
    );
  });

  test("a Cosmos DB account with no latency when the migration ran ends up monitored by the latency it reports", async () => {
    monitors.push({
      _id: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorType: MonitorType.Metrics,
      monitorSteps: steps("azure_serversidelatency_average", {
        "azuremonitor.resource_id": COSMOS_ID,
      }),
    });

    // 1. The migration runs while the account has reported neither latency.
    evidence = { directPoints: 0, gatewayPoints: 0, isGatewayOnly: false };
    await new MoveMonitorsOffRetiredCloudMetrics().migrate();

    expect(metricNameOf(monitors[0]!)).toBe("azure_serversidelatency_average");
    expect(monitorFeed).toHaveLength(1);
    expect(monitorFeed[0]!.displayColor).toBe(Yellow500);
    expect(monitorFeed[0]!.feedInfoInMarkdown).toContain(
      "OneUptime keeps reading it for this monitor, and moves the monitor to `azure_serversidelatencydirect_average` or `azure_serversidelatencygateway_average` once the account reports one of them.",
    );

    // 2. Its connection keeps reading ServerSideLatency, of that account alone.
    const kept: Array<CloudAddedMetric> = await readsOfTheProject(
      CloudProvider.Azure,
    );

    expect(
      kept.map((read: CloudAddedMetric) => {
        return [read.scope, read.name, read.aggregation, read.azureResourceId];
      }),
    ).toEqual([
      [
        CloudAddedMetricScope.Resource,
        "ServerSideLatency",
        "Average",
        COSMOS_ID,
      ],
    ]);

    // 3. An hour on, still no latency: nothing moves, and nothing more is said.
    await runJob();

    expect(metricNameOf(monitors[0]!)).toBe("azure_serversidelatency_average");
    expect(monitorFeed).toHaveLength(1);
    expect(evidenceAsked).toHaveLength(2);

    // 4. The account takes traffic through the gateway: the next hour moves the monitor.
    evidence = { directPoints: 0, gatewayPoints: 240, isGatewayOnly: false };
    await runJob();

    expect(metricNameOf(monitors[0]!)).toBe(
      "azure_serversidelatencygateway_average",
    );
    expect(monitorFeed).toHaveLength(2);
    expect(monitorFeed[1]!.monitorId.toString()).toBe(MONITOR_ID);
    expect(monitorFeed[1]!.displayColor).toBe(Gray500);
    expect(monitorFeed[1]!.monitorFeedEventType).toBe(
      MonitorFeedEventType.MonitorUpdated,
    );
    expect(monitorFeed[1]!.feedInfoInMarkdown).toContain(
      "This monitor now reads `azure_serversidelatencygateway_average`, the latency of the account's requests in gateway mode, which it reports.",
    );

    // 5. Its connection no longer reads the old metric for it.
    expect(await readsOfTheProject(CloudProvider.Azure)).toEqual([]);

    // Moved once: the next hour finds nothing to move, and says nothing.
    await runJob();
    expect(monitorFeed).toHaveLength(2);
  });

  test("a monitor saved since the job read it is never overwritten, and moves at the next hour", async () => {
    monitors.push({
      _id: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorType: MonitorType.Metrics,
      monitorSteps: steps("azure_serversidelatency_average", {
        "azuremonitor.resource_id": COSMOS_ID,
      }),
    });
    evidence = { directPoints: 12, gatewayPoints: 0, isGatewayOnly: false };
    savedMeanwhile.add(MONITOR_ID);

    await runJob();

    expect(metricNameOf(monitors[0]!)).toBe("azure_serversidelatency_average");
    expect(monitorFeed).toEqual([]);

    savedMeanwhile.clear();
    await runJob();

    expect(metricNameOf(monitors[0]!)).toBe(
      "azure_serversidelatencydirect_average",
    );
    expect(monitorFeed).toHaveLength(1);
  });

  test("a monitor nothing can move stays read for, and is told once, by the migration, never every hour", async () => {
    monitors.push({
      _id: PUBSUB_MONITOR_ID,
      projectId: PROJECT_ID,
      monitorType: MonitorType.Metrics,
      // Split by response code: what replaces the publish operations has none.
      monitorSteps: steps(PUBSUB_PUBLISH_OPERATIONS_METRIC, TOPIC),
    });

    await new MoveMonitorsOffRetiredCloudMetrics().migrate();
    await runJob();
    await runJob();

    expect(metricNameOf(monitors[0]!)).toBe(PUBSUB_PUBLISH_OPERATIONS_METRIC);
    expect(monitorFeed).toHaveLength(1);
    expect(monitorFeed[0]!.feedInfoInMarkdown).toContain(
      "OneUptime keeps reading it for this monitor while its cloud publishes it",
    );
    expect(
      (await readsOfTheProject(CloudProvider.GCP)).map(
        (read: CloudAddedMetric) => {
          return [read.scope, read.name, read.resourceLabels];
        },
      ),
    ).toEqual([
      [
        CloudAddedMetricScope.Resource,
        PUBSUB_PUBLISH_OPERATIONS_METRIC,
        { project_id: "shop-prod", topic_id: "orders" },
      ],
    ]);
  });

  test("the dashboards and SLOs are moved too, and a failure of the monitors' move holds them back nowhere", async () => {
    jest
      .spyOn(MoveMonitorsOffRetiredCloudMetrics, "moveAll")
      .mockRejectedValue(new Error("Postgres is away") as never);

    await runJob();

    expect(
      statements.some((statement: Statement): boolean => {
        return statement.sql.includes('FROM "Dashboard"');
      }),
    ).toBe(true);
    expect(
      statements.some((statement: Statement): boolean => {
        return statement.sql.includes('FROM "ServiceLevelObjective"');
      }),
    ).toBe(true);
    expect(sloFeed).toEqual([]);
  });
});
