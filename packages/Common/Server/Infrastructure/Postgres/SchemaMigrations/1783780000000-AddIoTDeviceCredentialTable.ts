import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * IoT device registry + per-device MQTT credentials. Registered
 * devices get individual authentication (credential id as MQTT
 * username, secretKey as password), topic isolation, revocation, and
 * silent-death offline detection (registered devices survive the
 * stale-inventory cleanup and get absent-series injection in IoT
 * Device monitors).
 */
export class AddIoTDeviceCredentialTable1783780000000
  implements MigrationInterface
{
  public name = "AddIoTDeviceCredentialTable1783780000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IoTDeviceCredential" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "iotFleetId" uuid NOT NULL, "externalId" character varying(100) NOT NULL, "name" character varying(100), "isEnabled" boolean NOT NULL DEFAULT true, "lastConnectedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, "secretKey" uuid NOT NULL, CONSTRAINT "PK_iot_device_credential_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_credential_projectId" ON "IoTDeviceCredential" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_credential_iotFleetId" ON "IoTDeviceCredential" ("iotFleetId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_credential_externalId" ON "IoTDeviceCredential" ("externalId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_credential_secretKey" ON "IoTDeviceCredential" ("secretKey")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_iot_device_credential_fleet_externalId" ON "IoTDeviceCredential" ("projectId", "iotFleetId", "externalId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_iot_device_credential_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_iot_device_credential_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_iot_device_credential_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_iot_device_credential_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_iot_device_credential_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_iot_device_credential_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_iot_device_credential_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_iot_device_credential_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_device_credential_fleet_externalId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_device_credential_secretKey"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_device_credential_externalId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_device_credential_iotFleetId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_device_credential_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "IoTDeviceCredential"`);
  }
}
