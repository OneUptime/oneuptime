import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DiscordReactionObservationService, {
  OBSERVATION_STALE_AFTER_MS,
  ObservationClaim,
} from "../../../Server/Services/DiscordReactionObservationService";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Real-database races for the durable Discord observation claim
 * (HOM-43 review 3, gate 1). Opt in with RUN_POSTGRES_DISCORD_OBSERVATION_TESTS=true
 * against a migrated Postgres, e.g. the parity runner with PARITY_TEST_POSTGRES=1:
 *
 *   PARITY_TEST_POSTGRES=1 bash packages/E2E/Discord/Fixture/parity-runner.sh \
 *     start <worktree> hom43-observation-races-01 common-test \
 *     Tests/Server/Services/DiscordReactionObservationPostgres.test.ts
 *
 * These races cannot be reproduced with the mocked DatabaseService: the
 * defects lived exactly in the non-atomic read-then-write gap between
 * findOneBy and updateBy. Every case below failed against the pre-review
 * implementation and passes against the single-conditional-write claim.
 *
 * Cases (failure inventory, written before the correction):
 *   1. concurrent fresh claims: exactly one Claimed among N racing workers.
 *   2. concurrent stale steals: exactly one Claimed when N workers race to
 *      steal the same abandoned Pending row.
 *   3. completion-versus-reclaim: a stale worker's markDone with an outdated
 *      token cannot terminate a claim the fresh worker re-took.
 *   4. a stale steal of a row whose observedAt is fresh returns
 *      AlreadyObserved (the steal predicate includes the timestamp).
 */

const describePostgres = (
  process.env["RUN_POSTGRES_DISCORD_OBSERVATION_TESTS"] === "true"
    ? describe
    : describe.skip
) as typeof describe;

const STALE: number = OBSERVATION_STALE_AFTER_MS + 60_000;

type ClaimKeyFunction = (n: number) => string;

/*
 * v13 ts-jest: ObservationClaim is a discriminated union; only the
 * "Claimed" arm carries observedAt. Narrow instead of reading it off the
 * union (TS2339 on v13).
 */
const claimedToken = (claim: ObservationClaim): Date => {
  if (claim.result === "Claimed" && claim.observedAt instanceof Date) {
    return claim.observedAt;
  }
  throw new Error("expected a Claimed observation with a token");
};

const key: ClaimKeyFunction = (n: number): string => {
  return `race-key-${n}`;
};

describePostgres(
  "DiscordReactionObservation claim races (real Postgres)",
  (): void => {
    let database: DataSource;
    let projectId: ObjectID;

    beforeAll(async (): Promise<void> => {
      database = new DataSource({
        type: "postgres",
        host: process.env["DATABASE_HOST"] || "postgres",
        port: Number(process.env["DATABASE_PORT"] || "5432"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database: process.env["DATABASE_NAME"] || "fixture",
        entities: Entities,
        synchronize: false,
      });
      await database.initialize();
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      projectId = ObjectID.generate();
      await database.query(
        `INSERT INTO "Project" ("_id", "name", "slug", "version") VALUES ($1, $2, $3, 1) ON CONFLICT DO NOTHING`,
        [
          projectId.toString(),
          `obs-race-${projectId}`,
          `obs-race-${projectId}`,
        ],
      );
    });

    beforeEach(async (): Promise<void> => {
      await database.query(
        `DELETE FROM "DiscordReactionObservation" WHERE "projectId" = $1`,
        [projectId.toString()],
      );
    });

    afterAll(async (): Promise<void> => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(
          `DELETE FROM "DiscordReactionObservation" WHERE "projectId" = $1`,
          [projectId.toString()],
        );
        await database.query(`DELETE FROM "Project" WHERE "_id" = $1`, [
          projectId.toString(),
        ]);
        await database.destroy();
      }
    });

    test("concurrent fresh claims: exactly one winner", async (): Promise<void> => {
      const results: Array<string> = (
        (await Promise.all(
          Array.from({ length: 12 }, (): Promise<unknown> => {
            return DiscordReactionObservationService.claim({
              projectId: projectId,
              claimKey: key(1),
              source: "reaction",
            }).catch((): unknown => {
              return { result: "Threw" };
            });
          }),
        )) as Array<{ result: string }>
      ).map((claim: { result: string }): string => {
        return claim.result;
      });

      const winners: number = results.filter(
        (result: string): boolean => result === "Claimed",
      ).length;

      expect(winners).toBe(1);
      expect(results).not.toContain("Threw");
    });

    test("concurrent stale steals: exactly one winner", async (): Promise<void> => {
      await database.query(
        `INSERT INTO "DiscordReactionObservation" ("_id", "version", "projectId", "claimKey", "source", "observationState", "observedAt")
       VALUES ($1, 1, $2, $3, 'reaction', 'Pending', now() - ($4 || ' milliseconds')::interval)`,
        [ObjectID.generate().toString(), projectId.toString(), key(2), STALE],
      );

      const results: Array<string> = (
        (await Promise.all(
          Array.from({ length: 12 }, (): Promise<unknown> => {
            return DiscordReactionObservationService.claim({
              projectId: projectId,
              claimKey: key(2),
              source: "reaction",
            }).catch((): unknown => {
              return { result: "Threw" };
            });
          }),
        )) as Array<{ result: string }>
      ).map((claim: { result: string }): string => {
        return claim.result;
      });

      const winners: number = results.filter(
        (result: string): boolean => result === "Claimed",
      ).length;

      expect(winners).toBe(1);
      expect(results).not.toContain("Threw");
    });

    test("a stolen claim cannot be marked Done by its previous owner", async (): Promise<void> => {
      const first: ObservationClaim =
        await DiscordReactionObservationService.claim({
          projectId: projectId,
          claimKey: key(3),
          source: "reaction",
        });
      expect(first.result).toBe("Claimed");

      // Abandon the first claim beyond the stale threshold, then steal it.
      await database.query(
        `UPDATE "DiscordReactionObservation" SET "observedAt" = now() - ($2 || ' milliseconds')::interval WHERE "projectId" = $1 AND "claimKey" = $3`,
        [projectId.toString(), STALE, key(3)],
      );

      const second: ObservationClaim =
        await DiscordReactionObservationService.claim({
          projectId: projectId,
          claimKey: key(3),
          source: "reaction",
        });
      expect(second.result).toBe("Claimed");

      // The previous owner's terminal write must not affect the new claim.
      const staleDone: boolean =
        await DiscordReactionObservationService.markDone({
          projectId: projectId,
          claimKey: key(3),
          observedAt: claimedToken(first),
        });

      const state: Array<{ observationState: string }> = await database.query(
        `SELECT "observationState" FROM "DiscordReactionObservation" WHERE "projectId" = $1 AND "claimKey" = $2`,
        [projectId.toString(), key(3)],
      );

      expect(staleDone).toBe(false);
      expect(state[0]?.observationState).toBe("Pending");

      // The current owner still can.
      const ownerDone: boolean =
        await DiscordReactionObservationService.markDone({
          projectId: projectId,
          claimKey: key(3),
          observedAt: claimedToken(second),
        });
      expect(ownerDone).toBe(true);
    });

    test("a fresh Pending claim is not stealable (predicate includes the timestamp)", async (): Promise<void> => {
      const first: ObservationClaim =
        await DiscordReactionObservationService.claim({
          projectId: projectId,
          claimKey: key(4),
          source: "pin",
        });
      expect(first.result).toBe("Claimed");

      const second: ObservationClaim =
        await DiscordReactionObservationService.claim({
          projectId: projectId,
          claimKey: key(4),
          source: "pin",
        });
      expect(second.result).toBe("AlreadyObserved");
    });

    // ---- HOM-43 review 4: token enforcement (red against fail-open code) ----
    // Completion and release are separate cases: a combined case stops at
    // the first failed assertion and never exercises the rest (Astra,
    // review of hom43-token-red-01).

    test("an omitted token cannot complete another worker's claim", async (): Promise<void> => {
      const owner: ObservationClaim =
        await DiscordReactionObservationService.claim({
          projectId: projectId,
          claimKey: key(5),
          source: "reaction",
        });
      expect(owner.result).toBe("Claimed");

      // Undefined token (cast: the fixed signature requires a Date).
      // Must be refused, not treated as a wildcard.
      const doneNoToken: boolean =
        await DiscordReactionObservationService.markDone({
          projectId: projectId,
          claimKey: key(5),
          observedAt: undefined as unknown as Date,
        });
      expect(doneNoToken).toBe(false);

      const state: Array<{ observationState: string }> = await database.query(
        `SELECT "observationState" FROM "DiscordReactionObservation" WHERE "projectId" = $1 AND "claimKey" = $2`,
        [projectId.toString(), key(5)],
      );
      expect(state[0]?.observationState).toBe("Pending");
    });

    test("an omitted token cannot release another worker's claim", async (): Promise<void> => {
      const owner: ObservationClaim =
        await DiscordReactionObservationService.claim({
          projectId: projectId,
          claimKey: key(8),
          source: "reaction",
        });
      expect(owner.result).toBe("Claimed");

      await DiscordReactionObservationService.release({
        projectId: projectId,
        claimKey: key(8),
        observedAt: undefined as unknown as Date,
      });

      // The row must survive a tokenless release.
      const state: Array<{ observationState: string }> = await database.query(
        `SELECT "observationState" FROM "DiscordReactionObservation" WHERE "projectId" = $1 AND "claimKey" = $2`,
        [projectId.toString(), key(8)],
      );
      expect(state.length).toBe(1);
      expect(state[0]?.observationState).toBe("Pending");
    });

    test("a stale token reports false after the new owner completed", async (): Promise<void> => {
      const first: ObservationClaim =
        await DiscordReactionObservationService.claim({
          projectId: projectId,
          claimKey: key(6),
          source: "reaction",
        });
      expect(first.result).toBe("Claimed");

      await database.query(
        `UPDATE "DiscordReactionObservation" SET "observedAt" = now() - interval '16 minutes' WHERE "projectId" = $1 AND "claimKey" = $2`,
        [projectId.toString(), key(6)],
      );

      const second: ObservationClaim =
        await DiscordReactionObservationService.claim({
          projectId: projectId,
          claimKey: key(6),
          source: "reaction",
        });
      expect(second.result).toBe("Claimed");

      const doneByOwner: boolean =
        await DiscordReactionObservationService.markDone({
          projectId: projectId,
          claimKey: key(6),
          observedAt: claimedToken(second),
        });
      expect(doneByOwner).toBe(true);

      // The previous owner's late markDone must report failure, not ride the
      // token-blind Done fallback to success.
      const doneByStale: boolean =
        await DiscordReactionObservationService.markDone({
          projectId: projectId,
          claimKey: key(6),
          observedAt: claimedToken(first),
        });
      expect(doneByStale).toBe(false);
    });

    test("an idempotent retry by the same owner still reports true", async (): Promise<void> => {
      const owner: ObservationClaim =
        await DiscordReactionObservationService.claim({
          projectId: projectId,
          claimKey: key(7),
          source: "pin",
        });
      expect(owner.result).toBe("Claimed");

      const first: boolean = await DiscordReactionObservationService.markDone({
        projectId: projectId,
        claimKey: key(7),
        observedAt: claimedToken(owner),
      });
      expect(first).toBe(true);

      const retry: boolean = await DiscordReactionObservationService.markDone({
        projectId: projectId,
        claimKey: key(7),
        observedAt: claimedToken(owner),
      });
      // The owner's own retry stays idempotent.
      expect(retry).toBe(true);
    });
  },
);
