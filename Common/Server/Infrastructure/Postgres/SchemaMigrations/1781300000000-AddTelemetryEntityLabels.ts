import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Entity model phase 2 follow-up (Internal/Docs/OpenTelemetryEntities.md):
 * `TelemetryEntity.labels` — labels observed on the entity's telemetry
 * (e.g. promoted from `oneuptime.label.*` resource attributes), merged as
 * a set union by the ingest reconciler. Simple jsonb string array in v1;
 * a relation to the Label table is a follow-up.
 */
export class AddTelemetryEntityLabels1781300000000
  implements MigrationInterface
{
  public name = "AddTelemetryEntityLabels1781300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "TelemetryEntity" ADD "labels" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" DROP COLUMN "labels"`,
    );
  }
}
