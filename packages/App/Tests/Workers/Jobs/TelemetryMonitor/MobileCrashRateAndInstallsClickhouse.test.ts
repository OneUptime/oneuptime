import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import ExceptionMonitorResponse from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import {
  RumAlertTemplate,
  getRumAlertTemplateById,
} from "Common/Types/Monitor/RumAlertTemplates";
import { APP_NOT_RESPONDING_EXCEPTION_TYPES } from "Common/Utils/Telemetry/MobileAppFaults";
import { STORED_APP_INSTALLATION_ID_ATTRIBUTE } from "Common/Types/Rum/MobileAppTelemetry";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import DataToProcess from "Common/Server/Utils/Monitor/DataToProcess";
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
 * #9716 against a real ClickHouse server: a mobile app's crash-free
 * installs, and its crash and ANR rate monitors.
 *
 *   - Crash-free installs: the Overview's two session-count reads, now
 *     counting the distinct app.installation.id beside the sessions - the
 *     spans' (TraceAggregationService) and the crashes'
 *     (ExceptionAggregationService), whose occurrences ingest gives the
 *     install - folded as the Overview folds them.
 *   - The rates: monitorException, the function the telemetry worker
 *     calls, on the App Crash Rate and App ANR Rate recommendations' own
 *     steps, and their criteria judged on what it read.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/MobileCrashRateAndInstallsClickhouse.test.ts
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

// Resolved and archived exception groups live in Postgres: none here.
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

import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import TraceAggregationService, {
  SessionCountResult as TraceSessionCountResult,
} from "Common/Server/Services/TraceAggregationService";
import ExceptionAggregationService, {
  SessionCountResult as ExceptionSessionCountResult,
} from "Common/Server/Services/ExceptionAggregationService";
import ExceptionMonitorCriteria from "Common/Server/Utils/Monitor/Criteria/ExceptionMonitorCriteria";
import ExceptionMonitorMeasureReader, {
  ExceptionMonitorInstalls,
} from "Common/Server/Utils/Monitor/ExceptionMonitorMeasures";
import Includes from "Common/Types/BaseDatabase/Includes";
import { monitorException } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import {
  MobileFaultCount,
  MobileSessions,
  readFaultInstalls,
  readFaultSessions,
  readSessionCount,
} from "../../../../FeatureSet/Dashboard/src/Components/Rum/MobileOverview/MobileRumSignalData";
import {
  getCrashFreeInstallsPercent,
  getCrashFreeSessionsPercent,
} from "../../../../FeatureSet/Dashboard/src/Pages/Rum/View/MobileOverviewHelpers";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `mobile_crash_rate_test_${process.pid}_${Date.now()}`;

const resolvedFingerprints: jest.Mock =
  TelemetryExceptionService.getResolvedOrArchivedFingerprints as unknown as jest.Mock;

const projectId: ObjectID = new ObjectID("7900000000000000000000a1");

/*
 * A busy app on 120 phones: 300 sessions in the hour, two spans each.
 * A small fleet: 100 sessions in the hour, on 10 kiosks.
 */
const busyAppId: ObjectID = new ObjectID("7900000000000000000000b1");
const smallFleetId: ObjectID = new ObjectID("7900000000000000000000b2");

const BUSY_SESSIONS: number = 300;
const BUSY_INSTALLS: number = 120;
const FLEET_SESSIONS: number = 100;
const FLEET_INSTALLS: number = 10;

/*
 * #9924: an iOS app on opentelemetry-swift 2.x, which names its install by
 * device.id (identifierForVendor) alone, over the past day: 320 sessions on
 * 300 iPhones (20 of them had a second session), one of which - iPhone 0 -
 * moved to opentelemetry-swift 3.0 and names both; iPhone 7 reinstalled
 * after its vendor's last app was removed, so its identifierForVendor
 * changed; and 6 more iPhones whose spans name no session. MetricKit
 * crashes on iPhones 1 to 5, each reported in a later session, and on one
 * of the sessionless iPhones, in no session.
 */
const iosAppId: ObjectID = new ObjectID("7900000000000000000000b3");

const IOS_SESSIONS: number = 320;
const IOS_PHONES: number = 300;
const IOS_SESSIONLESS_PHONES: number = 6;
// Its iPhones, the reinstalled one's second identifierForVendor, the sessionless.
const IOS_INSTALLS: number = IOS_PHONES + 1 + IOS_SESSIONLESS_PHONES;
const IOS_CRASHED_INSTALLS: number = 6;

function iphone(index: number | string): string {
  return `ios-${iosAppId.toString()}-${index}`;
}

function deviceIdOf(phone: string): JSONObject {
  return { "resource.device.id": phone };
}

const now: Date = new Date();

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

function minutesAgo(minutes: number, offsetSeconds: number = 0): Date {
  return new Date(now.getTime() - minutes * 60 * 1000 - offsetSeconds * 1000);
}

function installOf(appId: ObjectID, session: number): string {
  const installs: number =
    appId.toString() === busyAppId.toString() ? BUSY_INSTALLS : FLEET_INSTALLS;

  return `${appId.toString()}-install-${session % installs}`;
}

function sessionOf(appId: ObjectID, session: number): string {
  return `${appId.toString()}-session-${session}`;
}

interface SpanFixture {
  appId: ObjectID;
  // The session it was in; null for a span that names none.
  session: number | null;
  at: Date;
  // A span from an SDK that names no install.
  withoutInstall?: boolean;
  // What its resource names instead of the Android install (#9924).
  resource?: JSONObject | undefined;
}

function spanRow(fixture: SpanFixture, index: number): JSONObject {
  const startNs: string = String(
    BigInt(fixture.at.getTime()) * BigInt(1000000),
  );
  const attributes: JSONObject = { "app.screen.name": "MenuActivity" };

  if (fixture.resource) {
    Object.assign(attributes, fixture.resource);
  } else if (fixture.session !== null && !fixture.withoutInstall) {
    attributes[STORED_APP_INSTALLATION_ID_ATTRIBUTE] = installOf(
      fixture.appId,
      fixture.session,
    );
  }

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    primaryEntityId: fixture.appId.toString(),
    primaryEntityType: "RealUserMonitor",
    startTime: OneUptimeDate.toClickhouseDateTime64(fixture.at),
    endTime: OneUptimeDate.toClickhouseDateTime64(fixture.at),
    startTimeUnixNano: startNs,
    endTimeUnixNano: String(BigInt(startNs) + BigInt(5000000)),
    durationUnixNano: "5000000",
    traceId: `trace-${index}`,
    spanId: `span-${index}`,
    sessionId:
      fixture.session === null ? "" : sessionOf(fixture.appId, fixture.session),
    parentSpanId: "",
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    entityKeys: [],
    statusCode: SpanStatus.Ok,
    name: "Resumed",
    kind: "SPAN_KIND_INTERNAL",
    isRootSpan: true,
    retentionDate,
  };
}

interface ExceptionFixture {
  appId: ObjectID;
  session: number;
  exceptionType: string;
  escaped: boolean;
  at: Date;
  // An occurrence stored before ingest kept the install.
  withoutInstall?: boolean;
  // What ingest copied from its log's resource instead (#9924).
  resource?: JSONObject | undefined;
  // The session it arrived in, when not the one it is numbered by; '' for none.
  sessionId?: string | undefined;
}

function exceptionRow(fixture: ExceptionFixture): JSONObject {
  const attributes: JSONObject = { "exception.source": "log" };

  if (fixture.resource) {
    Object.assign(attributes, fixture.resource);
  } else if (!fixture.withoutInstall) {
    attributes[STORED_APP_INSTALLATION_ID_ATTRIBUTE] = installOf(
      fixture.appId,
      fixture.session,
    );
  }

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    primaryEntityId: fixture.appId.toString(),
    primaryEntityType: "RealUserMonitor",
    time: OneUptimeDate.toClickhouseDateTime64(fixture.at),
    timeUnixNano: String(fixture.at.getTime() * 1000000),
    exceptionType: fixture.exceptionType,
    stackTrace: "",
    message: "it failed",
    spanStatusCode: 0,
    escaped: fixture.escaped,
    traceId: "",
    spanId: "",
    sessionId:
      fixture.sessionId !== undefined
        ? fixture.sessionId
        : sessionOf(fixture.appId, fixture.session),
    fingerprint: `${fixture.exceptionType}-${fixture.escaped}`,
    spanName: "",
    release: "",
    parsedFrames: "",
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    entityKeys: [],
    retentionDate: retentionDate,
  };
}

function spanFixtures(): Array<SpanFixture> {
  const spans: Array<SpanFixture> = [];

  for (let session: number = 0; session < BUSY_SESSIONS; session++) {
    spans.push({ appId: busyAppId, session, at: minutesAgo(50, session) });
    spans.push({ appId: busyAppId, session, at: minutesAgo(20, session) });
  }

  // Spans that name no session: no session, no install.
  for (let index: number = 0; index < 20; index++) {
    spans.push({ appId: busyAppId, session: null, at: minutesAgo(10, index) });
  }

  // A session two hours ago is not one of the hour's.
  spans.push({ appId: busyAppId, session: 9999, at: minutesAgo(120) });

  for (let session: number = 0; session < FLEET_SESSIONS; session++) {
    spans.push({ appId: smallFleetId, session, at: minutesAgo(30, session) });
  }

  // The iOS app's day, hours before the hour the session rates read.
  for (let session: number = 0; session < IOS_SESSIONS; session++) {
    const phone: string = iphone(session % IOS_PHONES);

    spans.push({
      appId: iosAppId,
      session,
      at: minutesAgo(90 + session),
      resource:
        session % IOS_PHONES === 0
          ? {
              ...deviceIdOf(phone),
              [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: phone,
            }
          : deviceIdOf(phone),
    });
  }

  // iPhone 7 after a reinstall: a new identifierForVendor, a new install.
  spans.push({
    appId: iosAppId,
    session: 400,
    at: minutesAgo(100),
    resource: deviceIdOf(iphone("7-reinstalled")),
  });

  // iPhones that send spans with no session.id: installs, with no session.
  for (let index: number = 0; index < IOS_SESSIONLESS_PHONES; index++) {
    spans.push({
      appId: iosAppId,
      session: null,
      at: minutesAgo(200, index),
      resource: deviceIdOf(iphone(`sessionless-${index}`)),
    });
  }

  return spans;
}

const CRASH: string = "java.lang.IllegalStateException";

/*
 * The busy app: crashes in 6 sessions (session 0 twice), on 5 installs -
 * sessions 0 and 120 are on the same phone - two ANRs and a hang in 3
 * more, a handled exception, and a crash two hours ago. The small fleet:
 * crashes in 10 of its 100 sessions, one stored before installs were kept.
 */
function exceptionFixtures(): Array<ExceptionFixture> {
  const crash: (appId: ObjectID, session: number) => ExceptionFixture = (
    appId: ObjectID,
    session: number,
  ): ExceptionFixture => {
    return {
      appId,
      session,
      exceptionType: CRASH,
      escaped: true,
      at: minutesAgo(15, session),
    };
  };

  const fixtures: Array<ExceptionFixture> = [
    crash(busyAppId, 0),
    crash(busyAppId, 0),
    crash(busyAppId, 1),
    crash(busyAppId, 2),
    crash(busyAppId, 3),
    crash(busyAppId, 4),
    crash(busyAppId, 120),
    {
      appId: busyAppId,
      session: 10,
      exceptionType: "ANR",
      escaped: true,
      at: minutesAgo(12),
    },
    {
      appId: busyAppId,
      session: 11,
      exceptionType: "ANR",
      escaped: true,
      at: minutesAgo(12),
    },
    {
      appId: busyAppId,
      session: 12,
      exceptionType: "Hang",
      escaped: true,
      at: minutesAgo(12),
    },
    {
      appId: busyAppId,
      session: 20,
      exceptionType: "java.net.SocketTimeoutException",
      escaped: false,
      at: minutesAgo(12),
    },
    { ...crash(busyAppId, 30), at: minutesAgo(120) },
  ];

  /*
   * The iOS app's MetricKit crashes: each reported in a later session
   * (MetricKit delivers on the next launch), with the device.id ingest
   * copied from its log's resource - and one from a sessionless iPhone.
   */
  for (let phone: number = 1; phone <= 5; phone++) {
    fixtures.push({
      appId: iosAppId,
      session: 1000 + phone,
      exceptionType: "EXC_BAD_ACCESS",
      escaped: true,
      at: minutesAgo(80, phone),
      resource: deviceIdOf(iphone(phone)),
    });
  }

  fixtures.push({
    appId: iosAppId,
    session: 0,
    exceptionType: "EXC_BAD_ACCESS",
    escaped: true,
    at: minutesAgo(80),
    resource: deviceIdOf(iphone("sessionless-0")),
    sessionId: "",
  });

  // In the past five minutes, which App Crashes reads.
  for (let session: number = 0; session < 10; session++) {
    fixtures.push({
      ...crash(smallFleetId, session),
      at: minutesAgo(2, session),
      withoutInstall: session === 0,
    });
  }

  return fixtures;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType,
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

type AnyService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
};

const SERVICES: Array<AnyService> = [
  SpanService as unknown as AnyService,
  ExceptionInstanceService as unknown as AnyService,
];

const hour: { startTime: Date; endTime: Date } = {
  startTime: minutesAgo(60),
  endTime: now,
};

// The day a daily rate reads (#9924).
const day: { startTime: Date; endTime: Date } = {
  startTime: minutesAgo(24 * 60),
  endTime: now,
};

function stepOf(templateId: string, appId: ObjectID): MonitorStep {
  const template: RumAlertTemplate | undefined =
    getRumAlertTemplateById(templateId);

  return template!.getMonitorStep({
    rumApplicationId: appId.toString(),
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Storefront",
  });
}

// The first criteria whose filters match, as the evaluator reads them top to bottom.
async function matchedCriteria(
  step: MonitorStep,
  response: ExceptionMonitorResponse,
): Promise<string | null> {
  for (const instance of step.data?.monitorCriteria?.data
    ?.monitorCriteriaInstanceArray || ([] as Array<MonitorCriteriaInstance>)) {
    const filters: Array<CriteriaFilter> = instance.data?.filters || [];
    const results: Array<boolean> = [];

    for (const filter of filters) {
      results.push(
        Boolean(
          await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
            dataToProcess: response as unknown as DataToProcess,
            criteriaFilter: filter,
          }),
        ),
      );
    }

    const matched: boolean =
      instance.data?.filterCondition === FilterCondition.All
        ? results.every(Boolean)
        : results.some(Boolean);

    if (matched) {
      return instance.data?.name || null;
    }
  }

  return null;
}

integration(
  "A mobile app's crash-free installs and crash rates against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    const originals: Array<[AnyService, ServiceConnection]> = [];

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

      await createTable(
        client,
        clickhouse,
        Span as unknown as { new (): AnalyticsBaseModel },
      );
      await createTable(
        client,
        clickhouse,
        ExceptionInstance as unknown as { new (): AnalyticsBaseModel },
      );

      for (const service of SERVICES) {
        originals.push([
          service,
          {
            database: service.database,
            databaseClient: service.databaseClient,
            ingestDatabase: service.ingestDatabase,
            ingestDatabaseClient: service.ingestDatabaseClient,
          },
        ]);
        service.database = clickhouse;
        service.databaseClient = client;
        service.ingestDatabase = clickhouse;
        service.ingestDatabaseClient = client;
      }

      await client.insert({
        table: `${database}.${new Span().tableName}`,
        values: spanFixtures().map(spanRow),
        format: "JSONEachRow",
      });
      await client.insert({
        table: `${database}.${new ExceptionInstance().tableName}`,
        values: exceptionFixtures().map(exceptionRow),
        format: "JSONEachRow",
      });
    });

    afterAll(async (): Promise<void> => {
      for (const [service, connection] of originals) {
        Object.assign(service, connection);
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

    describe("crash-free installs, counted as crash-free sessions are", () => {
      async function overviewOf(
        appId: ObjectID,
        range: { startTime: Date; endTime: Date } = hour,
      ): Promise<{
        sessions: MobileSessions;
        crashes: MobileFaultCount;
      }> {
        const spans: TraceSessionCountResult =
          await TraceAggregationService.getSessionCount({
            projectId,
            ...range,
            serviceIds: [appId],
            countInstalls: true,
          });
        const crashes: ExceptionSessionCountResult =
          await ExceptionAggregationService.getSessionCount({
            projectId,
            ...range,
            serviceIds: [appId],
            escaped: true,
            excludedExceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
            countInstalls: true,
          });

        // As the routes answer them, and the Overview reads the answers.
        const crashAnswer: JSONObject = {
          sessions: crashes.sessions,
          occurrences: crashes.occurrences,
          installs: crashes.installs!,
          occurrencesWithInstall: crashes.occurrencesWithInstall!,
        };

        return {
          sessions: readSessionCount({
            sessions: spans.sessions,
            spans: spans.spans,
            installs: spans.installs!,
          }),
          crashes: {
            total: crashes.occurrences,
            series: [],
            sessions: readFaultSessions(crashAnswer),
            installs: readFaultInstalls(crashAnswer),
            failed: false,
          },
        };
      }

      test("the spans' sessions and installs: the hour's, none from a span that names none", async () => {
        const result: TraceSessionCountResult =
          await TraceAggregationService.getSessionCount({
            projectId,
            ...hour,
            serviceIds: [busyAppId],
            countInstalls: true,
          });

        expect(result).toEqual({
          sessions: BUSY_SESSIONS,
          // 600 spans of sessions, and 20 that name none.
          spans: 2 * BUSY_SESSIONS + 20,
          installs: BUSY_INSTALLS,
        });
      });

      test("the crashes' sessions and installs: no ANR, hang or handled exception among them", async () => {
        const result: ExceptionSessionCountResult =
          await ExceptionAggregationService.getSessionCount({
            projectId,
            ...hour,
            serviceIds: [busyAppId],
            escaped: true,
            excludedExceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
            countInstalls: true,
          });

        expect(result).toEqual({
          sessions: 6,
          occurrences: 7,
          // Sessions 0 and 120 crashed on the same phone.
          installs: 5,
          occurrencesWithInstall: 7,
        });
      });

      test("the Overview reads 98% of sessions and 95.83% of installs crash-free", async () => {
        const read: { sessions: MobileSessions; crashes: MobileFaultCount } =
          await overviewOf(busyAppId);

        expect(getCrashFreeSessionsPercent(read)).toBe(98);
        expect(getCrashFreeInstallsPercent(read)!.toFixed(2)).toBe("95.83");
      });

      test("a crash stored before installs were kept leaves the installs' share unknown, the sessions' still read", async () => {
        const read: { sessions: MobileSessions; crashes: MobileFaultCount } =
          await overviewOf(smallFleetId);

        expect(read.sessions.installs).toBe(FLEET_INSTALLS);
        expect(read.crashes.installs).toBeNull();
        expect(getCrashFreeInstallsPercent(read)).toBeNull();
        expect(getCrashFreeSessionsPercent(read)).toBe(90);
      });

      /*
       * #9924: an iOS app's installs are its device.id where it names no
       * app.installation.id - so it has crash-free installs at all.
       */
      test("an iOS app's installs over the day: its iPhones' identifierForVendor, a reinstall a new one, a sessionless iPhone one too", async () => {
        const result: TraceSessionCountResult =
          await TraceAggregationService.getSessionCount({
            projectId,
            ...day,
            serviceIds: [iosAppId],
            countInstalls: true,
          });

        expect(result).toEqual({
          // Its 320 sessions and the reinstalled iPhone's.
          sessions: IOS_SESSIONS + 1,
          spans: IOS_SESSIONS + 1 + IOS_SESSIONLESS_PHONES,
          installs: IOS_INSTALLS,
        });
      });

      test("an iOS app's crashes name their installs too, one of them in no session", async () => {
        const result: ExceptionSessionCountResult =
          await ExceptionAggregationService.getSessionCount({
            projectId,
            ...day,
            serviceIds: [iosAppId],
            escaped: true,
            excludedExceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
            countInstalls: true,
          });

        expect(result).toEqual({
          sessions: 5,
          occurrences: IOS_CRASHED_INSTALLS,
          installs: IOS_CRASHED_INSTALLS,
          occurrencesWithInstall: IOS_CRASHED_INSTALLS,
        });
      });

      test("the Overview reads an iOS app's crash-free installs, where it said only how many sessions crashed", async () => {
        const read: { sessions: MobileSessions; crashes: MobileFaultCount } =
          await overviewOf(iosAppId, day);

        expect(read.sessions.installs).toBe(IOS_INSTALLS);
        expect(read.crashes.installs).toBe(IOS_CRASHED_INSTALLS);
        // 301 of 307 installs: 98.05% crash-free.
        expect(getCrashFreeInstallsPercent(read)!.toFixed(2)).toBe("98.05");
      });

      test("the installs measure reads the same installs, through the monitor's own queries", async () => {
        const installs: ExceptionMonitorInstalls =
          await ExceptionMonitorMeasureReader.readInstalls({
            projectId,
            config: {
              ...stepOf("rum-app-daily-crash-rate", iosAppId).data!
                .exceptionMonitor!,
            },
            countQuery: {
              projectId,
              primaryEntityId: new Includes([iosAppId]),
              escaped: true,
            },
            windowStart: day.startTime,
            windowEnd: day.endTime,
          });

        expect(installs).toEqual({
          installs: IOS_INSTALLS,
          installsWithExceptions: IOS_CRASHED_INSTALLS,
        });
      });

      test("without the installs asked for, the reads are as they were", async () => {
        expect(
          await TraceAggregationService.getSessionCount({
            projectId,
            ...hour,
            serviceIds: [busyAppId],
          }),
        ).toEqual({ sessions: BUSY_SESSIONS, spans: 2 * BUSY_SESSIONS + 20 });
      });
    });

    describe("the crash and ANR rate monitors", () => {
      async function check(
        templateId: string,
        appId: ObjectID,
      ): Promise<{
        response: ExceptionMonitorResponse;
        matched: string | null;
      }> {
        const step: MonitorStep = stepOf(templateId, appId);
        const response: ExceptionMonitorResponse = await monitorException({
          monitorStep: step,
          monitorId: ObjectID.generate(),
          projectId: projectId,
          evaluateUntil: now,
        });

        return { response, matched: await matchedCriteria(step, response) };
      }

      test("App Crash Rate reads the hour's sessions and the share a crash happened in", async () => {
        const { response } = await check("rum-app-crash-rate", busyAppId);

        expect(response.exceptionCount).toBe(7);
        expect(response.sessionCount).toBe(BUSY_SESSIONS);
        expect(response.sessionsWithExceptionsCount).toBe(6);
        // 6 of 300: the Overview's 98% crash-free, seen from the other side.
        expect(response.sessionsWithExceptionsPercent).toBe(2);
      });

      test("2% of 300 sessions crashing is above Android vitals' 1.09%: it alerts", async () => {
        const { matched } = await check("rum-app-crash-rate", busyAppId);

        expect(matched).toBe("Crash rate above 1.09%");
      });

      test("App ANR Rate reads the ANRs and the hang, 3 sessions of 300, above 0.47%", async () => {
        const { response, matched } = await check(
          "rum-app-anr-rate",
          busyAppId,
        );

        expect(response.exceptionCount).toBe(3);
        expect(response.sessionsWithExceptionsCount).toBe(3);
        expect(response.sessionsWithExceptionsPercent).toBe(1);
        expect(matched).toBe("ANR rate above 0.47%");
      });

      test("a small fleet's 10% is judged on too few sessions: healthy, its crashes left to App Crashes", async () => {
        const { response, matched } = await check(
          "rum-app-crash-rate",
          smallFleetId,
        );

        expect(response.sessionCount).toBe(FLEET_SESSIONS);
        expect(response.sessionsWithExceptionsPercent).toBe(10);
        expect(matched).toBe("Healthy");

        const crashes: {
          response: ExceptionMonitorResponse;
          matched: string | null;
        } = await check("rum-app-crashes", smallFleetId);

        expect(crashes.matched).toBe("App crash reported");
      });

      /*
       * #9924: the same rates per install over a day - the share of the
       * day's users a crash reached, as the Play Console reads it.
       */
      test("Daily Crash Rate reads the day's installs: 6 of an iOS app's 307 crashed, above 1.09% - it alerts", async () => {
        const { response, matched } = await check(
          "rum-app-daily-crash-rate",
          iosAppId,
        );

        expect(response.exceptionCount).toBe(IOS_CRASHED_INSTALLS);
        expect(response.installCount).toBe(IOS_INSTALLS);
        expect(response.installsWithExceptionsCount).toBe(IOS_CRASHED_INSTALLS);
        expect(response.installsWithExceptionsPercent).toBe(1.95);
        expect(matched).toBe("Daily crash rate above 1.09%");
        // A share of installs reads no session.
        expect(response.sessionCount).toBeUndefined();
      });

      test("the iOS app's hourly session rate has nothing to read: its day was before the hour", async () => {
        const { response, matched } = await check(
          "rum-app-crash-rate",
          iosAppId,
        );

        expect(response.sessionCount).toBe(0);
        expect(response.sessionsWithExceptionsPercent).toBeNull();
        expect(matched).toBe("Healthy");
      });

      test("an app on fewer than 250 installs a day is judged on too few: healthy", async () => {
        const { response, matched } = await check(
          "rum-app-daily-crash-rate",
          busyAppId,
        );

        expect(response.installCount).toBe(BUSY_INSTALLS);
        // Its 5 crashed phones and the one that crashed two hours ago.
        expect(response.installsWithExceptionsCount).toBe(6);
        expect(response.installsWithExceptionsPercent).toBe(5);
        expect(matched).toBe("Healthy");
      });

      test("Daily ANR Rate reads the day's ANRs and hangs per install", async () => {
        const { response, matched } = await check(
          "rum-app-daily-anr-rate",
          busyAppId,
        );

        expect(response.exceptionCount).toBe(3);
        expect(response.installsWithExceptionsCount).toBe(3);
        expect(response.installsWithExceptionsPercent).toBe(2.5);
        // 120 installs are too few to read a daily rate of.
        expect(matched).toBe("Healthy");
      });

      test("an app with no session in the hour has no rate: healthy, not 0% nor an alert", async () => {
        const { response, matched } = await check(
          "rum-app-crash-rate",
          new ObjectID("7900000000000000000000b9"),
        );

        expect(response.sessionCount).toBe(0);
        expect(response.sessionsWithExceptionsPercent).toBeNull();
        expect(matched).toBe("Healthy");
      });
    });
  },
);

describe("Mobile crash rate and installs ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
