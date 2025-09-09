import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1757423505855 implements MigrationInterface {
    public name = 'MigrationName1757423505855'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "AnnouncementMonitor" ("announcementId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_7acb54ddede76e67b5e2eb84519" PRIMARY KEY ("announcementId", "monitorId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b43baa07f7be40b5cfb61153fd" ON "AnnouncementMonitor" ("announcementId") `);
        await queryRunner.query(`CREATE INDEX "IDX_751be8c61cfeb7e1a0af9fcc3a" ON "AnnouncementMonitor" ("monitorId") `);
        await queryRunner.query(`CREATE TABLE "AnnouncementTemplateMonitor" ("announcementTemplateId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_ad19f2b65c1b6b77e7a8d80c028" PRIMARY KEY ("announcementTemplateId", "monitorId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_46bee9106e631ebe9f6c95ff15" ON "AnnouncementTemplateMonitor" ("announcementTemplateId") `);
        await queryRunner.query(`CREATE INDEX "IDX_0d979cb538fde87c7441d7bc93" ON "AnnouncementTemplateMonitor" ("monitorId") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "AnnouncementMonitor" ADD CONSTRAINT "FK_b43baa07f7be40b5cfb61153fd3" FOREIGN KEY ("announcementId") REFERENCES "StatusPageAnnouncement"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AnnouncementMonitor" ADD CONSTRAINT "FK_751be8c61cfeb7e1a0af9fcc3a0" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AnnouncementTemplateMonitor" ADD CONSTRAINT "FK_46bee9106e631ebe9f6c95ff153" FOREIGN KEY ("announcementTemplateId") REFERENCES "StatusPageAnnouncementTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AnnouncementTemplateMonitor" ADD CONSTRAINT "FK_0d979cb538fde87c7441d7bc936" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "AnnouncementTemplateMonitor" DROP CONSTRAINT "FK_0d979cb538fde87c7441d7bc936"`);
        await queryRunner.query(`ALTER TABLE "AnnouncementTemplateMonitor" DROP CONSTRAINT "FK_46bee9106e631ebe9f6c95ff153"`);
        await queryRunner.query(`ALTER TABLE "AnnouncementMonitor" DROP CONSTRAINT "FK_751be8c61cfeb7e1a0af9fcc3a0"`);
        await queryRunner.query(`ALTER TABLE "AnnouncementMonitor" DROP CONSTRAINT "FK_b43baa07f7be40b5cfb61153fd3"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0d979cb538fde87c7441d7bc93"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_46bee9106e631ebe9f6c95ff15"`);
        await queryRunner.query(`DROP TABLE "AnnouncementTemplateMonitor"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_751be8c61cfeb7e1a0af9fcc3a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b43baa07f7be40b5cfb61153fd"`);
        await queryRunner.query(`DROP TABLE "AnnouncementMonitor"`);
    }

}
