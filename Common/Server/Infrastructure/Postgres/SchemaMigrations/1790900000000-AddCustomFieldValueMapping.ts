import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCustomFieldValueMapping1790900000000
  implements MigrationInterface
{
  public name: string = "AddCustomFieldValueMapping1790900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD "mapFromResourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD "mapFromCustomFieldName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" ADD "mapFromResourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" ADD "mapFromCustomFieldName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" ADD "mapFromResourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" ADD "mapFromCustomFieldName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" ADD "mapFromResourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" ADD "mapFromCustomFieldName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" ADD "mapFromResourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" ADD "mapFromCustomFieldName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" ADD "mapFromResourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" ADD "mapFromCustomFieldName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" ADD "mapFromResourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" ADD "mapFromCustomFieldName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" ADD "mapFromResourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" ADD "mapFromCustomFieldName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" ADD "mapFromResourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" ADD "mapFromCustomFieldName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" DROP COLUMN "mapFromCustomFieldName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" DROP COLUMN "mapFromResourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" DROP COLUMN "mapFromCustomFieldName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" DROP COLUMN "mapFromResourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" DROP COLUMN "mapFromCustomFieldName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamMemberCustomField" DROP COLUMN "mapFromResourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" DROP COLUMN "mapFromCustomFieldName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeamCustomField" DROP COLUMN "mapFromResourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" DROP COLUMN "mapFromCustomFieldName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" DROP COLUMN "mapFromResourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" DROP COLUMN "mapFromCustomFieldName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" DROP COLUMN "mapFromResourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" DROP COLUMN "mapFromCustomFieldName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" DROP COLUMN "mapFromResourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" DROP COLUMN "mapFromCustomFieldName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" DROP COLUMN "mapFromResourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP COLUMN "mapFromCustomFieldName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP COLUMN "mapFromResourceType"`,
    );
  }
}
