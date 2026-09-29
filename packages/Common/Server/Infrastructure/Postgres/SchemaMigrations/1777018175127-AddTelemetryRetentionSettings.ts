import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTelemetryRetentionSettings1777018175127
  implements MigrationInterface
{
  public name = "AddTelemetryRetentionSettings1777018175127";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "defaultTelemetryRetentionInDays" integer NOT NULL DEFAULT '15'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ALTER COLUMN "retainTelemetryDataForDays" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Service" ALTER COLUMN "retainTelemetryDataForDays" SET DEFAULT '15'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN IF EXISTS "defaultTelemetryRetentionInDays"`,
    );
  }
}
