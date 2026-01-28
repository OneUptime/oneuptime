import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769629928240 implements MigrationInterface {
    public name = 'MigrationName1769629928240'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "IncidentGroupingRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "priority" integer NOT NULL DEFAULT '1', "isEnabled" boolean NOT NULL DEFAULT true, "matchCriteria" jsonb, "incidentTitlePattern" character varying(500), "incidentDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "groupByMonitor" boolean NOT NULL DEFAULT true, "groupBySeverity" boolean NOT NULL DEFAULT false, "groupByIncidentTitle" boolean NOT NULL DEFAULT false, "groupByService" boolean NOT NULL DEFAULT false, "enableTimeWindow" boolean NOT NULL DEFAULT false, "timeWindowMinutes" integer NOT NULL DEFAULT '60', "groupByFields" jsonb, "episodeTitleTemplate" character varying, "episodeDescriptionTemplate" character varying, "enableResolveDelay" boolean NOT NULL DEFAULT false, "resolveDelayMinutes" integer NOT NULL DEFAULT '0', "enableReopenWindow" boolean NOT NULL DEFAULT false, "reopenWindowMinutes" integer NOT NULL DEFAULT '0', "enableInactivityTimeout" boolean NOT NULL DEFAULT false, "inactivityTimeoutMinutes" integer NOT NULL DEFAULT '60', "defaultAssignToUserId" uuid, "defaultAssignToTeamId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_94c61c1e38617f17072f6b6ad8e" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b3b80cf4883fbd326b9bbd3a75" ON "IncidentGroupingRule" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_505e5c53bda97f6f31701d27af" ON "IncidentGroupingRule" ("name") `);
        await queryRunner.query(`CREATE INDEX "IDX_672943fcdc88c0bff4668cebb4" ON "IncidentGroupingRule" ("priority") `);
        await queryRunner.query(`CREATE INDEX "IDX_5dc2e7fd35a5fe8b7bcfd5a21d" ON "IncidentGroupingRule" ("isEnabled") `);
        await queryRunner.query(`CREATE INDEX "IDX_aac63b94b4af39a7160adaad2f" ON "IncidentGroupingRule" ("defaultAssignToUserId") `);
        await queryRunner.query(`CREATE INDEX "IDX_fe5bdf8166514940897662bcbd" ON "IncidentGroupingRule" ("defaultAssignToTeamId") `);
        await queryRunner.query(`CREATE TABLE "IncidentGroupingRuleMonitor" ("incidentGroupingRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_733aff4e3760e917f30aeea6fef" PRIMARY KEY ("incidentGroupingRuleId", "monitorId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_306e6908e7e2ad0dd71be881ba" ON "IncidentGroupingRuleMonitor" ("incidentGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d285e375f967fc59fa9b96d7bd" ON "IncidentGroupingRuleMonitor" ("monitorId") `);
        await queryRunner.query(`CREATE TABLE "IncidentGroupingRuleIncidentSeverity" ("incidentGroupingRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_6428963c1ee00831295b6f0d852" PRIMARY KEY ("incidentGroupingRuleId", "incidentSeverityId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a739768a8dac3516afe08743c0" ON "IncidentGroupingRuleIncidentSeverity" ("incidentGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3b4f50b01923d34ce7dd1d12db" ON "IncidentGroupingRuleIncidentSeverity" ("incidentSeverityId") `);
        await queryRunner.query(`CREATE TABLE "IncidentGroupingRuleIncidentLabel" ("incidentGroupingRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_933daef4671d705d7830fec0fd1" PRIMARY KEY ("incidentGroupingRuleId", "labelId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_723a687aa549c95a0df19d8da8" ON "IncidentGroupingRuleIncidentLabel" ("incidentGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_930efbf2a450f944d33cb83f8c" ON "IncidentGroupingRuleIncidentLabel" ("labelId") `);
        await queryRunner.query(`CREATE TABLE "IncidentGroupingRuleMonitorLabel" ("incidentGroupingRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_7cc99b79bc44599600a5959b8c6" PRIMARY KEY ("incidentGroupingRuleId", "labelId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_77880aadd07a2ca077b648b40d" ON "IncidentGroupingRuleMonitorLabel" ("incidentGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_97830e8e0a8164acf30e88fee0" ON "IncidentGroupingRuleMonitorLabel" ("labelId") `);
        await queryRunner.query(`CREATE TABLE "IncidentGroupingRuleOnCallDutyPolicy" ("incidentGroupingRuleId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_34cbe036592b89b84bfb9838c85" PRIMARY KEY ("incidentGroupingRuleId", "onCallDutyPolicyId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f2de7b843c3513ba7551dc1219" ON "IncidentGroupingRuleOnCallDutyPolicy" ("incidentGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3a98852815612d72d638624735" ON "IncidentGroupingRuleOnCallDutyPolicy" ("onCallDutyPolicyId") `);
        await queryRunner.query(`ALTER TABLE "IncidentEpisode" ADD "incidentGroupingRuleId" uuid`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_b74f982a546755197371a7b565" ON "IncidentEpisode" ("incidentGroupingRuleId") `);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" ADD CONSTRAINT "FK_b3b80cf4883fbd326b9bbd3a750" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" ADD CONSTRAINT "FK_aac63b94b4af39a7160adaad2f1" FOREIGN KEY ("defaultAssignToUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" ADD CONSTRAINT "FK_fe5bdf8166514940897662bcbd3" FOREIGN KEY ("defaultAssignToTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" ADD CONSTRAINT "FK_6ec3a9100f6af789dc869b18220" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" ADD CONSTRAINT "FK_7a0da098649113cb8251f48c0b5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisode" ADD CONSTRAINT "FK_b74f982a546755197371a7b565e" FOREIGN KEY ("incidentGroupingRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeMember" ADD CONSTRAINT "FK_b8e5a102d8effb7d56ee952df93" FOREIGN KEY ("matchedRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleMonitor" ADD CONSTRAINT "FK_306e6908e7e2ad0dd71be881bae" FOREIGN KEY ("incidentGroupingRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleMonitor" ADD CONSTRAINT "FK_d285e375f967fc59fa9b96d7bd5" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleIncidentSeverity" ADD CONSTRAINT "FK_a739768a8dac3516afe08743c08" FOREIGN KEY ("incidentGroupingRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleIncidentSeverity" ADD CONSTRAINT "FK_3b4f50b01923d34ce7dd1d12dbc" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleIncidentLabel" ADD CONSTRAINT "FK_723a687aa549c95a0df19d8da83" FOREIGN KEY ("incidentGroupingRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleIncidentLabel" ADD CONSTRAINT "FK_930efbf2a450f944d33cb83f8c5" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleMonitorLabel" ADD CONSTRAINT "FK_77880aadd07a2ca077b648b40dc" FOREIGN KEY ("incidentGroupingRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleMonitorLabel" ADD CONSTRAINT "FK_97830e8e0a8164acf30e88fee0e" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_f2de7b843c3513ba7551dc12195" FOREIGN KEY ("incidentGroupingRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_3a98852815612d72d638624735b" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_3a98852815612d72d638624735b"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_f2de7b843c3513ba7551dc12195"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleMonitorLabel" DROP CONSTRAINT "FK_97830e8e0a8164acf30e88fee0e"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleMonitorLabel" DROP CONSTRAINT "FK_77880aadd07a2ca077b648b40dc"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleIncidentLabel" DROP CONSTRAINT "FK_930efbf2a450f944d33cb83f8c5"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleIncidentLabel" DROP CONSTRAINT "FK_723a687aa549c95a0df19d8da83"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleIncidentSeverity" DROP CONSTRAINT "FK_3b4f50b01923d34ce7dd1d12dbc"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleIncidentSeverity" DROP CONSTRAINT "FK_a739768a8dac3516afe08743c08"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleMonitor" DROP CONSTRAINT "FK_d285e375f967fc59fa9b96d7bd5"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleMonitor" DROP CONSTRAINT "FK_306e6908e7e2ad0dd71be881bae"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeMember" DROP CONSTRAINT "FK_b8e5a102d8effb7d56ee952df93"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisode" DROP CONSTRAINT "FK_b74f982a546755197371a7b565e"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" DROP CONSTRAINT "FK_7a0da098649113cb8251f48c0b5"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" DROP CONSTRAINT "FK_6ec3a9100f6af789dc869b18220"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" DROP CONSTRAINT "FK_fe5bdf8166514940897662bcbd3"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" DROP CONSTRAINT "FK_aac63b94b4af39a7160adaad2f1"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" DROP CONSTRAINT "FK_b3b80cf4883fbd326b9bbd3a750"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b74f982a546755197371a7b565"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisode" DROP COLUMN "incidentGroupingRuleId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3a98852815612d72d638624735"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f2de7b843c3513ba7551dc1219"`);
        await queryRunner.query(`DROP TABLE "IncidentGroupingRuleOnCallDutyPolicy"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97830e8e0a8164acf30e88fee0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_77880aadd07a2ca077b648b40d"`);
        await queryRunner.query(`DROP TABLE "IncidentGroupingRuleMonitorLabel"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_930efbf2a450f944d33cb83f8c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_723a687aa549c95a0df19d8da8"`);
        await queryRunner.query(`DROP TABLE "IncidentGroupingRuleIncidentLabel"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3b4f50b01923d34ce7dd1d12db"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a739768a8dac3516afe08743c0"`);
        await queryRunner.query(`DROP TABLE "IncidentGroupingRuleIncidentSeverity"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d285e375f967fc59fa9b96d7bd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_306e6908e7e2ad0dd71be881ba"`);
        await queryRunner.query(`DROP TABLE "IncidentGroupingRuleMonitor"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fe5bdf8166514940897662bcbd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_aac63b94b4af39a7160adaad2f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5dc2e7fd35a5fe8b7bcfd5a21d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_672943fcdc88c0bff4668cebb4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_505e5c53bda97f6f31701d27af"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b3b80cf4883fbd326b9bbd3a75"`);
        await queryRunner.query(`DROP TABLE "IncidentGroupingRule"`);
    }

}
