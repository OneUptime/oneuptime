import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1773414578773 implements MigrationInterface {
  public name = "MigrationName1773414578773";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "FK_logscrub_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "FK_logscrub_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "FK_logscrub_deletedByUserId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_logscrub_projectId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_logscrub_isEnabled"`);
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ed4595b431ba465ac9a9938d4" ON "LogScrubRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_88d1e2bb9908f0aada30f044f5" ON "LogScrubRule" ("isEnabled") `,
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
      `DROP INDEX "public"."IDX_88d1e2bb9908f0aada30f044f5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ed4595b431ba465ac9a9938d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_logscrub_isEnabled" ON "LogScrubRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_logscrub_projectId" ON "LogScrubRule" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ADD CONSTRAINT "FK_logscrub_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ADD CONSTRAINT "FK_logscrub_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ADD CONSTRAINT "FK_logscrub_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
