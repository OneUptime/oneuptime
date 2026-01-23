import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769172358833 implements MigrationInterface {
    public name = 'MigrationName1769172358833'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "AlertGroupingRuleMonitor" ("alertGroupingRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_2b6faf923556df2242a16b93fb7" PRIMARY KEY ("alertGroupingRuleId", "monitorId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_91b40cc6d343526075015f05a9" ON "AlertGroupingRuleMonitor" ("alertGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_a819b7733a603696cfcaadba35" ON "AlertGroupingRuleMonitor" ("monitorId") `);
        await queryRunner.query(`CREATE TABLE "AlertGroupingRuleAlertSeverity" ("alertGroupingRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_5178f1e1963b8496beda60f330d" PRIMARY KEY ("alertGroupingRuleId", "alertSeverityId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0e7726fda2f3288da32acd33a1" ON "AlertGroupingRuleAlertSeverity" ("alertGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_c1d82dcbc353eb227ab2a05984" ON "AlertGroupingRuleAlertSeverity" ("alertSeverityId") `);
        await queryRunner.query(`CREATE TABLE "AlertGroupingRuleAlertLabel" ("alertGroupingRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_b01145322bb355d6817b9c99045" PRIMARY KEY ("alertGroupingRuleId", "labelId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fc256e6b1e63df61175380f97b" ON "AlertGroupingRuleAlertLabel" ("alertGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_12620c464765c622c231d7c459" ON "AlertGroupingRuleAlertLabel" ("labelId") `);
        await queryRunner.query(`CREATE TABLE "AlertGroupingRuleMonitorLabel" ("alertGroupingRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_443ced6f783a0180e4eb8e0ce80" PRIMARY KEY ("alertGroupingRuleId", "labelId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8bb9e0543ad8ddb67480add741" ON "AlertGroupingRuleMonitorLabel" ("alertGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_38332de99fcc4c051440602bfc" ON "AlertGroupingRuleMonitorLabel" ("labelId") `);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" ADD "alertTitlePattern" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" ADD "alertDescriptionPattern" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" ADD "monitorNamePattern" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" ADD "monitorDescriptionPattern" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" ADD "groupByMonitor" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" ADD "groupBySeverity" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" ADD "groupByAlertTitle" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleMonitor" ADD CONSTRAINT "FK_91b40cc6d343526075015f05a9a" FOREIGN KEY ("alertGroupingRuleId") REFERENCES "AlertGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleMonitor" ADD CONSTRAINT "FK_a819b7733a603696cfcaadba356" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleAlertSeverity" ADD CONSTRAINT "FK_0e7726fda2f3288da32acd33a10" FOREIGN KEY ("alertGroupingRuleId") REFERENCES "AlertGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleAlertSeverity" ADD CONSTRAINT "FK_c1d82dcbc353eb227ab2a059847" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleAlertLabel" ADD CONSTRAINT "FK_fc256e6b1e63df61175380f97b7" FOREIGN KEY ("alertGroupingRuleId") REFERENCES "AlertGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleAlertLabel" ADD CONSTRAINT "FK_12620c464765c622c231d7c459e" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleMonitorLabel" ADD CONSTRAINT "FK_8bb9e0543ad8ddb67480add741f" FOREIGN KEY ("alertGroupingRuleId") REFERENCES "AlertGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleMonitorLabel" ADD CONSTRAINT "FK_38332de99fcc4c051440602bfc0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleMonitorLabel" DROP CONSTRAINT "FK_38332de99fcc4c051440602bfc0"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleMonitorLabel" DROP CONSTRAINT "FK_8bb9e0543ad8ddb67480add741f"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleAlertLabel" DROP CONSTRAINT "FK_12620c464765c622c231d7c459e"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleAlertLabel" DROP CONSTRAINT "FK_fc256e6b1e63df61175380f97b7"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleAlertSeverity" DROP CONSTRAINT "FK_c1d82dcbc353eb227ab2a059847"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleAlertSeverity" DROP CONSTRAINT "FK_0e7726fda2f3288da32acd33a10"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleMonitor" DROP CONSTRAINT "FK_a819b7733a603696cfcaadba356"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleMonitor" DROP CONSTRAINT "FK_91b40cc6d343526075015f05a9a"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" DROP COLUMN "groupByAlertTitle"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" DROP COLUMN "groupBySeverity"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" DROP COLUMN "groupByMonitor"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" DROP COLUMN "monitorDescriptionPattern"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" DROP COLUMN "monitorNamePattern"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" DROP COLUMN "alertDescriptionPattern"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRule" DROP COLUMN "alertTitlePattern"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_38332de99fcc4c051440602bfc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8bb9e0543ad8ddb67480add741"`);
        await queryRunner.query(`DROP TABLE "AlertGroupingRuleMonitorLabel"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_12620c464765c622c231d7c459"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fc256e6b1e63df61175380f97b"`);
        await queryRunner.query(`DROP TABLE "AlertGroupingRuleAlertLabel"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c1d82dcbc353eb227ab2a05984"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0e7726fda2f3288da32acd33a1"`);
        await queryRunner.query(`DROP TABLE "AlertGroupingRuleAlertSeverity"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a819b7733a603696cfcaadba35"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_91b40cc6d343526075015f05a9"`);
        await queryRunner.query(`DROP TABLE "AlertGroupingRuleMonitor"`);
    }

}
