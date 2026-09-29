import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1755030730926 implements MigrationInterface {
  public name = "MigrationName1755030730926";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CallLog" ADD "userId" uuid`);
    await queryRunner.query(`ALTER TABLE "EmailLog" ADD "userId" uuid`);
    await queryRunner.query(`ALTER TABLE "SmsLog" ADD "userId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD "userId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD "userId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47f0ed650c5e09da943caea60c" ON "CallLog" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d1fb84d0e16365609457eb1c7b" ON "EmailLog" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a2d58057bf9933c84b4fb0bafd" ON "SmsLog" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6da1247dee5e3bfa4cfd4d11ed" ON "PushNotificationLog" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0debc118df807b42cb4b274ff8" ON "WorkspaceNotificationLog" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_47f0ed650c5e09da943caea60c3" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_d1fb84d0e16365609457eb1c7ba" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_a2d58057bf9933c84b4fb0bafda" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_6da1247dee5e3bfa4cfd4d11ed6" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_0debc118df807b42cb4b274ff89" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_0debc118df807b42cb4b274ff89"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_6da1247dee5e3bfa4cfd4d11ed6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_a2d58057bf9933c84b4fb0bafda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_d1fb84d0e16365609457eb1c7ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_47f0ed650c5e09da943caea60c3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0debc118df807b42cb4b274ff8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6da1247dee5e3bfa4cfd4d11ed"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a2d58057bf9933c84b4fb0bafd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d1fb84d0e16365609457eb1c7b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47f0ed650c5e09da943caea60c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP COLUMN "userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP COLUMN "userId"`,
    );
    await queryRunner.query(`ALTER TABLE "SmsLog" DROP COLUMN "userId"`);
    await queryRunner.query(`ALTER TABLE "EmailLog" DROP COLUMN "userId"`);
    await queryRunner.query(`ALTER TABLE "CallLog" DROP COLUMN "userId"`);
  }
}
