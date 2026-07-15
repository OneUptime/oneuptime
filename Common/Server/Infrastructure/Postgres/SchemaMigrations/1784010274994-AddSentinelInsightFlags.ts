import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSentinelInsightFlags1784010274994
  implements MigrationInterface
{
  public name: string = "AddSentinelInsightFlags1784010274994";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableSentinelInsights" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableInsightFixTasks" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "triggeredBySentinelInsightId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_airun_triggeredBySentinelInsightId" ON "AIRun" ("triggeredBySentinelInsightId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_airun_triggeredBySentinelInsightId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "triggeredBySentinelInsightId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableInsightFixTasks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableSentinelInsights"`,
    );
  }
}
