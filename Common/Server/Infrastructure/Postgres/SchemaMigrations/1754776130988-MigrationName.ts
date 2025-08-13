import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1754776130988 implements MigrationInterface {
  public name = "MigrationName1754776130988";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CallLog" ADD "incidentId" uuid`);
    await queryRunner.query(`ALTER TABLE "CallLog" ADD "alertId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD "scheduledMaintenanceId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "CallLog" ADD "statusPageId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD "statusPageAnnouncementId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "EmailLog" ADD "incidentId" uuid`);
    await queryRunner.query(`ALTER TABLE "EmailLog" ADD "alertId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD "scheduledMaintenanceId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "EmailLog" ADD "statusPageId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD "statusPageAnnouncementId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "SmsLog" ADD "incidentId" uuid`);
    await queryRunner.query(`ALTER TABLE "SmsLog" ADD "alertId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD "scheduledMaintenanceId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "SmsLog" ADD "statusPageId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD "statusPageAnnouncementId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a3c1be70374eb2d7bd4197b4e5" ON "CallLog" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cbcb36c6bf371312ed3b4480d7" ON "CallLog" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b351b484c705ed28ff70c63da" ON "CallLog" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52a2817222b04d171238c8d26f" ON "CallLog" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c97514eeb34172cce672ebc4b4" ON "CallLog" ("statusPageAnnouncementId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_958516eeac015e262300985222" ON "EmailLog" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41488030fe07b21423bf85c905" ON "EmailLog" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b9230ffb158999e3dc8809f522" ON "EmailLog" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f7cfcce7b39d0f82f6464eb4a" ON "EmailLog" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a1b7625a277725b4dde4e6914b" ON "EmailLog" ("statusPageAnnouncementId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4ac2d86e7aa70bc0f7e56c29e8" ON "SmsLog" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9ba525289a633e16eacc9252ba" ON "SmsLog" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77668eecd28b8adb9bdef350b3" ON "SmsLog" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_515845fba2e880ab364efc3f41" ON "SmsLog" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42ee5d4d59b6d029610c45b375" ON "SmsLog" ("statusPageAnnouncementId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_a3c1be70374eb2d7bd4197b4e5e" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_cbcb36c6bf371312ed3b4480d7a" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_9b351b484c705ed28ff70c63da5" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_52a2817222b04d171238c8d26fd" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_c97514eeb34172cce672ebc4b40" FOREIGN KEY ("statusPageAnnouncementId") REFERENCES "StatusPageAnnouncement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_958516eeac015e2623009852228" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_41488030fe07b21423bf85c9058" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_b9230ffb158999e3dc8809f5228" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_8f7cfcce7b39d0f82f6464eb4a4" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_a1b7625a277725b4dde4e6914b2" FOREIGN KEY ("statusPageAnnouncementId") REFERENCES "StatusPageAnnouncement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_4ac2d86e7aa70bc0f7e56c29e87" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_9ba525289a633e16eacc9252ba3" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_77668eecd28b8adb9bdef350b3b" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_515845fba2e880ab364efc3f414" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_42ee5d4d59b6d029610c45b3757" FOREIGN KEY ("statusPageAnnouncementId") REFERENCES "StatusPageAnnouncement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_42ee5d4d59b6d029610c45b3757"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_515845fba2e880ab364efc3f414"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_77668eecd28b8adb9bdef350b3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_9ba525289a633e16eacc9252ba3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_4ac2d86e7aa70bc0f7e56c29e87"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_a1b7625a277725b4dde4e6914b2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_8f7cfcce7b39d0f82f6464eb4a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_b9230ffb158999e3dc8809f5228"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_41488030fe07b21423bf85c9058"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_958516eeac015e2623009852228"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_c97514eeb34172cce672ebc4b40"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_52a2817222b04d171238c8d26fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_9b351b484c705ed28ff70c63da5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_cbcb36c6bf371312ed3b4480d7a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_a3c1be70374eb2d7bd4197b4e5e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42ee5d4d59b6d029610c45b375"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_515845fba2e880ab364efc3f41"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77668eecd28b8adb9bdef350b3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9ba525289a633e16eacc9252ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ac2d86e7aa70bc0f7e56c29e8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a1b7625a277725b4dde4e6914b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f7cfcce7b39d0f82f6464eb4a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b9230ffb158999e3dc8809f522"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_41488030fe07b21423bf85c905"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_958516eeac015e262300985222"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c97514eeb34172cce672ebc4b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52a2817222b04d171238c8d26f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9b351b484c705ed28ff70c63da"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cbcb36c6bf371312ed3b4480d7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a3c1be70374eb2d7bd4197b4e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP COLUMN "statusPageAnnouncementId"`,
    );
    await queryRunner.query(`ALTER TABLE "SmsLog" DROP COLUMN "statusPageId"`);
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP COLUMN "scheduledMaintenanceId"`,
    );
    await queryRunner.query(`ALTER TABLE "SmsLog" DROP COLUMN "alertId"`);
    await queryRunner.query(`ALTER TABLE "SmsLog" DROP COLUMN "incidentId"`);
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP COLUMN "statusPageAnnouncementId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP COLUMN "statusPageId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP COLUMN "scheduledMaintenanceId"`,
    );
    await queryRunner.query(`ALTER TABLE "EmailLog" DROP COLUMN "alertId"`);
    await queryRunner.query(`ALTER TABLE "EmailLog" DROP COLUMN "incidentId"`);
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP COLUMN "statusPageAnnouncementId"`,
    );
    await queryRunner.query(`ALTER TABLE "CallLog" DROP COLUMN "statusPageId"`);
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP COLUMN "scheduledMaintenanceId"`,
    );
    await queryRunner.query(`ALTER TABLE "CallLog" DROP COLUMN "alertId"`);
    await queryRunner.query(`ALTER TABLE "CallLog" DROP COLUMN "incidentId"`);
  }
}
