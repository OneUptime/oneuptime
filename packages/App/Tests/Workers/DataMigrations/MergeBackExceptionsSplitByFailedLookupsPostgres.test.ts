import MergeBackExceptionsSplitByFailedLookups, {
  MERGE_BACK_SPLITS_MIGRATION_NAME,
  getDefaultMergeBackSplitsEnvironment,
  MergeBackSplitsEnvironment,
  MergeBackSplitsResult,
  SWEPT_MARKER_NAME,
  SweepProgress,
} from "../../../FeatureSet/Workers/DataMigrations/MergeBackExceptionsSplitByFailedLookups";
import ExceptionUtil, {
  ExceptionGroupingContent,
  OccurrenceFingerprints,
  TelemetryExceptionPayload,
  clearExistingV1FingerprintCache,
} from "../../../FeatureSet/Telemetry/Utils/Exception";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Entities from "Common/Models/DatabaseModels/Index";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import { TelemetryExceptionActivityType } from "Common/Models/DatabaseModels/TelemetryExceptionActivity";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import AuditLogService from "Common/Server/Services/AuditLogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "Common/Server/Utils/Logger";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { DataSource } from "Common/node_modules/typeorm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE LEFTOVER DUPLICATES OF #11113, ON A MIGRATED POSTGRES - AND THEIR
 * OCCURRENCES ON A REAL CLICKHOUSE WHEN ONE IS AT HAND.
 *
 * Until #11027 an occurrence whose project's exceptions could not be read
 * was filed under its grouping v1 fingerprint, and for an exception made
 * since grouping v2 that made a duplicate. #11089 merges one back on its
 * next occurrence; one whose error never happens again stayed: two rows in
 * the exceptions list, the total split across them. Here:
 *
 *   - the old code's leftovers, shown: the exception made by today's ingest
 *     through its real upsert, and the duplicate filed the way the code
 *     before #11027 filed an occurrence whose lookup failed - its
 *     resolveGroupFingerprints took `!candidate.v2 ||
 *     failedProjects.has(candidate.projectId)` together and kept the
 *     occurrence's `fingerprint`, its v1, which today's upsert still does
 *     for an occurrence that names no fingerprintV2. Two rows the list
 *     reads, and nothing today merges them while their error stays quiet;
 *   - MergeBackExceptionsSplitByFailedLookups, through its real statements
 *     (the page, ingest's lookup, the DataMigrations marker), the real heal
 *     and the real merge: a provable duplicate is merged back, with every
 *     count, its first and last seen, the survivor's state, assignment and
 *     history, both timelines and its audit entry;
 *   - lookalikes it cannot prove are left as two: a duplicate whose stored
 *     text a scrub rule changed, one filed under the keyed fingerprint a
 *     rule's text opens, one made before the other, one a person merged
 *     elsewhere or took out of a merge, the same error in another service,
 *     and two errors grouping v1 could not tell apart;
 *   - a second run changes nothing, not even a version or an updatedAt;
 *   - a table of many exceptions, read a few pages a run, finishes across
 *     runs, every duplicate merged exactly once.
 *
 * Opt in with RUN_POSTGRES_EXCEPTION_MERGE_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The migrated TelemetryException,
 * TelemetryExceptionActivity and DataMigrations tables' STRUCTURE is cloned
 * into a unique schema (search_path holds it first), dropped afterwards;
 * every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from EXCEPTION_MERGE_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from EXCEPTION_MERGE_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 *
 * With TEST_CLICKHOUSE_URL set too (a local, disposable server), every
 * occurrence is written to a real ExceptionInstance table of a database of
 * its own, and the sweep reads them there; without it, they are read from
 * the suite's own record of them, as the read's statement would.
 * MergeBackExceptionsSplitByFailedLookupsClickhouse runs that statement
 * under both analyzers.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_EXCEPTION_MERGE_TESTS"] === "true"
    ? describe
    : describe.skip;

const clickhouseEndpoint: string | undefined =
  process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(300000);

const DAY: number = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY);
}

function letters(index: number): string {
  let name: string = "";
  let left: number = index;

  do {
    name = String.fromCharCode(97 + (left % 26)) + name;
    left = Math.floor(left / 26);
  } while (left > 0);

  return name;
}

// An exception grouped by its frames.
function framesText(name: string): ExceptionGroupingContent {
  return {
    exceptionType: "TypeError",
    message: `Cannot read properties of undefined (reading '${name}')`,
    stackTrace: `TypeError: Cannot read properties of undefined (reading '${name}')\n    at load${name} (/app/src/${name}.js:10:5)\n    at main (/app/src/index.js:3:1)`,
  };
}

/*
 * The same code reached through a library frame: grouping v2 reads the
 * in-app frames alone and makes it the same exception, while v1 reads every
 * frame and makes it another (v1 folds line numbers, so another line would
 * not do).
 */
function throughALibrary(
  text: ExceptionGroupingContent,
): ExceptionGroupingContent {
  return {
    ...text,
    stackTrace: `${text.stackTrace}\n    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)`,
  };
}

// An exception grouped by its message, whose v2, v3 and v4 all differ.
function messageText(name: string): ExceptionGroupingContent {
  return {
    exceptionType: "PaymentError",
    message: `Payment ${name} declined for card 4111 1111 1111 1111, call +44 20 7946 0958`,
    stackTrace: "",
  };
}

// Two errors grouping v1 cannot tell apart: it runs message and type together.
const ONE_FOR_V1: ExceptionGroupingContent = {
  exceptionType: "Error",
  message: "PaymentGateway",
  stackTrace: "",
};
const OTHER_FOR_V1: ExceptionGroupingContent = {
  exceptionType: "GatewayError",
  message: "Payment",
  stackTrace: "",
};

interface StoredException {
  _id: string;
  fingerprint: string;
  occuranceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  isResolved: boolean;
  isArchived: boolean;
  assignToUserId: string | null;
  mergedIntoTelemetryExceptionId: string | null;
  mergedByUserId: string | null;
  mergedAt: Date | null;
  version: number;
  updatedAt: Date;
  primaryEntityId: string;
}

interface Occurrence {
  projectId: string;
  serviceId: string;
  fingerprint: string;
  text: ExceptionGroupingContent;
  at: Date;
}

describePostgres(
  "the duplicates a failed lookup made before #11027, merged back (Postgres)",
  () => {
    const schema: string = `exception_split_heal_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const clickhouseDatabase: string = `exception_split_heal_${process.pid}_${Date.now()}`;
    const projectId: ObjectID = ObjectID.generate();
    const serviceId: ObjectID = ObjectID.generate();
    const otherServiceId: ObjectID = ObjectID.generate();
    const personId: ObjectID = ObjectID.generate();

    let database: DataSource;
    let clickhouse: ClickhouseDatabase | null = null;
    let clickhouseClient: ClickhouseClient | null = null;
    let originalClickhouse: Partial<typeof ExceptionInstanceService> | null =
      null;

    // What ClickHouse keeps, or the suite's record of it.
    let occurrences: Array<Occurrence> = [];
    let unwritten: Array<Occurrence> = [];
    // Where the sweep is: Valkey's stand-in.
    let progress: SweepProgress | null = null;
    let auditEntries: Array<JSONObject> = [];

    function fingerprintsOf(
      text: ExceptionGroupingContent,
      data?: { service?: ObjectID; stored?: ExceptionGroupingContent },
    ): OccurrenceFingerprints {
      return ExceptionUtil.getOccurrenceFingerprints({
        projectId,
        primaryEntityId: data?.service || serviceId,
        arrived: text,
        stored: data?.stored || text,
      });
    }

    function payloadOf(
      text: ExceptionGroupingContent,
      at: Date,
      data?: { service?: ObjectID; stored?: ExceptionGroupingContent },
    ): TelemetryExceptionPayload {
      const stored: ExceptionGroupingContent = data?.stored || text;

      // As ingest builds one: a part it does not have is left out.
      return {
        fingerprint: "",
        projectId,
        primaryEntityId: data?.service || serviceId,
        primaryEntityType: ServiceType.OpenTelemetry,
        ...(stored.exceptionType
          ? { exceptionType: stored.exceptionType }
          : {}),
        ...(stored.message ? { message: stored.message } : {}),
        ...(stored.stackTrace ? { stackTrace: stored.stackTrace } : {}),
        occurredAt: at,
      };
    }

    function occur(
      text: ExceptionGroupingContent,
      fingerprint: string,
      at: Date,
      service: ObjectID = serviceId,
    ): void {
      const occurrence: Occurrence = {
        projectId: projectId.toString(),
        serviceId: service.toString(),
        fingerprint,
        text,
        at,
      };

      occurrences.push(occurrence);
      unwritten.push(occurrence);
    }

    /*
     * An occurrence as today's ingest takes it: its fingerprints tried in
     * order, read from Postgres, a new exception made under the newest
     * version's when none exists.
     */
    async function ingest(
      text: ExceptionGroupingContent,
      at: Date,
      data?: { service?: ObjectID; stored?: ExceptionGroupingContent },
    ): Promise<string> {
      const fingerprints: OccurrenceFingerprints = fingerprintsOf(text, data);
      const resolved: Map<string, string> =
        await ExceptionUtil.resolveGroupFingerprints([
          {
            projectId: projectId.toString(),
            primaryEntityId: (data?.service || serviceId).toString(),
            v1: fingerprints.fingerprint,
            v2: fingerprints.fingerprintV2,
            candidates: fingerprints.fingerprintCandidates,
          },
        ]);
      const landsOn: string = Array.from(resolved.values())[0]!;

      await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
        {
          ...payloadOf(text, at, data),
          fingerprint: fingerprints.fingerprint,
          fingerprintV2: fingerprints.fingerprintV2,
          fingerprintCandidates: fingerprints.fingerprintCandidates,
          ...(fingerprints.fingerprintRekeys
            ? { fingerprintRekeys: fingerprints.fingerprintRekeys }
            : {}),
        },
      ]);

      occur(data?.stored || text, landsOn, at, data?.service);

      return landsOn;
    }

    /*
     * An occurrence whose lookup failed, as the code before #11027 filed
     * it: under its `fingerprint` - grouping v1's of what it arrived as, or,
     * when v1 would give away what a rule hid, the one a new exception is
     * made under - with no lookup.
     */
    async function fileAsTheOldFallbackDid(
      text: ExceptionGroupingContent,
      at: Date,
      data?: { service?: ObjectID; stored?: ExceptionGroupingContent },
    ): Promise<string> {
      return fileUnder(fingerprintsOf(text, data).fingerprint, text, at, data);
    }

    /*
     * An occurrence filed under `fingerprint` with no lookup: what today's
     * upsert does with an occurrence that names no fingerprintV2, and what
     * ingest did with every one when that fingerprint's version was the
     * newest.
     */
    async function fileUnder(
      fingerprint: string,
      text: ExceptionGroupingContent,
      at: Date,
      data?: { service?: ObjectID; stored?: ExceptionGroupingContent },
    ): Promise<string> {
      await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
        { ...payloadOf(text, at, data), fingerprint },
      ]);

      occur(data?.stored || text, fingerprint, at, data?.service);

      return fingerprint;
    }

    // When an exception was made, as the test's timeline says.
    async function madeAt(fingerprint: string, at: Date): Promise<void> {
      await database.query(
        `UPDATE "${schema}"."TelemetryException" SET "createdAt" = $1 WHERE "projectId" = $2 AND "fingerprint" = $3`,
        [at, projectId.toString(), fingerprint],
      );
    }

    async function stored(): Promise<Map<string, StoredException>> {
      const rows: Array<StoredException> = await database.query(
        `SELECT "_id"::text AS "_id", "fingerprint", "occuranceCount", "firstSeenAt", "lastSeenAt", "isResolved", "isArchived",
                "assignToUserId"::text AS "assignToUserId",
                "mergedIntoTelemetryExceptionId"::text AS "mergedIntoTelemetryExceptionId",
                "mergedByUserId"::text AS "mergedByUserId", "mergedAt", "version", "updatedAt",
                "primaryEntityId"::text AS "primaryEntityId"
         FROM "${schema}"."TelemetryException"`,
      );

      return new Map(
        rows.map((row: StoredException): [string, StoredException] => {
          return [`${row.primaryEntityId}|${row.fingerprint}`, row];
        }),
      );
    }

    async function row(
      fingerprint: string,
      service: ObjectID = serviceId,
    ): Promise<StoredException> {
      const found: StoredException | undefined = (await stored()).get(
        `${service.toString()}|${fingerprint}`,
      );
      expect(found).toBeDefined();
      return found!;
    }

    // What the exceptions list reads: merged rows and former fingerprints left out.
    async function listed(): Promise<Array<TelemetryException>> {
      return TelemetryExceptionService.findBy({
        query: { projectId },
        select: {
          _id: true,
          fingerprint: true,
          occuranceCount: true,
          firstSeenAt: true,
        },
        limit: 1000,
        skip: 0,
        props: { isRoot: true },
      });
    }

    async function activity(): Promise<Array<[string, string, string]>> {
      const rows: Array<{
        telemetryExceptionId: string;
        activityType: string;
        relatedTelemetryExceptionId: string | null;
      }> = await database.query(
        `SELECT "telemetryExceptionId"::text AS "telemetryExceptionId", "activityType", "relatedTelemetryExceptionId"::text AS "relatedTelemetryExceptionId"
         FROM "${schema}"."TelemetryExceptionActivity" ORDER BY "createdAt", "activityType"`,
      );

      return rows.map(
        (entry: (typeof rows)[number]): [string, string, string] => {
          return [
            entry.telemetryExceptionId,
            entry.activityType,
            entry.relatedTelemetryExceptionId || "",
          ];
        },
      );
    }

    async function writeOccurrences(): Promise<void> {
      if (!clickhouseClient || unwritten.length === 0) {
        unwritten = [];
        return;
      }

      await ExceptionInstanceService.insertJsonRows(
        unwritten.map((occurrence: Occurrence): JSONObject => {
          return {
            _id: ObjectID.generateTimeOrdered().toString(),
            createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
            projectId: occurrence.projectId,
            primaryEntityId: occurrence.serviceId,
            primaryEntityType: "Service",
            time: OneUptimeDate.toClickhouseDateTime64(occurrence.at),
            timeUnixNano: String(occurrence.at.getTime() * 1000000),
            exceptionType: occurrence.text.exceptionType,
            stackTrace: occurrence.text.stackTrace,
            message: occurrence.text.message,
            spanStatusCode: 2,
            escaped: false,
            traceId: "",
            spanId: "",
            fingerprint: occurrence.fingerprint,
            spanName: "",
            release: "",
            environment: "",
            parsedFrames: "",
            attributes: {},
            attributeKeys: [],
            entityKeys: [],
            duplicateOf: "",
            retentionDate: OneUptimeDate.toClickhouseDateTime(
              OneUptimeDate.addRemoveDays(new Date(), 30),
            ).substring(0, 10),
          };
        }),
        { clickhouseSettings: { wait_for_async_insert: 1 } },
      );

      unwritten = [];
    }

    // The sweep's read of the occurrences, as its statement reads them.
    async function readOccurrencesKept(data: {
      projectId: string;
      primaryEntityId: string;
      fingerprint: string;
      from: Date;
      to: Date;
      limit: number;
    }): Promise<Array<ExceptionGroupingContent>> {
      const kept: Array<Occurrence> = occurrences
        .filter((occurrence: Occurrence): boolean => {
          return (
            occurrence.projectId === data.projectId &&
            occurrence.serviceId === data.primaryEntityId &&
            occurrence.fingerprint === data.fingerprint &&
            occurrence.at.getTime() >= data.from.getTime() &&
            occurrence.at.getTime() <= data.to.getTime()
          );
        })
        .sort((a: Occurrence, b: Occurrence): number => {
          return a.at.getTime() - b.at.getTime();
        });

      return [
        ...kept.slice(0, data.limit),
        ...[...kept].reverse().slice(0, data.limit),
      ].map((occurrence: Occurrence): ExceptionGroupingContent => {
        return occurrence.text;
      });
    }

    function migration(
      overrides?: Partial<MergeBackSplitsEnvironment>,
    ): MergeBackExceptionsSplitByFailedLookups {
      return new MergeBackExceptionsSplitByFailedLookups({
        readProgress: async (): Promise<SweepProgress | null> => {
          return progress ? { ...progress } : null;
        },
        writeProgress: async (next: SweepProgress): Promise<void> => {
          progress = { ...next };
        },
        ...(clickhouseClient
          ? {}
          : { readOccurrenceTexts: readOccurrencesKept }),
        ...(overrides || {}),
      });
    }

    async function sweep(
      overrides?: Partial<MergeBackSplitsEnvironment>,
      options?: { timeBudgetMs?: number },
    ): Promise<MergeBackSplitsResult> {
      await writeOccurrences();
      return migration(overrides).sweep(options || {});
    }

    // Forgets that it swept, and where it was: the next sweep reads every exception again.
    async function forgetTheSweep(): Promise<void> {
      progress = null;
      await database.query(`DELETE FROM "${schema}"."DataMigrations"`);
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["EXCEPTION_MERGE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["EXCEPTION_MERGE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["EXCEPTION_MERGE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of [
        "TelemetryException",
        "TelemetryExceptionActivity",
        "DataMigrations",
      ]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);

      if (clickhouseEndpoint) {
        const url: URL = new URL(clickhouseEndpoint);

        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
          throw new Error(
            "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
          );
        }

        const options: ClickHouseClientConfigOptions = {
          url: `${url.protocol}//${url.host}`,
          username: decodeURIComponent(url.username) || "default",
          password: decodeURIComponent(url.password),
          database: clickhouseDatabase,
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
          query: `CREATE DATABASE IF NOT EXISTS ${clickhouseDatabase}`,
        });
        await setup.disconnect();

        clickhouse = new ClickhouseDatabase(options);
        clickhouseClient = await clickhouse.connect(options);

        const model: AnalyticsBaseModel = new ExceptionInstance();
        const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
          modelType: ExceptionInstance as unknown as {
            new (): AnalyticsBaseModel;
          },
          database: clickhouse,
        }).toColumnsCreateStatement(model.tableColumns);

        await clickhouseClient.command({
          query: `CREATE TABLE ${clickhouseDatabase}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
          query_params: columns.query_params,
        });

        originalClickhouse = {
          database: ExceptionInstanceService.database,
          databaseClient: ExceptionInstanceService.databaseClient,
          ingestDatabase: ExceptionInstanceService.ingestDatabase,
          ingestDatabaseClient: ExceptionInstanceService.ingestDatabaseClient,
        };
        ExceptionInstanceService.database = clickhouse;
        ExceptionInstanceService.databaseClient = clickhouseClient;
        ExceptionInstanceService.ingestDatabase = clickhouse;
        ExceptionInstanceService.ingestDatabaseClient = clickhouseClient;
      }
    });

    afterAll(async () => {
      if (originalClickhouse) {
        Object.assign(ExceptionInstanceService, originalClickhouse);
      }

      if (clickhouseClient) {
        await clickhouseClient.command({
          query: `DROP DATABASE IF EXISTS ${clickhouseDatabase}`,
        });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // The audit log is ClickHouse's: each entry the merge writes, kept here.
      auditEntries = [];
      jest
        .spyOn(AuditLogService, "recordUpdate")
        .mockImplementation((async (data: {
          itemId: ObjectID;
          updatedFields: JSONObject;
          before: TelemetryException;
        }) => {
          auditEntries.push({
            itemId: data.itemId.toString(),
            from:
              data.before.mergedIntoTelemetryExceptionId?.toString() || null,
            to:
              (
                data.updatedFields[
                  "mergedIntoTelemetryExceptionId"
                ] as ObjectID | null
              )?.toString() || null,
          });
        }) as never);

      clearExistingV1FingerprintCache();
      occurrences = [];
      unwritten = [];
      progress = null;

      for (const table of [
        "TelemetryExceptionActivity",
        "TelemetryException",
        "DataMigrations",
      ]) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      if (clickhouseClient) {
        await clickhouseClient.command({
          query: `TRUNCATE TABLE ${clickhouseDatabase}.${new ExceptionInstance().tableName}`,
        });
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /*
     * An error seen once by today's ingest three weeks ago, and three times
     * since through a lookup that failed before #11027: the exception, and
     * its duplicate under v1.
     */
    async function leftoverPair(
      text: ExceptionGroupingContent = framesText("cart"),
    ): Promise<{ original: string; duplicate: string }> {
      const original: string = await ingest(text, daysAgo(21));
      await madeAt(original, daysAgo(21));

      const duplicate: string = await fileAsTheOldFallbackDid(
        text,
        daysAgo(12),
      );
      await madeAt(duplicate, daysAgo(12));
      await fileAsTheOldFallbackDid(text, daysAgo(11));
      await fileAsTheOldFallbackDid(text, daysAgo(10));

      expect(duplicate).not.toBe(original);

      // Filed by another process, days later: what this one knew is gone.
      clearExistingV1FingerprintCache();

      return { original, duplicate };
    }

    describe("the old code's leftovers", () => {
      test("an error the old fallback split stays two in the list, its total split, while it does not happen again", async () => {
        const { original, duplicate } = await leftoverPair();

        const list: Array<TelemetryException> = await listed();

        expect(
          list
            .map((exception: TelemetryException): string => {
              return exception.fingerprint!;
            })
            .sort(),
        ).toEqual([original, duplicate].sort());
        expect((await row(original)).occuranceCount).toBe(1);
        expect((await row(duplicate)).occuranceCount).toBe(3);

        // Other errors come and go: nothing today touches the two.
        await ingest(framesText("unrelated"), daysAgo(2));
        await ingest(framesText("unrelated"), daysAgo(1));

        expect(
          (await row(duplicate)).mergedIntoTelemetryExceptionId,
        ).toBeNull();
        expect(await listed()).toHaveLength(3);
      });

      test("the heal of #11089 runs only on an occurrence of its error: one more, and it would merge", async () => {
        const { original, duplicate } = await leftoverPair();

        await ingest(framesText("cart"), daysAgo(1));

        expect((await row(duplicate)).mergedIntoTelemetryExceptionId).toBe(
          (await row(original))._id,
        );
      });
    });

    describe("a provable duplicate is merged back", () => {
      test("into the older one: every count, its first and last seen, its state, assignment and history, both timelines, an audit entry, and no alert", async () => {
        const { original, duplicate } = await leftoverPair();
        // The older one was triaged: assigned to a person.
        await database.query(
          `UPDATE "${schema}"."TelemetryException" SET "assignToUserId" = $1 WHERE "fingerprint" = $2`,
          [personId.toString(), original],
        );
        const before: StoredException = await row(original);
        const duplicateBefore: StoredException = await row(duplicate);

        const result: MergeBackSplitsResult = await sweep();

        expect(result).toMatchObject({ isDone: true, merged: 1 });

        const survivor: StoredException = await row(original);
        const merged: StoredException = await row(duplicate);

        // One exception, the older one, counting all four occurrences.
        expect(merged.mergedIntoTelemetryExceptionId).toBe(survivor._id);
        expect(merged.mergedByUserId).toBeNull();
        expect(merged.mergedAt).not.toBeNull();
        expect(survivor.mergedIntoTelemetryExceptionId).toBeNull();
        expect(survivor.occuranceCount).toBe(4);
        // Its first seen as it was; its last seen the duplicate's.
        expect(survivor.firstSeenAt).toEqual(before.firstSeenAt);
        expect(survivor.lastSeenAt).toEqual(duplicateBefore.lastSeenAt);
        // Its state and assignment as they were.
        expect(survivor.isResolved).toBe(false);
        expect(survivor.isArchived).toBe(false);
        expect(survivor.assignToUserId).toBe(personId.toString());
        // The duplicate keeps its own count, for Unmerge.
        expect(merged.occuranceCount).toBe(3);

        // The list: one row, counting every occurrence.
        const list: Array<TelemetryException> = await listed();
        expect(list).toHaveLength(1);
        expect(list[0]!.fingerprint).toBe(original);
        expect(list[0]!.occuranceCount).toBe(4);

        // Both timelines, and the audit log, say so.
        expect(await activity()).toEqual([
          [survivor._id, TelemetryExceptionActivityType.Merged, merged._id],
          [merged._id, TelemetryExceptionActivityType.MergedInto, survivor._id],
        ]);
        expect(auditEntries).toEqual([
          { itemId: merged._id, from: null, to: survivor._id },
        ]);

        // And the marker: every exception has been read.
        const markers: Array<{ name: string }> = await database.query(
          `SELECT "name" FROM "${schema}"."DataMigrations"`,
        );
        expect(markers).toEqual([{ name: SWEPT_MARKER_NAME }]);
      });

      test("an occurrence after it counts on the older one, as a merged exception's does", async () => {
        const { original } = await leftoverPair();
        await sweep();

        await ingest(framesText("cart"), daysAgo(1));

        expect((await row(original)).occuranceCount).toBe(5);
        expect(await listed()).toHaveLength(1);
      });

      test("an exception grouped by its message, whose v2, v3 and v4 differ, is found where its text tries", async () => {
        const { original, duplicate } = await leftoverPair(messageText("eu"));

        expect((await sweep()).merged).toBe(1);
        expect((await row(duplicate)).mergedIntoTelemetryExceptionId).toBe(
          (await row(original))._id,
        );
      });

      test("several pairs, each into its own, the same error in another service apart", async () => {
        const a: { original: string; duplicate: string } = await leftoverPair(
          framesText("alpha"),
        );
        const b: { original: string; duplicate: string } = await leftoverPair(
          messageText("beta"),
        );
        // The same error in another service: its own exception, untouched.
        const elsewhere: string = await ingest(
          framesText("alpha"),
          daysAgo(25),
          {
            service: otherServiceId,
          },
        );

        const result: MergeBackSplitsResult = await sweep();

        expect(result.merged).toBe(2);
        expect((await row(a.duplicate)).mergedIntoTelemetryExceptionId).toBe(
          (await row(a.original))._id,
        );
        expect((await row(b.duplicate)).mergedIntoTelemetryExceptionId).toBe(
          (await row(b.original))._id,
        );
        expect(
          (await row(elsewhere, otherServiceId)).mergedIntoTelemetryExceptionId,
        ).toBeNull();
      });
    });

    describe("a lookalike it cannot prove is left as two", () => {
      test("a duplicate whose stored text a scrub rule changed, though the change folds", async () => {
        const arrived: ExceptionGroupingContent = {
          exceptionType: "TypeError",
          message: "No account for jane@example.com",
          stackTrace:
            "TypeError: No account\n    at signIn (/app/src/auth.js:10:5)",
        };
        const storedText: ExceptionGroupingContent = {
          ...arrived,
          message: "No account for [REDACTED]",
        };
        // The rule's change folds (an email): the occurrence kept its v1.
        expect(
          fingerprintsOf(arrived, { stored: storedText }).fingerprint,
        ).toBe(fingerprintsOf(arrived).fingerprint);

        const original: string = await ingest(arrived, daysAgo(21), {
          stored: storedText,
        });
        await madeAt(original, daysAgo(21));
        const duplicate: string = await fileAsTheOldFallbackDid(
          arrived,
          daysAgo(9),
          { stored: storedText },
        );
        await madeAt(duplicate, daysAgo(9));

        const result: MergeBackSplitsResult = await sweep();

        expect(result.merged).toBe(0);
        expect(result.notOfTheirOwnText).toBe(2);
        expect(await listed()).toHaveLength(2);
      });

      test("a duplicate filed under the keyed fingerprint a rule's text opens, which a v4 exception of its own could be", async () => {
        const arrived: ExceptionGroupingContent = {
          exceptionType: "CardError",
          message: "Card 4111 1111 1111 1111 declined",
          stackTrace: "",
        };
        const storedText: ExceptionGroupingContent = {
          ...arrived,
          message: "Card [REDACTED] declined",
        };
        const fingerprints: OccurrenceFingerprints = fingerprintsOf(arrived, {
          stored: storedText,
        });
        /*
         * v1 hashes what the rule hid: the old fallback kept the fingerprint
         * a new exception is made under, which any v4 exception has.
         */
        expect(fingerprints.fingerprint).toBe(fingerprints.fingerprintV2);

        // Made while v2 was the newest version, under it.
        const original: string = await fileUnder(
          ExceptionUtil.getFingerprintV2({
            projectId,
            primaryEntityId: serviceId,
            ...arrived,
          }),
          arrived,
          daysAgo(21),
          { stored: storedText },
        );
        await madeAt(original, daysAgo(21));
        const duplicate: string = await fileAsTheOldFallbackDid(
          arrived,
          daysAgo(9),
          { stored: storedText },
        );
        await madeAt(duplicate, daysAgo(9));

        const result: MergeBackSplitsResult = await sweep();

        expect(result.merged).toBe(0);
        expect(await listed()).toHaveLength(2);
      });

      test("an exception the old fallback made before the one its text finds: its error's own, never a duplicate", async () => {
        const text: ExceptionGroupingContent = framesText("first");
        const v1Exception: string = await fileAsTheOldFallbackDid(
          text,
          daysAgo(20),
        );
        await madeAt(v1Exception, daysAgo(20));
        // The same code through a library, seen since: its v2 is the same.
        const otherLine: ExceptionGroupingContent = throughALibrary(text);
        expect(fingerprintsOf(otherLine).fingerprint).not.toBe(v1Exception);
        const later: string = await ingest(otherLine, daysAgo(5));
        await madeAt(later, daysAgo(5));
        expect(fingerprintsOf(text).fingerprintCandidates).toContain(later);

        const result: MergeBackSplitsResult = await sweep();

        expect(result.merged).toBe(0);
        expect(result.notADuplicate).toBe(1);
        expect(await listed()).toHaveLength(2);
      });

      test("a duplicate a person took out of a merge, or merged elsewhere: their call stands", async () => {
        const unmerged: { original: string; duplicate: string } =
          await leftoverPair(framesText("unmerged"));
        const elsewhere: { original: string; duplicate: string } =
          await leftoverPair(framesText("elsewhere"));
        const third: string = await ingest(framesText("third"), daysAgo(3));

        // Taken out of a merge by a person: an Unmerged entry on its timeline.
        await database.query(
          `INSERT INTO "${schema}"."TelemetryExceptionActivity" ("_id", "projectId", "telemetryExceptionId", "activityType", "userId", "version", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, 0, now(), now())`,
          [
            ObjectID.generate().toString(),
            projectId.toString(),
            (await row(unmerged.duplicate))._id,
            TelemetryExceptionActivityType.UnmergedFrom,
            personId.toString(),
          ],
        );
        // Merged by a person into a third one.
        await database.query(
          `UPDATE "${schema}"."TelemetryException" SET "mergedIntoTelemetryExceptionId" = $1, "mergedByUserId" = $2 WHERE "fingerprint" = $3`,
          [(await row(third))._id, personId.toString(), elsewhere.duplicate],
        );

        const result: MergeBackSplitsResult = await sweep();

        expect(result.merged).toBe(0);
        expect(result.leftToAPerson).toBe(1);
        expect(
          (await row(unmerged.duplicate)).mergedIntoTelemetryExceptionId,
        ).toBeNull();
        expect(
          (await row(elsewhere.duplicate)).mergedIntoTelemetryExceptionId,
        ).toBe((await row(third))._id);
      });

      test("two errors grouping v1 could not tell apart, as one occurrence each says: left", async () => {
        const original: string = await ingest(ONE_FOR_V1, daysAgo(21));
        await madeAt(original, daysAgo(21));
        const otherOriginal: string = await ingest(OTHER_FOR_V1, daysAgo(20));
        await madeAt(otherOriginal, daysAgo(20));

        // The old fallback filed both errors under the one v1 they share.
        const duplicate: string = await fileAsTheOldFallbackDid(
          OTHER_FOR_V1,
          daysAgo(12),
        );
        await madeAt(duplicate, daysAgo(12));
        expect(await fileAsTheOldFallbackDid(ONE_FOR_V1, daysAgo(10))).toBe(
          duplicate,
        );

        const result: MergeBackSplitsResult = await sweep();

        expect(result.merged).toBe(0);
        expect(result.occurrencesDisagree).toBe(1);
        expect(await listed()).toHaveLength(3);
      });
    });

    describe("a second run changes nothing", () => {
      test("not a row, a version, an updatedAt, a timeline or the audit log", async () => {
        await leftoverPair(framesText("rerun"));
        // And a pair it leaves.
        const text: ExceptionGroupingContent = framesText("leftalone");
        const own: string = await fileAsTheOldFallbackDid(text, daysAgo(20));
        await madeAt(own, daysAgo(20));
        const later: string = await ingest(throughALibrary(text), daysAgo(4));
        await madeAt(later, daysAgo(4));
        expect(later).not.toBe(own);

        expect((await sweep()).merged).toBe(1);

        const rows: Map<string, StoredException> = await stored();
        const timelines: Array<[string, string, string]> = await activity();
        const audit: Array<JSONObject> = [...auditEntries];

        // Every exception read again, from the first.
        await forgetTheSweep();
        const again: MergeBackSplitsResult = await sweep();
        // And the upgrade's run, once more.
        await forgetTheSweep();
        await migration().migrate();

        expect(again).toMatchObject({ isDone: true, merged: 0 });
        expect(await stored()).toEqual(rows);
        expect(await activity()).toEqual(timelines);
        expect(auditEntries).toEqual(audit);
      });

      test("once swept, the upgrade's run and the job's read nothing at all, recorded or not", async () => {
        await leftoverPair(framesText("once"));
        await sweep();

        const reads: Array<unknown> = [];
        const environment: Partial<MergeBackSplitsEnvironment> = {
          readPage: async (): Promise<never> => {
            reads.push("page");
            throw new Error("not to be read");
          },
        };

        await migration(environment).migrate();
        const job: MergeBackSplitsResult = await migration(
          environment,
        ).continueSweep({});

        expect(reads).toEqual([]);
        expect(job.wasSweptBefore).toBe(true);
      });

      test("the job waits for the upgrade's run, recorded in DataMigrations", async () => {
        const { duplicate } = await leftoverPair(framesText("waits"));

        expect((await migration().continueSweep({})).isWaitingForUpgrade).toBe(
          true,
        );
        expect(
          (await row(duplicate)).mergedIntoTelemetryExceptionId,
        ).toBeNull();

        await database.query(
          `INSERT INTO "${schema}"."DataMigrations" ("_id", "name", "executed", "executedAt", "version", "createdAt", "updatedAt") VALUES ($1, $2, true, now(), 0, now(), now())`,
          [ObjectID.generate().toString(), MERGE_BACK_SPLITS_MIGRATION_NAME],
        );

        expect((await migration().continueSweep({})).merged).toBe(1);
      });
    });

    describe("a large table finishes across runs", () => {
      test("a few pages a run, every duplicate merged once, nothing else, and the counts add up", async () => {
        const random: SeededRandom = seededRandom(11113);
        const pairs: Array<{ original: string; duplicate: string }> = [];
        const singles: Array<TelemetryExceptionPayload> = [];
        let total: number = 0;

        for (let index: number = 0; index < 500; index++) {
          const text: ExceptionGroupingContent =
            random(2) === 0
              ? framesText(`one${letters(index)}`)
              : messageText(`one${letters(index)}`);
          const fingerprints: OccurrenceFingerprints = fingerprintsOf(text);
          const count: number = 1 + random(3);

          for (let time: number = 0; time < count; time++) {
            singles.push({
              ...payloadOf(text, daysAgo(1 + random(25))),
              fingerprint: fingerprints.fingerprint,
              fingerprintV2: fingerprints.fingerprintV2,
              fingerprintCandidates: fingerprints.fingerprintCandidates,
            });
          }

          total += count;
        }

        await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch(singles);
        // Made a fortnight ago, before every pair below.
        await database.query(
          `UPDATE "${schema}"."TelemetryException" SET "createdAt" = $1`,
          [daysAgo(15)],
        );
        clearExistingV1FingerprintCache();

        for (let index: number = 0; index < 30; index++) {
          pairs.push(
            await leftoverPair(
              random(2) === 0
                ? framesText(`dup${letters(index)}`)
                : messageText(`dup${letters(index)}`),
            ),
          );
          total += 4;
        }

        let runs: number = 0;
        const clock: { at: number } = { at: Date.now() };
        const pageReads: Array<string> = [];

        while (
          (
            (await database.query(
              `SELECT count(*)::int AS "count" FROM "${schema}"."DataMigrations" WHERE "name" = $1`,
              [SWEPT_MARKER_NAME],
            )) as Array<{ count: number }>
          )[0]!.count === 0
        ) {
          runs++;
          expect(runs).toBeLessThan(50);

          const readPage: MergeBackSplitsEnvironment["readPage"] =
            getDefaultMergeBackSplitsEnvironment().readPage;

          await writeOccurrences();
          await migration({
            pageSize: 60,
            now: (): Date => {
              return new Date(clock.at);
            },
            readPage: async (data: Parameters<typeof readPage>[0]) => {
              pageReads.push(data.after);
              clock.at += 1000;
              return readPage(data);
            },
          }).sweep({ timeBudgetMs: 3000 });
        }

        expect(runs).toBeGreaterThan(2);
        // Each page read once: no exception read twice.
        expect(new Set(pageReads).size).toBe(pageReads.length);

        const rows: Map<string, StoredException> = await stored();
        let merged: number = 0;
        let counted: number = 0;

        for (const pair of pairs) {
          expect(
            rows.get(`${serviceId}|${pair.duplicate}`)!
              .mergedIntoTelemetryExceptionId,
          ).toBe(rows.get(`${serviceId}|${pair.original}`)!._id);
        }

        for (const exception of rows.values()) {
          if (exception.mergedIntoTelemetryExceptionId) {
            merged++;
          } else {
            counted += exception.occuranceCount;
          }
        }

        expect(merged).toBe(pairs.length);
        // What the list counts adds up to every occurrence.
        expect(counted).toBe(total);
        expect(await activity()).toHaveLength(2 * pairs.length);
        expect(auditEntries).toHaveLength(pairs.length);
      });
    });
  },
);
