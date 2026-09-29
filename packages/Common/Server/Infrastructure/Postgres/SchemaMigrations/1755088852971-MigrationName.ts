import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1755088852971 implements MigrationInterface {
  public name = "MigrationName1755088852971";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD "onCallDutyPolicyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD "onCallDutyPolicyEscalationRuleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD "onCallDutyPolicyScheduleId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "CallLog" ADD "teamId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD "onCallDutyPolicyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD "onCallDutyPolicyEscalationRuleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD "onCallDutyPolicyScheduleId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "EmailLog" ADD "teamId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD "onCallDutyPolicyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD "onCallDutyPolicyEscalationRuleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD "onCallDutyPolicyScheduleId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "SmsLog" ADD "teamId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD "onCallDutyPolicyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD "onCallDutyPolicyEscalationRuleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD "onCallDutyPolicyScheduleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD "teamId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD "onCallDutyPolicyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD "onCallDutyPolicyEscalationRuleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD "onCallDutyPolicyScheduleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD "teamId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6946bee33de8b45b86ebb0012e" ON "CallLog" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80d91b1551ba233574c0bcb622" ON "CallLog" ("onCallDutyPolicyEscalationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cd59580cf3a63b448174a1137d" ON "CallLog" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_05936c8c2d09e1d8b9e0ae4401" ON "CallLog" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_556a159f8352d88297a8d3e951" ON "EmailLog" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7304fe2449af401fb07cc8b1c" ON "EmailLog" ("onCallDutyPolicyEscalationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e8c3faceca2821e87fcccd43d2" ON "EmailLog" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e394d08e87fb40b3a5d0b91250" ON "EmailLog" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e40b9d395423a1f4426cf43bd8" ON "SmsLog" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31ebe9573e70ab953299403142" ON "SmsLog" ("onCallDutyPolicyEscalationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45577c7db6091e91e99d492854" ON "SmsLog" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea4117e6437e6ea9a742dd978b" ON "SmsLog" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a2439761a3dbd16c5944743690" ON "PushNotificationLog" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a75ab085a0a948e113e120c468" ON "PushNotificationLog" ("onCallDutyPolicyEscalationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7709c3c7792047a57c4e3c090" ON "PushNotificationLog" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dba4c943614d8fa262ca2f39bf" ON "PushNotificationLog" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bfe40c4a4b25d4d68d53879f30" ON "WorkspaceNotificationLog" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8a1696a130d26efe72b215a1a7" ON "WorkspaceNotificationLog" ("onCallDutyPolicyEscalationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8212e8152d5b38c1d5d284fc9" ON "WorkspaceNotificationLog" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3881ce57f0bb88894ea33b77b1" ON "WorkspaceNotificationLog" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_6946bee33de8b45b86ebb0012e8" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_80d91b1551ba233574c0bcb622a" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_cd59580cf3a63b448174a1137d5" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_05936c8c2d09e1d8b9e0ae4401d" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_556a159f8352d88297a8d3e951f" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_b7304fe2449af401fb07cc8b1ce" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_e8c3faceca2821e87fcccd43d28" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_e394d08e87fb40b3a5d0b912505" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_e40b9d395423a1f4426cf43bd8a" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_31ebe9573e70ab9532994031422" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_45577c7db6091e91e99d492854b" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_ea4117e6437e6ea9a742dd978b3" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_a2439761a3dbd16c59447436905" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_a75ab085a0a948e113e120c468e" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_b7709c3c7792047a57c4e3c0904" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_dba4c943614d8fa262ca2f39bf2" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_bfe40c4a4b25d4d68d53879f30d" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_8a1696a130d26efe72b215a1a78" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_b8212e8152d5b38c1d5d284fc9e" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_3881ce57f0bb88894ea33b77b17" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_3881ce57f0bb88894ea33b77b17"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_b8212e8152d5b38c1d5d284fc9e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_8a1696a130d26efe72b215a1a78"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP CONSTRAINT "FK_bfe40c4a4b25d4d68d53879f30d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_dba4c943614d8fa262ca2f39bf2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_b7709c3c7792047a57c4e3c0904"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_a75ab085a0a948e113e120c468e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_a2439761a3dbd16c59447436905"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_ea4117e6437e6ea9a742dd978b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_45577c7db6091e91e99d492854b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_31ebe9573e70ab9532994031422"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_e40b9d395423a1f4426cf43bd8a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_e394d08e87fb40b3a5d0b912505"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_e8c3faceca2821e87fcccd43d28"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_b7304fe2449af401fb07cc8b1ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP CONSTRAINT "FK_556a159f8352d88297a8d3e951f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_05936c8c2d09e1d8b9e0ae4401d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_cd59580cf3a63b448174a1137d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_80d91b1551ba233574c0bcb622a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_6946bee33de8b45b86ebb0012e8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3881ce57f0bb88894ea33b77b1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8212e8152d5b38c1d5d284fc9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a1696a130d26efe72b215a1a7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bfe40c4a4b25d4d68d53879f30"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dba4c943614d8fa262ca2f39bf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b7709c3c7792047a57c4e3c090"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a75ab085a0a948e113e120c468"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a2439761a3dbd16c5944743690"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea4117e6437e6ea9a742dd978b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_45577c7db6091e91e99d492854"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31ebe9573e70ab953299403142"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e40b9d395423a1f4426cf43bd8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e394d08e87fb40b3a5d0b91250"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e8c3faceca2821e87fcccd43d2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b7304fe2449af401fb07cc8b1c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_556a159f8352d88297a8d3e951"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_05936c8c2d09e1d8b9e0ae4401"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd59580cf3a63b448174a1137d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80d91b1551ba233574c0bcb622"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6946bee33de8b45b86ebb0012e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP COLUMN "teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP COLUMN "onCallDutyPolicyScheduleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP COLUMN "onCallDutyPolicyEscalationRuleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" DROP COLUMN "onCallDutyPolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP COLUMN "teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP COLUMN "onCallDutyPolicyScheduleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP COLUMN "onCallDutyPolicyEscalationRuleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP COLUMN "onCallDutyPolicyId"`,
    );
    await queryRunner.query(`ALTER TABLE "SmsLog" DROP COLUMN "teamId"`);
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP COLUMN "onCallDutyPolicyScheduleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP COLUMN "onCallDutyPolicyEscalationRuleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP COLUMN "onCallDutyPolicyId"`,
    );
    await queryRunner.query(`ALTER TABLE "EmailLog" DROP COLUMN "teamId"`);
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP COLUMN "onCallDutyPolicyScheduleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP COLUMN "onCallDutyPolicyEscalationRuleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" DROP COLUMN "onCallDutyPolicyId"`,
    );
    await queryRunner.query(`ALTER TABLE "CallLog" DROP COLUMN "teamId"`);
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP COLUMN "onCallDutyPolicyScheduleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP COLUMN "onCallDutyPolicyEscalationRuleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP COLUMN "onCallDutyPolicyId"`,
    );
  }
}
