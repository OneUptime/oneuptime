import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769780297584 implements MigrationInterface {
    public name = 'MigrationName1769780297584'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "IncidentSlaRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "order" integer NOT NULL DEFAULT '1', "isEnabled" boolean NOT NULL DEFAULT true, "responseTimeInMinutes" integer, "resolutionTimeInMinutes" integer, "atRiskThresholdInPercentage" integer NOT NULL DEFAULT '80', "internalNoteReminderIntervalInMinutes" integer, "publicNoteReminderIntervalInMinutes" integer, "internalNoteReminderTemplate" text, "publicNoteReminderTemplate" text, "incidentTitlePattern" character varying(500), "incidentDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_7df8338a70c16abb7151cc9773a" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cd2943c22620ee3a9910e45663" ON "IncidentSlaRule" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_98e3b3d2a1e67d5d87f6254aad" ON "IncidentSlaRule" ("name") `);
        await queryRunner.query(`CREATE INDEX "IDX_7d2380a578cc24568b6e0e9f6a" ON "IncidentSlaRule" ("order") `);
        await queryRunner.query(`CREATE INDEX "IDX_ec7114aadb854b2e6f09fa3d16" ON "IncidentSlaRule" ("isEnabled") `);
        await queryRunner.query(`CREATE TABLE "IncidentSla" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incidentId" uuid NOT NULL, "incidentSlaRuleId" uuid NOT NULL, "responseDeadline" TIMESTAMP WITH TIME ZONE, "resolutionDeadline" TIMESTAMP WITH TIME ZONE, "status" character varying NOT NULL DEFAULT 'On Track', "respondedAt" TIMESTAMP WITH TIME ZONE, "resolvedAt" TIMESTAMP WITH TIME ZONE, "lastInternalNoteReminderSentAt" TIMESTAMP WITH TIME ZONE, "lastPublicNoteReminderSentAt" TIMESTAMP WITH TIME ZONE, "breachNotificationSentAt" TIMESTAMP WITH TIME ZONE, "slaStartedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_1e0e4d23867592377d865cd7fb6" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b20ae37629c143339b0f105d3f" ON "IncidentSla" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_2716e3d68b8fed7a062cb41e04" ON "IncidentSla" ("incidentId") `);
        await queryRunner.query(`CREATE INDEX "IDX_cae25577f21f1c0c52c6d038ab" ON "IncidentSla" ("incidentSlaRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_872fce6c27af1f0aa04cf5b0bc" ON "IncidentSla" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_1e9dfd0511bc457251e0d27992" ON "IncidentSla" ("slaStartedAt") `);
        await queryRunner.query(`CREATE TABLE "IncidentSlaRuleMonitor" ("incidentSlaRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_5ca43621c3484d364bba1db0fdb" PRIMARY KEY ("incidentSlaRuleId", "monitorId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_330c3f5655149584f1918bf125" ON "IncidentSlaRuleMonitor" ("incidentSlaRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3deaa8530c9d6065da31f65116" ON "IncidentSlaRuleMonitor" ("monitorId") `);
        await queryRunner.query(`CREATE TABLE "IncidentSlaRuleIncidentSeverity" ("incidentSlaRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_2a68293adc48c01c8ef849ffefd" PRIMARY KEY ("incidentSlaRuleId", "incidentSeverityId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9d7443c084cbde74e8ab77d6df" ON "IncidentSlaRuleIncidentSeverity" ("incidentSlaRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_1dbba01db81040f8139bf5c4aa" ON "IncidentSlaRuleIncidentSeverity" ("incidentSeverityId") `);
        await queryRunner.query(`CREATE TABLE "IncidentSlaRuleIncidentLabel" ("incidentSlaRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_c3a28da9a45df8251bb25d5e8d6" PRIMARY KEY ("incidentSlaRuleId", "labelId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a63cac299eedb0d44c1e937fc2" ON "IncidentSlaRuleIncidentLabel" ("incidentSlaRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_df0e2d83d9dcbc528b830645de" ON "IncidentSlaRuleIncidentLabel" ("labelId") `);
        await queryRunner.query(`CREATE TABLE "IncidentSlaRuleMonitorLabel" ("incidentSlaRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_e20fa59ad1d35c2f3a9c45f0832" PRIMARY KEY ("incidentSlaRuleId", "labelId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c94cf6138ec340ae7c1976dbea" ON "IncidentSlaRuleMonitorLabel" ("incidentSlaRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_93e6f28f50bf56aadcc907f440" ON "IncidentSlaRuleMonitorLabel" ("labelId") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRule" ADD CONSTRAINT "FK_cd2943c22620ee3a9910e456637" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRule" ADD CONSTRAINT "FK_26e788cca21b14940116395350f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRule" ADD CONSTRAINT "FK_eb48fce1657c9a1e9245611857f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentSla" ADD CONSTRAINT "FK_b20ae37629c143339b0f105d3f8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentSla" ADD CONSTRAINT "FK_2716e3d68b8fed7a062cb41e04f" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentSla" ADD CONSTRAINT "FK_cae25577f21f1c0c52c6d038ab4" FOREIGN KEY ("incidentSlaRuleId") REFERENCES "IncidentSlaRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentSla" ADD CONSTRAINT "FK_9771f22534ed092c59f55198c5a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentSla" ADD CONSTRAINT "FK_c1cadef60fde93931b5131fbbba" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleMonitor" ADD CONSTRAINT "FK_330c3f5655149584f1918bf1258" FOREIGN KEY ("incidentSlaRuleId") REFERENCES "IncidentSlaRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleMonitor" ADD CONSTRAINT "FK_3deaa8530c9d6065da31f65116c" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleIncidentSeverity" ADD CONSTRAINT "FK_9d7443c084cbde74e8ab77d6dfc" FOREIGN KEY ("incidentSlaRuleId") REFERENCES "IncidentSlaRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleIncidentSeverity" ADD CONSTRAINT "FK_1dbba01db81040f8139bf5c4aae" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleIncidentLabel" ADD CONSTRAINT "FK_a63cac299eedb0d44c1e937fc24" FOREIGN KEY ("incidentSlaRuleId") REFERENCES "IncidentSlaRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleIncidentLabel" ADD CONSTRAINT "FK_df0e2d83d9dcbc528b830645ded" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleMonitorLabel" ADD CONSTRAINT "FK_c94cf6138ec340ae7c1976dbea2" FOREIGN KEY ("incidentSlaRuleId") REFERENCES "IncidentSlaRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleMonitorLabel" ADD CONSTRAINT "FK_93e6f28f50bf56aadcc907f4403" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleMonitorLabel" DROP CONSTRAINT "FK_93e6f28f50bf56aadcc907f4403"`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleMonitorLabel" DROP CONSTRAINT "FK_c94cf6138ec340ae7c1976dbea2"`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleIncidentLabel" DROP CONSTRAINT "FK_df0e2d83d9dcbc528b830645ded"`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleIncidentLabel" DROP CONSTRAINT "FK_a63cac299eedb0d44c1e937fc24"`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleIncidentSeverity" DROP CONSTRAINT "FK_1dbba01db81040f8139bf5c4aae"`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleIncidentSeverity" DROP CONSTRAINT "FK_9d7443c084cbde74e8ab77d6dfc"`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleMonitor" DROP CONSTRAINT "FK_3deaa8530c9d6065da31f65116c"`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRuleMonitor" DROP CONSTRAINT "FK_330c3f5655149584f1918bf1258"`);
        await queryRunner.query(`ALTER TABLE "IncidentSla" DROP CONSTRAINT "FK_c1cadef60fde93931b5131fbbba"`);
        await queryRunner.query(`ALTER TABLE "IncidentSla" DROP CONSTRAINT "FK_9771f22534ed092c59f55198c5a"`);
        await queryRunner.query(`ALTER TABLE "IncidentSla" DROP CONSTRAINT "FK_cae25577f21f1c0c52c6d038ab4"`);
        await queryRunner.query(`ALTER TABLE "IncidentSla" DROP CONSTRAINT "FK_2716e3d68b8fed7a062cb41e04f"`);
        await queryRunner.query(`ALTER TABLE "IncidentSla" DROP CONSTRAINT "FK_b20ae37629c143339b0f105d3f8"`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRule" DROP CONSTRAINT "FK_eb48fce1657c9a1e9245611857f"`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRule" DROP CONSTRAINT "FK_26e788cca21b14940116395350f"`);
        await queryRunner.query(`ALTER TABLE "IncidentSlaRule" DROP CONSTRAINT "FK_cd2943c22620ee3a9910e456637"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_93e6f28f50bf56aadcc907f440"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c94cf6138ec340ae7c1976dbea"`);
        await queryRunner.query(`DROP TABLE "IncidentSlaRuleMonitorLabel"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_df0e2d83d9dcbc528b830645de"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a63cac299eedb0d44c1e937fc2"`);
        await queryRunner.query(`DROP TABLE "IncidentSlaRuleIncidentLabel"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1dbba01db81040f8139bf5c4aa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9d7443c084cbde74e8ab77d6df"`);
        await queryRunner.query(`DROP TABLE "IncidentSlaRuleIncidentSeverity"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3deaa8530c9d6065da31f65116"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_330c3f5655149584f1918bf125"`);
        await queryRunner.query(`DROP TABLE "IncidentSlaRuleMonitor"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1e9dfd0511bc457251e0d27992"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_872fce6c27af1f0aa04cf5b0bc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cae25577f21f1c0c52c6d038ab"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2716e3d68b8fed7a062cb41e04"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b20ae37629c143339b0f105d3f"`);
        await queryRunner.query(`DROP TABLE "IncidentSla"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ec7114aadb854b2e6f09fa3d16"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7d2380a578cc24568b6e0e9f6a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_98e3b3d2a1e67d5d87f6254aad"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cd2943c22620ee3a9910e45663"`);
        await queryRunner.query(`DROP TABLE "IncidentSlaRule"`);
    }

}
