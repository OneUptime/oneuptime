import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Wave 4 of session replay: correlation and capture policy columns on
 * RumApplication.
 *
 *   - sessionReplayTracePropagationOrigins: origins whose requests get a
 *     generated W3C traceparent header. '[]' (the default) means the
 *     recorder never injects - the safe default, since adding a header
 *     turns simple cross-origin requests into preflighted ones.
 *   - sessionReplay{Lcp,LongTask,SlowRequest}BudgetMs: performance capture
 *     budgets in milliseconds. 0 (the default) disables each trigger.
 *
 * Generated with `npm run generate-postgres-migration` and trimmed by
 * hand: the raw diff also restated columns and defaults from earlier
 * migrations that the local generation database happened to be missing
 * (ignoreErrorPatterns, erasure attempts, unrelated DEFAULT resets).
 * Only the statements this change actually introduces are kept.
 */
export class AddSessionReplayCorrelationColumns1785533806494
  implements MigrationInterface
{
  public name = "AddSessionReplayCorrelationColumns1785533806494";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayTracePropagationOrigins" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayLcpBudgetMs" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplayLongTaskBudgetMs" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "sessionReplaySlowRequestBudgetMs" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplaySlowRequestBudgetMs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayLongTaskBudgetMs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayLcpBudgetMs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplayTracePropagationOrigins"`,
    );
  }
}
