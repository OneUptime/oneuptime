import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEnableAutomaticIncidentInvestigationToProject1783598145111
  implements MigrationInterface
{
  public name = "AddEnableAutomaticIncidentInvestigationToProject1783598145111";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticIncidentInvestigation" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticIncidentInvestigation"`,
    );
  }
}
