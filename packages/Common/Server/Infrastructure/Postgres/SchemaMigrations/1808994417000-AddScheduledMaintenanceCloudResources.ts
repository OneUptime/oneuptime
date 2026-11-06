import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The cloud resources a scheduled maintenance event holds
 * (ScheduledMaintenance.cloudResources): while the event is in progress,
 * the monitors that name one of them open no incident or alert
 * (MonitorMaintenanceSuppression). A new join table,
 * "ScheduledMaintenanceCloudResource", as the event's database servers
 * have: its two ids, each indexed, each deleted with its event or its
 * resource.
 *
 * Only a new table is created: no existing table is scanned, locked or
 * rewritten.
 */
export class AddScheduledMaintenanceCloudResources1808994417000
  implements MigrationInterface
{
  public name: string = "AddScheduledMaintenanceCloudResources1808994417000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceCloudResource" ("scheduledMaintenanceId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, CONSTRAINT "PK_f770af1d18b4c98063b2e39ceb6" PRIMARY KEY ("scheduledMaintenanceId", "cloudResourceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2fc3f1beac13af6b1f9ea8454d" ON "ScheduledMaintenanceCloudResource" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ea7ab4f15b9cdc6e06b05f0fa" ON "ScheduledMaintenanceCloudResource" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCloudResource" ADD CONSTRAINT "FK_2fc3f1beac13af6b1f9ea8454dc" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCloudResource" ADD CONSTRAINT "FK_6ea7ab4f15b9cdc6e06b05f0fa1" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCloudResource" DROP CONSTRAINT "FK_6ea7ab4f15b9cdc6e06b05f0fa1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCloudResource" DROP CONSTRAINT "FK_2fc3f1beac13af6b1f9ea8454dc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ea7ab4f15b9cdc6e06b05f0fa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2fc3f1beac13af6b1f9ea8454d"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceCloudResource"`);
  }
}
