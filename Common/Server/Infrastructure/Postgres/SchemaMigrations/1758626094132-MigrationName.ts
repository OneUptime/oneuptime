import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1758626094132 implements MigrationInterface {
    public name = 'MigrationName1758626094132'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "TeamComplianceSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "ruleType" character varying(100) NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "options" jsonb, CONSTRAINT "PK_7fdfcc67b176bbc26d188e84c3f" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_510f0d225fc3cec252790630e7" ON "TeamComplianceSetting" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_1afaa319cf5f476122b131e2b8" ON "TeamComplianceSetting" ("teamId") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" ADD CONSTRAINT "FK_510f0d225fc3cec252790630e77" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" ADD CONSTRAINT "FK_1afaa319cf5f476122b131e2b8f" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" ADD CONSTRAINT "FK_a639b6b7654f5b6ee6eb431a036" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" ADD CONSTRAINT "FK_380d3ad2f032b7a77956ef29095" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" DROP CONSTRAINT "FK_380d3ad2f032b7a77956ef29095"`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" DROP CONSTRAINT "FK_a639b6b7654f5b6ee6eb431a036"`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" DROP CONSTRAINT "FK_1afaa319cf5f476122b131e2b8f"`);
        await queryRunner.query(`ALTER TABLE "TeamComplianceSetting" DROP CONSTRAINT "FK_510f0d225fc3cec252790630e77"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1afaa319cf5f476122b131e2b8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_510f0d225fc3cec252790630e7"`);
        await queryRunner.query(`DROP TABLE "TeamComplianceSetting"`);
    }

}
