import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A pull request can now be proposed from an AI chat conversation, which has
 * no AIAgent behind it (the AIAgent record belongs to the autonomous fix
 * worker). aiAgentId becomes nullable so chat-authored PRs can be recorded at
 * all — and recording them is what makes them count against the per-repository
 * open-PR cap, which reads AIAgentTaskPullRequest rows.
 *
 * A null aiAgentId therefore means "proposed from chat". Existing rows all
 * have an agent, so dropping NOT NULL needs no backfill and the down migration
 * is safe until the first chat-authored PR exists.
 */
export class AllowNullAiAgentOnPullRequest1784135099754
  implements MigrationInterface
{
  public name = "AllowNullAiAgentOnPullRequest1784135099754";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * The FK is dropped and re-added because Postgres will not alter a column's
     * nullability while a foreign key references it. ON DELETE CASCADE is
     * preserved exactly as it was.
     */
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_b1e01ecfe9eecfb555428471073"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "aiAgentId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_b1e01ecfe9eecfb555428471073" FOREIGN KEY ("aiAgentId") REFERENCES "AIAgent"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Restoring NOT NULL fails if any chat-authored (null-agent) rows exist.
     * That is deliberate: silently deleting or reassigning a customer's pull
     * request records to satisfy a rollback would be worse than a loud failure.
     */
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_b1e01ecfe9eecfb555428471073"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "aiAgentId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_b1e01ecfe9eecfb555428471073" FOREIGN KEY ("aiAgentId") REFERENCES "AIAgent"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
