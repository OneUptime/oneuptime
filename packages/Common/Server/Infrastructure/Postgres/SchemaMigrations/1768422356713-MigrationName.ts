import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1768422356713 implements MigrationInterface {
  public name = "MigrationName1768422356713";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_Monitor_incomingEmailSecretKey"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_Monitor_incomingEmailMonitorLastEmailReceivedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_Monitor_incomingEmailMonitorHeartbeatCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_94ee326d2c07251b662b431fac" ON "Monitor" ("incomingEmailSecretKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_185f36c4cebf452333df869187" ON "Monitor" ("incomingEmailMonitorLastEmailReceivedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33a77f31ba5b28905464433756" ON "Monitor" ("incomingEmailMonitorHeartbeatCheckedAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33a77f31ba5b28905464433756"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_185f36c4cebf452333df869187"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_94ee326d2c07251b662b431fac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_Monitor_incomingEmailMonitorHeartbeatCheckedAt" ON "Monitor" ("incomingEmailMonitorHeartbeatCheckedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_Monitor_incomingEmailMonitorLastEmailReceivedAt" ON "Monitor" ("incomingEmailMonitorLastEmailReceivedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_Monitor_incomingEmailSecretKey" ON "Monitor" ("incomingEmailSecretKey") `,
    );
  }
}
