import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ServiceLevelObjectiveFeedEventType } from "Common/Models/DatabaseModels/ServiceLevelObjectiveFeed";
import DashboardService from "Common/Server/Services/DashboardService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import ServiceLevelObjectiveFeedService from "Common/Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import {
  NAMES_RETIRED_COSMOS_METRIC,
  NAMES_RETIRED_PUBSUB_METRIC,
} from "Common/Server/Utils/CloudConnection/CloudRetiredMetricReads";
import logger from "Common/Server/Utils/Logger";
import { Gray500, Yellow500 } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  CosmosLatencyEvidence,
  PUBSUB_MESSAGES_PUBLISHED_METRIC,
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  RetiredCloudMetricQuery,
} from "Common/Utils/Metrics/RetiredCloudMetricMoves";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import MoveChartsAndSlosOffRetiredCloudMetrics from "../../../FeatureSet/Workers/DataMigrations/MoveChartsAndSlosOffRetiredCloudMetrics";
import MoveMonitorsOffRetiredCloudMetrics, {
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/MoveMonitorsOffRetiredCloudMetrics";
import fs from "fs";
import path from "path";

/*
 * MoveChartsAndSlosOffRetiredCloudMetrics (#9980): a dashboard's widgets
 * and an SLO's metric that read Cosmos DB's ServerSideLatency or Pub/Sub's
 * send_message_operation_count move as monitors do (how each moves is
 * pinned in Common, RetiredCloudMetricChartMoves.test). Pinned here: which
 * rows are read and paged by id, that a row is written only while it holds
 * what was read, what an SLO's feed says, that one failing row holds no
 * other back, and where it runs among the data migrations.
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

const MIGRATION_NAME: string = "MoveChartsAndSlosOffRetiredCloudMetrics";
const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);
const PROJECT_ID: string = "6b1f0a3c-2d4e-4f5a-9b6c-7d8e9f0a1b2c";
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const COSMOS_ID: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.DocumentDB/databaseAccounts/orders-db";

interface Row {
  _id: string;
  projectId: string;
  value: unknown;
}

interface Table {
  column: string;
  rows: Array<Row>;
  statements: Array<{ sql: string; parameters: Array<unknown> }>;
  savedMeanwhile: Set<string>;
  failFor: Set<string>;
}

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

function stub(service: unknown, tableName: string, column: string): Table {
  const table: Table = {
    column,
    rows: [],
    statements: [],
    savedMeanwhile: new Set<string>(),
    failFor: new Set<string>(),
  };

  jest
    .spyOn(service as DatabaseService<BaseModel>, "getRepository")
    .mockReturnValue({
      metadata: { tableName },
      manager: {
        query: async (sql: string, parameters: Array<unknown>) => {
          table.statements.push({ sql, parameters });

          if (sql.startsWith("UPDATE")) {
            const id: string = parameters[1] as string;

            if (table.failFor.has(id)) {
              throw new Error("could not write");
            }

            const row: Row | undefined = table.rows.find((candidate: Row) => {
              return candidate._id === id;
            });
            const holds: boolean =
              Boolean(row) &&
              !table.savedMeanwhile.has(id) &&
              JSON.stringify(JSON.parse(textOf(row!.value))) ===
                JSON.stringify(JSON.parse(parameters[2] as string));

            if (holds) {
              row!.value = JSON.parse(parameters[0] as string);
            }

            const written: Array<{ _id: string }> = holds ? [{ _id: id }] : [];

            return [written, written.length];
          }

          const after: string | undefined = parameters[3] as string | undefined;

          return table.rows
            .filter((row: Row) => {
              return (
                row.value !== null &&
                [parameters[1], parameters[2]].some(
                  (like: unknown): boolean => {
                    return matchesLike(textOf(row.value), String(like));
                  },
                ) &&
                (!after || row._id > after)
              );
            })
            .sort((a: Row, b: Row) => {
              return a._id < b._id ? -1 : 1;
            })
            .slice(0, parameters[0] as number)
            .map((row: Row) => {
              return {
                _id: row._id,
                projectId: row.projectId,
                [column]: row.value,
              };
            });
        },
      },
    } as never);

  return table;
}

function chartBoard(metricName: string, extra: JSONObject = {}): JSONObject {
  return {
    _type: "DashboardViewConfig",
    heightInDashboardUnits: 6,
    components: [
      {
        _type: "DashboardComponent",
        componentType: "Chart",
        arguments: {
          metricQueryConfigs: [
            {
              metricAliasData: { metricVariable: "a", legendUnit: "/s" },
              metricQueryData: {
                filterData: {
                  metricName,
                  attributes: { "azuremonitor.resource_id": COSMOS_ID },
                  aggegationType: "Avg",
                },
                groupByAttributeKeys: [],
              },
              ...extra,
            },
          ],
        },
      },
    ],
  };
}

function idOf(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

let dashboards: Table;
let slos: Table;
let sloFeed: Array<{
  serviceLevelObjectiveId: ObjectID;
  serviceLevelObjectiveFeedEventType: ServiceLevelObjectiveFeedEventType;
  displayColor: unknown;
  feedInfoInMarkdown: string;
}>;
let evidence: CosmosLatencyEvidence | null;

beforeEach(() => {
  dashboards = stub(DashboardService, "Dashboard", "dashboardViewConfig");
  slos = stub(
    ServiceLevelObjectiveService,
    "ServiceLevelObjective",
    "metricQueryConfig",
  );
  sloFeed = [];
  evidence = null;

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
  MoveMonitorsOffRetiredCloudMetrics.findEvidence =
    async (): Promise<CosmosLatencyEvidence | null> => {
      return evidence;
    };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MoveChartsAndSlosOffRetiredCloudMetrics", () => {
  test("reads only rows whose JSON names one of the two, not deleted, a page at a time by id", async () => {
    for (let index: number = 1; index <= PAGE_SIZE + 2; index++) {
      dashboards.rows.push({
        _id: idOf(index),
        projectId: PROJECT_ID,
        value: chartBoard(
          index % 2
            ? PUBSUB_PUBLISH_OPERATIONS_METRIC
            : "azure_percentage_cpu_average",
        ),
      });
    }

    await new MoveChartsAndSlosOffRetiredCloudMetrics().migrate();

    const selects: Array<{ sql: string; parameters: Array<unknown> }> =
      dashboards.statements.filter((statement: { sql: string }) => {
        return statement.sql.startsWith("SELECT");
      });

    expect(selects[0]!.sql).toContain('FROM "Dashboard"');
    expect(selects[0]!.sql).toContain('"deletedAt" IS NULL');
    expect(selects[0]!.parameters).toEqual([
      PAGE_SIZE,
      NAMES_RETIRED_PUBSUB_METRIC,
      NAMES_RETIRED_COSMOS_METRIC,
    ]);
    // A full page asks the next after its last id; fewer than a page ends it.
    expect(selects).toHaveLength(1);
    expect(
      dashboards.rows.filter((row: Row): boolean => {
        return textOf(row.value).includes(PUBSUB_MESSAGES_PUBLISHED_METRIC);
      }),
    ).toHaveLength(Math.ceil((PAGE_SIZE + 2) / 2));
  });

  test("pages on past a full page, after its last id", async () => {
    for (let index: number = 1; index <= PAGE_SIZE + 1; index++) {
      dashboards.rows.push({
        _id: idOf(index),
        projectId: PROJECT_ID,
        value: chartBoard(PUBSUB_PUBLISH_OPERATIONS_METRIC),
      });
    }

    // Moved rows no longer match: the second page starts after the first's last id.
    dashboards.savedMeanwhile = new Set<string>(
      dashboards.rows.map((row: Row) => {
        return row._id;
      }),
    );

    await MoveChartsAndSlosOffRetiredCloudMetrics.moveDashboards();

    const selects: Array<{ parameters: Array<unknown> }> =
      dashboards.statements.filter((statement: { sql: string }) => {
        return statement.sql.startsWith("SELECT");
      });

    expect(selects).toHaveLength(2);
    expect(selects[1]!.parameters[3]).toBe(idOf(PAGE_SIZE));
  });

  test("a chart moves, its legend's per-second unit dropped; a dashboard saved meanwhile is not written", async () => {
    dashboards.rows.push(
      {
        _id: idOf(1),
        projectId: PROJECT_ID,
        value: chartBoard(PUBSUB_PUBLISH_OPERATIONS_METRIC, {
          warningThreshold: 3,
        }),
      },
      {
        _id: idOf(2),
        projectId: PROJECT_ID,
        value: chartBoard(PUBSUB_PUBLISH_OPERATIONS_METRIC),
      },
    );
    dashboards.savedMeanwhile.add(idOf(2));
    const before: string = JSON.stringify(dashboards.rows[1]!.value);

    const counts: { moved: number; kept: number; failed: number } =
      await MoveChartsAndSlosOffRetiredCloudMetrics.moveDashboards();

    expect(counts).toEqual({ moved: 1, kept: 0, failed: 0 });

    const moved: string = JSON.stringify(dashboards.rows[0]!.value);

    expect(moved).toContain(PUBSUB_MESSAGES_PUBLISHED_METRIC);
    expect(moved).toContain('"warningThreshold":180');
    expect(moved).not.toContain('"legendUnit"');
    expect(JSON.stringify(dashboards.rows[1]!.value)).toBe(before);
  });

  test("a Cosmos DB chart moves to the latency its account reports, once it reports one", async () => {
    dashboards.rows.push({
      _id: idOf(1),
      projectId: PROJECT_ID,
      value: JSON.stringify(chartBoard("azure_serversidelatency_average")),
    });

    expect(
      await MoveChartsAndSlosOffRetiredCloudMetrics.moveDashboards(),
    ).toEqual({ moved: 0, kept: 1, failed: 0 });
    expect(textOf(dashboards.rows[0]!.value)).toContain(
      '"azure_serversidelatency_average"',
    );

    evidence = { directPoints: 9, gatewayPoints: 0 };

    expect(
      await MoveChartsAndSlosOffRetiredCloudMetrics.moveDashboards(),
    ).toEqual({ moved: 1, kept: 0, failed: 0 });
    expect(textOf(dashboards.rows[0]!.value)).toContain(
      '"azure_serversidelatencydirect_average"',
    );
  });

  test("an SLO moves and its feed says so; one it cannot move is told once, by the migration", async () => {
    slos.rows.push(
      {
        _id: idOf(1),
        projectId: PROJECT_ID,
        value: {
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          kind: "Histogram",
          goodAtOrUnder: 2,
        },
      },
      {
        _id: idOf(2),
        projectId: PROJECT_ID,
        value: {
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          kind: "Counter",
          goodFilter: "@response_code:success",
        },
      },
    );

    await new MoveChartsAndSlosOffRetiredCloudMetrics().migrate();

    expect(slos.rows[0]!.value).toEqual({
      metricName: PUBSUB_MESSAGES_PUBLISHED_METRIC,
      kind: "Histogram",
      goodAtOrUnder: 120,
    });
    expect(sloFeed).toHaveLength(2);
    expect(sloFeed[0]!.serviceLevelObjectiveId.toString()).toBe(idOf(1));
    expect(sloFeed[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveUpdated,
    );
    expect(sloFeed[0]!.displayColor).toBe(Gray500);
    expect(sloFeed[0]!.feedInfoInMarkdown).toBe(
      [
        "📊 **This SLO now counts what replaces a metric its cloud deprecates.**",
        "",
        "`pubsub.googleapis.com/topic/send_message_operation_count` is now `pubsub.googleapis.com/topic/message_sizes_count`. Its good value is 60 times what it was (2 is now 120): the publish operations were a rate a second, the messages published a count a minute. Review its settings.",
      ].join("\n"),
    );
    expect(sloFeed[1]!.displayColor).toBe(Yellow500);
    expect(sloFeed[1]!.feedInfoInMarkdown).toBe(
      [
        "⚠️ **This SLO counts a metric its cloud deprecates.**",
        "",
        "`pubsub.googleapis.com/topic/send_message_operation_count` is left as it is: its filter names a response code, which what replaces it does not have. Choose `pubsub.googleapis.com/topic/message_sizes_count` instead in its settings.",
      ].join("\n"),
    );

    // The hourly job tells a move only.
    await MoveChartsAndSlosOffRetiredCloudMetrics.moveAll({ tellKept: false });
    expect(sloFeed).toHaveLength(2);
  });

  test("a row that cannot be written holds no other back, and is counted", async () => {
    dashboards.rows.push(
      {
        _id: idOf(1),
        projectId: PROJECT_ID,
        value: chartBoard(PUBSUB_PUBLISH_OPERATIONS_METRIC),
      },
      {
        _id: idOf(2),
        projectId: PROJECT_ID,
        value: chartBoard(PUBSUB_PUBLISH_OPERATIONS_METRIC),
      },
    );
    dashboards.failFor.add(idOf(1));

    expect(
      await MoveChartsAndSlosOffRetiredCloudMetrics.moveDashboards(),
    ).toEqual({ moved: 1, kept: 0, failed: 1 });
    expect(
      (logger as unknown as { error: jest.Mock }).error,
    ).toHaveBeenCalled();
  });

  test("evidence that cannot be read is none: the chart stays", async () => {
    dashboards.rows.push({
      _id: idOf(1),
      projectId: PROJECT_ID,
      value: chartBoard("azure_serversidelatency_average"),
    });
    MoveMonitorsOffRetiredCloudMetrics.findEvidence = async (data: {
      query: RetiredCloudMetricQuery;
    }): Promise<CosmosLatencyEvidence | null> => {
      throw new Error(`no ClickHouse for ${data.query.metricName}`);
    };

    expect(
      await MoveChartsAndSlosOffRetiredCloudMetrics.moveDashboards(),
    ).toEqual({ moved: 0, kept: 1, failed: 0 });
  });

  test("rolls back nothing", async () => {
    await expect(
      new MoveChartsAndSlosOffRetiredCloudMetrics().rollback(),
    ).resolves.toBeUndefined();
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf-8",
    );

    function registered(): Array<string> {
      return Array.from(indexSource.matchAll(/new (\w+)\(\)/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );
    }

    test("carries its own name, and runs once, after the monitors' move and before the last two slots", () => {
      const names: Array<string> = registered();

      expect(new MoveChartsAndSlosOffRetiredCloudMetrics().name).toBe(
        MIGRATION_NAME,
      );
      expect(
        names.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(names.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        names.indexOf("MoveMonitorsOffRetiredCloudMetrics"),
      );
      expect(names.indexOf(MIGRATION_NAME)).toBeLessThan(
        names.indexOf("BackfillIncidentCallTranscriptSignInAccount"),
      );
      expect(names[names.length - 1]).toBe("AddAuditLogMcpClientColumns");
    });
  });
});
