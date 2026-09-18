import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1736364957990 implements MigrationInterface {
  public name = "MigrationName1736364957990";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AlertLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "logInMarkdown" text NOT NULL, "moreInformationInMarkdown" text NOT NULL, "alertLogEvent" character varying NOT NULL, CONSTRAINT "PK_500826238fa54528b0026f55d47" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5d56f9ed2c4c72745372a1ac6" ON "AlertLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52bbabed66e4e728441d49478f" ON "AlertLog" ("alertId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLog" ADD CONSTRAINT "FK_d5d56f9ed2c4c72745372a1ac6f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLog" ADD CONSTRAINT "FK_52bbabed66e4e728441d49478f8" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLog" ADD CONSTRAINT "FK_f5f832aad105579e95a09e1ddd0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLog" ADD CONSTRAINT "FK_7ca9046915f6de6e7a199588d26" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertLog" DROP CONSTRAINT "FK_7ca9046915f6de6e7a199588d26"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLog" DROP CONSTRAINT "FK_f5f832aad105579e95a09e1ddd0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLog" DROP CONSTRAINT "FK_52bbabed66e4e728441d49478f8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLog" DROP CONSTRAINT "FK_d5d56f9ed2c4c72745372a1ac6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52bbabed66e4e728441d49478f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5d56f9ed2c4c72745372a1ac6"`,
    );
    await queryRunner.query(`DROP TABLE "AlertLog"`);
  }
}
