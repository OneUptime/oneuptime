import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import {
  TelemetryIngestRefusalBatch,
  TelemetryIngestRefusalUpsert,
  buildTelemetryIngestRefusalUpsert,
} from "../../../Server/Services/TelemetryIngestionKeyRefusalService";
import ObjectID from "../../../Types/ObjectID";
import {
  TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS,
  TelemetryIngestRefusalReason,
} from "../../../Types/Telemetry/TelemetryIngestRefusal";
import { Client } from "pg";

/*
 * THE REFUSAL COUNTS' ONE STATEMENT, RUN BY POSTGRES (issues #6378, #11440).
 *
 * TelemetryIngestionKeyRefusalService adds each batch of refusals to its
 * row with one INSERT ... ON CONFLICT DO UPDATE. A refusal of the telemetry
 * queue comes and goes, so its row tells the latest stretch: a batch that
 * begins more than TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS after the row's
 * latest refusal starts the count and the first refusal again. Executed
 * here, not string matched:
 *
 *   - the first batch inserts the row;
 *   - a batch of the same stretch adds its count and moves the latest on,
 *     the first kept - and so does one another process counted from before
 *     the row's latest refusal;
 *   - a batch begun after the gap starts the count and the first refusal
 *     again;
 *   - any other reason's row adds every batch, however far apart, as it
 *     always has;
 *   - each row of one statement is decided by its own latest refusal.
 *
 * Opt in with RUN_POSTGRES_TELEMETRY_INGEST_REFUSAL_STRETCH_TESTS=true:
 *
 *   RUN_POSTGRES_TELEMETRY_INGEST_REFUSAL_STRETCH_TESTS=true \
 *   TELEMETRY_INGEST_REFUSAL_TEST_DATABASE_HOST=127.0.0.1 \
 *   TELEMETRY_INGEST_REFUSAL_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/TelemetryIngestRefusalStretchPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. It needs no
 * migrated tables: the two it writes are made, as the migration that added
 * them made them (1809071100000-AddTelemetryIngestionKeyRefusals), in a
 * uniquely named schema - the only one on the search_path - which is
 * dropped afterwards. Every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TELEMETRY_INGEST_REFUSAL_STRETCH_TESTS"] === "true"
    ? describe
    : describe.skip;

const SCHEMA_NAME_DASHES: RegExp = /-/g;

const PROJECT: ObjectID = new ObjectID("11440000-0000-4000-8000-000000000001");
const KEY_A: ObjectID = new ObjectID("11440000-0000-4000-8000-0000000000a1");
const KEY_B: ObjectID = new ObjectID("11440000-0000-4000-8000-0000000000b1");

const AT: Date = new Date("2026-11-28T09:00:00.000Z");
const GAP_MINUTES: number = TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS / 60_000;

function minutesAfter(minutes: number): Date {
  return new Date(AT.getTime() + minutes * 60 * 1000);
}

interface StoredRefusal {
  reason: string;
  surface: string;
  refusedCount: number;
  firstRefusedAt: Date;
  lastRefusedAt: Date;
}

function batch(
  overrides: Partial<TelemetryIngestRefusalBatch>,
): TelemetryIngestRefusalBatch {
  return {
    projectId: PROJECT,
    telemetryIngestionKeyId: KEY_A,
    reason: TelemetryIngestRefusalReason.QueueBacklogged,
    surface: "otel-metrics",
    count: 1,
    firstRefusedAt: AT,
    lastRefusedAt: AT,
    ...overrides,
  };
}

describePostgres(
  "telemetry refusal counts told apart by stretch, against Postgres",
  () => {
    const schema: string = `refusal_stretch_${ObjectID.generate()
      .toString()
      .replace(SCHEMA_NAME_DASHES, "")}`;

    let client: Client;

    const add: (
      batches: Array<TelemetryIngestRefusalBatch>,
    ) => Promise<void> = async (
      batches: Array<TelemetryIngestRefusalBatch>,
    ): Promise<void> => {
      const upsert: TelemetryIngestRefusalUpsert =
        buildTelemetryIngestRefusalUpsert(batches);

      await client.query(upsert.query, upsert.parameters);
    };

    const stored: (
      key: ObjectID,
      reason: string,
    ) => Promise<StoredRefusal | null> = async (
      key: ObjectID,
      reason: string,
    ): Promise<StoredRefusal | null> => {
      const result: { rows: Array<StoredRefusal> } = await client.query(
        `SELECT "reason", "surface", "refusedCount", "firstRefusedAt", "lastRefusedAt" FROM "TelemetryIngestionKeyRefusal" WHERE "telemetryIngestionKeyId" = $1 AND "reason" = $2`,
        [key.toString(), reason],
      );

      expect(result.rows.length).toBeLessThanOrEqual(1);

      return result.rows[0] || null;
    };

    beforeAll(async () => {
      client = new Client({
        host:
          process.env["TELEMETRY_INGEST_REFUSAL_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["TELEMETRY_INGEST_REFUSAL_TEST_DATABASE_PORT"] || "5400",
        ),
        user: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TELEMETRY_INGEST_REFUSAL_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
      });

      await client.connect();
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);

      // The key's table, as far as the statement reads it.
      await client.query(
        `CREATE TABLE "TelemetryIngestionKey" ("_id" uuid NOT NULL, "projectId" uuid NOT NULL, CONSTRAINT "PK_TelemetryIngestionKey" PRIMARY KEY ("_id"))`,
      );
      // The refusals' table and its unique index, as the migration made them.
      await client.query(
        `CREATE TABLE "TelemetryIngestionKeyRefusal" ("_id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "telemetryIngestionKeyId" uuid NOT NULL, "reason" character varying(100) NOT NULL, "surface" character varying(100) NOT NULL, "refusedCount" integer NOT NULL, "firstRefusedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastRefusedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, CONSTRAINT "PK_TelemetryIngestionKeyRefusal" PRIMARY KEY ("_id"))`,
      );
      await client.query(
        `CREATE UNIQUE INDEX "IDX_TelemetryIngestionKeyRefusal_row" ON "TelemetryIngestionKeyRefusal" ("telemetryIngestionKeyId", "reason", "surface")`,
      );
      await client.query(
        `ALTER TABLE "TelemetryIngestionKeyRefusal" ADD CONSTRAINT "FK_TelemetryIngestionKeyRefusal_key" FOREIGN KEY ("telemetryIngestionKeyId") REFERENCES "TelemetryIngestionKey"("_id") ON DELETE CASCADE`,
      );
      await client.query(
        `INSERT INTO "TelemetryIngestionKey" ("_id", "projectId") VALUES ($1, $3), ($2, $3)`,
        [KEY_A.toString(), KEY_B.toString(), PROJECT.toString()],
      );
    });

    beforeEach(async () => {
      await client.query(`DELETE FROM "TelemetryIngestionKeyRefusal"`);
    });

    afterAll(async () => {
      if (client) {
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await client.end();
      }
    });

    test("the first batch inserts the row", async () => {
      await add([batch({ count: 4, lastRefusedAt: minutesAfter(3) })]);

      expect(
        await stored(KEY_A, TelemetryIngestRefusalReason.QueueBacklogged),
      ).toEqual({
        reason: "queue-backlogged",
        surface: "otel-metrics",
        refusedCount: 4,
        firstRefusedAt: AT,
        lastRefusedAt: minutesAfter(3),
      });
    });

    test("a batch of the same stretch adds its count and moves the latest on", async () => {
      await add([batch({ count: 4, lastRefusedAt: minutesAfter(3) })]);
      // Exactly the gap after the row's latest refusal: still the stretch.
      await add([
        batch({
          count: 6,
          firstRefusedAt: minutesAfter(3 + GAP_MINUTES),
          lastRefusedAt: minutesAfter(5 + GAP_MINUTES),
        }),
      ]);

      expect(
        await stored(KEY_A, TelemetryIngestRefusalReason.QueueBacklogged),
      ).toMatchObject({
        refusedCount: 10,
        firstRefusedAt: AT,
        lastRefusedAt: minutesAfter(5 + GAP_MINUTES),
      });
    });

    test("a batch another process counted from before the row's latest refusal adds to the stretch", async () => {
      await add([batch({ count: 4, lastRefusedAt: minutesAfter(10) })]);
      await add([
        batch({
          count: 2,
          firstRefusedAt: minutesAfter(-2),
          lastRefusedAt: minutesAfter(4),
        }),
      ]);

      expect(
        await stored(KEY_A, TelemetryIngestRefusalReason.QueueBacklogged),
      ).toMatchObject({
        refusedCount: 6,
        firstRefusedAt: minutesAfter(-2),
        lastRefusedAt: minutesAfter(10),
      });
    });

    test("a batch begun after the gap starts the count and the first refusal again", async () => {
      await add([batch({ count: 900, lastRefusedAt: minutesAfter(60) })]);
      await add([
        batch({
          count: 7,
          firstRefusedAt: minutesAfter(61 + GAP_MINUTES),
          lastRefusedAt: minutesAfter(62 + GAP_MINUTES),
        }),
      ]);

      expect(
        await stored(KEY_A, TelemetryIngestRefusalReason.QueueBacklogged),
      ).toMatchObject({
        refusedCount: 7,
        firstRefusedAt: minutesAfter(61 + GAP_MINUTES),
        lastRefusedAt: minutesAfter(62 + GAP_MINUTES),
      });

      // And the stretch after that one goes on from there.
      await add([
        batch({
          count: 3,
          firstRefusedAt: minutesAfter(63 + GAP_MINUTES),
          lastRefusedAt: minutesAfter(64 + GAP_MINUTES),
        }),
      ]);

      expect(
        await stored(KEY_A, TelemetryIngestRefusalReason.QueueBacklogged),
      ).toMatchObject({
        refusedCount: 10,
        firstRefusedAt: minutesAfter(61 + GAP_MINUTES),
      });
    });

    test("the queue being full for everyone is told apart by stretch too", async () => {
      await add([
        batch({
          reason: TelemetryIngestRefusalReason.QueueFull,
          count: 50,
        }),
      ]);
      await add([
        batch({
          reason: TelemetryIngestRefusalReason.QueueFull,
          count: 1,
          firstRefusedAt: minutesAfter(2 * GAP_MINUTES),
          lastRefusedAt: minutesAfter(2 * GAP_MINUTES),
        }),
      ]);

      expect(
        await stored(KEY_A, TelemetryIngestRefusalReason.QueueFull),
      ).toMatchObject({
        refusedCount: 1,
        firstRefusedAt: minutesAfter(2 * GAP_MINUTES),
      });
    });

    test("any other reason adds every batch, however far apart, as it always has", async () => {
      await add([
        batch({
          reason: TelemetryIngestRefusalReason.KeyDisabled,
          count: 5,
        }),
      ]);
      await add([
        batch({
          reason: TelemetryIngestRefusalReason.KeyDisabled,
          count: 1,
          firstRefusedAt: minutesAfter(10 * GAP_MINUTES),
          lastRefusedAt: minutesAfter(10 * GAP_MINUTES),
        }),
      ]);

      expect(
        await stored(KEY_A, TelemetryIngestRefusalReason.KeyDisabled),
      ).toMatchObject({
        refusedCount: 6,
        firstRefusedAt: AT,
        lastRefusedAt: minutesAfter(10 * GAP_MINUTES),
      });
    });

    test("each row of one statement is decided by its own latest refusal", async () => {
      await add([
        batch({ count: 100, lastRefusedAt: minutesAfter(1) }),
        batch({
          telemetryIngestionKeyId: KEY_B,
          count: 100,
          lastRefusedAt: minutesAfter(40),
        }),
      ]);
      await add([
        // Key A's row last refused at 09:01: a new stretch.
        batch({
          count: 1,
          firstRefusedAt: minutesAfter(45),
          lastRefusedAt: minutesAfter(46),
        }),
        // Key B's at 09:40: the same one.
        batch({
          telemetryIngestionKeyId: KEY_B,
          count: 1,
          firstRefusedAt: minutesAfter(45),
          lastRefusedAt: minutesAfter(46),
        }),
      ]);

      expect(
        await stored(KEY_A, TelemetryIngestRefusalReason.QueueBacklogged),
      ).toMatchObject({ refusedCount: 1, firstRefusedAt: minutesAfter(45) });
      expect(
        await stored(KEY_B, TelemetryIngestRefusalReason.QueueBacklogged),
      ).toMatchObject({ refusedCount: 101, firstRefusedAt: AT });
    });

    test("a count at the column's bound stops there, in a stretch as before", async () => {
      await add([batch({ count: 2147483000 })]);
      await add([
        batch({
          count: 5000,
          firstRefusedAt: minutesAfter(1),
          lastRefusedAt: minutesAfter(1),
        }),
      ]);

      expect(
        await stored(KEY_A, TelemetryIngestRefusalReason.QueueBacklogged),
      ).toMatchObject({ refusedCount: 2147483647 });
    });
  },
);
