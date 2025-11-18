import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1763477560906 implements MigrationInterface {
    public name = 'MigrationName1763477560906'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ScheduledMaintenanceInternalNoteFile" ("scheduledMaintenanceInternalNoteId" uuid NOT NULL, "fileId" uuid NOT NULL, CONSTRAINT "PK_fddb744dc7cf400724befe5ba91" PRIMARY KEY ("scheduledMaintenanceInternalNoteId", "fileId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ac92a60535a6d598c9619fd199" ON "ScheduledMaintenanceInternalNoteFile" ("scheduledMaintenanceInternalNoteId") `);
        await queryRunner.query(`CREATE INDEX "IDX_daee340befeece208b507a4242" ON "ScheduledMaintenanceInternalNoteFile" ("fileId") `);
        await queryRunner.query(`CREATE TABLE "ScheduledMaintenancePublicNoteFile" ("scheduledMaintenancePublicNoteId" uuid NOT NULL, "fileId" uuid NOT NULL, CONSTRAINT "PK_373f78b83aa76e5250df8ebaed7" PRIMARY KEY ("scheduledMaintenancePublicNoteId", "fileId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_af6905f89ca8108ed0f478fd37" ON "ScheduledMaintenancePublicNoteFile" ("scheduledMaintenancePublicNoteId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f09af6332e0b89f134472f0442" ON "ScheduledMaintenancePublicNoteFile" ("fileId") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceInternalNoteFile" ADD CONSTRAINT "FK_ac92a60535a6d598c9619fd1999" FOREIGN KEY ("scheduledMaintenanceInternalNoteId") REFERENCES "ScheduledMaintenanceInternalNote"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceInternalNoteFile" ADD CONSTRAINT "FK_daee340befeece208b507a42423" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenancePublicNoteFile" ADD CONSTRAINT "FK_af6905f89ca8108ed0f478fd376" FOREIGN KEY ("scheduledMaintenancePublicNoteId") REFERENCES "ScheduledMaintenancePublicNote"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenancePublicNoteFile" ADD CONSTRAINT "FK_f09af6332e0b89f134472f0442a" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenancePublicNoteFile" DROP CONSTRAINT "FK_f09af6332e0b89f134472f0442a"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenancePublicNoteFile" DROP CONSTRAINT "FK_af6905f89ca8108ed0f478fd376"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceInternalNoteFile" DROP CONSTRAINT "FK_daee340befeece208b507a42423"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceInternalNoteFile" DROP CONSTRAINT "FK_ac92a60535a6d598c9619fd1999"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f09af6332e0b89f134472f0442"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_af6905f89ca8108ed0f478fd37"`);
        await queryRunner.query(`DROP TABLE "ScheduledMaintenancePublicNoteFile"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_daee340befeece208b507a4242"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ac92a60535a6d598c9619fd199"`);
        await queryRunner.query(`DROP TABLE "ScheduledMaintenanceInternalNoteFile"`);
    }

}
