import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEnableAutomaticAlertInvestigationToProject1783632447975
  implements MigrationInterface
{
  public name = "AddEnableAutomaticAlertInvestigationToProject1783632447975";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticAlertInvestigation" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticAlertInvestigation"`,
    );
  }
}
