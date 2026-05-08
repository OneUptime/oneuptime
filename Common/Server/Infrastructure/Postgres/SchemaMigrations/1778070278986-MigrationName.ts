import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778070278986 implements MigrationInterface {
  public name = "MigrationName1778070278986";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentHost" ("incidentId" uuid NOT NULL, "hostId" uuid NOT NULL, CONSTRAINT "PK_af405a55232f0a9b86f8e61afc8" PRIMARY KEY ("incidentId", "hostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_754c607846b4d3fed7812910af" ON "IncidentHost" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_761485a265848de15cbe146577" ON "IncidentHost" ("hostId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertHost" ("alertId" uuid NOT NULL, "hostId" uuid NOT NULL, CONSTRAINT "PK_7d743416076d53cd4d3eb81e510" PRIMARY KEY ("alertId", "hostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_70537c0436813fa8056e5390e9" ON "AlertHost" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f241ff3816d26dfaa3ca615b18" ON "AlertHost" ("hostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentHost" ADD CONSTRAINT "FK_754c607846b4d3fed7812910aff" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentHost" ADD CONSTRAINT "FK_761485a265848de15cbe1465776" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertHost" ADD CONSTRAINT "FK_70537c0436813fa8056e5390e96" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertHost" ADD CONSTRAINT "FK_f241ff3816d26dfaa3ca615b185" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertHost" DROP CONSTRAINT "FK_f241ff3816d26dfaa3ca615b185"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertHost" DROP CONSTRAINT "FK_70537c0436813fa8056e5390e96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentHost" DROP CONSTRAINT "FK_761485a265848de15cbe1465776"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentHost" DROP CONSTRAINT "FK_754c607846b4d3fed7812910aff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f241ff3816d26dfaa3ca615b18"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_70537c0436813fa8056e5390e9"`,
    );
    await queryRunner.query(`DROP TABLE "AlertHost"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_761485a265848de15cbe146577"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_754c607846b4d3fed7812910af"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentHost"`);
  }
}
