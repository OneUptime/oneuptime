import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Network devices as affected resources (issue #5341): the routers,
 * switches, firewalls and access points an incident or an alert is about.
 *
 *   - "IncidentNetworkDevice": Incident.networkDevices.
 *   - "AlertNetworkDevice": Alert.networkDevices.
 *
 * Both tables are new and empty, so their indexes and foreign keys are built
 * here; no existing table changes.
 */
export class AddNetworkDevicesToIncidentsAndAlerts1808300000000
  implements MigrationInterface
{
  public name: string = "AddNetworkDevicesToIncidentsAndAlerts1808300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentNetworkDevice" ("incidentId" uuid NOT NULL, "networkDeviceId" uuid NOT NULL, CONSTRAINT "PK_c358dc102b501e1ea17abcd70cd" PRIMARY KEY ("incidentId", "networkDeviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6707f86e36f3608503089b813b" ON "IncidentNetworkDevice" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_867ff8f82ef6a01f333a16c201" ON "IncidentNetworkDevice" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertNetworkDevice" ("alertId" uuid NOT NULL, "networkDeviceId" uuid NOT NULL, CONSTRAINT "PK_bc846cf815cf84c72d50b78e11a" PRIMARY KEY ("alertId", "networkDeviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2b74b1c81bb76bf1ed3440f74d" ON "AlertNetworkDevice" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_84128a88dd310310a01bc863be" ON "AlertNetworkDevice" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNetworkDevice" ADD CONSTRAINT "FK_6707f86e36f3608503089b813b0" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNetworkDevice" ADD CONSTRAINT "FK_867ff8f82ef6a01f333a16c201e" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertNetworkDevice" ADD CONSTRAINT "FK_2b74b1c81bb76bf1ed3440f74de" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertNetworkDevice" ADD CONSTRAINT "FK_84128a88dd310310a01bc863bef" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertNetworkDevice" DROP CONSTRAINT "FK_84128a88dd310310a01bc863bef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertNetworkDevice" DROP CONSTRAINT "FK_2b74b1c81bb76bf1ed3440f74de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNetworkDevice" DROP CONSTRAINT "FK_867ff8f82ef6a01f333a16c201e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentNetworkDevice" DROP CONSTRAINT "FK_6707f86e36f3608503089b813b0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_84128a88dd310310a01bc863be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2b74b1c81bb76bf1ed3440f74d"`,
    );
    await queryRunner.query(`DROP TABLE "AlertNetworkDevice"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_867ff8f82ef6a01f333a16c201"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6707f86e36f3608503089b813b"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentNetworkDevice"`);
  }
}
