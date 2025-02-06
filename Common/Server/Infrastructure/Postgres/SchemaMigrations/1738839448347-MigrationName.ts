import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1738839448347 implements MigrationInterface {
  public name = "MigrationName1738839448347";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceProviderSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "settings" jsonb NOT NULL, "serviceProviderType" character varying(500) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_067585897cee83c2724244e3531" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9058eb1588c022d397933b2c07" ON "ServiceProviderSetting" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceProviderNotificationRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "notificationRule" jsonb NOT NULL, "eventType" character varying NOT NULL, "serviceProviderType" character varying(500) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_e3c6caf5936bbfc4e4489c7613d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ecd5ace9a33e87928c90bf8ba0" ON "ServiceProviderNotificationRule" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" ADD CONSTRAINT "FK_9058eb1588c022d397933b2c07e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" ADD CONSTRAINT "FK_c606b8363bb5109bb7a878123aa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" ADD CONSTRAINT "FK_1abb759b95955aa055be8e7b0da" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderNotificationRule" ADD CONSTRAINT "FK_ecd5ace9a33e87928c90bf8ba01" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderNotificationRule" ADD CONSTRAINT "FK_5ebe7a9e0c352d228fdac1a2ebd" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderNotificationRule" ADD CONSTRAINT "FK_f251df7a63ce5458ae04dbee7ab" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderNotificationRule" DROP CONSTRAINT "FK_f251df7a63ce5458ae04dbee7ab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderNotificationRule" DROP CONSTRAINT "FK_5ebe7a9e0c352d228fdac1a2ebd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderNotificationRule" DROP CONSTRAINT "FK_ecd5ace9a33e87928c90bf8ba01"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" DROP CONSTRAINT "FK_1abb759b95955aa055be8e7b0da"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" DROP CONSTRAINT "FK_c606b8363bb5109bb7a878123aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" DROP CONSTRAINT "FK_9058eb1588c022d397933b2c07e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ecd5ace9a33e87928c90bf8ba0"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceProviderNotificationRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9058eb1588c022d397933b2c07"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceProviderSetting"`);
  }
}
