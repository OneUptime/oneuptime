import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The legacy AIAgentTask substrate is removed: code-fix work lives on the
 * unified AIRun table. Hand-written because typeorm migration:generate
 * cannot emit drops for deleted entities. FK-safe order: child tables
 * first, then the referencing column on the surviving
 * AIAgentTaskPullRequest (DROP COLUMN drops its FK + index), then the
 * parent table. Historical legacy task/log rows are destroyed by design;
 * the pull-request records (the G11 outcome baseline) survive.
 */
export class DropLegacyAIAgentTaskTables1783970619302
  implements MigrationInterface
{
  public name = "DropLegacyAIAgentTaskTables1783970619302";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "AIAgentTaskLog"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "AIAgentTaskTelemetryException"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN IF EXISTS "aiAgentTaskId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "AIAgentTask"`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally irreversible: the legacy AIAgentTask feature no longer exists.
  }
}
