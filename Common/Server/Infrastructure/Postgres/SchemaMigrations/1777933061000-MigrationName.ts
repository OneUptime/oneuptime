import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1777933061000 implements MigrationInterface {
  public name: string = "MigrationName1777933061000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "monitorTemplateId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_620a223938dfac49fed7ab46e9" ON "Monitor" ("monitorTemplateId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_620a223938dfac49fed7ab46e9e" FOREIGN KEY ("monitorTemplateId") REFERENCES "MonitorTemplate"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_620a223938dfac49fed7ab46e9e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_620a223938dfac49fed7ab46e9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "monitorTemplateId"`,
    );
  }
}
