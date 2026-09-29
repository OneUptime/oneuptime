import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with generate-postgres-migration, then pruned: the generator
 * also emitted a DROP + re-ADD of NetworkDeviceDiscoveryScan.snmpV3AuthKey /
 * snmpV3PrivKey (text -> varchar type churn that would destroy stored keys)
 * and unrelated OnCallDutyPolicyScheduleLayer default churn. Only the
 * statements for the new inventory/discovery columns were kept.
 */
export class AddNetworkDeviceInventoryAndDiscoverySchedule1784211212164
  implements MigrationInterface
{
  public name = "AddNetworkDeviceInventoryAndDiscoverySchedule1784211212164";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "sysObjectId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "sysLocation" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "sysContact" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "vendor" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "deviceModel" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "serialNumber" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "firmwareVersion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "softwareVersion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "lastRebootedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "cdpNeighbors" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "isRecurring" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "rescanIntervalInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "nextScanAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD "macAddress" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD "interfaceType" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP COLUMN "interfaceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP COLUMN "macAddress"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "nextScanAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "rescanIntervalInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "isRecurring"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "cdpNeighbors"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "lastRebootedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "softwareVersion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "firmwareVersion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "serialNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "deviceModel"`,
    );
    await queryRunner.query(`ALTER TABLE "NetworkDevice" DROP COLUMN "vendor"`);
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "sysContact"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "sysLocation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "sysObjectId"`,
    );
  }
}
