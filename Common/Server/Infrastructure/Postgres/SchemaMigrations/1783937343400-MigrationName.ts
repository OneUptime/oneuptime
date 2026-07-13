import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1783937343400 implements MigrationInterface {
  public name = "MigrationName1783937343400";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_Project_alertInvestigationMinimumSeverityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_network_device_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_network_device_probeId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_network_device_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_network_device_archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_network_device_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" DROP CONSTRAINT "FK_nd_owner_team_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" DROP CONSTRAINT "FK_nd_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" DROP CONSTRAINT "FK_nd_owner_team_networkDeviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" DROP CONSTRAINT "FK_nd_owner_team_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" DROP CONSTRAINT "FK_nd_owner_team_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" DROP CONSTRAINT "FK_nd_owner_user_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" DROP CONSTRAINT "FK_nd_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" DROP CONSTRAINT "FK_nd_owner_user_networkDeviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" DROP CONSTRAINT "FK_nd_owner_user_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" DROP CONSTRAINT "FK_nd_owner_user_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" DROP CONSTRAINT "FK_nd_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" DROP CONSTRAINT "FK_nd_owner_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" DROP CONSTRAINT "FK_nd_owner_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" DROP CONSTRAINT "FK_nd_label_rule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" DROP CONSTRAINT "FK_nd_label_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" DROP CONSTRAINT "FK_nd_label_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP CONSTRAINT "FK_nd_discovery_scan_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP CONSTRAINT "FK_nd_discovery_scan_probeId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP CONSTRAINT "FK_nd_discovery_scan_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP CONSTRAINT "FK_nd_discovery_scan_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP CONSTRAINT "FK_network_interface_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP CONSTRAINT "FK_network_interface_networkDeviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP CONSTRAINT "FK_network_interface_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP CONSTRAINT "FK_network_interface_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_iot_device_credential_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_iot_device_credential_iotFleetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_iot_device_credential_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_iot_device_credential_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabel" DROP CONSTRAINT "FK_network_device_label_networkDeviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabel" DROP CONSTRAINT "FK_network_device_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleNetworkDeviceLabel" DROP CONSTRAINT "FK_NetworkDeviceOwnerRuleNetworkDeviceLabel_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleNetworkDeviceLabel" DROP CONSTRAINT "FK_NetworkDeviceOwnerRuleNetworkDeviceLabel_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerUser" DROP CONSTRAINT "FK_NetworkDeviceOwnerRuleOwnerUser_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerUser" DROP CONSTRAINT "FK_NetworkDeviceOwnerRuleOwnerUser_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_NetworkDeviceOwnerRuleOwnerTeam_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_NetworkDeviceOwnerRuleOwnerTeam_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleNetworkDeviceLabel" DROP CONSTRAINT "FK_NetworkDeviceLabelRuleNetworkDeviceLabel_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleNetworkDeviceLabel" DROP CONSTRAINT "FK_NetworkDeviceLabelRuleNetworkDeviceLabel_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleLabelToAdd" DROP CONSTRAINT "FK_NetworkDeviceLabelRuleLabelToAdd_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleLabelToAdd" DROP CONSTRAINT "FK_NetworkDeviceLabelRuleLabelToAdd_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_projectId_isArchived"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_hostname"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_network_device_slug"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_team_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_team_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_team_networkDeviceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_team_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_user_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_user_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_user_networkDeviceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_user_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_owner_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_label_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_label_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_label_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_discovery_scan_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_discovery_scan_probeId_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_interface_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_interface_networkDeviceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_interface_projectId_networkDeviceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_interface_device_ifindex"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_device_credential_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_device_credential_iotFleetId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_device_credential_externalId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_device_credential_secretKey"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_iot_device_credential_fleet_externalId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_AIRun_triggeredByIncidentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_AIRun_triggeredByAlertId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_AIRun_monitorId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_label_networkDeviceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_NetworkDeviceOwnerRuleNetworkDeviceLabel_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_NetworkDeviceOwnerRuleNetworkDeviceLabel_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_NetworkDeviceOwnerRuleOwnerUser_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_NetworkDeviceOwnerRuleOwnerUser_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_NetworkDeviceOwnerRuleOwnerTeam_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_NetworkDeviceOwnerRuleOwnerTeam_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_NetworkDeviceLabelRuleNetworkDeviceLabel_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_NetworkDeviceLabelRuleNetworkDeviceLabel_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_NetworkDeviceLabelRuleLabelToAdd_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_NetworkDeviceLabelRuleLabelToAdd_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP COLUMN "createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP COLUMN "deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "snmpVersion" SET DEFAULT 'V2c'`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3AuthKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3AuthKey" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3PrivKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3PrivKey" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpVersion" SET DEFAULT 'V2c'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_013b5e41b9038b20bb5d5eb419" ON "NetworkDevice" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0fa6fd1a6f500aaa861b7889b5" ON "NetworkDevice" ("hostname") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_878d6fc3878837bb01e09b2f3f" ON "NetworkDevice" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_995daaa461b8bb7737d0a18060" ON "NetworkDeviceOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7663695e384398a0ab92bd1ebb" ON "NetworkDeviceOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e83f8e1b994bf8c4b40a93de0" ON "NetworkDeviceOwnerTeam" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24b412eb7c5e14d8895fc4c943" ON "NetworkDeviceOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1045582ada8b55d8539d5809e4" ON "NetworkDeviceOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fc42ffffbfa743144c8e489100" ON "NetworkDeviceOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9e37f1b2bef23b32728bfdb3c" ON "NetworkDeviceOwnerUser" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c8e2b6df50e0f261057b4ad2f4" ON "NetworkDeviceOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_00acc40f832e5d3dccab7fb793" ON "NetworkDeviceOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2e564991e712c65a4ce3addc8" ON "NetworkDeviceOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cae4f1031b7aad75c32bf97461" ON "NetworkDeviceOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_af44c69f44ec3c788722834759" ON "NetworkDeviceLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3793fa86d7a037d64290800e24" ON "NetworkDeviceLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6fdbb1a0edfbad7dd5c61dbfdb" ON "NetworkDeviceLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_07cbc66823954383f2ce7ae88c" ON "NetworkDeviceDiscoveryScan" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db5710091605ef1636be8406a7" ON "NetworkDeviceDiscoveryScan" ("probeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4f1d2a67c3bdddcf886f50456d" ON "NetworkDeviceDiscoveryScan" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c16558ff995b841f3874414c1c" ON "NetworkInterface" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77d42253415c47fbf90d51f647" ON "NetworkInterface" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1b2508aa56b5ff2b24f5b0e766" ON "NetworkInterface" ("projectId", "networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2956e682707ccc12e39a84a105" ON "IoTDeviceCredential" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_82fca2f399495f9827d6eaa7ee" ON "IoTDeviceCredential" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b471027fe1f99ed101f5564100" ON "IoTDeviceCredential" ("externalId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa0f6f56456520a0b0eda73a7e" ON "IoTDeviceCredential" ("secretKey") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c0ae0a9cfdb66ad65a77066802" ON "IoTDeviceCredential" ("projectId", "iotFleetId", "externalId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08a36ceecd6596aeedc9a473c7" ON "AIRun" ("triggeredByIncidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_455c247c8a7884be997503098f" ON "AIRun" ("triggeredByAlertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3cd9ba3ad193250b13477e5fde" ON "AIRun" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9f9f521a00ad738c75409b5763" ON "NetworkDeviceLabel" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c0fc4617e1c1fef22e313c2772" ON "NetworkDeviceLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5964312b9c73efd3b13e857c10" ON "NetworkDeviceOwnerRuleNetworkDeviceLabel" ("networkDeviceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d4b3a67839023dbf9b544ffb96" ON "NetworkDeviceOwnerRuleNetworkDeviceLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_87cac5a7fdf13e7a868c700816" ON "NetworkDeviceOwnerRuleOwnerUser" ("networkDeviceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b81f77e774d423f72664be19c8" ON "NetworkDeviceOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e5263dedddc9950776d108ea8" ON "NetworkDeviceOwnerRuleOwnerTeam" ("networkDeviceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42ab7d4cfcab40e81ff1bdc2cb" ON "NetworkDeviceOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e65fd5ddaec26a2551bf81b6dc" ON "NetworkDeviceLabelRuleNetworkDeviceLabel" ("networkDeviceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b6fdc7463438554e1d315034d1" ON "NetworkDeviceLabelRuleNetworkDeviceLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae1281598a798f4347b3c14a6b" ON "NetworkDeviceLabelRuleLabelToAdd" ("networkDeviceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2da6349c86d57cd731c34fe71b" ON "NetworkDeviceLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_cb3c2936c0b88fdf2a790fd7322" FOREIGN KEY ("alertInvestigationMinimumSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_013b5e41b9038b20bb5d5eb419c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_83b4a3ffbed23270b6084c81f4b" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_e039fa032dbaa1534c1ef77dcec" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_175f29a8013cb3af200397289d3" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_4fa51de5ca772c255c845952bc2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_995daaa461b8bb7737d0a18060d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_7663695e384398a0ab92bd1ebb7" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_0e83f8e1b994bf8c4b40a93de07" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_f6c636f254f4c6f7f9ad945b4c1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_8050ac10da1503ba19f6ba209b4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_1045582ada8b55d8539d5809e4d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_fc42ffffbfa743144c8e4891009" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_c9e37f1b2bef23b32728bfdb3c0" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_32b774550d4fd426b18ceb07003" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_20f98ac43c96c7bfb243640cc3f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD CONSTRAINT "FK_00acc40f832e5d3dccab7fb7937" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD CONSTRAINT "FK_3ec23f67dda8756349c9efcb99a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD CONSTRAINT "FK_46ae144cd651021478bb02f5e7f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD CONSTRAINT "FK_af44c69f44ec3c788722834759b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD CONSTRAINT "FK_835a289f4bf53d0988bed555259" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD CONSTRAINT "FK_eff1c298121aab64fba34115cea" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_07cbc66823954383f2ce7ae88c4" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_db5710091605ef1636be8406a7d" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_8fcdb52b616afb4672c2d1b6365" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_9d892856629b6f597ccc60557f4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD CONSTRAINT "FK_c16558ff995b841f3874414c1cd" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD CONSTRAINT "FK_77d42253415c47fbf90d51f6476" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_2956e682707ccc12e39a84a105f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_82fca2f399495f9827d6eaa7ee5" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_2492befebdb67cb0d3da1f4c844" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_e03efc287e1715f34367081650a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabel" ADD CONSTRAINT "FK_9f9f521a00ad738c75409b57633" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabel" ADD CONSTRAINT "FK_c0fc4617e1c1fef22e313c27728" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleNetworkDeviceLabel" ADD CONSTRAINT "FK_5964312b9c73efd3b13e857c101" FOREIGN KEY ("networkDeviceOwnerRuleId") REFERENCES "NetworkDeviceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleNetworkDeviceLabel" ADD CONSTRAINT "FK_d4b3a67839023dbf9b544ffb96c" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerUser" ADD CONSTRAINT "FK_87cac5a7fdf13e7a868c7008168" FOREIGN KEY ("networkDeviceOwnerRuleId") REFERENCES "NetworkDeviceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerUser" ADD CONSTRAINT "FK_b81f77e774d423f72664be19c8a" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_1e5263dedddc9950776d108ea87" FOREIGN KEY ("networkDeviceOwnerRuleId") REFERENCES "NetworkDeviceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_42ab7d4cfcab40e81ff1bdc2cb0" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleNetworkDeviceLabel" ADD CONSTRAINT "FK_e65fd5ddaec26a2551bf81b6dc3" FOREIGN KEY ("networkDeviceLabelRuleId") REFERENCES "NetworkDeviceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleNetworkDeviceLabel" ADD CONSTRAINT "FK_b6fdc7463438554e1d315034d1a" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleLabelToAdd" ADD CONSTRAINT "FK_ae1281598a798f4347b3c14a6b5" FOREIGN KEY ("networkDeviceLabelRuleId") REFERENCES "NetworkDeviceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleLabelToAdd" ADD CONSTRAINT "FK_2da6349c86d57cd731c34fe71b0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleLabelToAdd" DROP CONSTRAINT "FK_2da6349c86d57cd731c34fe71b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleLabelToAdd" DROP CONSTRAINT "FK_ae1281598a798f4347b3c14a6b5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleNetworkDeviceLabel" DROP CONSTRAINT "FK_b6fdc7463438554e1d315034d1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleNetworkDeviceLabel" DROP CONSTRAINT "FK_e65fd5ddaec26a2551bf81b6dc3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_42ab7d4cfcab40e81ff1bdc2cb0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_1e5263dedddc9950776d108ea87"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerUser" DROP CONSTRAINT "FK_b81f77e774d423f72664be19c8a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerUser" DROP CONSTRAINT "FK_87cac5a7fdf13e7a868c7008168"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleNetworkDeviceLabel" DROP CONSTRAINT "FK_d4b3a67839023dbf9b544ffb96c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleNetworkDeviceLabel" DROP CONSTRAINT "FK_5964312b9c73efd3b13e857c101"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabel" DROP CONSTRAINT "FK_c0fc4617e1c1fef22e313c27728"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabel" DROP CONSTRAINT "FK_9f9f521a00ad738c75409b57633"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_e03efc287e1715f34367081650a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_2492befebdb67cb0d3da1f4c844"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_82fca2f399495f9827d6eaa7ee5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" DROP CONSTRAINT "FK_2956e682707ccc12e39a84a105f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP CONSTRAINT "FK_77d42253415c47fbf90d51f6476"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP CONSTRAINT "FK_c16558ff995b841f3874414c1cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP CONSTRAINT "FK_9d892856629b6f597ccc60557f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP CONSTRAINT "FK_8fcdb52b616afb4672c2d1b6365"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP CONSTRAINT "FK_db5710091605ef1636be8406a7d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP CONSTRAINT "FK_07cbc66823954383f2ce7ae88c4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" DROP CONSTRAINT "FK_eff1c298121aab64fba34115cea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" DROP CONSTRAINT "FK_835a289f4bf53d0988bed555259"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" DROP CONSTRAINT "FK_af44c69f44ec3c788722834759b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" DROP CONSTRAINT "FK_46ae144cd651021478bb02f5e7f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" DROP CONSTRAINT "FK_3ec23f67dda8756349c9efcb99a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" DROP CONSTRAINT "FK_00acc40f832e5d3dccab7fb7937"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" DROP CONSTRAINT "FK_20f98ac43c96c7bfb243640cc3f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" DROP CONSTRAINT "FK_32b774550d4fd426b18ceb07003"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" DROP CONSTRAINT "FK_c9e37f1b2bef23b32728bfdb3c0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" DROP CONSTRAINT "FK_fc42ffffbfa743144c8e4891009"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" DROP CONSTRAINT "FK_1045582ada8b55d8539d5809e4d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" DROP CONSTRAINT "FK_8050ac10da1503ba19f6ba209b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" DROP CONSTRAINT "FK_f6c636f254f4c6f7f9ad945b4c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" DROP CONSTRAINT "FK_0e83f8e1b994bf8c4b40a93de07"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" DROP CONSTRAINT "FK_7663695e384398a0ab92bd1ebb7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" DROP CONSTRAINT "FK_995daaa461b8bb7737d0a18060d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_4fa51de5ca772c255c845952bc2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_175f29a8013cb3af200397289d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_e039fa032dbaa1534c1ef77dcec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_83b4a3ffbed23270b6084c81f4b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_013b5e41b9038b20bb5d5eb419c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_cb3c2936c0b88fdf2a790fd7322"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2da6349c86d57cd731c34fe71b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae1281598a798f4347b3c14a6b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b6fdc7463438554e1d315034d1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e65fd5ddaec26a2551bf81b6dc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42ab7d4cfcab40e81ff1bdc2cb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e5263dedddc9950776d108ea8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b81f77e774d423f72664be19c8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_87cac5a7fdf13e7a868c700816"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d4b3a67839023dbf9b544ffb96"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5964312b9c73efd3b13e857c10"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c0fc4617e1c1fef22e313c2772"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f9f521a00ad738c75409b5763"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3cd9ba3ad193250b13477e5fde"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_455c247c8a7884be997503098f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08a36ceecd6596aeedc9a473c7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c0ae0a9cfdb66ad65a77066802"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa0f6f56456520a0b0eda73a7e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b471027fe1f99ed101f5564100"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_82fca2f399495f9827d6eaa7ee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2956e682707ccc12e39a84a105"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b2508aa56b5ff2b24f5b0e766"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77d42253415c47fbf90d51f647"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c16558ff995b841f3874414c1c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4f1d2a67c3bdddcf886f50456d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db5710091605ef1636be8406a7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_07cbc66823954383f2ce7ae88c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6fdbb1a0edfbad7dd5c61dbfdb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3793fa86d7a037d64290800e24"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_af44c69f44ec3c788722834759"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cae4f1031b7aad75c32bf97461"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2e564991e712c65a4ce3addc8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_00acc40f832e5d3dccab7fb793"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c8e2b6df50e0f261057b4ad2f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9e37f1b2bef23b32728bfdb3c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fc42ffffbfa743144c8e489100"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1045582ada8b55d8539d5809e4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24b412eb7c5e14d8895fc4c943"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e83f8e1b994bf8c4b40a93de0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7663695e384398a0ab92bd1ebb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_995daaa461b8bb7737d0a18060"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_878d6fc3878837bb01e09b2f3f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0fa6fd1a6f500aaa861b7889b5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_013b5e41b9038b20bb5d5eb419"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpVersion" SET DEFAULT '2c'`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3PrivKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3PrivKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3AuthKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3AuthKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "snmpVersion" SET DEFAULT '2c'`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD "deletedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD "createdByUserId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_NetworkDeviceLabelRuleLabelToAdd_labelId" ON "NetworkDeviceLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_NetworkDeviceLabelRuleLabelToAdd_ruleId" ON "NetworkDeviceLabelRuleLabelToAdd" ("networkDeviceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_NetworkDeviceLabelRuleNetworkDeviceLabel_labelId" ON "NetworkDeviceLabelRuleNetworkDeviceLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_NetworkDeviceLabelRuleNetworkDeviceLabel_ruleId" ON "NetworkDeviceLabelRuleNetworkDeviceLabel" ("networkDeviceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_NetworkDeviceOwnerRuleOwnerTeam_teamId" ON "NetworkDeviceOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_NetworkDeviceOwnerRuleOwnerTeam_ruleId" ON "NetworkDeviceOwnerRuleOwnerTeam" ("networkDeviceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_NetworkDeviceOwnerRuleOwnerUser_userId" ON "NetworkDeviceOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_NetworkDeviceOwnerRuleOwnerUser_ruleId" ON "NetworkDeviceOwnerRuleOwnerUser" ("networkDeviceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_NetworkDeviceOwnerRuleNetworkDeviceLabel_labelId" ON "NetworkDeviceOwnerRuleNetworkDeviceLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_NetworkDeviceOwnerRuleNetworkDeviceLabel_ruleId" ON "NetworkDeviceOwnerRuleNetworkDeviceLabel" ("networkDeviceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_label_labelId" ON "NetworkDeviceLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_label_networkDeviceId" ON "NetworkDeviceLabel" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AIRun_monitorId" ON "AIRun" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AIRun_triggeredByAlertId" ON "AIRun" ("triggeredByAlertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AIRun_triggeredByIncidentId" ON "AIRun" ("triggeredByIncidentId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_iot_device_credential_fleet_externalId" ON "IoTDeviceCredential" ("projectId", "iotFleetId", "externalId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_credential_secretKey" ON "IoTDeviceCredential" ("secretKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_credential_externalId" ON "IoTDeviceCredential" ("externalId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_credential_iotFleetId" ON "IoTDeviceCredential" ("iotFleetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_iot_device_credential_projectId" ON "IoTDeviceCredential" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_network_interface_device_ifindex" ON "NetworkInterface" ("networkDeviceId", "interfaceIndex") WHERE ("deletedAt" IS NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_interface_projectId_networkDeviceId" ON "NetworkInterface" ("projectId", "networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_interface_networkDeviceId" ON "NetworkInterface" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_interface_projectId" ON "NetworkInterface" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_discovery_scan_probeId_status" ON "NetworkDeviceDiscoveryScan" ("probeId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_discovery_scan_projectId" ON "NetworkDeviceDiscoveryScan" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_label_rule_isEnabled" ON "NetworkDeviceLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_label_rule_name" ON "NetworkDeviceLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_label_rule_projectId" ON "NetworkDeviceLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_rule_isEnabled" ON "NetworkDeviceOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_rule_name" ON "NetworkDeviceOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_rule_projectId" ON "NetworkDeviceOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_user_isOwnerNotified" ON "NetworkDeviceOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_user_networkDeviceId" ON "NetworkDeviceOwnerUser" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_user_userId" ON "NetworkDeviceOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_user_projectId" ON "NetworkDeviceOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_team_isOwnerNotified" ON "NetworkDeviceOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_team_networkDeviceId" ON "NetworkDeviceOwnerTeam" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_team_teamId" ON "NetworkDeviceOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_owner_team_projectId" ON "NetworkDeviceOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_network_device_slug" ON "NetworkDevice" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_hostname" ON "NetworkDevice" ("hostname") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_projectId_isArchived" ON "NetworkDevice" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_projectId" ON "NetworkDevice" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleLabelToAdd" ADD CONSTRAINT "FK_NetworkDeviceLabelRuleLabelToAdd_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleLabelToAdd" ADD CONSTRAINT "FK_NetworkDeviceLabelRuleLabelToAdd_ruleId" FOREIGN KEY ("networkDeviceLabelRuleId") REFERENCES "NetworkDeviceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleNetworkDeviceLabel" ADD CONSTRAINT "FK_NetworkDeviceLabelRuleNetworkDeviceLabel_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRuleNetworkDeviceLabel" ADD CONSTRAINT "FK_NetworkDeviceLabelRuleNetworkDeviceLabel_ruleId" FOREIGN KEY ("networkDeviceLabelRuleId") REFERENCES "NetworkDeviceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_NetworkDeviceOwnerRuleOwnerTeam_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_NetworkDeviceOwnerRuleOwnerTeam_ruleId" FOREIGN KEY ("networkDeviceOwnerRuleId") REFERENCES "NetworkDeviceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerUser" ADD CONSTRAINT "FK_NetworkDeviceOwnerRuleOwnerUser_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleOwnerUser" ADD CONSTRAINT "FK_NetworkDeviceOwnerRuleOwnerUser_ruleId" FOREIGN KEY ("networkDeviceOwnerRuleId") REFERENCES "NetworkDeviceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleNetworkDeviceLabel" ADD CONSTRAINT "FK_NetworkDeviceOwnerRuleNetworkDeviceLabel_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRuleNetworkDeviceLabel" ADD CONSTRAINT "FK_NetworkDeviceOwnerRuleNetworkDeviceLabel_ruleId" FOREIGN KEY ("networkDeviceOwnerRuleId") REFERENCES "NetworkDeviceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabel" ADD CONSTRAINT "FK_network_device_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabel" ADD CONSTRAINT "FK_network_device_label_networkDeviceId" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_iot_device_credential_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_iot_device_credential_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_iot_device_credential_iotFleetId" FOREIGN KEY ("iotFleetId") REFERENCES "IoTFleet"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ADD CONSTRAINT "FK_iot_device_credential_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD CONSTRAINT "FK_network_interface_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD CONSTRAINT "FK_network_interface_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD CONSTRAINT "FK_network_interface_networkDeviceId" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD CONSTRAINT "FK_network_interface_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_nd_discovery_scan_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_nd_discovery_scan_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_nd_discovery_scan_probeId" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "FK_nd_discovery_scan_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD CONSTRAINT "FK_nd_label_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD CONSTRAINT "FK_nd_label_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLabelRule" ADD CONSTRAINT "FK_nd_label_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD CONSTRAINT "FK_nd_owner_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD CONSTRAINT "FK_nd_owner_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerRule" ADD CONSTRAINT "FK_nd_owner_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_nd_owner_user_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_nd_owner_user_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_nd_owner_user_networkDeviceId" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_nd_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerUser" ADD CONSTRAINT "FK_nd_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_nd_owner_team_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_nd_owner_team_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_nd_owner_team_networkDeviceId" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_nd_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOwnerTeam" ADD CONSTRAINT "FK_nd_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_network_device_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_network_device_archivedByUserId" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_network_device_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_network_device_probeId" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_network_device_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_Project_alertInvestigationMinimumSeverityId" FOREIGN KEY ("alertInvestigationMinimumSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
