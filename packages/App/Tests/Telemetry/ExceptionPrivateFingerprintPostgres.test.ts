import ExceptionUtil, {
  TelemetryExceptionPayload,
  clearExistingV1FingerprintCache,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import Entities from "Common/Models/DatabaseModels/Index";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import TelemetryExceptionActivityService from "Common/Server/Services/TelemetryExceptionActivityService";
import TelemetryExceptionMerge, {
  ExceptionMergeOutcome,
  ExceptionUnmergeOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionMerge";
import TelemetryExceptionRekey, {
  ExceptionRekeyOutcome,
  ExceptionRekeyResult,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionRekey";
import FormerExceptionFingerprints, {
  FORMER_FINGERPRINT_MIN_AGE_MS,
} from "Common/Server/Utils/Telemetry/FormerExceptionFingerprints";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { DataSource, EntityManager } from "Common/node_modules/typeorm";

/*
 * AN EXCEPTION MOVED TO A PRIVATE FINGERPRINT, ON POSTGRES (#10619).
 *
 * An exception made before #10434 under an unkeyed hash of text a scrub rule
 * now hides is moved, on its next occurrence the rule changed, to the keyed
 * fingerprint of the same text: its row keeps its id, state and counts, and
 * its old fingerprint is kept by a row of its own merged into it, which the
 * occurrences from before the move still carry. The unit suites fake the
 * database; this runs the move's transaction, the ingest upsert around it
 * and a person's merges and unmerges on a real one:
 *
 *   - the move, once, whatever copies of the exception race to it;
 *   - every later occurrence, a rule or not, goes to the new fingerprint;
 *   - the reads of the exception's occurrences follow the old one (its group
 *     fingerprints, and a session replay's exception groups);
 *   - nothing is split or merged, and the old fingerprint is never merged or
 *     unmerged on its own, but goes where its exception goes.
 *
 * Opt in with RUN_POSTGRES_EXCEPTION_MERGE_TESTS=true against a Postgres
 * migrated to the current head, as ExceptionMergePostgres.test.ts does: the
 * migrated TelemetryException's structure is cloned into a unique schema
 * that is dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from EXCEPTION_MERGE_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from EXCEPTION_MERGE_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EXCEPTION_MERGE_TESTS"] === "true"
    ? describe
    : describe.skip;

interface Row {
  _id: string;
  fingerprint: string;
  occuranceCount: number;
  mergedIntoTelemetryExceptionId: string | null;
  formerFingerprintOfTelemetryExceptionId: string | null;
}

// The unkeyed fingerprint a span's exception was made under before #10434.
const UNKEYED: string = "a".repeat(64);
// The keyed fingerprint of the same text.
const KEYED: string = "b".repeat(64);

describePostgres(
  "moving an exception to a private fingerprint on Postgres",
  () => {
    const schema: string = `exception_rekey_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const projectId: ObjectID = ObjectID.generate();
    const serviceId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();
    let database: DataSource;

    /*
     * One occurrence of the exception, as ingest hands it over: tried under
     * its unkeyed fingerprint, then the keyed one; and, when a rule hid what
     * the unkeyed one hashes, the move from one to the other.
     */
    function occurrence(data: {
      ruleHidIt: boolean;
      fingerprint?: string | undefined;
    }): TelemetryExceptionPayload {
      return {
        fingerprint: data.fingerprint || UNKEYED,
        fingerprintV2: data.fingerprint || UNKEYED,
        fingerprintCandidates: [data.fingerprint || UNKEYED, KEYED],
        ...(data.ruleHidIt ? { fingerprintRekeys: { [UNKEYED]: KEYED } } : {}),
        projectId,
        primaryEntityId: serviceId,
        primaryEntityType: ServiceType.OpenTelemetry,
        exceptionType: "InvalidSsnError",
        message: data.ruleHidIt
          ? "Invalid SSN [REDACTED] on file"
          : "Invalid SSN 123-45-6789 on file",
        occurredAt: new Date(Date.now() - 60 * 1000),
      };
    }

    async function ingest(
      occurrences: Array<TelemetryExceptionPayload>,
    ): Promise<void> {
      await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch(occurrences);
    }

    async function rows(): Promise<Array<Row>> {
      return database.query(
        `SELECT "_id"::text AS "_id", "fingerprint", "occuranceCount",
              "mergedIntoTelemetryExceptionId"::text AS "mergedIntoTelemetryExceptionId",
              "formerFingerprintOfTelemetryExceptionId"::text AS "formerFingerprintOfTelemetryExceptionId"
       FROM "${schema}"."TelemetryException" ORDER BY "createdAt", "fingerprint"`,
      );
    }

    async function read(fingerprint: string): Promise<Row> {
      const row: Row | undefined = (await rows()).find(
        (entry: Row): boolean => {
          return entry.fingerprint === fingerprint;
        },
      );
      expect(row).toBeDefined();
      return row!;
    }

    // The exceptions of the table: not the rows that keep a former fingerprint.
    async function exceptions(): Promise<Array<Row>> {
      return (await rows()).filter((row: Row): boolean => {
        return !row.formerFingerprintOfTelemetryExceptionId;
      });
    }

    // An exception of its own, made by an ingest that no rule changed.
    async function anotherException(fingerprint: string): Promise<Row> {
      await ingest([
        {
          fingerprint,
          fingerprintV2: fingerprint,
          fingerprintCandidates: [fingerprint],
          projectId,
          primaryEntityId: serviceId,
          primaryEntityType: ServiceType.OpenTelemetry,
          exceptionType: "TypeError",
          message: `message of ${fingerprint}`,
          occurredAt: new Date(Date.now() - 60 * 1000),
        },
      ]);
      return read(fingerprint);
    }

    // The span exception from before #10434, under its unkeyed fingerprint.
    async function exceptionFromBefore(): Promise<Row> {
      await ingest([occurrence({ ruleHidIt: false })]);
      clearExistingV1FingerprintCache();
      return read(UNKEYED);
    }

    // Its group as the database holds it now: nothing kept from a read before.
    async function groupOf(row: Row): Promise<Array<string>> {
      TelemetryExceptionService.clearGroupFingerprints();

      return (
        (
          await TelemetryExceptionService.getGroupFingerprints({
            projectId,
            exceptions: [{ id: row._id, fingerprint: row.fingerprint }],
          })
        ).get(row._id.toLowerCase()) || []
      );
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
      for (const level of ["debug", "info", "warn", "error"] as const) {
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
      jest
        .spyOn(TelemetryExceptionService, "forgetGroupFingerprints")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(TelemetryExceptionActivityService, "record")
        .mockResolvedValue(0 as never);
      jest
        .spyOn(TelemetryExceptionMerge, "readOwnSeen")
        .mockResolvedValue(null);
      jest
        .spyOn(TelemetryExceptionMerge, "recordInAuditLog")
        .mockResolvedValue(undefined);

      // Who may edit is the merge suites'; here everyone may.
      jest
        .spyOn(TelemetryExceptionMerge, "readEditable")
        .mockImplementation((async (data: { ids: Array<ObjectID> }) => {
          const found: Array<{
            _id: string;
            primaryEntityId: string;
            fingerprint: string;
            mergedIntoTelemetryExceptionId: string | null;
            formerFingerprintOfTelemetryExceptionId: string | null;
          }> = await database.query(
            `SELECT "_id"::text AS "_id", "primaryEntityId"::text AS "primaryEntityId", "fingerprint",
                  "mergedIntoTelemetryExceptionId"::text AS "mergedIntoTelemetryExceptionId",
                  "formerFingerprintOfTelemetryExceptionId"::text AS "formerFingerprintOfTelemetryExceptionId"
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
              if (entry.formerFingerprintOfTelemetryExceptionId) {
                model.formerFingerprintOfTelemetryExceptionId = new ObjectID(
                  entry.formerFingerprintOfTelemetryExceptionId,
                );
              }
              return model;
            },
          );
        }) as never);

      clearExistingV1FingerprintCache();
      await database.query(`DELETE FROM "${schema}"."TelemetryException"`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function props(): { tenantId: ObjectID; userId: ObjectID } {
      return { tenantId: projectId, userId };
    }

    test("its next occurrence a rule changed moves it: the same row, its count, the keyed fingerprint, and a row merged into it that keeps the old one", async () => {
      const before: Row = await exceptionFromBefore();

      await ingest([occurrence({ ruleHidIt: true })]);

      const moved: Row = await read(KEYED);
      expect(moved._id).toBe(before._id);
      expect(moved.occuranceCount).toBe(2);
      expect(moved.mergedIntoTelemetryExceptionId).toBeNull();

      const kept: Row = await read(UNKEYED);
      expect(kept.formerFingerprintOfTelemetryExceptionId).toBe(before._id);
      expect(kept.mergedIntoTelemetryExceptionId).toBe(before._id);
      expect(kept.occuranceCount).toBe(0);

      // Nothing split: one exception.
      expect(await exceptions()).toHaveLength(1);
    });

    test("every later occurrence goes to the keyed fingerprint, a rule or not, in a process that read nothing yet, and nothing moves twice", async () => {
      const before: Row = await exceptionFromBefore();
      await ingest([occurrence({ ruleHidIt: true })]);

      for (const ruleHidIt of [true, false, true]) {
        clearExistingV1FingerprintCache();
        await ingest([occurrence({ ruleHidIt })]);
      }

      expect((await read(KEYED))._id).toBe(before._id);
      expect((await read(KEYED)).occuranceCount).toBe(5);
      expect((await read(UNKEYED)).occuranceCount).toBe(0);
      expect(await rows()).toHaveLength(2);
    });

    test("the reads of its occurrences follow the old fingerprint: its group, and a session replay's exception groups", async () => {
      await exceptionFromBefore();
      await ingest([occurrence({ ruleHidIt: true })]);

      const moved: Row = await read(KEYED);

      expect(await groupOf(moved)).toEqual([KEYED, UNKEYED]);
      TelemetryExceptionService.clearGroupFingerprints();
      expect(
        await TelemetryExceptionService.getGroupFingerprintsOfFingerprint({
          projectId,
          fingerprint: KEYED,
          primaryEntityId: serviceId,
        }),
      ).toEqual([KEYED, UNKEYED]);
    });

    test("copies of the exception racing to move it move it once", async () => {
      const before: Row = await exceptionFromBefore();

      const results: Array<ExceptionRekeyResult> = await Promise.all(
        [1, 2, 3].map((): Promise<ExceptionRekeyResult> => {
          return TelemetryExceptionRekey.rekey({
            projectId: projectId.toString(),
            primaryEntityId: serviceId.toString(),
            from: UNKEYED,
            to: KEYED,
          });
        }),
      );

      expect(
        results.map((result: ExceptionRekeyResult): string => {
          return result.fingerprint;
        }),
      ).toEqual([KEYED, KEYED, KEYED]);
      expect(
        results.filter((result: ExceptionRekeyResult): boolean => {
          return result.outcome === ExceptionRekeyOutcome.Moved;
        }),
      ).toHaveLength(1);
      expect((await read(KEYED))._id).toBe(before._id);
      expect(await rows()).toHaveLength(2);
    });

    test("the keyed fingerprint taken by another exception: nothing moves, and nothing merges", async () => {
      const before: Row = await exceptionFromBefore();
      const stray: Row = await anotherException(KEYED);
      clearExistingV1FingerprintCache();

      await ingest([occurrence({ ruleHidIt: true })]);

      expect((await read(UNKEYED))._id).toBe(before._id);
      expect((await read(UNKEYED)).occuranceCount).toBe(2);
      expect((await read(KEYED))._id).toBe(stray._id);
      expect((await read(KEYED)).mergedIntoTelemetryExceptionId).toBeNull();
      expect(await rows()).toHaveLength(2);
    });

    test("merged into another by a person, its old fingerprint goes along; unmerged, it comes back with it", async () => {
      await exceptionFromBefore();
      await ingest([occurrence({ ruleHidIt: true })]);
      const moved: Row = await read(KEYED);
      const survivor: Row = await anotherException("c".repeat(64));

      const merged: Awaited<ReturnType<typeof TelemetryExceptionMerge.merge>> =
        await TelemetryExceptionMerge.merge({
          telemetryExceptionId: new ObjectID(survivor._id),
          mergedTelemetryExceptionIds: [new ObjectID(moved._id)],
          props: props(),
        });

      expect(merged.merged).toEqual([
        {
          telemetryExceptionId: moved._id,
          outcome: ExceptionMergeOutcome.Merged,
        },
      ]);
      expect((await read(UNKEYED)).mergedIntoTelemetryExceptionId).toBe(
        survivor._id,
      );
      // The survivor reads every occurrence of it, those from before the move too.
      expect(await groupOf(await read(survivor.fingerprint))).toEqual(
        expect.arrayContaining([survivor.fingerprint, KEYED, UNKEYED]),
      );
      expect((await read(survivor.fingerprint)).occuranceCount).toBe(3);

      expect(
        (
          await TelemetryExceptionMerge.unmerge({
            telemetryExceptionId: new ObjectID(moved._id),
            props: props(),
          })
        ).outcome,
      ).toBe(ExceptionUnmergeOutcome.Unmerged);

      expect((await read(UNKEYED)).mergedIntoTelemetryExceptionId).toBe(
        moved._id,
      );
      expect(await groupOf(await read(KEYED))).toEqual([KEYED, UNKEYED]);
      expect(await groupOf(await read(survivor.fingerprint))).toEqual([
        survivor.fingerprint,
      ]);
      expect((await read(survivor.fingerprint)).occuranceCount).toBe(1);
      expect((await read(KEYED)).occuranceCount).toBe(2);
    });

    test("one a person merged before the move: its old fingerprint is merged into the one it was merged into", async () => {
      const before: Row = await exceptionFromBefore();
      const survivor: Row = await anotherException("c".repeat(64));

      await TelemetryExceptionMerge.merge({
        telemetryExceptionId: new ObjectID(survivor._id),
        mergedTelemetryExceptionIds: [new ObjectID(before._id)],
        props: props(),
      });
      clearExistingV1FingerprintCache();
      await ingest([occurrence({ ruleHidIt: true })]);

      expect((await read(KEYED))._id).toBe(before._id);
      expect((await read(UNKEYED)).mergedIntoTelemetryExceptionId).toBe(
        survivor._id,
      );
      expect(
        (await read(UNKEYED)).formerFingerprintOfTelemetryExceptionId,
      ).toBe(before._id);
      expect(await groupOf(await read(survivor.fingerprint))).toEqual(
        expect.arrayContaining([survivor.fingerprint, KEYED, UNKEYED]),
      );
    });

    test("its old fingerprint is never merged, merged into or unmerged on its own", async () => {
      await exceptionFromBefore();
      await ingest([occurrence({ ruleHidIt: true })]);
      const kept: Row = await read(UNKEYED);
      const other: Row = await anotherException("c".repeat(64));

      await expect(
        TelemetryExceptionMerge.merge({
          telemetryExceptionId: new ObjectID(other._id),
          mergedTelemetryExceptionIds: [new ObjectID(kept._id)],
          props: props(),
        }),
      ).rejects.toThrow("former fingerprint");
      await expect(
        TelemetryExceptionMerge.merge({
          telemetryExceptionId: new ObjectID(kept._id),
          mergedTelemetryExceptionIds: [new ObjectID(other._id)],
          props: props(),
        }),
      ).rejects.toThrow("former fingerprint");
      await expect(
        TelemetryExceptionMerge.unmerge({
          telemetryExceptionId: new ObjectID(kept._id),
          props: props(),
        }),
      ).rejects.toThrow("former fingerprint");

      expect((await read(UNKEYED)).mergedIntoTelemetryExceptionId).toBe(
        (await read(KEYED))._id,
      );
    });

    test("once no occurrence carries its old fingerprint, the row that keeps it is deleted, and the exception is found by its new one alone", async () => {
      await exceptionFromBefore();
      await ingest([occurrence({ ruleHidIt: true })]);
      const moved: Row = await read(KEYED);
      const later: Date = new Date(
        Date.now() + FORMER_FINGERPRINT_MIN_AGE_MS + 60 * 1000,
      );

      // An occurrence from before the move is kept still: the row stays.
      const carried: jest.SpyInstance = jest
        .spyOn(FormerExceptionFingerprints, "readCarried")
        .mockResolvedValue(new Set<string>([UNKEYED]));
      expect(
        await FormerExceptionFingerprints.retireUncarried({ now: later }),
      ).toEqual({ read: 1, retired: 0 });
      expect(await rows()).toHaveLength(2);

      // A day after the move at least: not before.
      carried.mockResolvedValue(new Set<string>());
      expect(
        await FormerExceptionFingerprints.retireUncarried({ now: new Date() }),
      ).toEqual({ read: 0, retired: 0 });

      // Past their retention: deleted, and the exception is as it was.
      expect(
        await FormerExceptionFingerprints.retireUncarried({ now: later }),
      ).toEqual({ read: 1, retired: 1 });
      expect(await rows()).toHaveLength(1);
      expect((await read(KEYED))._id).toBe(moved._id);
      expect((await read(KEYED)).occuranceCount).toBe(2);
      expect(await groupOf(await read(KEYED))).toEqual([KEYED]);

      // Its next occurrence, a rule or not, still finds it: nothing new.
      clearExistingV1FingerprintCache();
      await ingest([occurrence({ ruleHidIt: false })]);
      expect(await rows()).toHaveLength(1);
      expect((await read(KEYED)).occuranceCount).toBe(3);
    });
  },
);
