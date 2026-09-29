import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTelemetryRetentionConfig1779199346010
  implements MigrationInterface
{
  public name: string = "AddTelemetryRetentionConfig1779199346010";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "telemetryRetentionConfig" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "telemetryRetentionConfig" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "telemetryRetentionConfig"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "telemetryRetentionConfig"`,
    );
  }
}
