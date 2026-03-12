import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1773344537755 implements MigrationInterface {
  public name = "MigrationName1773344537755";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" DROP CONSTRAINT "FK_56e1d744839c4e59c50de300a9d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" DROP CONSTRAINT "FK_fa55f4b8cb6e6ce31554b7b021f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" DROP CONSTRAINT "FK_8bd2b62c5f269dc8b2c74da0f27"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_56e1d744839c4e59c50de300a9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80241afbecf0a3749cc775f93f"`,
    );
    await queryRunner.query(`ALTER TABLE "LogSavedView" DROP COLUMN "name"`);
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD "name" character varying(50) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd2dce79ac83d56416311f50e5" ON "LogSavedView" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f23bc454fb9a7dbecaeee6b93" ON "LogSavedView" ("isDefault") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD CONSTRAINT "FK_fd2dce79ac83d56416311f50e52" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD CONSTRAINT "FK_93663ad4128292e6a57f5950ab9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD CONSTRAINT "FK_a7817e3946945d28ef65a81e173" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" DROP CONSTRAINT "FK_a7817e3946945d28ef65a81e173"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" DROP CONSTRAINT "FK_93663ad4128292e6a57f5950ab9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" DROP CONSTRAINT "FK_fd2dce79ac83d56416311f50e52"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f23bc454fb9a7dbecaeee6b93"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd2dce79ac83d56416311f50e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(`ALTER TABLE "LogSavedView" DROP COLUMN "name"`);
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD "name" character varying(100) NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80241afbecf0a3749cc775f93f" ON "LogSavedView" ("isDefault") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_56e1d744839c4e59c50de300a9" ON "LogSavedView" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD CONSTRAINT "FK_8bd2b62c5f269dc8b2c74da0f27" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD CONSTRAINT "FK_fa55f4b8cb6e6ce31554b7b021f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD CONSTRAINT "FK_56e1d744839c4e59c50de300a9d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
