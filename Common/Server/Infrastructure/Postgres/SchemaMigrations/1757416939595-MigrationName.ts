import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1757416939595 implements MigrationInterface {
    name = 'MigrationName1757416939595'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "IncidentTemplate" ADD "initialIncidentStateId" uuid`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_36317c99429a40d3344d838223" ON "IncidentTemplate" ("initialIncidentStateId") `);
        await queryRunner.query(`ALTER TABLE "IncidentTemplate" ADD CONSTRAINT "FK_36317c99429a40d3344d838223f" FOREIGN KEY ("initialIncidentStateId") REFERENCES "IncidentState"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "IncidentTemplate" DROP CONSTRAINT "FK_36317c99429a40d3344d838223f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_36317c99429a40d3344d838223"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "IncidentTemplate" DROP COLUMN "initialIncidentStateId"`);
    }

}
