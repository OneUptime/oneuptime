import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1754384418632 implements MigrationInterface {
  public name = "MigrationName1754384418632";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "StatusPageSCIM" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "statusPageId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "bearerToken" character varying(500) NOT NULL, "autoProvisionUsers" boolean NOT NULL DEFAULT true, "autoDeprovisionUsers" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_9d65d486be515b9608347cf66d4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a241118fe6b4a8665deef444b" ON "StatusPageSCIM" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7200e368657773fde2836c57eb" ON "StatusPageSCIM" ("statusPageId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" ADD CONSTRAINT "FK_0a241118fe6b4a8665deef444b2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" ADD CONSTRAINT "FK_7200e368657773fde2836c57ebe" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" ADD CONSTRAINT "FK_adb05dd1cbe0e734a76b3dbdcf1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" ADD CONSTRAINT "FK_2fded7c784a5c2f56ad2553cb80" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" DROP CONSTRAINT "FK_2fded7c784a5c2f56ad2553cb80"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" DROP CONSTRAINT "FK_adb05dd1cbe0e734a76b3dbdcf1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" DROP CONSTRAINT "FK_7200e368657773fde2836c57ebe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" DROP CONSTRAINT "FK_0a241118fe6b4a8665deef444b2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7200e368657773fde2836c57eb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a241118fe6b4a8665deef444b"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageSCIM"`);
  }
}
