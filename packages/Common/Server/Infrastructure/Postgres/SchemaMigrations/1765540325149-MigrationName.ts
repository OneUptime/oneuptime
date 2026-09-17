import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1765540325149 implements MigrationInterface {
  public name = "MigrationName1765540325149";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LlmProvider" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "name" character varying(50) NOT NULL, "description" character varying, "slug" character varying(100) NOT NULL, "llmType" character varying(100) NOT NULL, "apiKey" character varying, "modelName" character varying(100), "baseUrl" character varying(100), "projectId" uuid, "deletedByUserId" uuid, "createdByUserId" uuid, "isGlobalLlm" boolean NOT NULL DEFAULT false, "isEnabled" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_c057270b82040d0c3f3eb7904d6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" ADD CONSTRAINT "FK_745a31adc0966cf0444cc321541" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" ADD CONSTRAINT "FK_082f150ef63369af3cd022d3720" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" ADD CONSTRAINT "FK_6d1f986fccda177f98ec3549629" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" DROP CONSTRAINT "FK_6d1f986fccda177f98ec3549629"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" DROP CONSTRAINT "FK_082f150ef63369af3cd022d3720"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" DROP CONSTRAINT "FK_745a31adc0966cf0444cc321541"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(`DROP TABLE "LlmProvider"`);
  }
}
