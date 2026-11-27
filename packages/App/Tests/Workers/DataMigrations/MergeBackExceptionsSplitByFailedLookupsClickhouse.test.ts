import {
  OCCURRENCES_READ,
  readOccurrenceTextsFromClickhouse,
} from "../../../FeatureSet/Workers/DataMigrations/MergeBackExceptionsSplitByFailedLookups";
import { ExceptionGroupingContent } from "../../../FeatureSet/Telemetry/Utils/Exception";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The occurrences a duplicate a failed lookup made still has, read against
 * a real ClickHouse server (#11113).
 *
 * MergeBackExceptionsSplitByFailedLookups merges a duplicate back only when
 * every occurrence ClickHouse still keeps leads to the exception its stored
 * text does. Its unit suite stands that read in; this one runs it, under
 * both analyzers:
 *
 *   - the duplicate's own occurrences alone: its project, its service, its
 *     fingerprint, in its window, kept (retentionDate) and originals only
 *     (a crash another reporter repeated is counted nowhere);
 *   - the earliest OCCURRENCES_READ and the latest OCCURRENCES_READ, each
 *     in time order, however many it has;
 *   - each text as it was stored, an empty one as empty;
 *   - the time limit the read sends is one the server takes;
 *   - a table that is not there fails the read (the sweep leaves the pair).
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18126:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18126 \
 *     npx jest Tests/Workers/DataMigrations/MergeBackExceptionsSplitByFailedLookupsClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
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

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `merge_back_splits_test_${process.pid}_${Date.now()}`;

const PROJECT: string = "11113000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT: string = "11113000-0000-4000-8000-0000000000a2";
const SERVICE: string = "11113000-0000-4000-8000-0000000000b1";
const OTHER_SERVICE: string = "11113000-0000-4000-8000-0000000000b2";
const DUPLICATE: string = "f".repeat(64);
const OTHER_FINGERPRINT: string = "e".repeat(64);

const MINUTE: number = 60 * 1000;
// The duplicate's window: an hour, a fortnight ago.
const FROM: Date = new Date(Date.now() - 14 * 24 * 60 * MINUTE);
const TO: Date = new Date(FROM.getTime() + 60 * MINUTE);

interface Fixture {
  // Minutes after the window opens; negative, or past 60, is outside it.
  at: number;
  message: string;
  projectId?: string;
  serviceId?: string;
  fingerprint?: string;
  duplicateOf?: string;
  expired?: boolean;
  stackTrace?: string;
  exceptionType?: string;
}

function rowOf(fixture: Fixture): JSONObject {
  const time: Date = new Date(FROM.getTime() + fixture.at * MINUTE);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: fixture.projectId || PROJECT,
    primaryEntityId: fixture.serviceId || SERVICE,
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000),
    exceptionType: fixture.exceptionType ?? "TypeError",
    stackTrace:
      fixture.stackTrace ?? "TypeError: x\n    at load (/app/a.js:1:1)",
    message: fixture.message,
    spanStatusCode: 2,
    escaped: false,
    traceId: "",
    spanId: "",
    fingerprint: fixture.fingerprint || DUPLICATE,
    spanName: "",
    release: "",
    environment: "",
    parsedFrames: "",
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    duplicateOf: fixture.duplicateOf || "",
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), fixture.expired ? -2 : 30),
    ).substring(0, 10),
  };
}

// The duplicate's own: 250 kept originals in its window, twelve seconds apart.
const OWN: Array<Fixture> = Array.from(
  { length: 250 },
  (_value: unknown, index: number): Fixture => {
    return { at: index * 0.2, message: `own ${index}` };
  },
);

const STRAYS: Array<Fixture> = [
  { at: 5, message: "another project's", projectId: OTHER_PROJECT },
  { at: 5, message: "another service's", serviceId: OTHER_SERVICE },
  { at: 5, message: "another exception's", fingerprint: OTHER_FINGERPRINT },
  { at: -5, message: "before its window" },
  { at: 65, message: "after its window" },
  { at: 5, message: "a repeat", duplicateOf: ObjectID.generate().toString() },
  { at: 5, message: "past its retention", expired: true },
];

function messages(texts: Array<ExceptionGroupingContent>): Array<string> {
  return texts.map((text: ExceptionGroupingContent): string => {
    return text.message;
  });
}

interface Connection {
  database: ClickhouseDatabase;
  client: ClickhouseClient;
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

integration(
  "the occurrences a duplicate a failed lookup made still has, against ClickHouse",
  () => {
    const connections: Array<Connection> = [];
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

      const setup: ClickhouseDatabase = new ClickhouseDatabase({
        ...options,
        database: "default",
      });
      const setupClient: ClickhouseClient = await setup.connect({
        ...options,
        database: "default",
      });
      await setupClient.command({
        query: `CREATE DATABASE IF NOT EXISTS ${database}`,
      });
      await setup.disconnect();

      const clickhouse: ClickhouseDatabase = new ClickhouseDatabase(options);
      const client: ClickhouseClient = await clickhouse.connect(options);

      connections.push({ database: clickhouse, client });

      // The older analyzer, by whichever name this server gives its setting.
      const settings: { json: () => Promise<{ data?: Array<JSONObject> }> } =
        (await client.query({
          query:
            "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
          format: "JSON",
        })) as unknown as {
          json: () => Promise<{ data?: Array<JSONObject> }>;
        };
      const setting: string = String(
        (await settings.json()).data?.[0]?.["name"] || "enable_analyzer",
      );

      const olderOptions: ClickHouseClientConfigOptions = {
        ...options,
        clickhouse_settings: { [setting]: 0 } as ClickHouseSettings,
      };
      const older: ClickhouseDatabase = new ClickhouseDatabase(olderOptions);

      connections.push({
        database: older,
        client: await older.connect(olderOptions),
      });

      const model: AnalyticsBaseModel = new ExceptionInstance();
      const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
        modelType: ExceptionInstance as unknown as {
          new (): AnalyticsBaseModel;
        },
        database: clickhouse,
      }).toColumnsCreateStatement(model.tableColumns);

      await client.command({
        query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
        query_params: columns.query_params,
      });

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
        [
          ...OWN,
          ...STRAYS,
          // Texts as they were stored: an empty stack trace and type stay empty.
          {
            at: 59,
            message: "stored as it came",
            stackTrace: "",
            exceptionType: "",
          },
        ].map(rowOf),
        { clickhouseSettings: { wait_for_async_insert: 1 } },
      );
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(ExceptionInstanceService, original);
      }

      if (connections[0]) {
        await connections[0].client.command({
          query: `DROP DATABASE IF EXISTS ${database}`,
        });
      }

      for (const connection of connections) {
        await connection.database.disconnect();
      }
    });

    async function read(
      data?: Partial<{
        projectId: string;
        primaryEntityId: string;
        fingerprint: string;
        from: Date;
        to: Date;
        limit: number;
      }>,
    ): Promise<Array<ExceptionGroupingContent>> {
      return readOccurrenceTextsFromClickhouse({
        projectId: PROJECT,
        primaryEntityId: SERVICE,
        fingerprint: DUPLICATE,
        from: FROM,
        to: TO,
        limit: OCCURRENCES_READ,
        ...(data || {}),
      });
    }

    describe.each([
      ["the current analyzer", 0],
      ["the older analyzer (enable_analyzer = 0)", 1],
    ])("through %s", (_name: string, position: number) => {
      beforeAll((): void => {
        const connection: Connection = connections[position]!;

        ExceptionInstanceService.database = connection.database;
        ExceptionInstanceService.databaseClient = connection.client;
      });

      test("the earliest and the latest of its own, each in time order, and nothing of another's", async () => {
        const texts: Array<ExceptionGroupingContent> = await read();
        const found: Array<string> = messages(texts);

        expect(found).toHaveLength(2 * OCCURRENCES_READ);
        // The earliest, oldest first.
        expect(found.slice(0, OCCURRENCES_READ)).toEqual(
          OWN.slice(0, OCCURRENCES_READ).map((fixture: Fixture): string => {
            return fixture.message;
          }),
        );
        // The latest, newest first: the one stored as it came, then its own.
        expect(found.slice(OCCURRENCES_READ, OCCURRENCES_READ + 2)).toEqual([
          "stored as it came",
          "own 249",
        ]);

        for (const stray of STRAYS) {
          expect(found).not.toContain(stray.message);
        }
      });

      test("fewer than the limit of its own: each once from each end", async () => {
        const texts: Array<ExceptionGroupingContent> = await read({
          to: new Date(FROM.getTime() + 0.5 * MINUTE),
        });

        // 0, 0.2, 0.4 minutes in.
        expect(messages(texts)).toEqual([
          "own 0",
          "own 1",
          "own 2",
          "own 2",
          "own 1",
          "own 0",
        ]);
      });

      test("a text as it was stored, an empty one empty", async () => {
        const texts: Array<ExceptionGroupingContent> = await read({
          from: new Date(FROM.getTime() + 58 * MINUTE),
        });

        expect(texts[0]).toEqual({
          message: "stored as it came",
          stackTrace: "",
          exceptionType: "",
        });
        expect(texts[texts.length - 1]).toEqual({
          message: "stored as it came",
          stackTrace: "",
          exceptionType: "",
        });
      });

      test("another project's, service's or exception's occurrences are theirs", async () => {
        expect(messages(await read({ projectId: OTHER_PROJECT }))).toEqual([
          "another project's",
          "another project's",
        ]);
        expect(
          messages(await read({ primaryEntityId: OTHER_SERVICE })),
        ).toEqual(["another service's", "another service's"]);
        expect(
          messages(await read({ fingerprint: OTHER_FINGERPRINT })),
        ).toEqual(["another exception's", "another exception's"]);
      });

      test("none in its window: nothing", async () => {
        expect(
          await read({
            from: new Date(FROM.getTime() - 30 * MINUTE),
            to: new Date(FROM.getTime() - 20 * MINUTE),
          }),
        ).toEqual([]);
      });
    });

    test("a table that is not there fails the read", async () => {
      const connection: Connection = connections[0]!;

      ExceptionInstanceService.database = connection.database;
      ExceptionInstanceService.databaseClient = connection.client;

      await connection.client.command({
        query: `DROP TABLE ${database}.${new ExceptionInstance().tableName}`,
      });

      await expect(read()).rejects.toThrow();
    });
  },
);

describe("The occurrences of a duplicate: ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
