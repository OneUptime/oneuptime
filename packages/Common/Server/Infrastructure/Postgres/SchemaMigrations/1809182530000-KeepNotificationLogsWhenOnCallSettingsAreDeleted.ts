import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Deleting an escalation rule, an on-call schedule or a team keeps the
 * records of what was sent for it (issue #9036, as the on-call runs'
 * history is kept by KeepOnCallHistoryWhenItsSettingsAreDeleted).
 *
 * Every notification delivery log - the call, email, push, SMS, Telegram,
 * webhook, WhatsApp and workspace message logs - names the rule, schedule
 * and team an on-call page went out through, each ON DELETE CASCADE: the
 * delete of any of them deleted every log of every message ever sent for
 * it. Now the database clears the reference instead (ON DELETE SET NULL);
 * the log stays. A log's person and its on-call policy still cascade, as
 * the person's own pages and a run's policy do.
 *
 * Generated as a DROP and an ADD of each constraint. Each ADD, as
 * generated, goes to OnlineDdl.replaceForeignKey: dropped and added NOT
 * VALID in one statement - an instant's ACCESS EXCLUSIVE on the log and the
 * table it references, its wait bounded by the migration's lock_timeout -
 * then validated without blocking either table. Safe to run again: a key
 * already replaced and validated is left as it is.
 */
export class KeepNotificationLogsWhenOnCallSettingsAreDeleted1809182530000
  implements MigrationInterface
{
  public name: string =
    "KeepNotificationLogsWhenOnCallSettingsAreDeleted1809182530000";

  // OnlineDdl.replaceForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_80d91b1551ba233574c0bcb622a" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_cd59580cf3a63b448174a1137d5" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_05936c8c2d09e1d8b9e0ae4401d" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_b7304fe2449af401fb07cc8b1ce" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_e8c3faceca2821e87fcccd43d28" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_e394d08e87fb40b3a5d0b912505" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_a75ab085a0a948e113e120c468e" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_b7709c3c7792047a57c4e3c0904" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_dba4c943614d8fa262ca2f39bf2" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_31ebe9573e70ab9532994031422" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_45577c7db6091e91e99d492854b" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_ea4117e6437e6ea9a742dd978b3" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_73d4a08358acbc3f18bb8cf6c2a" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_59948ea3c04951efe8fc1295b88" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_5d20420ec35d6b20c195ac04beb" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_0b12854b347864adb78bdda6f99" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_c340cb0653d553203a37f402e4e" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_d625e8286c577c2f15391c3a38d" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_486f56105b72ee019cd96342723" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_f78a2014c70e4846df79f9e681a" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_a638be5c4d5e8551f7be91dd8be" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_8a1696a130d26efe72b215a1a78" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_b8212e8152d5b38c1d5d284fc9e" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_3881ce57f0bb88894ea33b77b17" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
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
      `ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_a638be5c4d5e8551f7be91dd8be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_f78a2014c70e4846df79f9e681a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_486f56105b72ee019cd96342723"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_d625e8286c577c2f15391c3a38d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_c340cb0653d553203a37f402e4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" DROP CONSTRAINT "FK_0b12854b347864adb78bdda6f99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_5d20420ec35d6b20c195ac04beb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_59948ea3c04951efe8fc1295b88"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" DROP CONSTRAINT "FK_73d4a08358acbc3f18bb8cf6c2a"`,
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
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_dba4c943614d8fa262ca2f39bf2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_b7709c3c7792047a57c4e3c0904"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP CONSTRAINT "FK_a75ab085a0a948e113e120c468e"`,
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
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_05936c8c2d09e1d8b9e0ae4401d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_cd59580cf3a63b448174a1137d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_80d91b1551ba233574c0bcb622a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_3881ce57f0bb88894ea33b77b17" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_b8212e8152d5b38c1d5d284fc9e" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ADD CONSTRAINT "FK_8a1696a130d26efe72b215a1a78" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_a638be5c4d5e8551f7be91dd8be" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_f78a2014c70e4846df79f9e681a" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_486f56105b72ee019cd96342723" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_d625e8286c577c2f15391c3a38d" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_c340cb0653d553203a37f402e4e" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WebhookLog" ADD CONSTRAINT "FK_0b12854b347864adb78bdda6f99" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_5d20420ec35d6b20c195ac04beb" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_59948ea3c04951efe8fc1295b88" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelegramLog" ADD CONSTRAINT "FK_73d4a08358acbc3f18bb8cf6c2a" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_ea4117e6437e6ea9a742dd978b3" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_45577c7db6091e91e99d492854b" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_31ebe9573e70ab9532994031422" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_dba4c943614d8fa262ca2f39bf2" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_b7709c3c7792047a57c4e3c0904" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD CONSTRAINT "FK_a75ab085a0a948e113e120c468e" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_e394d08e87fb40b3a5d0b912505" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_e8c3faceca2821e87fcccd43d28" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "EmailLog" ADD CONSTRAINT "FK_b7304fe2449af401fb07cc8b1ce" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_05936c8c2d09e1d8b9e0ae4401d" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_cd59580cf3a63b448174a1137d5" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_80d91b1551ba233574c0bcb622a" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
