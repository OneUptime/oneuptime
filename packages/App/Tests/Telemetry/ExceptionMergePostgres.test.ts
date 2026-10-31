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
import ExceptionMonitorMeasureReader, {
  ExceptionMonitorMeasures,
} from "Common/Server/Utils/Monitor/ExceptionMonitorMeasures";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
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
 * those to a model of every occurrence ingested; another holds the new and
 * regressed exceptions of entity-scoped Exceptions monitors to the groups
 * here and the occurrences ingested.
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

    /*
     * No ClickHouse here: an unmerge finds none of the survivor's own
     * occurrences unless a test says when they were seen.
     */
    jest.spyOn(TelemetryExceptionMerge, "readOwnSeen").mockResolvedValue(null);

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

  /*
   * The list narrowed by an attribute filter, a link from a span or a log
   * and the API look exceptions up by the fingerprints of occurrences: a
   * merged exception's fingerprint finds the exception it was merged into
   * (TelemetryExceptionService.withMergedFingerprintAliases), through the
   * service's own read of this schema.
   */
  test("a merged exception's fingerprint finds the exception it was merged into", async () => {
    jest
      .spyOn(TelemetryExceptionService, "getRepository")
      .mockReturnValue(database.getRepository(TelemetryException) as never);

    await ingest(["a", "b", "c"]);
    await merge("a", ["b"]);

    async function lookUp(fingerprints: Array<string>): Promise<Array<string>> {
      const found: Array<TelemetryException> =
        await TelemetryExceptionService.findBy({
          query: {
            projectId,
            fingerprint: new Includes(fingerprints),
          },
          select: { fingerprint: true },
          limit: 10,
          skip: 0,
          props: { isRoot: true },
        });

      return found
        .map((row: TelemetryException): string => {
          return row.fingerprint || "";
        })
        .sort();
    }

    // The occurrences of b count on a: the list shows a for them.
    expect(await lookUp(["b"])).toEqual(["a"]);
    expect(await lookUp(["b", "c"])).toEqual(["a", "c"]);
    expect(
      (
        await TelemetryExceptionService.countBy({
          query: { projectId, fingerprint: "b" },
          props: { isRoot: true },
        })
      ).positiveNumber,
    ).toBe(1);

    // Unmerged, b's fingerprint is its own again.
    await unmerge("b");
    expect(await lookUp(["b"])).toEqual(["b"]);
  });

  /*
   * A caller that matches the rows back to the fingerprints it asked about
   * (the security case's story and evidence, the session replay's
   * exception links) is told which exception each fingerprint counts on
   * (TelemetryExceptionService.findByOccurrenceFingerprints): b's is a's
   * while b is merged into it, though a's row carries a's fingerprint, and
   * b's own again once it is unmerged.
   */
  test("matching rows back to the fingerprints asked about: a merged one to the exception it was merged into", async () => {
    jest
      .spyOn(TelemetryExceptionService, "getRepository")
      .mockReturnValue(database.getRepository(TelemetryException) as never);

    await ingest(["a", "b", "c", "d"]);
    await merge("a", ["b", "c"]);

    async function counted(
      fingerprints: Array<string>,
    ): Promise<Record<string, Array<string>>> {
      const answer: Map<
        string,
        Array<TelemetryException>
      > = await TelemetryExceptionService.findByOccurrenceFingerprints({
        projectId,
        fingerprints,
        select: { message: true },
        limit: 10,
        props: { isRoot: true },
      });

      const byFingerprint: Record<string, Array<string>> = {};

      for (const [fingerprint, exceptions] of answer) {
        byFingerprint[fingerprint] = exceptions.map(
          (row: TelemetryException): string => {
            return row.fingerprint || "";
          },
        );
      }

      return byFingerprint;
    }

    expect(await counted(["b", "c", "d", "e"])).toEqual({
      b: ["a"],
      c: ["a"],
      d: ["d"],
    });
    expect(await counted(["a", "b"])).toEqual({ a: ["a"], b: ["a"] });

    // The ids are the survivor's own.
    const answer: Map<
      string,
      Array<TelemetryException>
    > = await TelemetryExceptionService.findByOccurrenceFingerprints({
      projectId,
      fingerprints: ["b"],
      select: {},
      limit: 10,
      props: { isRoot: true },
    });
    expect(answer.get("b")![0]!.id!.toString()).toBe((await read("a"))._id);

    // Unmerged, b counts on its own exception again; c is still a's.
    await unmerge("b");
    expect(await counted(["b", "c"])).toEqual({ b: ["b"], c: ["a"] });
  });

  test("an unmerge gives the survivor back its own first and last seen", async () => {
    const day: (n: number) => Date = (n: number): Date => {
      return new Date(Date.UTC(2026, 9, 1 + n));
    };

    // a was seen on days 5 and 20, b on days 1 and 25.
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      { ...occurrence("a"), occurredAt: day(5) },
      { ...occurrence("a"), occurredAt: day(20) },
      { ...occurrence("b"), occurredAt: day(1) },
      { ...occurrence("b"), occurredAt: day(25) },
    ]);

    await merge("a", ["b"]);

    async function seen(fingerprint: string): Promise<[string, string]> {
      const [found]: Array<{ firstSeenAt: Date; lastSeenAt: Date }> =
        await database.query(
          `SELECT "firstSeenAt", "lastSeenAt" FROM "${schema}"."TelemetryException" WHERE "fingerprint" = $1`,
          [fingerprint],
        );
      return [
        new Date(found!.firstSeenAt).toISOString(),
        new Date(found!.lastSeenAt).toISOString(),
      ];
    }

    expect(await seen("a")).toEqual([
      day(1).toISOString(),
      day(25).toISOString(),
    ]);

    // ClickHouse holds a's own occurrences, by a's fingerprint.
    jest.spyOn(TelemetryExceptionMerge, "readOwnSeen").mockResolvedValue({
      firstSeenAt: day(5),
      lastSeenAt: day(20),
      firstSeenInRelease: null,
      lastSeenInRelease: null,
    });

    expect(await unmerge("b")).toBe(ExceptionUnmergeOutcome.Unmerged);
    expect(await seen("a")).toEqual([
      day(5).toISOString(),
      day(20).toISOString(),
    ]);
    // b keeps its own, as it always did.
    expect(await seen("b")).toEqual([
      day(1).toISOString(),
      day(25).toISOString(),
    ]);
  });

  /*
   * AN ENTITY-SCOPED EXCEPTIONS MONITOR OVER MERGED EXCEPTIONS: A SEEDED
   * SWEEP.
   *
   * An infrastructure entity is a property of each occurrence, so a monitor
   * scoped to entities counts its new and regressed exceptions among the
   * groups of the window's occurrences from them
   * (ExceptionMonitorMeasureReader); an occurrence of a merged exception
   * keeps its own fingerprint and counts for the exception it was merged
   * into. Each round ingests random occurrences on random hosts - up to an
   * hour old, and in the window - and resolves, archives and merges
   * exceptions in between, so the window's occurrences bring back resolved
   * ones (Regressed) and make new ones. Then random monitors, scoped and not,
   * read their counts through this Postgres; each is held to the groups it
   * holds and every occurrence ingested. ClickHouse is played by those
   * occurrences.
   */
  test("a seeded sweep of entity-scoped monitors over merged exceptions: new and regressed count what their occurrences say", async () => {
    jest
      .spyOn(TelemetryExceptionService, "getRepository")
      .mockReturnValue(database.getRepository(TelemetryException) as never);

    interface Seen {
      fingerprint: string;
      host: string;
      time: Date;
    }

    interface Group {
      _id: string;
      fingerprint: string;
      firstSeenAt: Date | null;
      regressedAt: Date | null;
      isResolved: boolean;
      isArchived: boolean;
      mergedIntoTelemetryExceptionId: string | null;
    }

    function stepCheckingOn(checkOns: Array<CheckOn>): MonitorStep {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorType: MonitorType.Exceptions,
        monitorName: "Checkout",
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
      });
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      instance.data = {
        ...instance.data!,
        filters: checkOns.map((checkOn: CheckOn) => {
          return { checkOn, filterType: FilterType.GreaterThan, value: 0 };
        }),
      };
      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = { monitorCriteriaInstanceArray: [instance] };
      step.setMonitorCriteria(criteria);
      return step;
    }

    const fingerprints: Array<string> = ["e0", "e1", "e2", "e3", "e4", "e5"];
    const hosts: Array<string> = ["host:a", "host:b", "host:c"];
    const minute: number = 60 * 1000;
    const random: SeededRandom = seededRandom(5461);

    // What the sweep met, so it cannot pass on nothing.
    let scopedReads: number = 0;
    let narrowedReads: number = 0;
    let regressedReads: number = 0;
    let reachedThroughMerged: number = 0;

    for (let round: number = 0; round < 20; round++) {
      await database.query(`DELETE FROM "${schema}"."TelemetryException"`);

      const seen: Array<Seen> = [];
      const now: number = Date.now();

      const ingestSeen: (batch: Array<Seen>) => Promise<void> = async (
        batch: Array<Seen>,
      ): Promise<void> => {
        await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch(
          batch.map((entry: Seen): TelemetryExceptionPayload => {
            return { ...occurrence(entry.fingerprint), occurredAt: entry.time };
          }),
        );
        seen.push(...batch);
      };

      // From an hour to twenty minutes ago: every exception but the late ones.
      const late: Array<string> = fingerprints.filter((): boolean => {
        return random(4) === 0;
      });
      const early: Array<Seen> = [];

      for (const fingerprint of fingerprints) {
        if (late.includes(fingerprint)) {
          continue;
        }

        const count: number = 1 + random(2);

        for (let draw: number = 0; draw < count; draw++) {
          early.push({
            fingerprint,
            host: hosts[random(hosts.length)]!,
            time: new Date(now - (20 + random(40)) * minute - 17000),
          });
        }
      }

      await ingestSeen(early);

      // Resolved a quarter of an hour ago, or archived; and some merged.
      for (const fingerprint of fingerprints) {
        if (late.includes(fingerprint)) {
          continue;
        }

        const draw: number = random(6);

        if (draw < 2) {
          await database.query(
            `UPDATE "${schema}"."TelemetryException" SET "isResolved" = true, "markedAsResolvedAt" = now() - interval '15 minutes' WHERE "fingerprint" = $1`,
            [fingerprint],
          );
        } else if (draw === 2) {
          await database.query(
            `UPDATE "${schema}"."TelemetryException" SET "isArchived" = true WHERE "fingerprint" = $1`,
            [fingerprint],
          );
        }
      }

      for (let attempt: number = 0; attempt < 3; attempt++) {
        const survivor: string = fingerprints[random(fingerprints.length)]!;
        const merged: string = fingerprints[random(fingerprints.length)]!;
        const current: Map<string, GroupRow> = await rows();

        if (
          survivor === merged ||
          !current.has(survivor) ||
          !current.has(merged) ||
          current.get(survivor)!.mergedIntoTelemetryExceptionId ||
          current.get(merged)!.mergedIntoTelemetryExceptionId
        ) {
          continue;
        }

        await merge(survivor, [merged]);
      }

      // The window: the last eight minutes, on random hosts.
      const recent: Array<Seen> = [];
      const recentCount: number = 2 + random(6);

      for (let draw: number = 0; draw < recentCount; draw++) {
        recent.push({
          fingerprint: fingerprints[random(fingerprints.length)]!,
          host: hosts[random(hosts.length)]!,
          time: new Date(now - random(8) * minute - 23000),
        });
      }

      await ingestSeen(recent);

      /*
       * The monitor evaluates a moment after the last occurrence was taken
       * in: Postgres stamps a regression to the microsecond, and a window
       * that ended in the same millisecond would cut it by less than a
       * millisecond can say.
       */
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 5);
      });

      const groups: Array<Group> = await database.query(
        `SELECT "_id"::text AS "_id", "fingerprint", "firstSeenAt", "regressedAt", "isResolved", "isArchived",
                "mergedIntoTelemetryExceptionId"::text AS "mergedIntoTelemetryExceptionId"
         FROM "${schema}"."TelemetryException"`,
      );

      for (let read: number = 0; read < 5; read++) {
        const config: MonitorStepExceptionMonitor = {
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          entityKeys:
            random(4) === 0
              ? []
              : hosts.filter((): boolean => {
                  return random(2) === 0;
                }),
          includeResolved: random(3) === 0,
          includeArchived: random(3) === 0,
          lastXSecondsOfExceptions: random(2) === 0 ? 600 : 1800,
        };
        const until: Date = new Date();

        // The count query, as the worker builds it.
        const excluded: Array<string> =
          await TelemetryExceptionService.getResolvedOrArchivedFingerprints({
            projectId,
            resolved: !config.includeResolved,
            archived: !config.includeArchived,
          });
        const countQuery: Record<string, unknown> = {
          ...MonitorStepExceptionMonitorUtil.toAnalyticsQuery(config, until),
          projectId,
          ...(excluded.length > 0
            ? { fingerprint: new IncludesNone(excluded) }
            : {}),
        };

        // ClickHouse, played by the occurrences ingested.
        jest
          .spyOn(ExceptionInstanceService, "findBy")
          .mockImplementation((async (findBy: {
            query: Record<string, unknown>;
          }) => {
            const time: InBetween<Date> = findBy.query[
              "time"
            ] as InBetween<Date>;
            const entityKeys: Array<string> | null = findBy.query["entityKeys"]
              ? ((findBy.query["entityKeys"] as Includes)
                  .values as Array<string>)
              : null;
            const leftOut: Array<string> = findBy.query["fingerprint"]
              ? ((findBy.query["fingerprint"] as IncludesNone)
                  .values as Array<string>)
              : [];
            const found: Set<string> = new Set();

            for (const entry of seen) {
              if (
                entry.time.getTime() >= new Date(time.startValue).getTime() &&
                entry.time.getTime() <= new Date(time.endValue).getTime() &&
                (!entityKeys || entityKeys.includes(entry.host)) &&
                !leftOut.includes(entry.fingerprint)
              ) {
                found.add(entry.fingerprint);
              }
            }

            return Array.from(found).map(
              (fingerprint: string): ExceptionInstance => {
                const row: ExceptionInstance = new ExceptionInstance();
                row.fingerprint = fingerprint;
                return row;
              },
            );
          }) as never);

        const measures: ExceptionMonitorMeasures =
          await ExceptionMonitorMeasureReader.read({
            projectId,
            monitorStep: stepCheckingOn([
              CheckOn.NewExceptionCount,
              CheckOn.RegressedExceptionCount,
            ]),
            config,
            countQuery,
            exceptionCount: 0,
            evaluateUntil: until,
          });

        // The model: each exception not merged into another, with those merged into it.
        const windowStart: number =
          until.getTime() - config.lastXSecondsOfExceptions * 1000;
        const inWindow: (value: Date | null) => boolean = (
          value: Date | null,
        ): boolean => {
          return (
            value !== null &&
            new Date(value).getTime() >= windowStart &&
            new Date(value).getTime() <= until.getTime()
          );
        };
        const scoped: boolean = (config.entityKeys || []).length > 0;
        let newCount: number = 0;
        let regressedCount: number = 0;
        let unscopedTotal: number = 0;

        for (const group of groups) {
          if (group.mergedIntoTelemetryExceptionId) {
            continue;
          }

          const members: Array<string> = groups
            .filter((member: Group): boolean => {
              return member.mergedIntoTelemetryExceptionId === group._id;
            })
            .map((member: Group): string => {
              return member.fingerprint;
            });
          const reachedBy: (allowed: Array<string>) => boolean = (
            allowed: Array<string>,
          ): boolean => {
            return seen.some((entry: Seen): boolean => {
              return (
                allowed.includes(entry.fingerprint) &&
                inWindow(entry.time) &&
                (config.entityKeys || []).includes(entry.host) &&
                !excluded.includes(entry.fingerprint)
              );
            });
          };
          const reached: boolean = reachedBy([group.fingerprint, ...members]);

          if (!config.includeArchived && group.isArchived) {
            continue;
          }

          const isNew: boolean =
            inWindow(group.firstSeenAt) &&
            (config.includeResolved || !group.isResolved);
          const isRegressed: boolean =
            inWindow(group.regressedAt) && !group.isResolved;

          unscopedTotal += (isNew ? 1 : 0) + (isRegressed ? 1 : 0);

          if (scoped && !reached) {
            continue;
          }

          if (
            scoped &&
            (isNew || isRegressed) &&
            !reachedBy([group.fingerprint])
          ) {
            reachedThroughMerged++;
          }

          newCount += isNew ? 1 : 0;
          regressedCount += isRegressed ? 1 : 0;
        }

        expect({
          round,
          read,
          entityKeys: config.entityKeys,
          measures,
        }).toEqual({
          round,
          read,
          entityKeys: config.entityKeys,
          measures: {
            newExceptionCount: newCount,
            regressedExceptionCount: regressedCount,
          },
        });

        scopedReads += scoped ? 1 : 0;
        narrowedReads +=
          scoped && newCount + regressedCount < unscopedTotal ? 1 : 0;
        regressedReads += regressedCount > 0 ? 1 : 0;
      }
    }

    expect(scopedReads).toBeGreaterThan(40);
    expect(narrowedReads).toBeGreaterThan(5);
    expect(regressedReads).toBeGreaterThan(5);
    expect(reachedThroughMerged).toBeGreaterThan(0);
  });
});
