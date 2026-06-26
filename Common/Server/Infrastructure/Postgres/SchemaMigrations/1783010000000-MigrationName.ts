import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1783010000000 implements MigrationInterface {
  public name = "MigrationName1783010000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_iot_fleet_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_iot_fleet_archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_iot_fleet_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_iot_fleet_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" DROP CONSTRAINT "FK_iot_fleet_owner_team_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" DROP CONSTRAINT "FK_iot_fleet_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" DROP CONSTRAINT "FK_iot_fleet_owner_team_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" DROP CONSTRAINT "FK_iot_fleet_owner_team_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" DROP CONSTRAINT "FK_iot_fleet_owner_team_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" DROP CONSTRAINT "FK_iot_fleet_owner_user_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" DROP CONSTRAINT "FK_iot_fleet_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" DROP CONSTRAINT "FK_iot_fleet_owner_user_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" DROP CONSTRAINT "FK_iot_fleet_owner_user_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" DROP CONSTRAINT "FK_iot_fleet_owner_user_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_iot_device_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_iot_device_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_iot_device_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_iot_device_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" DROP CONSTRAINT "FK_iot_fleet_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" DROP CONSTRAINT "FK_iot_fleet_owner_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" DROP CONSTRAINT "FK_iot_fleet_owner_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" DROP CONSTRAINT "FK_iot_fleet_label_rule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" DROP CONSTRAINT "FK_iot_fleet_label_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" DROP CONSTRAINT "FK_iot_fleet_label_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" DROP CONSTRAINT "FK_iot_fleet_label_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" DROP CONSTRAINT "FK_iot_fleet_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" DROP CONSTRAINT "FK_incident_iot_fleet_incidentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" DROP CONSTRAINT "FK_incident_iot_fleet_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" DROP CONSTRAINT "FK_alert_iot_fleet_alertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" DROP CONSTRAINT "FK_alert_iot_fleet_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" DROP CONSTRAINT "FK_scheduled_maintenance_iot_fleet_scheduledMaintenanceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" DROP CONSTRAINT "FK_scheduled_maintenance_iot_fleet_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleIoTFleetLabel" DROP CONSTRAINT "FK_ifor_fleet_label_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleIoTFleetLabel" DROP CONSTRAINT "FK_ifor_fleet_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerUser" DROP CONSTRAINT "FK_ifor_owner_user_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerUser" DROP CONSTRAINT "FK_ifor_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_ifor_owner_team_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_ifor_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleIoTFleetLabel" DROP CONSTRAINT "FK_iflr_fleet_label_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleIoTFleetLabel" DROP CONSTRAINT "FK_iflr_fleet_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleLabelToAdd" DROP CONSTRAINT "FK_iflr_label_to_add_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleLabelToAdd" DROP CONSTRAINT "FK_iflr_label_to_add_labelId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_fleet_projectId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_fleet_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_fleet_slug"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_fleet_isArchived"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_projectId_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_team_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_team_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_team_iotFleetId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_team_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_user_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_user_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_user_iotFleetId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_user_isOwnerNotified"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_device_projectId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_device_iotFleetId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_iot_device_identity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_owner_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_label_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_label_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_label_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_label_iotFleetId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_fleet_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_iot_fleet_incidentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_iot_fleet_iotFleetId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_iot_fleet_alertId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_iot_fleet_iotFleetId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scheduled_maintenance_iot_fleet_scheduledMaintenanceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scheduled_maintenance_iot_fleet_iotFleetId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ifor_fleet_label_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ifor_fleet_label_labelId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_ifor_owner_user_ruleId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ifor_owner_user_userId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ifor_owner_team_ruleId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ifor_owner_team_teamId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iflr_fleet_label_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iflr_fleet_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iflr_label_to_add_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iflr_label_to_add_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7085ca5bd6759244658ae92c61" ON "IoTFleet" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_29362e55ba98447461ffdc88cf" ON "IoTFleet" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28ab1eb00e76f0f9218869681d" ON "IoTFleet" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d214ba009e4cabda9dc647dad0" ON "IoTFleet" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a2b7ff8e2ab9b8e5fe2e6d1b1d" ON "IoTFleetOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d971257c3d9243d36cce94512" ON "IoTFleetOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0d9a66f2450af828abeec03911" ON "IoTFleetOwnerTeam" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e6585e1476426ed5777d4c761" ON "IoTFleetOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db2eee63be1f9e91d2cb5c74a5" ON "IoTFleetOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5840d80c4095bbc9503f56bcc3" ON "IoTFleetOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_616e525fa781071484551fd1c9" ON "IoTFleetOwnerUser" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3f6938f18e72a721d7f918274" ON "IoTFleetOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_374a1cdf32244bee064804e772" ON "IoTDevice" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a157b610bb86d9da058abd3c1" ON "IoTDevice" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_14d9d8a86fe8d27d9028e8bf18" ON "IoTDevice" ("projectId", "iotFleetId", "kind", "externalId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b49a2975442f0314c1385c1cbb" ON "IoTFleetOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7dc2c7f08db8489eb6d371725a" ON "IoTFleetOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9e3dd267298395b31610815b58" ON "IoTFleetOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_679a3a2d1af5c86db57187503f" ON "IoTFleetLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9e50efb4be9a223fdb4dbb3273" ON "IoTFleetLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d0d9f84572ea1e45e5ad6f9d0" ON "IoTFleetLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a39f6d112d8ceade4f7457dc6e" ON "IoTFleetLabel" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_55417724523d74b0a7ec2c4d01" ON "IoTFleetLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_013ea6dcf174b2d2f61bf513a5" ON "IncidentIoTFleet" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5aa909a08fe6e5b6a62333ad8d" ON "IncidentIoTFleet" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5cded38b0426eb07d4c38e30c" ON "AlertIoTFleet" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_470ca2fb9890c73b9c0864be10" ON "AlertIoTFleet" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7220f7e7b7eb6c77432f72fe02" ON "ScheduledMaintenanceIoTFleet" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ee2e1f5d0edd28178a54b40d4" ON "ScheduledMaintenanceIoTFleet" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52221393486bae9c27502424f4" ON "IoTFleetOwnerRuleIoTFleetLabel" ("iotFleetOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bce2a863ba89d4fe8a8fe2b688" ON "IoTFleetOwnerRuleIoTFleetLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a07632d270f7f3f1c7b808f789" ON "IoTFleetOwnerRuleOwnerUser" ("iotFleetOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_79be6535b4c3a3cf128b08c457" ON "IoTFleetOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfc37818cd1e9c7ffaba8c9c2a" ON "IoTFleetOwnerRuleOwnerTeam" ("iotFleetOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e6619bcc1a347b984557c4f808" ON "IoTFleetOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46d1fcb4145b9fbfa1045bbe29" ON "IoTFleetLabelRuleIoTFleetLabel" ("iotFleetLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52429e6f47d01d7b11a469815a" ON "IoTFleetLabelRuleIoTFleetLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4204c241c0c69f08a4a00b6959" ON "IoTFleetLabelRuleLabelToAdd" ("iotFleetLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9f6b46e83eca73768c5daaa91" ON "IoTFleetLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_7085ca5bd6759244658ae92c61c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_eaa84aaaf581230844e06f94980" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_45e3d6ac41181d4454a94fe865a" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_1be95254160cf2b11cb4575f00a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_a2b7ff8e2ab9b8e5fe2e6d1b1d4" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_6d971257c3d9243d36cce94512e" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_0d9a66f2450af828abeec039112" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_e7249efffe6cddf7d5f4d324197" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_0ccafe61295a6f62a3f4899c372" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_db2eee63be1f9e91d2cb5c74a5f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_5840d80c4095bbc9503f56bcc33" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_616e525fa781071484551fd1c94" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_779bcae8cb2d6458cbc38c21eb7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_f00c122709a8a42f59f89da15b8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_374a1cdf32244bee064804e772a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_4a157b610bb86d9da058abd3c1f" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_ec5cccfbe638ca64f48e3a5d66d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_0bec7e63da775127f425eeb619f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD CONSTRAINT "FK_b49a2975442f0314c1385c1cbb9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD CONSTRAINT "FK_072a6a7b47d368fd6750bfdfed7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD CONSTRAINT "FK_49fa74d67c3068757d076ed49bd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD CONSTRAINT "FK_679a3a2d1af5c86db57187503f6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD CONSTRAINT "FK_137b309bb72f5c4c6664907fbb7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD CONSTRAINT "FK_f6e3d26ded484089e5efea3042b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" ADD CONSTRAINT "FK_a39f6d112d8ceade4f7457dc6ec" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" ADD CONSTRAINT "FK_55417724523d74b0a7ec2c4d019" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" ADD CONSTRAINT "FK_013ea6dcf174b2d2f61bf513a5b" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" ADD CONSTRAINT "FK_5aa909a08fe6e5b6a62333ad8d6" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" ADD CONSTRAINT "FK_d5cded38b0426eb07d4c38e30cd" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" ADD CONSTRAINT "FK_470ca2fb9890c73b9c0864be103" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" ADD CONSTRAINT "FK_7220f7e7b7eb6c77432f72fe025" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" ADD CONSTRAINT "FK_0ee2e1f5d0edd28178a54b40d44" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleIoTFleetLabel" ADD CONSTRAINT "FK_52221393486bae9c27502424f45" FOREIGN KEY ("iotFleetOwnerRuleId") REFERENCES "IoTFleetOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleIoTFleetLabel" ADD CONSTRAINT "FK_bce2a863ba89d4fe8a8fe2b6888" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerUser" ADD CONSTRAINT "FK_a07632d270f7f3f1c7b808f7894" FOREIGN KEY ("iotFleetOwnerRuleId") REFERENCES "IoTFleetOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerUser" ADD CONSTRAINT "FK_79be6535b4c3a3cf128b08c4572" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_cfc37818cd1e9c7ffaba8c9c2af" FOREIGN KEY ("iotFleetOwnerRuleId") REFERENCES "IoTFleetOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_e6619bcc1a347b984557c4f8081" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleIoTFleetLabel" ADD CONSTRAINT "FK_46d1fcb4145b9fbfa1045bbe297" FOREIGN KEY ("iotFleetLabelRuleId") REFERENCES "IoTFleetLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleIoTFleetLabel" ADD CONSTRAINT "FK_52429e6f47d01d7b11a469815a5" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleLabelToAdd" ADD CONSTRAINT "FK_4204c241c0c69f08a4a00b69592" FOREIGN KEY ("iotFleetLabelRuleId") REFERENCES "IoTFleetLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleLabelToAdd" ADD CONSTRAINT "FK_d9f6b46e83eca73768c5daaa91b" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleLabelToAdd" DROP CONSTRAINT "FK_d9f6b46e83eca73768c5daaa91b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleLabelToAdd" DROP CONSTRAINT "FK_4204c241c0c69f08a4a00b69592"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleIoTFleetLabel" DROP CONSTRAINT "FK_52429e6f47d01d7b11a469815a5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleIoTFleetLabel" DROP CONSTRAINT "FK_46d1fcb4145b9fbfa1045bbe297"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_e6619bcc1a347b984557c4f8081"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_cfc37818cd1e9c7ffaba8c9c2af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerUser" DROP CONSTRAINT "FK_79be6535b4c3a3cf128b08c4572"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerUser" DROP CONSTRAINT "FK_a07632d270f7f3f1c7b808f7894"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleIoTFleetLabel" DROP CONSTRAINT "FK_bce2a863ba89d4fe8a8fe2b6888"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleIoTFleetLabel" DROP CONSTRAINT "FK_52221393486bae9c27502424f45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" DROP CONSTRAINT "FK_0ee2e1f5d0edd28178a54b40d44"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" DROP CONSTRAINT "FK_7220f7e7b7eb6c77432f72fe025"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" DROP CONSTRAINT "FK_470ca2fb9890c73b9c0864be103"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" DROP CONSTRAINT "FK_d5cded38b0426eb07d4c38e30cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" DROP CONSTRAINT "FK_5aa909a08fe6e5b6a62333ad8d6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" DROP CONSTRAINT "FK_013ea6dcf174b2d2f61bf513a5b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" DROP CONSTRAINT "FK_55417724523d74b0a7ec2c4d019"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" DROP CONSTRAINT "FK_a39f6d112d8ceade4f7457dc6ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" DROP CONSTRAINT "FK_f6e3d26ded484089e5efea3042b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" DROP CONSTRAINT "FK_137b309bb72f5c4c6664907fbb7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" DROP CONSTRAINT "FK_679a3a2d1af5c86db57187503f6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" DROP CONSTRAINT "FK_49fa74d67c3068757d076ed49bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" DROP CONSTRAINT "FK_072a6a7b47d368fd6750bfdfed7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" DROP CONSTRAINT "FK_b49a2975442f0314c1385c1cbb9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_0bec7e63da775127f425eeb619f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_ec5cccfbe638ca64f48e3a5d66d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_4a157b610bb86d9da058abd3c1f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP CONSTRAINT "FK_374a1cdf32244bee064804e772a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" DROP CONSTRAINT "FK_f00c122709a8a42f59f89da15b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" DROP CONSTRAINT "FK_779bcae8cb2d6458cbc38c21eb7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" DROP CONSTRAINT "FK_616e525fa781071484551fd1c94"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" DROP CONSTRAINT "FK_5840d80c4095bbc9503f56bcc33"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" DROP CONSTRAINT "FK_db2eee63be1f9e91d2cb5c74a5f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" DROP CONSTRAINT "FK_0ccafe61295a6f62a3f4899c372"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" DROP CONSTRAINT "FK_e7249efffe6cddf7d5f4d324197"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" DROP CONSTRAINT "FK_0d9a66f2450af828abeec039112"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" DROP CONSTRAINT "FK_6d971257c3d9243d36cce94512e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" DROP CONSTRAINT "FK_a2b7ff8e2ab9b8e5fe2e6d1b1d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_1be95254160cf2b11cb4575f00a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_45e3d6ac41181d4454a94fe865a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_eaa84aaaf581230844e06f94980"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_7085ca5bd6759244658ae92c61c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9f6b46e83eca73768c5daaa91"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4204c241c0c69f08a4a00b6959"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52429e6f47d01d7b11a469815a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46d1fcb4145b9fbfa1045bbe29"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e6619bcc1a347b984557c4f808"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfc37818cd1e9c7ffaba8c9c2a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79be6535b4c3a3cf128b08c457"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a07632d270f7f3f1c7b808f789"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bce2a863ba89d4fe8a8fe2b688"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52221393486bae9c27502424f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ee2e1f5d0edd28178a54b40d4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7220f7e7b7eb6c77432f72fe02"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_470ca2fb9890c73b9c0864be10"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5cded38b0426eb07d4c38e30c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5aa909a08fe6e5b6a62333ad8d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_013ea6dcf174b2d2f61bf513a5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_55417724523d74b0a7ec2c4d01"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a39f6d112d8ceade4f7457dc6e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d0d9f84572ea1e45e5ad6f9d0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9e50efb4be9a223fdb4dbb3273"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_679a3a2d1af5c86db57187503f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9e3dd267298395b31610815b58"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7dc2c7f08db8489eb6d371725a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b49a2975442f0314c1385c1cbb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_14d9d8a86fe8d27d9028e8bf18"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a157b610bb86d9da058abd3c1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_374a1cdf32244bee064804e772"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d3f6938f18e72a721d7f918274"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_616e525fa781071484551fd1c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5840d80c4095bbc9503f56bcc3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db2eee63be1f9e91d2cb5c74a5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e6585e1476426ed5777d4c761"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0d9a66f2450af828abeec03911"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6d971257c3d9243d36cce94512"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a2b7ff8e2ab9b8e5fe2e6d1b1d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d214ba009e4cabda9dc647dad0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28ab1eb00e76f0f9218869681d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_29362e55ba98447461ffdc88cf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7085ca5bd6759244658ae92c61"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iflr_label_to_add_labelId" ON "IoTFleetLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iflr_label_to_add_ruleId" ON "IoTFleetLabelRuleLabelToAdd" ("iotFleetLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iflr_fleet_label_labelId" ON "IoTFleetLabelRuleIoTFleetLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iflr_fleet_label_ruleId" ON "IoTFleetLabelRuleIoTFleetLabel" ("iotFleetLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_owner_team_teamId" ON "IoTFleetOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_owner_team_ruleId" ON "IoTFleetOwnerRuleOwnerTeam" ("iotFleetOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_owner_user_userId" ON "IoTFleetOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_owner_user_ruleId" ON "IoTFleetOwnerRuleOwnerUser" ("iotFleetOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_fleet_label_labelId" ON "IoTFleetOwnerRuleIoTFleetLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ifor_fleet_label_ruleId" ON "IoTFleetOwnerRuleIoTFleetLabel" ("iotFleetOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_maintenance_iot_fleet_iotFleetId" ON "ScheduledMaintenanceIoTFleet" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_maintenance_iot_fleet_scheduledMaintenanceId" ON "ScheduledMaintenanceIoTFleet" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_iot_fleet_iotFleetId" ON "AlertIoTFleet" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_iot_fleet_alertId" ON "AlertIoTFleet" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_iot_fleet_iotFleetId" ON "IncidentIoTFleet" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_iot_fleet_incidentId" ON "IncidentIoTFleet" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_label_labelId" ON "IoTFleetLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_label_iotFleetId" ON "IoTFleetLabel" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_label_rule_isEnabled" ON "IoTFleetLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_label_rule_name" ON "IoTFleetLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_label_rule_projectId" ON "IoTFleetLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_rule_isEnabled" ON "IoTFleetOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_rule_name" ON "IoTFleetOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_rule_projectId" ON "IoTFleetOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_iot_device_identity" ON "IoTDevice" ("projectId", "iotFleetId", "kind", "externalId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_iotFleetId" ON "IoTDevice" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_projectId" ON "IoTDevice" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_user_isOwnerNotified" ON "IoTFleetOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_user_iotFleetId" ON "IoTFleetOwnerUser" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_user_userId" ON "IoTFleetOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_user_projectId" ON "IoTFleetOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_team_isOwnerNotified" ON "IoTFleetOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_team_iotFleetId" ON "IoTFleetOwnerTeam" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_team_teamId" ON "IoTFleetOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_owner_team_projectId" ON "IoTFleetOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_iot_fleet_projectId_name" ON "IoTFleet" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_isArchived" ON "IoTFleet" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_iot_fleet_slug" ON "IoTFleet" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_name" ON "IoTFleet" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_fleet_projectId" ON "IoTFleet" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleLabelToAdd" ADD CONSTRAINT "FK_iflr_label_to_add_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleLabelToAdd" ADD CONSTRAINT "FK_iflr_label_to_add_ruleId" FOREIGN KEY ("iotFleetLabelRuleId") REFERENCES "IoTFleetLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleIoTFleetLabel" ADD CONSTRAINT "FK_iflr_fleet_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRuleIoTFleetLabel" ADD CONSTRAINT "FK_iflr_fleet_label_ruleId" FOREIGN KEY ("iotFleetLabelRuleId") REFERENCES "IoTFleetLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_ifor_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_ifor_owner_team_ruleId" FOREIGN KEY ("iotFleetOwnerRuleId") REFERENCES "IoTFleetOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerUser" ADD CONSTRAINT "FK_ifor_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleOwnerUser" ADD CONSTRAINT "FK_ifor_owner_user_ruleId" FOREIGN KEY ("iotFleetOwnerRuleId") REFERENCES "IoTFleetOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleIoTFleetLabel" ADD CONSTRAINT "FK_ifor_fleet_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRuleIoTFleetLabel" ADD CONSTRAINT "FK_ifor_fleet_label_ruleId" FOREIGN KEY ("iotFleetOwnerRuleId") REFERENCES "IoTFleetOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" ADD CONSTRAINT "FK_scheduled_maintenance_iot_fleet_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceIoTFleet" ADD CONSTRAINT "FK_scheduled_maintenance_iot_fleet_scheduledMaintenanceId" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" ADD CONSTRAINT "FK_alert_iot_fleet_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertIoTFleet" ADD CONSTRAINT "FK_alert_iot_fleet_alertId" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" ADD CONSTRAINT "FK_incident_iot_fleet_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentIoTFleet" ADD CONSTRAINT "FK_incident_iot_fleet_incidentId" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" ADD CONSTRAINT "FK_iot_fleet_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabel" ADD CONSTRAINT "FK_iot_fleet_label_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD CONSTRAINT "FK_iot_fleet_label_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD CONSTRAINT "FK_iot_fleet_label_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetLabelRule" ADD CONSTRAINT "FK_iot_fleet_label_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD CONSTRAINT "FK_iot_fleet_owner_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD CONSTRAINT "FK_iot_fleet_owner_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerRule" ADD CONSTRAINT "FK_iot_fleet_owner_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_iot_device_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_iot_device_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_iot_device_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD CONSTRAINT "FK_iot_device_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_iot_fleet_owner_user_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_iot_fleet_owner_user_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_iot_fleet_owner_user_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_iot_fleet_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerUser" ADD CONSTRAINT "FK_iot_fleet_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_iot_fleet_owner_team_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_iot_fleet_owner_team_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_iot_fleet_owner_team_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_iot_fleet_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleetOwnerTeam" ADD CONSTRAINT "FK_iot_fleet_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_iot_fleet_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_iot_fleet_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_iot_fleet_archivedByUserId" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_iot_fleet_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
