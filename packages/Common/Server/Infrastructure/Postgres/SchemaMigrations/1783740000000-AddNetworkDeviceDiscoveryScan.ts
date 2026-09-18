import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkDeviceDiscoveryScan1783740000000
  implements MigrationInterface
{
  public name = "AddNetworkDeviceDiscoveryScan1783740000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceDiscoveryScan" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "probeId" uuid NOT NULL, "cidr" character varying(100) NOT NULL, "snmpVersion" character varying(100) DEFAULT '2c', "snmpCommunityString" character varying(100), "snmpPort" integer DEFAULT '161', "status" character varying(100) NOT NULL DEFAULT 'Pending', "statusMessage" character varying(500), "discoveredDevices" jsonb, "scannedHostCount" integer, "respondedHostCount" integer, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_network_device_discovery_scan_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_discovery_scan_projectId" ON "NetworkDeviceDiscoveryScan" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_discovery_scan_probeId_status" ON "NetworkDeviceDiscoveryScan" ("probeId", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_nd_discovery_scan_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_nd_discovery_scan_probeId" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_nd_discovery_scan_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_nd_discovery_scan_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "NetworkDeviceDiscoveryScan"`,
    );
  }
}
