import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInvestigationTuningToProject1783760576655
  implements MigrationInterface
{
  public name = "AddInvestigationTuningToProject1783760576655";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertInvestigationDedupeWindowMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "aiMaxConcurrentInvestigations" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "aiMaxConcurrentInvestigations"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertInvestigationDedupeWindowMinutes"`,
    );
  }
}
