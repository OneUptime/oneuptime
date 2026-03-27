import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1774559064919 implements MigrationInterface {
  public name = "MigrationName1774559064919";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_Dashboard_logoFileId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_Dashboard_faviconFileId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "pageDescription"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "pageDescription" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_2f81cafa1d653e4a023da14e541" FOREIGN KEY ("logoFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_83b237be936983b34fb7bcf1584" FOREIGN KEY ("faviconFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_83b237be936983b34fb7bcf1584"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_2f81cafa1d653e4a023da14e541"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "pageDescription"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "pageDescription" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_Dashboard_faviconFileId" FOREIGN KEY ("faviconFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_Dashboard_logoFileId" FOREIGN KEY ("logoFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
