import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import Service from "../../../../../Models/DatabaseModels/Service";
import AnalyticsDatabaseService, {
  Results,
} from "../../../../../Server/Services/AnalyticsDatabaseService";
import RumApplicationService from "../../../../../Server/Services/RumApplicationService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import {
  ClickhousePassword,
  ClickhouseUsername,
} from "../../../../../Server/EnvironmentConfig";
import { getClickhouseDatabaseName } from "../../../../../Server/Utils/AnalyticsDatabase/ClusterConfig";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ContentScanOptions,
  LocationFindings,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  scanProjectTelemetry,
  TelemetryStoreScan,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import {
  findTelemetryFindingOccurrences,
  OccurrencePlan,
  planOccurrenceRead,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryFindingOccurrences";
import LlmConversationPrivacy from "../../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import logger from "../../../../../Server/Utils/Logger";
import {
  DataSecurityFindingOccurrence,
  DataSecurityFindingOccurrences,
  DataSecurityOccurrencesSource,
} from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { FindingSampleRecord } from "../../../../../Types/DataSecurity/FindingSampleRecord";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A LOG FINDING'S LINES, BY THEIR OWN IDS, IN A REAL CLICKHOUSE (#9793).
 *
 * The unit tests hold the statements to their shape; this runs them on a
 * table keyed as the product's LogItemV3 is (projectId, time,
 * primaryEntityId), with a request that wrote several lines in one
 * millisecond - one of them with a user's email in it:
 *
 *  - the scan keeps each line it found the email in with its own id (the
 *    row's _id), which the logs explorer opens that very line by;
 *  - those kept lines are read back as exactly themselves: the line with
 *    the email, never a neighbour of the same millisecond and request;
 *  - a finding from before lines kept their ids is found by the narrowed
 *    search, and its lines name their ids too.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -p 127.0.0.1:8193:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 * then TEST_CLICKHOUSE_URL=http://localhost:8193 CLICKHOUSE_PASSWORD=test npx jest <this file>.
 * The suite creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `telemetry_log_lines_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d9793",
);
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000000d9701";
const TRACE: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN: string = "00f067aa0ba902b7";

// The request's lines, all written in one millisecond: one holds an email.
const LEAKING_LINE: string = "0192f1a0-0000-7000-8000-00000009793a";
const NEIGHBOUR_LINES: Array<string> = [
  "0192f1a0-0000-7000-8000-00000009793b",
  "0192f1a0-0000-7000-8000-00000009793c",
  "0192f1a0-0000-7000-8000-00000009793d",
];
// A line outside any request, a minute earlier, with another email.
const LONE_LINE: string = "0192f1a0-0000-7000-8000-00000009793e";

let client: ClickHouseClient;

function inDatabase(query: string): string {
  return query.split(`${getClickhouseDatabaseName()}.`).join(`${database}.`);
}

async function rowsOf(statement: Statement): Promise<Array<JSONObject>> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: inDatabase(statement.query),
    query_params: statement.query_params,
    format: "JSON",
  });

  return ((await result.json()) as { data: Array<JSONObject> }).data;
}

function options(): ContentScanOptions {
  return {
    limits: {
      maxObjects: 2000,
      maxBytesPerObject: 65536,
      maxBytesTotal: 52428800,
      maxRowsPerTable: 1000,
      maxTables: 200,
      deadline: new Date(Date.now() + 60 * 60 * 1000),
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test-key",
  };
}

const LINE_COLUMNS: string =
  "projectId, primaryEntityId, primaryEntityType, time, severityText, body, attributes, traceId, spanId, retentionDate, _id, createdAt";

integration(
  "a log finding's lines, by their own ids, in a real ClickHouse",
  () => {
    // The request's millisecond: a minute ago, so the scan's hour holds it.
    const requestTime: Date = new Date(
      Math.floor(Date.now() / 1000) * 1000 - 60_000 + 123,
    );
    const loneTime: Date = new Date(requestTime.getTime() - 60_000);

    beforeAll(async (): Promise<void> => {
      // The real ClickHouse HTTP client needs Node timers with unref().
      jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
      jest
        .spyOn(globalThis, "clearTimeout")
        .mockImplementation(nodeClearTimeout);

      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "This integration suite requires a local ClickHouse server.",
        );
      }

      client = createClient({
        url: endpoint!,
        username: ClickhouseUsername,
        password: ClickhousePassword,
        request_timeout: 120000,
      });

      const at: (time: Date) => string = (time: Date): string => {
        return `toDateTime64('${time.toISOString().replace("T", " ").replace("Z", "")}', 9, 'UTC')`;
      };
      const line: (data: {
        id: string;
        time: Date;
        body: string;
        traceId: string | null;
        spanId: string | null;
      }) => string = (data: {
        id: string;
        time: Date;
        body: string;
        traceId: string | null;
        spanId: string | null;
      }): string => {
        const traceId: string = data.traceId ? `'${data.traceId}'` : "NULL";
        const spanId: string = data.spanId ? `'${data.spanId}'` : "NULL";

        return `('${PROJECT_ID.toString()}', '${CHECKOUT}', 'OpenTelemetry', ${at(data.time)}, 'Info', '${data.body}', map('http.method', 'POST'), ${traceId}, ${spanId}, now() + toIntervalDay(15), '${data.id}', now())`;
      };

      for (const query of [
        `CREATE DATABASE ${database}`,
        `CREATE TABLE ${database}.LogItemV3 (projectId String, primaryEntityId String, primaryEntityType LowCardinality(Nullable(String)), time DateTime64(9) CODEC(DoubleDelta, ZSTD(1)), severityText LowCardinality(String), body String CODEC(ZSTD(3)), attributes Map(String, String) CODEC(ZSTD(3)), traceId Nullable(String), spanId Nullable(String), retentionDate DateTime, _id String CODEC(ZSTD(1)), createdAt DateTime) ENGINE = MergeTree PARTITION BY toYYYYMMDD(time) PRIMARY KEY (projectId, time, primaryEntityId) ORDER BY (projectId, time, primaryEntityId)`,
        `INSERT INTO ${database}.LogItemV3 (${LINE_COLUMNS}) VALUES ${[
          line({
            id: NEIGHBOUR_LINES[0]!,
            time: requestTime,
            body: "Handling POST /signup",
            traceId: TRACE,
            spanId: SPAN,
          }),
          line({
            id: LEAKING_LINE,
            time: requestTime,
            body: "Signed up jane.doe@acmecorp.io from the mobile app",
            traceId: TRACE,
            spanId: SPAN,
          }),
          line({
            id: NEIGHBOUR_LINES[1]!,
            time: requestTime,
            body: "Sent the welcome email",
            traceId: TRACE,
            spanId: SPAN,
          }),
          line({
            id: NEIGHBOUR_LINES[2]!,
            time: requestTime,
            body: "Answered 201",
            traceId: TRACE,
            spanId: SPAN,
          }),
          line({
            id: LONE_LINE,
            time: loneTime,
            body: "Nightly export mailed kai.wu@acmecorp.io",
            traceId: null,
            spanId: null,
          }),
        ].join(", ")}`,
      ]) {
        await client.command({ query });
      }

      // Every read the scan and the lookup make, against this database.
      jest
        .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
        .mockImplementation((async (statement: Statement): Promise<Results> => {
          const data: Array<JSONObject> = await rowsOf(statement);

          return {
            json: (): Promise<unknown> => {
              return Promise.resolve({ data });
            },
          } as unknown as Results;
        }) as never);
      jest
        .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
        .mockResolvedValue([]);

      const checkout: Service = new Service();
      checkout._id = CHECKOUT;
      checkout.name = "checkout";

      jest
        .spyOn(ServiceService, "findBy")
        .mockResolvedValue([checkout] as never);
      jest
        .spyOn(RumApplicationService, "findBy")
        .mockResolvedValue([] as never);
      // The other signals' tables are not here: their reads fail, and are logged.
      jest.spyOn(logger, "warn").mockImplementation((): void => {});
    });

    afterAll(async (): Promise<void> => {
      if (client) {
        try {
          await client.command({
            query: `DROP DATABASE IF EXISTS ${database}`,
          });
        } finally {
          await client.close();
        }
      }

      jest.restoreAllMocks();
    });

    async function occurrencesOf(
      records: Array<FindingSampleRecord>,
    ): Promise<DataSecurityFindingOccurrences> {
      const plan: OccurrencePlan = planOccurrenceRead(
        DataStoreKind.TelemetryLogs,
        "body",
      )!;

      return await findTelemetryFindingOccurrences({
        projectId: PROJECT_ID,
        plan,
        ownerId: CHECKOUT,
        location: "body",
        dataTypeId: "email-address",
        options: options(),
        sampleRecords: records,
        lastSeenAt: new Date(),
      });
    }

    test("the scan keeps each line it found the data in with its own id, and the lookup reads exactly those lines", async () => {
      const scans: Array<TelemetryStoreScan> = await scanProjectTelemetry({
        projectId: PROJECT_ID,
        sampleSize: 500,
        since: new Date(Date.now() - 60 * 60 * 1000),
        options: options(),
      });
      const logs: TelemetryStoreScan = scans.find(
        (scan: TelemetryStoreScan): boolean => {
          return (
            scan.kind === DataStoreKind.TelemetryLogs &&
            scan.serviceId === CHECKOUT
          );
        },
      )!;
      const body: LocationFindings = logs.result.locations.find(
        (entry: LocationFindings): boolean => {
          return entry.location === "body";
        },
      )!;
      const kept: Array<FindingSampleRecord> =
        body.sampleRecords?.["email-address"] || [];

      // Each line it was found in, by its own id: the request's, then the lone one.
      expect(
        kept.map((record: FindingSampleRecord): string => {
          return record.logId || "";
        }),
      ).toEqual([LEAKING_LINE, LONE_LINE]);
      expect(kept[0]).toEqual({
        time: requestTime.toISOString(),
        traceId: TRACE,
        spanId: SPAN,
        logId: LEAKING_LINE,
      });

      const found: DataSecurityFindingOccurrences = await occurrencesOf(kept);

      expect(found.source).toBe(DataSecurityOccurrencesSource.SampledRecords);
      // Exactly the two lines: none of the three that share the request's millisecond.
      expect(
        found.occurrences.map(
          (occurrence: DataSecurityFindingOccurrence): string => {
            return occurrence.logId || "";
          },
        ),
      ).toEqual([LEAKING_LINE, LONE_LINE]);
      expect(found.recordsRead).toBe(2);
      expect(found.occurrences[0]?.traceId).toBe(TRACE);
      expect(found.occurrences[0]?.maskedValue).not.toContain("jane.doe");
    });

    test("a line kept before lines kept ids is read by its millisecond, and still names its id", async () => {
      const found: DataSecurityFindingOccurrences = await occurrencesOf([
        { time: requestTime.toISOString(), traceId: TRACE, spanId: SPAN },
      ]);

      // Its millisecond holds four lines; the one that carries the email is shown.
      expect(found.recordsRead).toBe(4);
      expect(
        found.occurrences.map(
          (occurrence: DataSecurityFindingOccurrence): string => {
            return occurrence.logId || "";
          },
        ),
      ).toEqual([LEAKING_LINE]);
    });

    test("a finding from before records were kept is found by the narrowed search, its lines named by their ids", async () => {
      const found: DataSecurityFindingOccurrences = await occurrencesOf([]);

      expect(found.source).toBe(DataSecurityOccurrencesSource.SampleWindow);
      expect(
        found.occurrences
          .map((occurrence: DataSecurityFindingOccurrence): string => {
            return occurrence.logId || "";
          })
          .sort(),
      ).toEqual([LEAKING_LINE, LONE_LINE].sort());
    });
  },
);
