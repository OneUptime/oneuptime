import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1773676206197 implements MigrationInterface {
  public name = "MigrationName1773676206197";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LogScrubRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "patternType" character varying(100) NOT NULL, "customRegex" character varying(500), "scrubAction" character varying(100) NOT NULL DEFAULT 'redact', "fieldsToScrub" character varying(100) NOT NULL DEFAULT 'both', "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_993a671224f0dca8edfd22bc788" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ed4595b431ba465ac9a9938d4" ON "LogScrubRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_88d1e2bb9908f0aada30f044f5" ON "LogScrubRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ADD CONSTRAINT "FK_0ed4595b431ba465ac9a9938d4d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ADD CONSTRAINT "FK_cec04acd064a11bf98c2eae3819" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ADD CONSTRAINT "FK_88ad7031d2481dd8142e543ddbd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "FK_88ad7031d2481dd8142e543ddbd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "FK_cec04acd064a11bf98c2eae3819"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "FK_0ed4595b431ba465ac9a9938d4d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_88d1e2bb9908f0aada30f044f5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ed4595b431ba465ac9a9938d4"`,
    );
    await queryRunner.query(`DROP TABLE "LogScrubRule"`);
  }
}
