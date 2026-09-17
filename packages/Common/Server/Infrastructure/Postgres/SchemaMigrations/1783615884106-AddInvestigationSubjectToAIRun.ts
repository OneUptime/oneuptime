import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInvestigationSubjectToAIRun1783615884106
  implements MigrationInterface
{
  public name = "AddInvestigationSubjectToAIRun1783615884106";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "triggeredByIncidentId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "triggeredByAlertId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AIRun_triggeredByIncidentId" ON "AIRun" ("triggeredByIncidentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AIRun_triggeredByAlertId" ON "AIRun" ("triggeredByAlertId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_AIRun_triggeredByAlertId"`);
    await queryRunner.query(`DROP INDEX "IDX_AIRun_triggeredByIncidentId"`);
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "triggeredByAlertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "triggeredByIncidentId"`,
    );
  }
}
