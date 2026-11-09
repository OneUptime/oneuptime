import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Two columns for AI runs that fail and are tried again (issues #6437 and
 * #6438).
 *
 * "AIRun"."retryAt" is when a run that went back to the queue is due: a
 * minute, then five, after its AI provider failed an attempt
 * (Server/Utils/AI/AIRunRetryPolicy), and at once after a hand-back or a
 * stale attempt. The queue starts a run only once it is due, and counts
 * the run's time in the queue from it.
 *
 * "LlmProvider"."requestTimeoutInSeconds" is how long OneUptime waits for
 * the provider to answer one request. Empty is the default it always had:
 * 120 seconds, 300 for Ollama.
 *
 * Both are nullable with no default: adding them rewrites no row, and every
 * existing run and provider behaves exactly as before.
 *
 * Generated with npm run generate-postgres-migration, then numbered after
 * the last registered migration.
 */
export class AddAIRunRetryAtAndProviderTimeout1809080100000
  implements MigrationInterface
{
  public name: string = "AddAIRunRetryAtAndProviderTimeout1809080100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" ADD "requestTimeoutInSeconds" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "retryAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "retryAt"`);
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" DROP COLUMN "requestTimeoutInSeconds"`,
    );
  }
}
