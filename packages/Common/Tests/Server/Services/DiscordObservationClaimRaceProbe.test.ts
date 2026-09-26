import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DiscordReactionObservationService from "../../../Server/Services/DiscordReactionObservationService";
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
 * Interface-neutral race probe for HOM-43 gate 1 (Astra, review 3). This
 * file is deliberately compatible with BOTH the pre-review service (claim
 * returns a bare string) and the reviewed service (claim returns
 * {result, observedAt}), so the SAME probe can run red on the preserved
 * pre-change tree and green on the corrected tree:
 *
 *   red:   PARITY_TEST_POSTGRES=1 parity-runner.sh start <ee5390d3e7 worktree> \
 *            hom43-red-claim-race-01 common-test \
 *            Tests/Server/Services/DiscordObservationClaimRaceProbe.test.ts
 *   green: same probe plus DiscordReactionObservationPostgres.test.ts on the
 *            feature worktree.
 *
 * It must not reference the observedAt column in SQL or import types that
 * only exist on one tree. The defect it reproduces: two workers that both
 * read the same stale Pending row both "steal" it, because the pre-review
 * steal was a read-then-updateBy without a timestamp comparison.
 */

const describePostgres = (
  process.env["RUN_POSTGRES_DISCORD_OBSERVATION_TESTS"] === "true"
    ? describe
    : describe.skip
) as typeof describe;

type ClaimReturn = string | { result?: string } | undefined;

function normalize(claim: ClaimReturn): string {
  if (typeof claim === "string") {
    return claim;
  }
  return String((claim as { result?: string } | undefined)?.result);
}

describePostgres(
  "DiscordReactionObservation claim race probe (real Postgres)",
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
          `obs-probe-${projectId}`,
          `obs-probe-${projectId}`,
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

    test("N workers racing to steal one abandoned Pending row: exactly one wins", async (): Promise<void> => {
      /*
       * A Pending row abandoned 20 minutes ago (beyond the 15-minute stale
       * threshold on both trees). updatedAt is the only clock the
       * pre-review code consulted, so it is backdated directly.
       */
      await database.query(
        `INSERT INTO "DiscordReactionObservation"
           ("_id", "version", "projectId", "claimKey", "source", "observationState", "createdAt", "updatedAt")
         VALUES ($1, 1, $2, $3, 'reaction', 'Pending',
                 now() - interval '20 minutes', now() - interval '20 minutes')`,
        [ObjectID.generate().toString(), projectId.toString(), "probe-stale-1"],
      );

      const results: Array<string> = (
        await Promise.all(
          Array.from({ length: 12 }, (): Promise<ClaimReturn> => {
            return DiscordReactionObservationService.claim({
              projectId: projectId,
              claimKey: "probe-stale-1",
              source: "reaction",
            }).catch((): ClaimReturn => {
              return "Threw";
            });
          }),
        )
      ).map(normalize);

      const winners: number = results.filter(
        (result: string): boolean => result === "Claimed",
      ).length;

      expect(results).not.toContain("Threw");
      expect(winners).toBe(1);
    });
  },
);
