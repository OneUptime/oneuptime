import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * IoT activity wiring — iotFleets ManyToMany join tables on Alert,
 * Incident and ScheduledMaintenance (cloned from the
 * AlertProxmoxCluster / IncidentProxmoxCluster shape in
 * 1781600000001-AddProxmoxCephActivityAndRules). Lets the per-fleet
 * Activity pages and SideMenu badge counts query `iotFleets` on
 * Incident / Alert / ScheduledMaintenance.
 *
 * Columns/indexes/FKs are derived from the model decorators in
 * Common/Models/DatabaseModels/.
 */
export class AddIoTFleetActivityJoinTables1783000000000
  implements MigrationInterface
{
  public name = "AddIoTFleetActivityJoinTables1783000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // AlertIoTFleet
    await queryRunner.query(
      `CREATE TABLE "AlertIoTFleet" ("alertId" uuid NOT NULL, "iotFleetId" uuid NOT NULL, CONSTRAINT "PK_alert_iot_fleet" PRIMARY KEY ("alertId", "iotFleetId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_iot_fleet_alertId" ON "AlertIoTFleet" ("alertId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_iot_fleet_iotFleetId" ON "AlertIoTFleet" ("iotFleetId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" ADD CONSTRAINT "FK_alert_iot_fleet_alertId" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" ADD CONSTRAINT "FK_alert_iot_fleet_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IncidentIoTFleet
    await queryRunner.query(
      `CREATE TABLE "IncidentIoTFleet" ("incidentId" uuid NOT NULL, "iotFleetId" uuid NOT NULL, CONSTRAINT "PK_incident_iot_fleet" PRIMARY KEY ("incidentId", "iotFleetId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_iot_fleet_incidentId" ON "IncidentIoTFleet" ("incidentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_iot_fleet_iotFleetId" ON "IncidentIoTFleet" ("iotFleetId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" ADD CONSTRAINT "FK_incident_iot_fleet_incidentId" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" ADD CONSTRAINT "FK_incident_iot_fleet_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // ScheduledMaintenanceIoTFleet
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceIoTFleet" ("scheduledMaintenanceId" uuid NOT NULL, "iotFleetId" uuid NOT NULL, CONSTRAINT "PK_scheduled_maintenance_iot_fleet" PRIMARY KEY ("scheduledMaintenanceId", "iotFleetId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_maintenance_iot_fleet_scheduledMaintenanceId" ON "ScheduledMaintenanceIoTFleet" ("scheduledMaintenanceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_maintenance_iot_fleet_iotFleetId" ON "ScheduledMaintenanceIoTFleet" ("iotFleetId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" ADD CONSTRAINT "FK_scheduled_maintenance_iot_fleet_scheduledMaintenanceId" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" ADD CONSTRAINT "FK_scheduled_maintenance_iot_fleet_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" DROP CONSTRAINT "FK_scheduled_maintenance_iot_fleet_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" DROP CONSTRAINT "FK_scheduled_maintenance_iot_fleet_scheduledMaintenanceId"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceIoTFleet"`);

    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" DROP CONSTRAINT "FK_incident_iot_fleet_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" DROP CONSTRAINT "FK_incident_iot_fleet_incidentId"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentIoTFleet"`);

    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" DROP CONSTRAINT "FK_alert_iot_fleet_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" DROP CONSTRAINT "FK_alert_iot_fleet_alertId"`,
    );
    await queryRunner.query(`DROP TABLE "AlertIoTFleet"`);
  }
}
