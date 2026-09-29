import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAIInvestigationDecision1793700000000
  implements MigrationInterface
{
  public name: string = "AddAIInvestigationDecision1793700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "aiInvestigationDecision" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "aiInvestigationDecision" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "aiInvestigationDecision"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "aiInvestigationDecision"`,
    );
  }
}
