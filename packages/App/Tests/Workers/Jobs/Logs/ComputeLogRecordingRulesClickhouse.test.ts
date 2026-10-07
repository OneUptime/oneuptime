import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import LogRecordingRule from "Common/Models/DatabaseModels/LogRecordingRule";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import LogRecordingRuleQuery, {
  LogRecordingRulePoint,
} from "Common/Server/Utils/Telemetry/LogRecordingRuleQuery";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_ID_ATTRIBUTE,
  LogRecordingRuleDefinitionUtil,
} from "Common/Types/Log/LogRecordingRuleDefinition";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import { LogRecordingRuleWindow } from "Common/Utils/Telemetry/LogRecordingRuleWindow";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Log recording rules against a real ClickHouse server.
 *
 * The unit tests pin the statement a rule runs - every value bound, the
 * aggregation over toFloat64OrNull, LIMIT ... BY bucket - as text. What
 * they cannot show is what ClickHouse makes of it: that the statement
 * parses, that a log whose numeric attribute is "n/a" really drops out of
 * an average instead of pulling it toward 0, that attribute filters match
 * their key whatever its case and their value exactly - quotes and
 * backslashes included - and that the rows the worker writes are rows the
 * Metric table takes. So this suite loads Sophos SD-WAN SLA summaries into
 * a table built from the real Log model, runs the statement through
 * LogService, and runs one tick of the real worker into a table built from
 * the real Metric model.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/Logs/ComputeLogRecordingRulesClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

// Keep anything the services load from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Worker: "Worker", Telemetry: "Telemetry" },
  };
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

// The rules live in Postgres; the ClickHouse side is what this suite is about.
jest.mock("Common/Server/Services/LogRecordingRuleService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      indexMetricNameServiceNameMap: jest.fn(),
    },
  };
});

import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import LogRecordingRuleService from "Common/Server/Services/LogRecordingRuleService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import "../../../../FeatureSet/Workers/Jobs/Logs/ComputeLogRecordingRules";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `log_recording_rule_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;

// Two whole minutes of logs, ten minutes ago, so nothing is near "now".
const FIRST_MINUTE: Date = new Date(
  Math.floor(Date.now() / MINUTE) * MINUTE - 10 * MINUTE,
);
const SECOND_MINUTE: Date = new Date(FIRST_MINUTE.getTime() + MINUTE);
const AFTER_WINDOW: Date = new Date(FIRST_MINUTE.getTime() + 2 * MINUTE);

const WINDOW: LogRecordingRuleWindow = {
  startTime: FIRST_MINUTE,
  endTime: AFTER_WINDOW,
  minutes: 2,
  skippedMinutes: 0,
};

// Postgres ids, as service ids always are.
const projectId: ObjectID = new ObjectID(
  "88000000-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "88000000-0000-4000-8000-00000000000b",
);
const firewallServiceId: ObjectID = new ObjectID(
  "88000000-0000-4000-8000-00000000000c",
);
const otherServiceId: ObjectID = new ObjectID(
  "88000000-0000-4000-8000-00000000000d",
);
const ruleId: ObjectID = new ObjectID("88000000-0000-4000-8000-00000000000e");

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);

interface LogFixture {
  at: Date;
  secondsIn?: number;
  attributes: Record<string, string>;
  body?: string;
  projectId?: ObjectID;
  serviceId?: ObjectID;
  severity?: LogSeverity;
}

const sla: (fields: Record<string, string>) => Record<string, string> = (
  fields: Record<string, string>,
): Record<string, string> => {
  return {
    log_type: "SD-WAN",
    log_component: "SLA",
    profile_name: "Branch-Internet",
    gw_status: "up",
    ...fields,
  };
};

const LOGS: Array<LogFixture> = [
  // First minute: WAN1 reports 10 and 20, WAN2 100.
  {
    at: FIRST_MINUTE,
    secondsIn: 5,
    attributes: sla({ gw_name: "WAN1", latency: "10" }),
  },
  {
    at: FIRST_MINUTE,
    secondsIn: 35,
    attributes: sla({ gw_name: "WAN1", latency: "20" }),
  },
  {
    at: FIRST_MINUTE,
    secondsIn: 10,
    attributes: sla({ gw_name: "WAN2", latency: "100" }),
  },
  // Not a number: left out of WAN1's average, never read as 0.
  {
    at: FIRST_MINUTE,
    secondsIn: 50,
    attributes: sla({ gw_name: "WAN1", latency: "n/a" }),
  },
  {
    at: FIRST_MINUTE,
    secondsIn: 51,
    attributes: sla({ gw_name: "WAN1", latency: "12ms" }),
  },
  { at: FIRST_MINUTE, secondsIn: 52, attributes: sla({ gw_name: "WAN1" }) },
  // Another profile on the same gateway: a series of its own.
  {
    at: FIRST_MINUTE,
    secondsIn: 20,
    attributes: sla({ gw_name: "WAN1", profile_name: "VoIP", latency: "7" }),
  },
  // Second minute: WAN1 30.
  {
    at: SECOND_MINUTE,
    secondsIn: 15,
    attributes: sla({ gw_name: "WAN1", latency: "30" }),
  },
  // Not an SLA summary: filtered out.
  {
    at: FIRST_MINUTE,
    secondsIn: 30,
    attributes: {
      log_type: "SD-WAN",
      log_component: "Route",
      gw_name: "WAN1",
      latency: "999",
    },
  },
  // Another project's firewall: never read.
  {
    at: FIRST_MINUTE,
    secondsIn: 30,
    projectId: otherProjectId,
    attributes: sla({ gw_name: "WAN1", latency: "5000" }),
  },
  // Outside the window, on both sides.
  {
    at: new Date(FIRST_MINUTE.getTime() - MINUTE),
    secondsIn: 59,
    attributes: sla({ gw_name: "WAN1", latency: "777" }),
  },
  {
    at: AFTER_WINDOW,
    secondsIn: 0,
    attributes: sla({ gw_name: "WAN1", latency: "888" }),
  },
  // Another service, with an awkward value to match exactly.
  {
    at: SECOND_MINUTE,
    secondsIn: 40,
    serviceId: otherServiceId,
    severity: LogSeverity.Error,
    body: 'gateway WAN3 down: it\'s "bad" \\ 100% of probes',
    attributes: {
      gw_name: "WAN3",
      gw_status: "down",
      note: 'it\'s "bad" \\ 100%',
    },
  },
];

function logRow(fixture: LogFixture, index: number): JSONObject {
  const time: Date = new Date(
    fixture.at.getTime() + (fixture.secondsIn || 0) * 1000,
  );
  const attributes: Record<string, string> = fixture.attributes;
  const body: string =
    fixture.body ||
    Object.entries(attributes)
      .map((entry: [string, string]): string => {
        return `${entry[0]}="${entry[1]}"`;
      })
      .join(" ");

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (fixture.projectId || projectId).toString(),
    primaryEntityId: (fixture.serviceId || firewallServiceId).toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000 + index),
    severityText: fixture.severity || LogSeverity.Information,
    severityNumber: 9,
    attributes: attributes,
    attributeKeys: Object.keys(attributes).sort(),
    entityKeys: [],
    traceId: "",
    spanId: "",
    body: body,
    retentionDate: retentionDate,
  };
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

type ConnectedService = typeof LogService | typeof MetricService;

function connectionOf(service: ConnectedService): ServiceConnection {
  return {
    database: service.database,
    databaseClient: service.databaseClient,
    ingestDatabase: service.ingestDatabase,
    ingestDatabaseClient: service.ingestDatabaseClient,
  };
}

const ruleService: {
  findBy: jest.Mock;
  compareAndSetColumnsByIdWithoutHooks: jest.Mock;
} = LogRecordingRuleService as unknown as {
  findBy: jest.Mock;
  compareAndSetColumnsByIdWithoutHooks: jest.Mock;
};

async function pointsFor(
  partial: Partial<LogRecordingRuleDefinition>,
): Promise<Array<LogRecordingRulePoint>> {
  const definition: LogRecordingRuleDefinition =
    LogRecordingRuleDefinitionUtil.normalize({
      filter: {},
      aggregationType: AggregationType.Count,
      ...partial,
    });

  expect(
    LogRecordingRuleDefinitionUtil.getValidationError(definition),
  ).toBeNull();

  const result: { json: () => Promise<{ data?: Array<JSONObject> }> } =
    (await LogService.executeQuery(
      LogRecordingRuleQuery.buildStatement({
        projectId,
        definition,
        window: WINDOW,
      }),
    )) as unknown as { json: () => Promise<{ data?: Array<JSONObject> }> };

  return LogRecordingRuleQuery.readPoints({
    rows: (await result.json()).data || [],
    definition,
    window: WINDOW,
  }).points;
}

// A point as [minute index, the series' group values, value].
function summarize(
  points: Array<LogRecordingRulePoint>,
): Array<[number, Record<string, string>, number]> {
  return points
    .map(
      (
        point: LogRecordingRulePoint,
      ): [number, Record<string, string>, number] => {
        return [
          (point.bucketStart.getTime() - FIRST_MINUTE.getTime()) / MINUTE,
          point.groupValues,
          point.value,
        ];
      },
    )
    .sort(
      (
        a: [number, Record<string, string>, number],
        b: [number, Record<string, string>, number],
      ): number => {
        return (
          a[0] - b[0] ||
          JSON.stringify(a[1]).localeCompare(JSON.stringify(b[1]))
        );
      },
    );
}

const latencyByGateway: Partial<LogRecordingRuleDefinition> = {
  filter: {
    attributeFilters: [
      { key: "log_type", value: "SD-WAN" },
      { key: "log_component", value: "SLA" },
    ],
  },
  aggregationType: AggregationType.Avg,
  valueAttribute: "latency",
  groupByAttributes: ["gw_name", "profile_name"],
  unit: "ms",
};

integration("Log recording rules against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let originalLog: ServiceConnection | undefined;
  let originalMetric: ServiceConnection | undefined;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse, Log);
    await createTable(client, clickhouse, Metric);

    originalLog = connectionOf(LogService);
    originalMetric = connectionOf(MetricService);

    for (const service of [
      LogService,
      MetricService,
    ] as Array<ConnectedService>) {
      service.database = clickhouse;
      service.databaseClient = client;
      service.ingestDatabase = clickhouse;
      service.ingestDatabaseClient = client;
    }

    await LogService.insertJsonRows(LOGS.map(logRow), {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });
  });

  afterAll(async (): Promise<void> => {
    if (originalLog) {
      Object.assign(LogService, originalLog);
    }

    if (originalMetric) {
      Object.assign(MetricService, originalMetric);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("averages each gateway's SLA latency per minute, skipping values that are not numbers", async () => {
    expect(summarize(await pointsFor(latencyByGateway))).toEqual([
      [0, { gw_name: "WAN1", profile_name: "Branch-Internet" }, 15],
      [0, { gw_name: "WAN1", profile_name: "VoIP" }, 7],
      [0, { gw_name: "WAN2", profile_name: "Branch-Internet" }, 100],
      [1, { gw_name: "WAN1", profile_name: "Branch-Internet" }, 30],
    ]);
  });

  test.each([
    [AggregationType.Sum, 30],
    [AggregationType.Min, 10],
    [AggregationType.Max, 20],
    [AggregationType.P50, 15],
  ])(
    "%s of WAN1's latency in the first minute is %p",
    async (aggregationType: AggregationType, expected: number) => {
      const points: Array<LogRecordingRulePoint> = await pointsFor({
        ...latencyByGateway,
        aggregationType,
        groupByAttributes: ["gw_name"],
        filter: {
          attributeFilters: [
            { key: "log_component", value: "SLA" },
            { key: "profile_name", value: "Branch-Internet" },
          ],
        },
      });

      expect(
        summarize(points).find(
          (point: [number, Record<string, string>, number]): boolean => {
            return point[0] === 0 && point[1]["gw_name"] === "WAN1";
          },
        )?.[2],
      ).toBeCloseTo(expected, 5);
    },
  );

  test("a count with no group by counts every matching log, with 0 for an empty minute", async () => {
    expect(
      summarize(
        await pointsFor({
          filter: { attributeFilters: [{ key: "gw_name", value: "WAN2" }] },
        }),
      ),
    ).toEqual([
      [0, {}, 1],
      [1, {}, 0],
    ]);
  });

  test("attribute filter keys match whatever their case; values match exactly", async () => {
    expect(
      summarize(
        await pointsFor({
          filter: {
            attributeFilters: [
              { key: "LOG_COMPONENT", value: "SLA" },
              { key: "Gw_Name", value: "WAN2" },
            ],
          },
        }),
      ),
    ).toEqual([
      [0, {}, 1],
      [1, {}, 0],
    ]);

    // "sla" is not "SLA".
    expect(
      summarize(
        await pointsFor({
          filter: {
            attributeFilters: [{ key: "log_component", value: "sla" }],
          },
        }),
      ),
    ).toEqual([
      [0, {}, 0],
      [1, {}, 0],
    ]);
  });

  test("a value with quotes, a backslash and a percent sign matches exactly, as bound text", async () => {
    expect(
      summarize(
        await pointsFor({
          filter: {
            attributeFilters: [{ key: "note", value: 'it\'s "bad" \\ 100%' }],
          },
        }),
      ),
    ).toEqual([
      [0, {}, 0],
      [1, {}, 1],
    ]);

    // What would rewrite the predicate in a spliced statement matches nothing.
    expect(
      summarize(
        await pointsFor({
          filter: {
            attributeFilters: [{ key: "note", value: "x' OR '1'='1" }],
          },
        }),
      ),
    ).toEqual([
      [0, {}, 0],
      [1, {}, 0],
    ]);
  });

  test("the body filter is a case-insensitive contains with its wildcards literal", async () => {
    expect(
      summarize(await pointsFor({ filter: { body: "100% OF PROBES" } })),
    ).toEqual([
      [0, {}, 0],
      [1, {}, 1],
    ]);

    // `_` is a literal underscore, not "any character".
    expect(
      summarize(await pointsFor({ filter: { body: "WAN_ down" } })),
    ).toEqual([
      [0, {}, 0],
      [1, {}, 0],
    ]);
  });

  test("severities and telemetry services narrow what is read", async () => {
    expect(
      summarize(
        await pointsFor({ filter: { severityTexts: [LogSeverity.Error] } }),
      ),
    ).toEqual([
      [0, {}, 0],
      [1, {}, 1],
    ]);

    expect(
      summarize(
        await pointsFor({
          filter: { telemetryServiceIds: [otherServiceId.toString()] },
          groupByAttributes: ["gw_status"],
        }),
      ),
    ).toEqual([[1, { gw_status: "down" }, 1]]);
  });

  test("a log without a group-by attribute is a series of its own, with an empty value", async () => {
    const points: Array<LogRecordingRulePoint> = await pointsFor({
      filter: { attributeFilters: [{ key: "log_component", value: "SLA" }] },
      groupByAttributes: ["latency"],
    });

    expect(
      summarize(points).filter(
        (point: [number, Record<string, string>, number]): boolean => {
          return point[0] === 0 && point[1]["latency"] === "";
        },
      ),
    ).toEqual([[0, { latency: "" }, 1]]);
  });

  test("one tick of the worker writes the rule's points into the Metric table", async () => {
    ruleService.findBy.mockResolvedValue([
      Object.assign(new LogRecordingRule(), {
        _id: ruleId.toString(),
        projectId: projectId,
        name: "SD-WAN gateway latency",
        outputMetricName: "sdwan.gateway.latency.ms",
        definition: latencyByGateway,
        computedUntil: FIRST_MINUTE,
      }),
    ]);
    ruleService.compareAndSetColumnsByIdWithoutHooks.mockResolvedValue(true);
    (
      TelemetryUtil as unknown as { indexMetricNameServiceNameMap: jest.Mock }
    ).indexMetricNameServiceNameMap.mockResolvedValue(undefined);

    // 40 seconds into the minute after the window: the window has elapsed.
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(AFTER_WINDOW.getTime() + 40 * 1000));

    try {
      await mockCapturedJobs["Logs:ComputeRecordingRules"]!();
    } finally {
      jest.restoreAllMocks();
    }

    await client.command({ query: `SYSTEM FLUSH ASYNC INSERT QUEUE` });

    const result: { data: Array<JSONObject> } = (await (
      await client.query({
        query: `SELECT toUnixTimestamp(time) AS minute, attributes['gw_name'] AS gateway, attributes['profile_name'] AS profile, attributes[{ruleAttribute:String}] AS rule, value, metricPointType FROM ${database}.MetricItemV3 WHERE projectId = {projectId:String} AND name = {name:String} ORDER BY minute, gateway, profile`,
        query_params: {
          ruleAttribute: LOG_RECORDING_RULE_ID_ATTRIBUTE,
          projectId: projectId.toString(),
          name: "sdwan.gateway.latency.ms",
        },
        format: "JSON",
      })
    ).json()) as { data: Array<JSONObject> };

    expect(
      result.data.map((row: JSONObject) => {
        return [
          (Number(row["minute"]) * 1000 - FIRST_MINUTE.getTime()) / MINUTE,
          row["gateway"],
          row["profile"],
          Number(row["value"]),
          row["rule"],
          row["metricPointType"],
        ];
      }),
    ).toEqual([
      [0, "WAN1", "Branch-Internet", 15, ruleId.toString(), "Gauge"],
      [0, "WAN1", "VoIP", 7, ruleId.toString(), "Gauge"],
      [0, "WAN2", "Branch-Internet", 100, ruleId.toString(), "Gauge"],
      [1, "WAN1", "Branch-Internet", 30, ruleId.toString(), "Gauge"],
    ]);
  });
});

describe("Log recording rule ClickHouse suite wiring", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
