import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAlertInvestigationGating1783701585317
  implements MigrationInterface
{
  public name = "AddAlertInvestigationGating1783701585317";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertInvestigationMinimumSeverityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_Project_alertInvestigationMinimumSeverityId" FOREIGN KEY ("alertInvestigationMinimumSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" ADD "monitorId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_AIRun_monitorId" ON "AIRun" ("monitorId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_AIRun_monitorId"`);
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "monitorId"`);
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_Project_alertInvestigationMinimumSeverityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertInvestigationMinimumSeverityId"`,
    );
  }
}
