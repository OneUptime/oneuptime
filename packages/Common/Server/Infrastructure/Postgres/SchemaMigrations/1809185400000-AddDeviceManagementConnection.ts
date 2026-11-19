import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #9586): the
 * device management connections (an Esper tenant), the devices they import
 * and the apps installed on them. All three tables are new, so they are
 * empty while their indexes and keys are made, and need no online DDL.
 */
export class AddDeviceManagementConnection1809185400000
  implements MigrationInterface
{
  public name: string = "AddDeviceManagementConnection1809185400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DeviceManagementConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "provider" character varying(100) NOT NULL, "config" jsonb, "secrets" text NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "nextPullAt" TIMESTAMP WITH TIME ZONE, "lastPulledAt" TIMESTAMP WITH TIME ZONE, "lastSuccessfulPullAt" TIMESTAMP WITH TIME ZONE, "lastPullResult" jsonb, "lastError" text, "pullState" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_af1968c29a597f200e88b47b141" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf664b362c5cd753e12c423486" ON "DeviceManagementConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_149dc6e908eae1b700760cfa82" ON "DeviceManagementConnection" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_078f50081935fab34d2814434a" ON "DeviceManagementConnection" ("nextPullAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ManagedDevice" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "connectionId" uuid NOT NULL, "providerDeviceId" character varying(100) NOT NULL, "deviceName" character varying(100), "alias" character varying(100), "serialNumber" character varying(100), "imei" character varying(100), "manufacturer" character varying(100), "brand" character varying(100), "model" character varying(100), "osVersion" character varying(100), "buildNumber" character varying(100), "securityPatchLevel" character varying(100), "agentVersion" character varying(100), "providerState" integer, "lastCheckInAt" TIMESTAMP WITH TIME ZONE, "groupId" character varying(100), "groupName" character varying(100), "groupPath" character varying(500), "isKioskMode" boolean, "batteryLevel" integer, "ipAddresses" character varying(500), "macAddress" character varying(100), "details" jsonb, "provisionedAt" TIMESTAMP WITH TIME ZONE, "removedAt" TIMESTAMP WITH TIME ZONE, "appsReadAt" TIMESTAMP WITH TIME ZONE, "appCount" integer, "inventoryItemId" uuid, "inventoryMatch" character varying(100), "inventoryAttributes" jsonb, "isInventoryItemArchivedOnRemoval" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_8485720e28a47708700392dd114" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c0e3f7e33ecb7bfe48a931f56" ON "ManagedDevice" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a67f679e596c546d6f8d4e2152" ON "ManagedDevice" ("connectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_078d83ade846f75f33dadef5a2" ON "ManagedDevice" ("serialNumber") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5e1a6c8b691bbf808e465449e3" ON "ManagedDevice" ("lastCheckInAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_682749f449bca8811cd60b936e" ON "ManagedDevice" ("groupName") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_916d3031e42886582550e104fe" ON "ManagedDevice" ("inventoryItemId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33ab0ba069df8c15c4c6b06097" ON "ManagedDevice" ("projectId", "removedAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7090cfe04e33e986dbbcd2ce03" ON "ManagedDevice" ("connectionId", "providerDeviceId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ManagedDeviceApp" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "connectionId" uuid NOT NULL, "managedDeviceId" uuid NOT NULL, "appName" character varying(100), "packageName" character varying(500) NOT NULL, "versionName" character varying(100), "versionCode" character varying(100), "state" character varying(100), "isKioskApp" boolean NOT NULL DEFAULT false, "isManagedByService" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_b9fcd916328214f75b05a7c40ca" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2823d719ed121c19b42ff47f56" ON "ManagedDeviceApp" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_98d7da098bf55da470aab8e453" ON "ManagedDeviceApp" ("connectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8302664233b8c7e965595eb92" ON "ManagedDeviceApp" ("packageName") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bbd5ad1471d1a0851dfe7c76ed" ON "ManagedDeviceApp" ("managedDeviceId", "packageName") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DeviceManagementConnection" ADD CONSTRAINT "FK_bf664b362c5cd753e12c423486f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DeviceManagementConnection" ADD CONSTRAINT "FK_9a46f897d4355933e21e94ec3cf" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DeviceManagementConnection" ADD CONSTRAINT "FK_3595b00fdd93d36f9dc45f7fb3a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDevice" ADD CONSTRAINT "FK_5c0e3f7e33ecb7bfe48a931f56b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDevice" ADD CONSTRAINT "FK_a67f679e596c546d6f8d4e21527" FOREIGN KEY ("connectionId") REFERENCES "DeviceManagementConnection"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDevice" ADD CONSTRAINT "FK_916d3031e42886582550e104feb" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDeviceApp" ADD CONSTRAINT "FK_2823d719ed121c19b42ff47f562" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDeviceApp" ADD CONSTRAINT "FK_98d7da098bf55da470aab8e4534" FOREIGN KEY ("connectionId") REFERENCES "DeviceManagementConnection"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDeviceApp" ADD CONSTRAINT "FK_3399a4bd96bb9a4df0508945df5" FOREIGN KEY ("managedDeviceId") REFERENCES "ManagedDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ManagedDeviceApp" DROP CONSTRAINT "FK_3399a4bd96bb9a4df0508945df5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDeviceApp" DROP CONSTRAINT "FK_98d7da098bf55da470aab8e4534"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDeviceApp" DROP CONSTRAINT "FK_2823d719ed121c19b42ff47f562"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDevice" DROP CONSTRAINT "FK_916d3031e42886582550e104feb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDevice" DROP CONSTRAINT "FK_a67f679e596c546d6f8d4e21527"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ManagedDevice" DROP CONSTRAINT "FK_5c0e3f7e33ecb7bfe48a931f56b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DeviceManagementConnection" DROP CONSTRAINT "FK_3595b00fdd93d36f9dc45f7fb3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DeviceManagementConnection" DROP CONSTRAINT "FK_9a46f897d4355933e21e94ec3cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DeviceManagementConnection" DROP CONSTRAINT "FK_bf664b362c5cd753e12c423486f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bbd5ad1471d1a0851dfe7c76ed"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8302664233b8c7e965595eb92"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_98d7da098bf55da470aab8e453"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2823d719ed121c19b42ff47f56"`,
    );
    await queryRunner.query(`DROP TABLE "ManagedDeviceApp"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7090cfe04e33e986dbbcd2ce03"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33ab0ba069df8c15c4c6b06097"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_916d3031e42886582550e104fe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_682749f449bca8811cd60b936e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5e1a6c8b691bbf808e465449e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_078d83ade846f75f33dadef5a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a67f679e596c546d6f8d4e2152"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c0e3f7e33ecb7bfe48a931f56"`,
    );
    await queryRunner.query(`DROP TABLE "ManagedDevice"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_078f50081935fab34d2814434a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_149dc6e908eae1b700760cfa82"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf664b362c5cd753e12c423486"`,
    );
    await queryRunner.query(`DROP TABLE "DeviceManagementConnection"`);
  }
}
