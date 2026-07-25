import { MigrationInterface, QueryRunner } from "typeorm";

export class AddServiceLevelObjective1784987015619
  implements MigrationInterface
{
  name = "AddServiceLevelObjective1784987015619";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjective" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "slug" character varying(100) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "sliType" character varying NOT NULL DEFAULT 'Monitor Uptime', "multiMonitorMode" character varying NOT NULL DEFAULT 'Any Monitor Down', "metricQueryConfig" jsonb, "targetPercentage" numeric NOT NULL, "windowType" character varying NOT NULL DEFAULT 'Rolling', "windowDays" integer NOT NULL DEFAULT '30', "timezone" character varying(100), "atRiskThresholdPercentage" integer NOT NULL DEFAULT '20', "currentSliPercentage" numeric, "errorBudgetRemainingPercentage" numeric, "errorBudgetRemainingSeconds" integer, "errorBudgetTotalSeconds" integer, "currentBurnRate" numeric, "sloStatus" character varying NOT NULL DEFAULT 'Healthy', "statusChangeNotificationSentAt" TIMESTAMP WITH TIME ZONE, "lastEvaluatedAt" TIMESTAMP WITH TIME ZONE, "nextEvaluationAt" TIMESTAMP WITH TIME ZONE, "lastAccumulatedBucketEndAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_ba02350ab59adf11ab31bfba090" UNIQUE ("slug"), CONSTRAINT "PK_02a26e6a5286aeb09e58326a287" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c46e7cd584085573c357955389" ON "ServiceLevelObjective" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0529301be36c9c0224f721e4c3" ON "ServiceLevelObjective" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ba02350ab59adf11ab31bfba09" ON "ServiceLevelObjective" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a18ae1afc837908246d716ffd" ON "ServiceLevelObjective" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9ae72bfe937fb3a52bea2009d1" ON "ServiceLevelObjective" ("sloStatus") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c55b55b9cc6777e482730080b" ON "ServiceLevelObjective" ("nextEvaluationAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveBurnRateRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceLevelObjectiveId" uuid NOT NULL, "name" character varying(100) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "burnRateThreshold" numeric NOT NULL, "longWindowInMinutes" integer NOT NULL, "shortWindowInMinutes" integer NOT NULL, "minimumSampleCount" integer, "refireSuppressionMinutes" integer, "alertSeverityId" uuid, "lastAlertCreatedAt" TIMESTAMP WITH TIME ZONE, "lastAlertResolvedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_09977f8f1fae6984d1c047a65a0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7569331f78148b6e53867aa5f7" ON "ServiceLevelObjectiveBurnRateRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_981fd1395a10cad88ffa35ebfd" ON "ServiceLevelObjectiveBurnRateRule" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d499f2cab7c1c41dc87a1c6156" ON "ServiceLevelObjectiveBurnRateRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_35186fe6e401e695917e8b361d" ON "ServiceLevelObjectiveBurnRateRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f790e04533d2b79a7a27f4524b" ON "ServiceLevelObjectiveBurnRateRule" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "serviceLevelObjectiveId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_bc954ce3df97bb1ddfa671893e5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32e90aa7284ccedb801fe256f1" ON "ServiceLevelObjectiveOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_02047e9714492b3f1c8e91b999" ON "ServiceLevelObjectiveOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4994cd04a5e4794b3d61b2e6e5" ON "ServiceLevelObjectiveOwnerUser" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bef5294b53ff9e9ca4f5a92e3a" ON "ServiceLevelObjectiveOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_be7506765e639c732a90783147" ON "ServiceLevelObjectiveOwnerUser" ("serviceLevelObjectiveId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "serviceLevelObjectiveId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_313ad90d395bc9e3619768c1ad4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_efd3d0d3702596f5f17a1dee59" ON "ServiceLevelObjectiveOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1f9a4a97270d3450a42eb12a9" ON "ServiceLevelObjectiveOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d338133d1cae58344006229440" ON "ServiceLevelObjectiveOwnerTeam" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_503bb58cee6939ee45fc94f81b" ON "ServiceLevelObjectiveOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_53e4404ae86c9de055cf1dee02" ON "ServiceLevelObjectiveOwnerTeam" ("serviceLevelObjectiveId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveLabel" ("serviceLevelObjectiveId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_2fed536b8e53af3208a9b604816" PRIMARY KEY ("serviceLevelObjectiveId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_09469911554f1093b70999cc71" ON "ServiceLevelObjectiveLabel" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c9650fa5b4ba5a7e577b876e5" ON "ServiceLevelObjectiveLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveMonitor" ("serviceLevelObjectiveId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_e7cb42e7fd4d3bc31e7a308c1f4" PRIMARY KEY ("serviceLevelObjectiveId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a14890fd4cec9286468d001b22" ON "ServiceLevelObjectiveMonitor" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a57eae6948f19b1e97523f9a8e" ON "ServiceLevelObjectiveMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveDownMonitorStatus" ("serviceLevelObjectiveId" uuid NOT NULL, "monitorStatusId" uuid NOT NULL, CONSTRAINT "PK_3c64a2701713dc0b25fd196d1eb" PRIMARY KEY ("serviceLevelObjectiveId", "monitorStatusId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ab2bff0fe27125c20cc479178" ON "ServiceLevelObjectiveDownMonitorStatus" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7cf428df61316a8df6b9607999" ON "ServiceLevelObjectiveDownMonitorStatus" ("monitorStatusId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveBurnRateRuleOnCallDutyPolicy" ("serviceLevelObjectiveBurnRateRuleId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_257b38158d7deed031fe0b37404" PRIMARY KEY ("serviceLevelObjectiveBurnRateRuleId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c70c0ce5ed34cf8908da9e014" ON "ServiceLevelObjectiveBurnRateRuleOnCallDutyPolicy" ("serviceLevelObjectiveBurnRateRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_35eb8923c8064a883954f7c969" ON "ServiceLevelObjectiveBurnRateRuleOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD CONSTRAINT "FK_c46e7cd584085573c3579553899" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD CONSTRAINT "FK_974aafc5e3a66a3a7368d485ffa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD CONSTRAINT "FK_ff1296ae51710c26f904dfef2fd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD CONSTRAINT "FK_7569331f78148b6e53867aa5f7d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD CONSTRAINT "FK_981fd1395a10cad88ffa35ebfde" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD CONSTRAINT "FK_f790e04533d2b79a7a27f4524bd" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD CONSTRAINT "FK_38825b71e3f4460758f32c8ad2b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD CONSTRAINT "FK_e8c5423ee38943417d1b1153939" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerUser" ADD CONSTRAINT "FK_32e90aa7284ccedb801fe256f16" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerUser" ADD CONSTRAINT "FK_02047e9714492b3f1c8e91b9995" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerUser" ADD CONSTRAINT "FK_4994cd04a5e4794b3d61b2e6e58" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerUser" ADD CONSTRAINT "FK_8546f9976d6b0c60a6cf94d2993" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerUser" ADD CONSTRAINT "FK_dec4db5a0248fb01d7950d78812" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerTeam" ADD CONSTRAINT "FK_efd3d0d3702596f5f17a1dee595" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerTeam" ADD CONSTRAINT "FK_e1f9a4a97270d3450a42eb12a99" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerTeam" ADD CONSTRAINT "FK_d338133d1cae58344006229440f" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerTeam" ADD CONSTRAINT "FK_e2f3df46a03efffd9e1a9029e67" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerTeam" ADD CONSTRAINT "FK_6f988b69e435922b6d721fbd412" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabel" ADD CONSTRAINT "FK_09469911554f1093b70999cc715" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabel" ADD CONSTRAINT "FK_7c9650fa5b4ba5a7e577b876e55" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitor" ADD CONSTRAINT "FK_a14890fd4cec9286468d001b22f" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitor" ADD CONSTRAINT "FK_a57eae6948f19b1e97523f9a8ec" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveDownMonitorStatus" ADD CONSTRAINT "FK_6ab2bff0fe27125c20cc4791780" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveDownMonitorStatus" ADD CONSTRAINT "FK_7cf428df61316a8df6b9607999d" FOREIGN KEY ("monitorStatusId") REFERENCES "MonitorStatus"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_0c70c0ce5ed34cf8908da9e014b" FOREIGN KEY ("serviceLevelObjectiveBurnRateRuleId") REFERENCES "ServiceLevelObjectiveBurnRateRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_35eb8923c8064a883954f7c9695" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_35eb8923c8064a883954f7c9695"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_0c70c0ce5ed34cf8908da9e014b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveDownMonitorStatus" DROP CONSTRAINT "FK_7cf428df61316a8df6b9607999d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveDownMonitorStatus" DROP CONSTRAINT "FK_6ab2bff0fe27125c20cc4791780"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitor" DROP CONSTRAINT "FK_a57eae6948f19b1e97523f9a8ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitor" DROP CONSTRAINT "FK_a14890fd4cec9286468d001b22f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabel" DROP CONSTRAINT "FK_7c9650fa5b4ba5a7e577b876e55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabel" DROP CONSTRAINT "FK_09469911554f1093b70999cc715"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerTeam" DROP CONSTRAINT "FK_6f988b69e435922b6d721fbd412"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerTeam" DROP CONSTRAINT "FK_e2f3df46a03efffd9e1a9029e67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerTeam" DROP CONSTRAINT "FK_d338133d1cae58344006229440f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerTeam" DROP CONSTRAINT "FK_e1f9a4a97270d3450a42eb12a99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerTeam" DROP CONSTRAINT "FK_efd3d0d3702596f5f17a1dee595"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerUser" DROP CONSTRAINT "FK_dec4db5a0248fb01d7950d78812"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerUser" DROP CONSTRAINT "FK_8546f9976d6b0c60a6cf94d2993"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerUser" DROP CONSTRAINT "FK_4994cd04a5e4794b3d61b2e6e58"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerUser" DROP CONSTRAINT "FK_02047e9714492b3f1c8e91b9995"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerUser" DROP CONSTRAINT "FK_32e90aa7284ccedb801fe256f16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP CONSTRAINT "FK_e8c5423ee38943417d1b1153939"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP CONSTRAINT "FK_38825b71e3f4460758f32c8ad2b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP CONSTRAINT "FK_f790e04533d2b79a7a27f4524bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP CONSTRAINT "FK_981fd1395a10cad88ffa35ebfde"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP CONSTRAINT "FK_7569331f78148b6e53867aa5f7d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP CONSTRAINT "FK_ff1296ae51710c26f904dfef2fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP CONSTRAINT "FK_974aafc5e3a66a3a7368d485ffa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP CONSTRAINT "FK_c46e7cd584085573c3579553899"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_35eb8923c8064a883954f7c969"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c70c0ce5ed34cf8908da9e014"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveBurnRateRuleOnCallDutyPolicy"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7cf428df61316a8df6b9607999"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ab2bff0fe27125c20cc479178"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveDownMonitorStatus"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a57eae6948f19b1e97523f9a8e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a14890fd4cec9286468d001b22"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c9650fa5b4ba5a7e577b876e5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_09469911554f1093b70999cc71"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_53e4404ae86c9de055cf1dee02"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_503bb58cee6939ee45fc94f81b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d338133d1cae58344006229440"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1f9a4a97270d3450a42eb12a9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_efd3d0d3702596f5f17a1dee59"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be7506765e639c732a90783147"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bef5294b53ff9e9ca4f5a92e3a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4994cd04a5e4794b3d61b2e6e5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_02047e9714492b3f1c8e91b999"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32e90aa7284ccedb801fe256f1"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f790e04533d2b79a7a27f4524b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_35186fe6e401e695917e8b361d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d499f2cab7c1c41dc87a1c6156"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_981fd1395a10cad88ffa35ebfd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7569331f78148b6e53867aa5f7"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveBurnRateRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c55b55b9cc6777e482730080b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9ae72bfe937fb3a52bea2009d1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a18ae1afc837908246d716ffd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ba02350ab59adf11ab31bfba09"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0529301be36c9c0224f721e4c3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c46e7cd584085573c357955389"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjective"`);
  }
}
