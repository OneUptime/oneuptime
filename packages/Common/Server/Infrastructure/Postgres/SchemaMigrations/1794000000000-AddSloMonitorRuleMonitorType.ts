import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSloMonitorRuleMonitorType1794000000000
  implements MigrationInterface
{
  public name: string = "AddSloMonitorRuleMonitorType1794000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" ADD "monitorType" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" DROP COLUMN "monitorType"`,
    );
  }
}
