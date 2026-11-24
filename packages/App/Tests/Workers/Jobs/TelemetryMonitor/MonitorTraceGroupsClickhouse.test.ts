import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import TraceMonitorResponse from "Common/Types/Monitor/TraceMonitor/TraceMonitorResponse";
import TraceMonitorGroupResult from "Common/Types/Monitor/TraceMonitor/TraceMonitorGroupResult";
import { getRumAlertTemplateById } from "Common/Types/Monitor/RumAlertTemplates";
import Query from "Common/Types/BaseDatabase/Query";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import DataToProcess from "Common/Server/Utils/Monitor/DataToProcess";
import { FanOutEntity } from "Common/Server/Utils/Monitor/PerEntityCriteriaFanOut";
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
 * #9711 against a real ClickHouse server: a mobile app's Device Stopped
 * Reporting, a Traces monitor grouped by the install OpenTelemetry Android
 * names on its resource, one alert per install.
 *
 * monitorTrace, the function the telemetry worker calls, reads the window's
 * spans per install, and the installs that sent spans in the week before it
 * and none in it, counted as 0; the per-group criteria then pick the quiet
 * one out of the fleet. When the whole fleet went quiet, no install is
 * judged.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/MonitorTraceGroupsClickhouse.test.ts
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
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

import SpanService, {
  SpanAttributeGroup,
} from "Common/Server/Services/SpanService";
import SeriesContextEnricher from "Common/Server/Utils/Monitor/SeriesContextEnricher";
import MetricSeriesFingerprint from "Common/Utils/Metrics/MetricSeriesFingerprint";
import TraceMonitorCriteria from "Common/Server/Utils/Monitor/Criteria/TraceMonitorCriteria";
import TraceGroupCriteriaFanOut from "Common/Server/Utils/Monitor/TraceGroupCriteriaFanOut";
import { TraceGroupExpectedCache } from "Common/Server/Utils/Monitor/TraceGroupAbsence";
import { monitorTrace } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `trace_groups_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("7a00000000000000000000a1");

// A kiosk fleet, a fleet whose network went down, and another app.
const kioskAppId: ObjectID = new ObjectID("7a00000000000000000000b1");
const darkFleetId: ObjectID = new ObjectID("7a00000000000000000000b2");
const otherAppId: ObjectID = new ObjectID("7a00000000000000000000b3");

const INSTALL: string = "resource.app.installation.id";

const now: Date = new Date();

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

function hoursAgo(hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

interface SpanFixture {
  appId: ObjectID;
  // The install the span's resource names; '' for an SDK that names none.
  install: string;
  at: Date;
  // What else the span's resource says about its device (#9925).
  device?: JSONObject | undefined;
}

// What a kiosk's resource says about it: its name and model.
const LANE_1: JSONObject = {
  "resource.host.name": "Store 0412, lane 1",
  "resource.device.model.name": "Pixel Tablet",
};
const LANE_3: JSONObject = {
  "resource.host.name": "Store 0412, lane 3",
  "resource.device.model.name": "Pixel Tablet",
};

function spanRow(fixture: SpanFixture, index: number): JSONObject {
  const startNs: string = String(
    BigInt(fixture.at.getTime()) * BigInt(1000000),
  );
  const attributes: JSONObject = {
    "app.screen.name": "MenuActivity",
    ...(fixture.device || {}),
  };

  if (fixture.install) {
    attributes[INSTALL] = fixture.install;
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
    sessionId: "",
    parentSpanId: "",
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    entityKeys: [],
    statusCode: SpanStatus.Unset,
    name: "kiosk.heartbeat",
    kind: "SPAN_KIND_INTERNAL",
    isRootSpan: true,
    retentionDate,
  };
}

/*
 * The kiosk fleet: kiosk-a and kiosk-b report in the hour; kiosk-c sent
 * spans two days ago and none since; kiosk-d last reported ten days ago, past
 * the week a group is expected for; spans that name no install are no
 * install; and another app's kiosk-z is not this app's. The dark fleet's
 * three kiosks all reported yesterday and none in the hour.
 *
 * The fleet names its kiosks (#9925): kiosk-a is "lane 1"; kiosk-c was
 * renamed "lane 3" from "lane 9" before it went quiet, and its very last
 * span named no device; kiosk-b, an iPad, names only its model identifier.
 */
function spanFixtures(): Array<SpanFixture> {
  const spans: Array<SpanFixture> = [];
  const add: (
    appId: ObjectID,
    install: string,
    at: Date,
    count: number,
    device?: JSONObject,
  ) => void = (
    appId: ObjectID,
    install: string,
    at: Date,
    count: number,
    device?: JSONObject,
  ): void => {
    for (let index: number = 0; index < count; index++) {
      spans.push({
        appId,
        install,
        at: new Date(at.getTime() - index * 1000),
        device,
      });
    }
  };

  add(kioskAppId, "kiosk-a", hoursAgo(0.2), 12, LANE_1);
  add(kioskAppId, "kiosk-a", hoursAgo(30), 5, LANE_1);
  add(kioskAppId, "kiosk-b", hoursAgo(0.5), 3, {
    "resource.device.model.identifier": "iPad13,18",
  });
  add(kioskAppId, "kiosk-b", hoursAgo(72), 2);
  add(kioskAppId, "kiosk-c", hoursAgo(47.9), 1);
  add(kioskAppId, "kiosk-c", hoursAgo(48), 3, LANE_3);
  add(kioskAppId, "kiosk-c", hoursAgo(60), 2, {
    "resource.host.name": "Store 0412, lane 9",
  });
  add(kioskAppId, "kiosk-d", hoursAgo(240), 4);
  add(kioskAppId, "", hoursAgo(0.3), 6);
  add(kioskAppId, "", hoursAgo(50), 6);
  add(otherAppId, "kiosk-z", hoursAgo(26), 3);

  add(darkFleetId, "dark-1", hoursAgo(20), 2);
  add(darkFleetId, "dark-2", hoursAgo(21), 2);
  add(darkFleetId, "dark-3", hoursAgo(22), 2);

  return spans;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new Span();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Span as unknown as { new (): AnalyticsBaseModel },
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

function deviceStep(appId: ObjectID): MonitorStep {
  return getRumAlertTemplateById(
    "rum-device-stopped-reporting",
  )!.getMonitorStep({
    rumApplicationId: appId.toString(),
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Kiosk Ordering",
  });
}

function breachFilter(step: MonitorStep): CriteriaFilter {
  return step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!
    .data!.filters[0]!;
}

function installsOf(groups: Array<TraceMonitorGroupResult>): Array<string> {
  return groups.map((group: TraceMonitorGroupResult): string => {
    return String(group.labels[INSTALL]);
  });
}

integration(
  "A mobile fleet's Device Stopped Reporting against ClickHouse",
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
        database: SpanService.database,
        databaseClient: SpanService.databaseClient,
        ingestDatabase: SpanService.ingestDatabase,
        ingestDatabaseClient: SpanService.ingestDatabaseClient,
      };

      SpanService.database = clickhouse;
      SpanService.databaseClient = client;
      SpanService.ingestDatabase = clickhouse;
      SpanService.ingestDatabaseClient = client;

      await client.insert({
        table: `${database}.${new Span().tableName}`,
        values: spanFixtures().map(spanRow),
        format: "JSONEachRow",
      });
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(SpanService, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    beforeEach(() => {
      TraceGroupExpectedCache.clear();
    });

    describe("the grouped reads", () => {
      const appQuery: (appId: ObjectID, since: Date) => Query<Span> = (
        appId: ObjectID,
        since: Date,
      ): Query<Span> => {
        return {
          projectId: projectId,
          primaryEntityId: new Includes([appId]),
          startTime: new InBetween(since, now),
        } as Query<Span>;
      };

      test("count the hour's spans per install, the busiest first, with the total", async () => {
        const result: Awaited<
          ReturnType<typeof SpanService.countByAttributeGroups>
        > = await SpanService.countByAttributeGroups({
          query: appQuery(kioskAppId, hoursAgo(1)),
          groupByAttributes: [INSTALL],
          limit: 100,
          props: { isRoot: true },
        });

        expect(result.groups).toEqual([
          { values: ["kiosk-a"], count: 12 },
          { values: [""], count: 6 },
          { values: ["kiosk-b"], count: 3 },
        ]);
        expect(result.totalCount).toBe(21);
        expect(result.totalGroupCount).toBe(3);
      });

      test("find the week's installs, the most recently seen first, none without an install", async () => {
        const groups: Array<SpanAttributeGroup> =
          await SpanService.findRecentAttributeGroups({
            query: {
              projectId: projectId,
              primaryEntityId: new Includes([kioskAppId]),
            } as Query<Span>,
            groupByAttributes: [INSTALL],
            since: hoursAgo(24 * 7 + 1),
            until: hoursAgo(1),
            limit: 1000,
            props: { isRoot: true },
          });

        expect(groups).toEqual([
          { values: ["kiosk-a"] },
          { values: ["kiosk-c"] },
          { values: ["kiosk-b"] },
        ]);
      });

      test("with each install's last name and model, the latest span that sent one winning (#9925)", async () => {
        const groups: Array<SpanAttributeGroup> =
          await SpanService.findRecentAttributeGroups({
            query: {
              projectId: projectId,
              primaryEntityId: new Includes([kioskAppId]),
            } as Query<Span>,
            groupByAttributes: [INSTALL],
            since: hoursAgo(24 * 7 + 1),
            until: hoursAgo(1),
            limit: 1000,
            props: { isRoot: true },
            contextAttributes: [
              "resource.host.name",
              "resource.device.model.name",
              "resource.device.model.identifier",
            ],
          });

        expect(groups).toEqual([
          { values: ["kiosk-a"], lastValues: LANE_1 },
          /*
           * Renamed from lane 9 to lane 3; its very last span named no
           * device, and does not blank what the one before it said.
           */
          { values: ["kiosk-c"], lastValues: LANE_3 },
          // Its week's spans before the hour named no device at all.
          { values: ["kiosk-b"] },
        ]);
      });

      test("the hour's count reads the same, beside each group", async () => {
        const result: Awaited<
          ReturnType<typeof SpanService.countByAttributeGroups>
        > = await SpanService.countByAttributeGroups({
          query: appQuery(kioskAppId, hoursAgo(1)),
          groupByAttributes: [INSTALL],
          limit: 100,
          props: { isRoot: true },
          contextAttributes: [
            "resource.host.name",
            "resource.device.model.name",
            "resource.device.model.identifier",
          ],
        });

        expect(result.groups).toEqual([
          { values: ["kiosk-a"], count: 12, lastValues: LANE_1 },
          { values: [""], count: 6 },
          {
            values: ["kiosk-b"],
            count: 3,
            lastValues: { "resource.device.model.identifier": "iPad13,18" },
          },
        ]);
        expect(result.totalCount).toBe(21);
      });
    });

    describe("monitorTrace on Device Stopped Reporting's step", () => {
      test("names the install that went quiet first, counted as 0, beside the ones that report", async () => {
        const response: TraceMonitorResponse = await monitorTrace({
          monitorStep: deviceStep(kioskAppId),
          monitorId: ObjectID.generate(),
          projectId: projectId,
          evaluateUntil: now,
        });

        expect(response.groupByAttributes).toEqual([INSTALL]);
        expect(response.spanCount).toBe(21);
        expect(installsOf(response.groupBreakdown!)).toEqual([
          "kiosk-c",
          "kiosk-a",
          "",
          "kiosk-b",
        ]);
        expect(response.groupBreakdown![0]).toMatchObject({
          spanCount: 0,
          isQuiet: true,
        });
        /*
         * #9925: the quiet kiosk is named by what its last spans said, the
         * ones that report by what the hour's spans said - display only:
         * its fingerprint is its install's alone.
         */
        expect(response.groupBreakdown![0]!.context).toEqual({
          "device.name": "Store 0412, lane 3",
          "device.model.name": "Pixel Tablet",
        });
        expect(response.groupBreakdown![0]!.fingerprint).toBe(
          MetricSeriesFingerprint.computeFingerprint({ [INSTALL]: "kiosk-c" }),
        );
        expect(response.groupBreakdown![1]!.context).toEqual({
          "device.name": "Store 0412, lane 1",
          "device.model.name": "Pixel Tablet",
        });
        expect(response.groupBreakdown![2]!.context).toBeUndefined();
        expect(response.groupBreakdown![3]!.context).toEqual({
          "device.model.name": "iPad13,18",
        });
        // kiosk-d aged out: ten days quiet is past the week a group is expected for.
        expect(installsOf(response.groupBreakdown!)).not.toContain("kiosk-d");
        // Another app's kiosk is not this app's.
        expect(installsOf(response.groupBreakdown!)).not.toContain("kiosk-z");
        expect(response.isQuietWindow).toBeUndefined();
      });

      test("one alert, for the quiet install alone", async () => {
        const step: MonitorStep = deviceStep(kioskAppId);
        const response: TraceMonitorResponse = await monitorTrace({
          monitorStep: step,
          monitorId: ObjectID.generate(),
          projectId: projectId,
          evaluateUntil: now,
        });

        // The monitor as a whole: one install is quiet.
        expect(
          await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
            dataToProcess: response as unknown as DataToProcess,
            criteriaFilter: breachFilter(step),
          }),
        ).toContain("kiosk-c");

        // Each install on its own: only kiosk-c breaches.
        const breaching: Array<string> = [];

        for (const entity of TraceGroupCriteriaFanOut.getGroupEntities({
          dataToProcess: response as unknown as DataToProcess,
        }) as Array<FanOutEntity>) {
          if (
            await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
              dataToProcess: entity.dataToProcess!,
              criteriaFilter: breachFilter(step),
            })
          ) {
            breaching.push(String(entity.labels[INSTALL]));
          }
        }

        expect(breaching).toEqual(["kiosk-c"]);
      });

      test("the quiet kiosk's alert reads its name, and dedupes on its install", async () => {
        const step: MonitorStep = deviceStep(kioskAppId);
        const response: TraceMonitorResponse = await monitorTrace({
          monitorStep: step,
          monitorId: ObjectID.generate(),
          projectId: projectId,
          evaluateUntil: now,
        });

        const quiet: FanOutEntity = (
          TraceGroupCriteriaFanOut.getGroupEntities({
            dataToProcess: response as unknown as DataToProcess,
          }) as Array<FanOutEntity>
        ).find((entity: FanOutEntity): boolean => {
          return entity.labels[INSTALL] === "kiosk-c";
        })!;

        expect(quiet.labels).toEqual({ [INSTALL]: "kiosk-c" });
        expect(
          SeriesContextEnricher.enrichTitle({
            title: "[RUM] Device stopped reporting - Kiosk Ordering",
            seriesLabels: quiet.labels,
            seriesContext: quiet.context,
          }),
        ).toBe(
          "[RUM] Device stopped reporting - Kiosk Ordering - Device: Store 0412, lane 3 | Install: kiosk-c | Model: Pixel Tablet",
        );
      });

      test("a fleet that went quiet at once judges no install, and says so", async () => {
        const step: MonitorStep = deviceStep(darkFleetId);
        const response: TraceMonitorResponse = await monitorTrace({
          monitorStep: step,
          monitorId: ObjectID.generate(),
          projectId: projectId,
          evaluateUntil: now,
        });

        expect(response.spanCount).toBe(0);
        expect(response.isQuietWindow).toBe(true);
        expect(response.groupBreakdown).toEqual([]);
        expect(response.totalGroupCount).toBe(3);
        expect(
          await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
            dataToProcess: response as unknown as DataToProcess,
            criteriaFilter: breachFilter(step),
          }),
        ).toBeNull();
      });

      test("an ungrouped monitor of the same app counts as it always did", async () => {
        const step: MonitorStep = deviceStep(kioskAppId);
        step.setTraceMonitor({
          ...step.data!.traceMonitor!,
          groupByAttributes: [],
        });

        const response: TraceMonitorResponse = await monitorTrace({
          monitorStep: step,
          monitorId: ObjectID.generate(),
          projectId: projectId,
          evaluateUntil: now,
        });

        expect(response.spanCount).toBe(21);
        expect(response.groupBreakdown).toBeUndefined();
      });
    });
  },
);

describe("Trace groups ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
