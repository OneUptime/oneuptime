import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770054293299 implements MigrationInterface {
    public name = 'MigrationName1770054293299'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_70b9c1fa91a5f73810e7cd1b67"`);
        await queryRunner.query(`ALTER TABLE "Incident" DROP COLUMN "occurredAt"`);
        await queryRunner.query(`ALTER TABLE "CallLog" ADD "monitorId" uuid`);
        await queryRunner.query(`ALTER TABLE "EmailLog" ADD "monitorId" uuid`);
        await queryRunner.query(`ALTER TABLE "SmsLog" ADD "monitorId" uuid`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD "monitorId" uuid`);
        await queryRunner.query(`ALTER TABLE "PushNotificationLog" ADD "monitorId" uuid`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationLog" ADD "monitorId" uuid`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_dae47ce94b4f0bd1e27f9c5b34" ON "CallLog" ("monitorId") `);
        await queryRunner.query(`CREATE INDEX "IDX_51bdfa7eca53b8fbd7e1de3557" ON "EmailLog" ("monitorId") `);
        await queryRunner.query(`CREATE INDEX "IDX_0df98915051e60a98a99db94de" ON "SmsLog" ("monitorId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6c9e7c1df0058db3cb6d9a6e96" ON "WhatsAppLog" ("monitorId") `);
        await queryRunner.query(`CREATE INDEX "IDX_be5e4a65d5e061fa3e40dae6df" ON "PushNotificationLog" ("monitorId") `);
        await queryRunner.query(`CREATE INDEX "IDX_c8788e8f074fc4f8e9efd08af7" ON "WorkspaceNotificationLog" ("monitorId") `);
        await queryRunner.query(`ALTER TABLE "CallLog" ADD CONSTRAINT "FK_dae47ce94b4f0bd1e27f9c5b345" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_51bdfa7eca53b8fbd7e1de35573" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_0df98915051e60a98a99db94de0" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_6c9e7c1df0058db3cb6d9a6e965" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_be5e4a65d5e061fa3e40dae6dff" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_c8788e8f074fc4f8e9efd08af76" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_c8788e8f074fc4f8e9efd08af76"`);
        await queryRunner.query(`ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_be5e4a65d5e061fa3e40dae6dff"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_6c9e7c1df0058db3cb6d9a6e965"`);
        await queryRunner.query(`ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_0df98915051e60a98a99db94de0"`);
        await queryRunner.query(`ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_51bdfa7eca53b8fbd7e1de35573"`);
        await queryRunner.query(`ALTER TABLE "CallLog" DROP CONSTRAINT "FK_dae47ce94b4f0bd1e27f9c5b345"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c8788e8f074fc4f8e9efd08af7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_be5e4a65d5e061fa3e40dae6df"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6c9e7c1df0058db3cb6d9a6e96"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0df98915051e60a98a99db94de"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_51bdfa7eca53b8fbd7e1de3557"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dae47ce94b4f0bd1e27f9c5b34"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "WorkspaceNotificationLog" DROP COLUMN "monitorId"`);
        await queryRunner.query(`ALTER TABLE "PushNotificationLog" DROP COLUMN "monitorId"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP COLUMN "monitorId"`);
        await queryRunner.query(`ALTER TABLE "SmsLog" DROP COLUMN "monitorId"`);
        await queryRunner.query(`ALTER TABLE "EmailLog" DROP COLUMN "monitorId"`);
        await queryRunner.query(`ALTER TABLE "CallLog" DROP COLUMN "monitorId"`);
        await queryRunner.query(`ALTER TABLE "Incident" ADD "occurredAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE INDEX "IDX_70b9c1fa91a5f73810e7cd1b67" ON "Incident" ("occurredAt") `);
    }

}
