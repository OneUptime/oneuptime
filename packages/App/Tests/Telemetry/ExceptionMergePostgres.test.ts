import ExceptionUtil, {
  TelemetryExceptionPayload,
  clearExistingV1FingerprintCache,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import Entities from "Common/Models/DatabaseModels/Index";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import TelemetryExceptionActivityService, {
  TelemetryExceptionActivityEntry,
} from "Common/Server/Services/TelemetryExceptionActivityService";
import { TelemetryExceptionActivityType } from "Common/Models/DatabaseModels/TelemetryExceptionActivity";
import TelemetryExceptionMerge, {
  ExceptionMergeOutcome,
  ExceptionUnmergeOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionMerge";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { DataSource, EntityManager } from "Common/node_modules/typeorm";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * MERGING EXCEPTIONS, AND UNDOING IT, ON POSTGRES - WITH INGEST IN BETWEEN.
 *
 * TelemetryExceptionMerge moves counts with raw statements under row locks,
 * and the ingest upsert counts an occurrence of a merged exception on the
 * one it was merged into too (ExceptionUtil.withMergedSurvivors). The unit
 * suites fake the database; only a real Postgres shows that the counts add
 * up afterwards: an exception that is not merged counts its own occurrences
 * and those of every exception merged into it, a merged one counts its own,
 * and unmerging gives each back exactly what it would have counted had it
 * never been merged. A seeded sweep of merges, unmerges and ingests holds
 * those to a model of every occurrence ingested.
 *
 * Opt in with RUN_POSTGRES_EXCEPTION_MERGE_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The migrated TelemetryException's
 * STRUCTURE (its unique index on the conflict key and the partial index of
 * merged rows included) is cloned into a unique schema that is dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from EXCEPTION_MERGE_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from EXCEPTION_MERGE_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EXCEPTION_MERGE_TESTS"] === "true"
    ? describe
    : describe.skip;

interface GroupRow {
  _id: string;
  fingerprint: string;
  message: string | null;
  occuranceCount: number;
  isResolved: boolean;
  regressedAt: Date | null;
  mergedIntoTelemetryExceptionId: string | null;
  mergedByUserId: string | null;
}

describePostgres("merging exceptions against Postgres", () => {
  const schema: string = `exception_merge_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const serviceId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  let database: DataSource;
  let activity: Array<[string, TelemetryExceptionActivityType, string]>;

  function occurrence(fingerprint: string): TelemetryExceptionPayload {
    return {
      fingerprint,
      projectId,
      primaryEntityId: serviceId,
      primaryEntityType: ServiceType.OpenTelemetry,
      exceptionType: "TypeError",
      message: `message of ${fingerprint}`,
      stackTrace: `TypeError: x\n    at ${fingerprint} (cart.js:10:5)`,
      occurredAt: new Date(Date.now() - 60 * 1000),
    };
  }

  async function ingest(fingerprints: Array<string>): Promise<void> {
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch(
      fingerprints.map(occurrence),
    );
  }

  async function rows(): Promise<Map<string, GroupRow>> {
    const all: Array<GroupRow> = await database.query(
      `SELECT "_id"::text AS "_id", "fingerprint", "message", "occuranceCount",
              "isResolved", "regressedAt",
              "mergedIntoTelemetryExceptionId"::text AS "mergedIntoTelemetryExceptionId",
              "mergedByUserId"::text AS "mergedByUserId"
       FROM "${schema}"."TelemetryException"`,
    );
    return new Map(
      all.map((row: GroupRow): [string, GroupRow] => {
        return [row.fingerprint, row];
      }),
    );
  }

  async function read(fingerprint: string): Promise<GroupRow> {
    const row: GroupRow | undefined = (await rows()).get(fingerprint);
    expect(row).toBeDefined();
    return row!;
  }

  async function merge(
    survivor: string,
    merged: Array<string>,
  ): Promise<Array<ExceptionMergeOutcome>> {
    const result: Awaited<ReturnType<typeof TelemetryExceptionMerge.merge>> =
      await TelemetryExceptionMerge.merge({
        telemetryExceptionId: new ObjectID((await read(survivor))._id),
        mergedTelemetryExceptionIds: await Promise.all(
          merged.map(async (fingerprint: string): Promise<ObjectID> => {
            return new ObjectID((await read(fingerprint))._id);
          }),
        ),
        props: { tenantId: projectId, userId },
      });

    return result.merged.map((entry: { outcome: ExceptionMergeOutcome }) => {
      return entry.outcome;
    });
  }

  async function unmerge(
    fingerprint: string,
  ): Promise<ExceptionUnmergeOutcome> {
    return (
      await TelemetryExceptionMerge.unmerge({
        telemetryExceptionId: new ObjectID((await read(fingerprint))._id),
        props: { tenantId: projectId, userId },
      })
    ).outcome;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["EXCEPTION_MERGE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["EXCEPTION_MERGE_TEST_DATABASE_PORT"] || "5400"),
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
    await database.query(
      `CREATE TABLE "${schema}"."TelemetryException" (LIKE public."TelemetryException" INCLUDING ALL)`,
    );
  });

  afterAll(async () => {
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

    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: database.manager,
    } as never);

    jest
      .spyOn(TelemetryExceptionService, "executeTransaction")
      .mockImplementation(((
        run: (manager: EntityManager) => Promise<unknown>,
      ) => {
        return database.transaction(run);
      }) as never);

    /*
     * Who may edit is TelemetryExceptionMerge.test.ts's: here everyone may,
     * and the rows are read from this schema.
     */
    jest
      .spyOn(TelemetryExceptionMerge, "readEditable")
      .mockImplementation((async (data: { ids: Array<ObjectID> }) => {
        const found: Array<{
          _id: string;
          primaryEntityId: string;
          fingerprint: string;
          mergedIntoTelemetryExceptionId: string | null;
        }> = await database.query(
          `SELECT "_id"::text AS "_id", "primaryEntityId"::text AS "primaryEntityId", "fingerprint",
                  "mergedIntoTelemetryExceptionId"::text AS "mergedIntoTelemetryExceptionId"
           FROM "${schema}"."TelemetryException" WHERE "_id" = ANY($1::uuid[])`,
          [
            data.ids.map((id: ObjectID): string => {
              return id.toString();
            }),
          ],
        );

        return found.map(
          (entry: (typeof found)[number]): TelemetryException => {
            const model: TelemetryException = new TelemetryException();
            model._id = entry._id;
            model.primaryEntityId = new ObjectID(entry.primaryEntityId);
            model.fingerprint = entry.fingerprint;
            if (entry.mergedIntoTelemetryExceptionId) {
              model.mergedIntoTelemetryExceptionId = new ObjectID(
                entry.mergedIntoTelemetryExceptionId,
              );
            }
            return model;
          },
        );
      }) as never);

    // What the merges, unmerges and ingests left on the activity timelines.
    activity = [];
    jest
      .spyOn(TelemetryExceptionActivityService, "record")
      .mockImplementation((async (data: {
        entries: Array<TelemetryExceptionActivityEntry>;
      }) => {
        for (const entry of data.entries) {
          activity.push([
            entry.telemetryExceptionId.toString(),
            entry.activityType,
            entry.relatedTelemetryExceptionId?.toString() || "",
          ]);
        }
        return data.entries.length;
      }) as never);

    await database.query(`DELETE FROM "${schema}"."TelemetryException"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a merged exception's count moves in, its new occurrences count on both, and an unmerge gives it back exactly", async () => {
    await ingest(["a", "a", "a", "b", "b", "b", "b", "b"]);

    expect(await merge("a", ["b"])).toEqual([ExceptionMergeOutcome.Merged]);
    expect((await read("a")).occuranceCount).toBe(8);
    expect((await read("b")).occuranceCount).toBe(5);
    expect((await read("b")).mergedIntoTelemetryExceptionId).toBe(
      (await read("a"))._id,
    );
    expect((await read("b")).mergedByUserId).toBe(userId.toString());
    // Both timelines say so, once the merge is written.
    expect(activity).toEqual([
      [
        (await read("a"))._id,
        TelemetryExceptionActivityType.Merged,
        (await read("b"))._id,
      ],
      [
        (await read("b"))._id,
        TelemetryExceptionActivityType.MergedInto,
        (await read("a"))._id,
      ],
    ]);

    // Two of b and one of a, after the merge.
    await ingest(["b", "b", "a"]);
    expect((await read("a")).occuranceCount).toBe(11);
    expect((await read("b")).occuranceCount).toBe(7);

    expect(await unmerge("b")).toBe(ExceptionUnmergeOutcome.Unmerged);
    expect((await read("a")).occuranceCount).toBe(4);
    expect((await read("b")).occuranceCount).toBe(7);
    expect((await read("b")).mergedIntoTelemetryExceptionId).toBeNull();

    // Unmerged: b's occurrences are its own again.
    await ingest(["b"]);
    expect((await read("a")).occuranceCount).toBe(4);
    expect((await read("b")).occuranceCount).toBe(8);
  });

  test("merging again, or unmerging what is not merged, changes nothing", async () => {
    await ingest(["a", "b", "b"]);
    await merge("a", ["b"]);

    expect(await merge("a", ["b"])).toEqual([
      ExceptionMergeOutcome.AlreadyMerged,
    ]);
    expect((await read("a")).occuranceCount).toBe(3);

    await unmerge("b");
    expect(await unmerge("b")).toBe(ExceptionUnmergeOutcome.NotMerged);
    expect((await read("a")).occuranceCount).toBe(1);
    expect((await read("b")).occuranceCount).toBe(2);
  });

  test("the survivor keeps its own message: an occurrence of a merged exception only counts there", async () => {
    await ingest(["a", "b"]);
    await merge("a", ["b"]);
    await ingest(["b"]);

    expect((await read("a")).message).toBe("message of a");
    expect((await read("b")).message).toBe("message of b");
  });

  test("a resolved survivor reopens as Regressed when a merged exception comes back", async () => {
    await ingest(["a", "b"]);
    await merge("a", ["b"]);
    await database.query(
      `UPDATE "${schema}"."TelemetryException" SET "isResolved" = true, "markedAsResolvedAt" = now() - interval '1 hour' WHERE "fingerprint" = 'a'`,
    );

    activity.length = 0;
    await ingest(["b"]);

    const survivor: GroupRow = await read("a");
    expect(survivor.isResolved).toBe(false);
    expect(survivor.regressedAt).not.toBeNull();
    // The survivor's timeline says it came back.
    expect(activity).toEqual([
      [survivor._id, TelemetryExceptionActivityType.Regressed, ""],
    ]);
  });

  test("merging an exception others were merged into moves them along, and each unmerge takes only its own", async () => {
    await ingest(["a", "b", "b", "c", "c", "c"]);

    await merge("b", ["c"]);
    expect((await read("b")).occuranceCount).toBe(5);

    await merge("a", ["b"]);
    expect((await read("a")).occuranceCount).toBe(6);
    expect((await read("b")).occuranceCount).toBe(2);
    expect((await read("c")).mergedIntoTelemetryExceptionId).toBe(
      (await read("a"))._id,
    );

    await ingest(["c"]);
    expect((await read("a")).occuranceCount).toBe(7);

    await unmerge("b");
    expect((await read("a")).occuranceCount).toBe(5);
    expect((await read("b")).occuranceCount).toBe(2);

    await unmerge("c");
    expect((await read("a")).occuranceCount).toBe(1);
    expect((await read("c")).occuranceCount).toBe(4);
  });

  /*
   * Grouping v2 on the same database: an exception made before it keeps its
   * v1 fingerprint and keeps receiving occurrences by it; every other
   * occurrence is grouped by its v2 fingerprint, so a variant with other line
   * numbers (another v1, the same v2) joins the new exception.
   */
  test("grouping v2: an existing exception keeps its first fingerprint, a new one is made under v2, and its variants join it", async () => {
    clearExistingV1FingerprintCache();

    // Made before grouping v2: its occurrences carried no v2 fingerprint.
    await ingest(["old-v1"]);

    const withV2: (v1: string, v2: string) => TelemetryExceptionPayload = (
      v1: string,
      v2: string,
    ): TelemetryExceptionPayload => {
      return { ...occurrence(v1), fingerprintV2: v2 };
    };

    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      withV2("old-v1", "old-v2"),
      withV2("new-v1-line-40", "new-v2"),
    ]);
    clearExistingV1FingerprintCache();
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      withV2("new-v1-line-52", "new-v2"),
    ]);

    const current: Map<string, GroupRow> = await rows();
    expect(Array.from(current.keys()).sort()).toEqual(["new-v2", "old-v1"]);
    expect(current.get("old-v1")!.occuranceCount).toBe(2);
    expect(current.get("new-v2")!.occuranceCount).toBe(2);
  });

  test("a seeded sweep of ingests, merges and unmerges: the counts always add up", async () => {
    const fingerprints: Array<string> = ["f0", "f1", "f2", "f3", "f4", "f5"];
    const own: Map<string, number> = new Map();
    const random: SeededRandom = seededRandom(5813);

    await ingest(fingerprints);
    for (const fingerprint of fingerprints) {
      own.set(fingerprint, 1);
    }

    for (let step: number = 0; step < 120; step++) {
      const choice: number = random(3);

      if (choice === 0) {
        const batch: Array<string> = [];
        const size: number = 1 + random(6);
        for (let i: number = 0; i < size; i++) {
          const fingerprint: string =
            fingerprints[random(fingerprints.length)]!;
          batch.push(fingerprint);
          own.set(fingerprint, (own.get(fingerprint) || 0) + 1);
        }
        await ingest(batch);
      } else if (choice === 1) {
        const survivor: string = fingerprints[random(fingerprints.length)]!;
        const merged: string = fingerprints[random(fingerprints.length)]!;
        const current: Map<string, GroupRow> = await rows();

        if (
          survivor === merged ||
          current.get(survivor)!.mergedIntoTelemetryExceptionId ||
          current.get(merged)!.mergedIntoTelemetryExceptionId
        ) {
          continue;
        }
        await merge(survivor, [merged]);
      } else {
        await unmerge(fingerprints[random(fingerprints.length)]!);
      }

      // The invariants, against every occurrence ingested so far.
      const current: Map<string, GroupRow> = await rows();
      const idToFingerprint: Map<string, string> = new Map(
        Array.from(current.values()).map((row: GroupRow): [string, string] => {
          return [row._id, row.fingerprint];
        }),
      );
      const problems: Array<string> = [];
      let visibleTotal: number = 0;

      for (const row of current.values()) {
        if (row.mergedIntoTelemetryExceptionId) {
          const survivor: string = idToFingerprint.get(
            row.mergedIntoTelemetryExceptionId,
          )!;
          if (current.get(survivor)!.mergedIntoTelemetryExceptionId) {
            problems.push(`${row.fingerprint} is merged into a merged one`);
          }
          if (row.occuranceCount !== own.get(row.fingerprint)) {
            problems.push(
              `${row.fingerprint} (merged) counts ${row.occuranceCount}`,
            );
          }
          continue;
        }

        let expected: number = own.get(row.fingerprint) || 0;
        for (const member of current.values()) {
          if (member.mergedIntoTelemetryExceptionId === row._id) {
            expected += own.get(member.fingerprint) || 0;
          }
        }
        if (row.occuranceCount !== expected) {
          problems.push(
            `${row.fingerprint} counts ${row.occuranceCount}, expected ${expected}`,
          );
        }
        visibleTotal += row.occuranceCount;
      }

      const ingested: number = Array.from(own.values()).reduce(
        (a: number, b: number): number => {
          return a + b;
        },
        0,
      );
      if (visibleTotal !== ingested) {
        problems.push(`the list counts ${visibleTotal} of ${ingested}`);
      }

      expect([step, problems]).toEqual([step, []]);
    }
  });
});
