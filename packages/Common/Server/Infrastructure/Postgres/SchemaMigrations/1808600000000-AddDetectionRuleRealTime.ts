import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (the statement TypeORM
 * generates for the model), then renumbered after the last registered
 * migration.
 *
 * A detection rule that fires on one event can check each event as it
 * arrives instead of every interval (Types/SecurityEvent/RealTimeDetection):
 * DetectionRule gets "isRealTime".
 *
 * Nothing to backfill: false on every rule there is, so a scheduled rule
 * stays scheduled until somebody turns real time on. A constant default is
 * stored in the catalog, so the column is added without rewriting the table.
 */
export class AddDetectionRuleRealTime1808600000000
  implements MigrationInterface
{
  public name: string = "AddDetectionRuleRealTime1808600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "isRealTime" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "isRealTime"`,
    );
  }
}
