import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkDeviceTables1783720000000 implements MigrationInterface {
  public name = "AddNetworkDeviceTables1783720000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkDevice" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "hostname" character varying(100) NOT NULL, "probeId" uuid, "snmpVersion" character varying(100) DEFAULT '2c', "snmpCommunityString" character varying(100), "snmpPort" integer DEFAULT '161', "snmpV3Auth" jsonb, "sysDescr" character varying(500), "sysName" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "interfacesTotal" integer DEFAULT '0', "interfacesUp" integer DEFAULT '0', "interfacesDown" integer DEFAULT '0', "createdByUserId" uuid, "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "archivedByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_network_device_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_projectId" ON "NetworkDevice" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_projectId_isArchived" ON "NetworkDevice" ("projectId", "isArchived")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_hostname" ON "NetworkDevice" ("hostname")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_network_device_slug" ON "NetworkDevice" ("slug")`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_network_device_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_network_device_probeId" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_network_device_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_network_device_archivedByUserId" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_network_device_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Label join table
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceLabel" ("networkDeviceId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_network_device_label" PRIMARY KEY ("networkDeviceId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_label_networkDeviceId" ON "NetworkDeviceLabel" ("networkDeviceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_label_labelId" ON "NetworkDeviceLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabel" ADD CONSTRAINT "FK_network_device_label_networkDeviceId" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabel" ADD CONSTRAINT "FK_network_device_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // Interfaces
    await queryRunner.query(
      `CREATE TABLE "NetworkInterface" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "networkDeviceId" uuid NOT NULL, "interfaceIndex" integer NOT NULL, "name" character varying(100) NOT NULL, "alias" character varying(100), "isMonitored" boolean NOT NULL DEFAULT true, "isOperationallyUp" boolean, "isAdministrativelyUp" boolean, "speedInMbps" decimal, "inRateMbps" decimal, "outRateMbps" decimal, "utilizationPercent" decimal, "errorsPerSecond" decimal, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_network_interface_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_interface_projectId" ON "NetworkInterface" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_interface_networkDeviceId" ON "NetworkInterface" ("networkDeviceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_interface_projectId_networkDeviceId" ON "NetworkInterface" ("projectId", "networkDeviceId")`,
    );
    /*
     * The upsert path looks interfaces up by (device, ifIndex); enforce
     * uniqueness at the DB level for soft-delete-aware rows.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_network_interface_device_ifindex" ON "NetworkInterface" ("networkDeviceId", "interfaceIndex") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD CONSTRAINT "FK_network_interface_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD CONSTRAINT "FK_network_interface_networkDeviceId" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD CONSTRAINT "FK_network_interface_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD CONSTRAINT "FK_network_interface_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    /*
     * SNMP monitor type retirement: the monitor type was replaced by
     * Network Device monitors backed by NetworkDevice resources. The few
     * existing SNMP monitors are soft-deleted (customers were notified);
     * their rows remain recoverable but stop being scheduled or listed.
     */
    await queryRunner.query(
      `UPDATE "Monitor" SET "deletedAt" = now() WHERE "monitorType" = 'SNMP' AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "NetworkInterface"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "NetworkDeviceLabel"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "NetworkDevice"`);
    // Soft-deleted SNMP monitors are not restored on rollback.
  }
}
