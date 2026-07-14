import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Output-token accounting per LLM call, needed by the code-fix agent's
 * per-run loop budget (a total-token cap would strangle loops as input
 * context grows). Validated by application: the dev database applied this
 * on boot and the generator confirms no remaining diff.
 */
export class AddCompletionTokensToLlmLog1783990000000
  implements MigrationInterface
{
  public name = "AddCompletionTokensToLlmLog1783990000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD COLUMN IF NOT EXISTS "completionTokens" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmLog" DROP COLUMN IF EXISTS "completionTokens"`,
    );
  }
}
