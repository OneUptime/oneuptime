import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration after
 * AddGlobalRunners1803950000000, and moved into a migration of its own:
 * RunnerJob already exists, so the index a global Runner's claim reads by
 * (RunnerJob.runsOnGlobalRunner, RunnerJobService.claimNextGlobalJob) is
 * built online, without blocking the writes every runbook step makes. Safe
 * to run again after a stop part way.
 */
export class AddGlobalRunnerJobIndex1804000000000
  implements MigrationInterface
{
  public name: string = "AddGlobalRunnerJobIndex1804000000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_f1fb288722f84d308332c8109b" ON "RunnerJob" ("runsOnGlobalRunner") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_f1fb288722f84d308332c8109b"`,
    );
  }
}
