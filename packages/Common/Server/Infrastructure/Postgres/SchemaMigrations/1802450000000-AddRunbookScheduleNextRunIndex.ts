import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddRunbookTriggers1802400000000, and moved into a migration of its own:
 * Runbook already exists, so the index the scheduler finds due runs by -
 * "runbooks whose next scheduled run has come" (RunbookScheduler, once a
 * minute) - is built online, without blocking the table's writers. Safe to
 * run again after a stop part way.
 */
export class AddRunbookScheduleNextRunIndex1802450000000
  implements MigrationInterface
{
  public name: string = "AddRunbookScheduleNextRunIndex1802450000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_9448439a99ffa417e38e4ec678" ON "Runbook" ("scheduleNextRunAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_9448439a99ffa417e38e4ec678"`,
    );
  }
}
