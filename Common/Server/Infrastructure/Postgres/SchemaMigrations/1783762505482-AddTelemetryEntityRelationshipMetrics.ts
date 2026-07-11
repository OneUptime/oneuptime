import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTelemetryEntityRelationshipMetrics1783762505482
  implements MigrationInterface
{
  public name = "AddTelemetryEntityRelationshipMetrics1783762505482";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD "callCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD "errorCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD "avgDurationMs" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" DROP COLUMN "avgDurationMs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" DROP COLUMN "errorCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" DROP COLUMN "callCount"`,
    );
  }
}
