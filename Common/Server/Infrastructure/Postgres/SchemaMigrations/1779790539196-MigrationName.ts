import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1779790539196 implements MigrationInterface {
  name = "MigrationName1779790539196";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TeamCustomField" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "customFieldType" character varying(100), "dropdownOptions" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_5468a529ade7a35109fe258fe72" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_517fe31404817cbe8a598e025b" ON "TeamCustomField" ("projectId") `,
    );
    await queryRunner.query(`ALTER TABLE "Team" ADD "customFields" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" ADD CONSTRAINT "FK_517fe31404817cbe8a598e025bf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" ADD CONSTRAINT "FK_ee19a4ef5f6bb2a580539234476" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" ADD CONSTRAINT "FK_952539a5b3ad11840697481365c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" DROP CONSTRAINT "FK_952539a5b3ad11840697481365c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" DROP CONSTRAINT "FK_ee19a4ef5f6bb2a580539234476"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" DROP CONSTRAINT "FK_517fe31404817cbe8a598e025bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(`ALTER TABLE "Team" DROP COLUMN "customFields"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_517fe31404817cbe8a598e025b"`,
    );
    await queryRunner.query(`DROP TABLE "TeamCustomField"`);
  }
}
