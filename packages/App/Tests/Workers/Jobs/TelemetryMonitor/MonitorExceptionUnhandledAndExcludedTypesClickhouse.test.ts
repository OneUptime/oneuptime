import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import PositiveNumber from "Common/Types/PositiveNumber";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import ExceptionMonitorResponse from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import { getRumAlertTemplateById } from "Common/Types/Monitor/RumAlertTemplates";
import { APP_NOT_RESPONDING_EXCEPTION_TYPES } from "Common/Utils/Telemetry/MobileAppFaults";
import { TelemetryRulePreviewAnswer } from "Common/Types/Monitor/TelemetryRulePreview";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { TelemetryReadScope } from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
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
 * #9713: an Exceptions monitor that counts only unhandled exceptions and
 * leaves chosen types out, against a real ClickHouse server.
 *
 * The unit tests pin what the monitor puts on its query (`escaped = true`,
 * `exceptionType NOT IN (...)`). What only real rows can show is what
 * those COUNT, and that the three places that count them agree:
 *
 *   - the check, monitorException, the function the telemetry worker calls;
 *   - the rule's preview, TelemetryRulePreviewService.previewExceptions,
 *     the chart under the form;
 *   - a mobile app's Overview, whose Crashes tile reads the exception
 *     histogram unhandled with ANR and Hang left out: the App Crashes
 *     recommendation is now this monitor, and counts exactly that.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/MonitorExceptionUnhandledAndExcludedTypesClickhouse.test.ts
 * ------------------------------------------------------------------
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The criteria evaluator's native addon; nothing here runs JavaScript.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

/*
 * Resolved and archived state lives on the Postgres exception group: no
 * group is resolved here, so the lookup answers none.
 */
jest.mock("Common/Server/Services/TelemetryExceptionService", () => {
  return {
    __esModule: true,
    default: {
      getResolvedOrArchivedFingerprints: jest.fn(),
      countBy: jest.fn(),
    },
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

import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import ExceptionAggregationService, {
  HistogramBucket,
  SessionCountResult,
} from "Common/Server/Services/ExceptionAggregationService";
import TelemetryRulePreviewService from "Common/Server/Services/TelemetryRulePreviewService";
import { monitorException } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `exception_unhandled_types_test_${process.pid}_${Date.now()}`;

const resolvedFingerprints: jest.Mock =
  TelemetryExceptionService.getResolvedOrArchivedFingerprints as unknown as jest.Mock;

const projectId: ObjectID = new ObjectID("7800000000000000000000a1");

// A mobile app, and a backend service in the same project.
const appId: ObjectID = new ObjectID("7800000000000000000000b1");
const backendId: ObjectID = new ObjectID("7800000000000000000000b2");

const EVERYTHING: TelemetryReadScope = { readableIds: null, blockedIds: [] };

const now: number = Date.now();

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

interface OccurrenceFixture {
  serviceId: ObjectID;
  exceptionType: string;
  // null leaves the flag unknown, as a log body scan writes it.
  escaped: boolean | null;
  fingerprint: string;
  sessionId?: string;
  minutesAgo?: number;
}

/*
 * What a mobile app's ingest writes in a few minutes: two crashes (an
 * Android exception, an iOS Mach exception), an Android ANR and an iOS
 * hang - all unhandled - and the handled exceptions the app records
 * itself, one of them with no word on whether it was caught. A backend's
 * unhandled exception sits beside them, in another service.
 */
const occurrences: Array<OccurrenceFixture> = [
  {
    serviceId: appId,
    exceptionType: "java.lang.IllegalStateException",
    escaped: true,
    fingerprint: "android-crash",
    sessionId: "session-1",
  },
  {
    serviceId: appId,
    exceptionType: "java.lang.IllegalStateException",
    escaped: true,
    fingerprint: "android-crash",
    sessionId: "session-2",
  },
  {
    serviceId: appId,
    exceptionType: "EXC_BAD_ACCESS",
    escaped: true,
    fingerprint: "ios-crash",
    sessionId: "session-3",
  },
  {
    serviceId: appId,
    exceptionType: "ANR",
    escaped: true,
    fingerprint: "android-anr",
    sessionId: "session-1",
  },
  {
    serviceId: appId,
    exceptionType: "Hang",
    escaped: true,
    fingerprint: "ios-hang",
    sessionId: "session-4",
  },
  {
    serviceId: appId,
    exceptionType: "java.net.SocketTimeoutException",
    escaped: false,
    fingerprint: "handled-timeout",
    sessionId: "session-5",
  },
  {
    serviceId: appId,
    exceptionType: "java.io.IOException",
    escaped: null,
    fingerprint: "unknown-io",
    sessionId: "session-5",
  },
  {
    serviceId: backendId,
    exceptionType: "TypeError",
    escaped: true,
    fingerprint: "backend-crash",
  },
];

function occurrenceRow(fixture: OccurrenceFixture, index: number): JSONObject {
  const time: Date = new Date(
    now - (fixture.minutesAgo ?? 1) * 60 * 1000 - index * 1000,
  );

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    primaryEntityId: fixture.serviceId.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000),
    exceptionType: fixture.exceptionType,
    stackTrace: "",
    message: "it failed",
    spanStatusCode: 0,
    escaped: fixture.escaped,
    traceId: "",
    spanId: "",
    sessionId: fixture.sessionId || "",
    fingerprint: fixture.fingerprint,
    spanName: "",
    release: "",
    parsedFrames: "",
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    retentionDate: retentionDate,
  };
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new ExceptionInstance();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: ExceptionInstance as unknown as { new (): AnalyticsBaseModel },
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

const WINDOW_SECONDS: number = 600;

function monitorOf(
  config: Partial<MonitorStepExceptionMonitor>,
): MonitorStepExceptionMonitor {
  return {
    ...MonitorStepExceptionMonitorUtil.getDefault(),
    telemetryServiceIds: [appId],
    lastXSecondsOfExceptions: WINDOW_SECONDS,
    ...config,
  };
}

async function evaluate(
  monitor: MonitorStepExceptionMonitor,
): Promise<ExceptionMonitorResponse> {
  const step: MonitorStep = new MonitorStep();
  step.setExceptionMonitor(monitor);

  return monitorException({
    monitorStep: step,
    monitorId: ObjectID.generate(),
    projectId: projectId,
    evaluateUntil: new Date(now),
  });
}

async function countFor(
  config: Partial<MonitorStepExceptionMonitor>,
): Promise<number> {
  return (await evaluate(monitorOf(config))).exceptionCount;
}

// The preview's newest window, which ends where the check's does.
async function previewNewestWindow(
  monitor: MonitorStepExceptionMonitor,
): Promise<number> {
  const answer: TelemetryRulePreviewAnswer =
    await TelemetryRulePreviewService.previewExceptions({
      projectId: projectId,
      exceptionMonitor: monitor,
      scope: EVERYTHING,
      now: new Date(now),
    });

  const newestStart: number =
    OneUptimeDate.fromString(answer.endTime).getTime() -
    answer.windowInSeconds * 1000;

  return (
    answer.buckets.find((bucket: { time: string; value: number }) => {
      return OneUptimeDate.fromString(bucket.time).getTime() === newestStart;
    })?.value || 0
  );
}

integration(
  "Exceptions monitor unhandled-only and left-out types against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: ServiceConnection | undefined;

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

      await createTable(client, clickhouse);

      original = {
        database: ExceptionInstanceService.database,
        databaseClient: ExceptionInstanceService.databaseClient,
        ingestDatabase: ExceptionInstanceService.ingestDatabase,
        ingestDatabaseClient: ExceptionInstanceService.ingestDatabaseClient,
      };

      ExceptionInstanceService.database = clickhouse;
      ExceptionInstanceService.databaseClient = client;
      ExceptionInstanceService.ingestDatabase = clickhouse;
      ExceptionInstanceService.ingestDatabaseClient = client;

      await ExceptionInstanceService.insertJsonRows(
        occurrences.map(occurrenceRow),
        { clickhouseSettings: { wait_for_async_insert: 1 } },
      );
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(ExceptionInstanceService, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    beforeEach(() => {
      resolvedFingerprints.mockReset().mockResolvedValue([]);
    });

    test("the fixture loaded every occurrence", async () => {
      const total: PositiveNumber = await ExceptionInstanceService.countBy({
        query: {},
        skip: 0,
        limit: 1000,
        props: { isRoot: true },
      });

      expect(total.toNumber()).toBe(occurrences.length);
    });

    test("without the filters the app's every exception counts, as before", async () => {
      expect(await countFor({})).toBe(7);
    });

    test("unhandled only counts the escaped ones: a caught exception, and one that does not say, are left out", async () => {
      expect(await countFor({ unhandledOnly: true })).toBe(5);
    });

    test("types left out are not counted, whatever else matches", async () => {
      expect(await countFor({ excludedExceptionTypes: ["ANR", "Hang"] })).toBe(
        5,
      );
    });

    test("App Crashes' two filters together count the crashes alone", async () => {
      expect(
        await countFor({
          unhandledOnly: true,
          excludedExceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
        }),
      ).toBe(3);
    });

    test("App Not Responding's kept types count the freezes alone", async () => {
      expect(
        await countFor({
          exceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
        }),
      ).toBe(2);
    });

    test("kept types less the ones left out count what is left", async () => {
      expect(
        await countFor({
          exceptionTypes: ["ANR", "EXC_BAD_ACCESS"],
          excludedExceptionTypes: ["ANR"],
        }),
      ).toBe(1);
    });

    test("a type both kept and left out leaves nothing to count, and the query still runs", async () => {
      expect(
        await countFor({
          exceptionTypes: ["ANR"],
          excludedExceptionTypes: ["ANR"],
        }),
      ).toBe(0);
    });

    test("an exact type match: a left-out type in another case is still counted", async () => {
      expect(await countFor({ excludedExceptionTypes: ["anr", "hang"] })).toBe(
        7,
      );
    });

    test("the recommendation's own step counts what its filters say", async () => {
      const template: ReturnType<typeof getRumAlertTemplateById> =
        getRumAlertTemplateById("rum-app-crashes");

      const step: MonitorStep = template!.getMonitorStep({
        rumApplicationId: appId.toString(),
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "Storefront",
      });

      const response: ExceptionMonitorResponse = await monitorException({
        monitorStep: step,
        monitorId: ObjectID.generate(),
        projectId: projectId,
        evaluateUntil: new Date(now),
      });

      expect(response.exceptionCount).toBe(3);
    });

    describe("the preview counts what the check counts", () => {
      test.each([
        ["unhandled only", { unhandledOnly: true }],
        ["types left out", { excludedExceptionTypes: ["ANR", "Hang"] }],
        [
          "App Crashes",
          {
            unhandledOnly: true,
            excludedExceptionTypes: ["ANR", "Hang"],
          },
        ],
        ["App Not Responding", { exceptionTypes: ["ANR", "Hang"] }],
        [
          "a type both kept and left out",
          { exceptionTypes: ["ANR"], excludedExceptionTypes: ["ANR"] },
        ],
      ])(
        "%s",
        async (
          _label: string,
          config: Partial<MonitorStepExceptionMonitor>,
        ): Promise<void> => {
          const monitor: MonitorStepExceptionMonitor = monitorOf(config);

          expect(await previewNewestWindow(monitor)).toBe(
            (await evaluate(monitor)).exceptionCount,
          );
        },
      );
    });

    describe("App Crashes counts exactly what the Overview's Crashes tile counts", () => {
      const window: { startTime: Date; endTime: Date } = {
        startTime: new Date(now - WINDOW_SECONDS * 1000),
        endTime: new Date(now),
      };

      test("the tile's histogram, unhandled with the freezes left out, adds up to the monitor's count", async () => {
        const buckets: Array<HistogramBucket> =
          await ExceptionAggregationService.getHistogram({
            projectId: projectId,
            ...window,
            bucketSizeInMinutes: 1,
            serviceIds: [appId],
            escaped: true,
            excludedExceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
          });

        const tileCount: number = buckets.reduce(
          (total: number, bucket: HistogramBucket) => {
            return total + bucket.count;
          },
          0,
        );

        expect(tileCount).toBe(
          await countFor({
            unhandledOnly: true,
            excludedExceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
          }),
        );
      });

      test("and the ANRs tile's, the freezes alone, adds up to App Not Responding's", async () => {
        const result: SessionCountResult =
          await ExceptionAggregationService.getSessionCount({
            projectId: projectId,
            ...window,
            serviceIds: [appId],
            exceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
          });

        expect(result.occurrences).toBe(
          await countFor({
            exceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
          }),
        );
        // The ANR and the hang were in two sessions.
        expect(result.sessions).toBe(2);
      });
    });
  },
);

describe("Exceptions monitor unhandled and left-out types ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
