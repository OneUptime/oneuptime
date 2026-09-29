import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDropdownOptionsToCustomFields1779619108628
  implements MigrationInterface
{
  public name: string = "AddDropdownOptionsToCustomFields1779619108628";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD "dropdownOptions" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" ADD "dropdownOptions" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" ADD "dropdownOptions" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" ADD "dropdownOptions" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" ADD "dropdownOptions" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" ADD "dropdownOptions" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" ADD "dropdownOptions" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" DROP COLUMN "dropdownOptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" DROP COLUMN "dropdownOptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" DROP COLUMN "dropdownOptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" DROP COLUMN "dropdownOptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" DROP COLUMN "dropdownOptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" DROP COLUMN "dropdownOptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP COLUMN "dropdownOptions"`,
    );
  }
}
