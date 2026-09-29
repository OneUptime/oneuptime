import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Realigns the Runner / RunbookCredential / AutoRemediation schema with what
 * TypeORM derives from the entities. Those tables were introduced by
 * hand-named migrations, and the RunbookAgent -> Runner rename kept the old
 * hashed constraint names, so the database carried identifiers TypeORM no
 * longer computes. Every generated migration therefore re-emitted the same
 * drop/create churn. This renames the foreign keys and indexes to the
 * canonical hashed names and fixes the RunnerOwnerTeam / RunnerOwnerUser
 * composite index column order to match the entity declarations.
 *
 * No data is touched: only constraint and index identifiers change.
 */
export class AlignRunnerSchemaWithEntities1785880000000
  implements MigrationInterface
{
  public name = "AlignRunnerSchemaWithEntities1785880000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_Project_incidentInvestigationMinimumSeverityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" DROP CONSTRAINT "FK_8e18db257015a927b10be53cf30"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" DROP CONSTRAINT "FK_936a55c9ef76c806615a869de57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" DROP CONSTRAINT "FK_7c2ccd1de68f9f805ef8fe26e0d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP CONSTRAINT "FK_e13e6bd687869dfd16ddcc7900c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP CONSTRAINT "FK_ccc385027b89b731641a3cabd48"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP CONSTRAINT "FK_5c9d1810e0fda27177cd41ea738"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" DROP CONSTRAINT "FK_a24dd370690da68a5101fba0827"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" DROP CONSTRAINT "FK_060e3fdce32f2ae3e8af08113af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" DROP CONSTRAINT "FK_59cd65c91e9ae10bd861103bb10"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" DROP CONSTRAINT "FK_72c74137f08535200785cec3eb3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" DROP CONSTRAINT "FK_92018b0daeac19524b45c43cb7f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" DROP CONSTRAINT "FK_545f95aef235cd8abbd2d4a11ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" DROP CONSTRAINT "FK_2b1b7db69ee94cef9eab74b85ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" DROP CONSTRAINT "FK_c0d14dc88c9c009c0e352fa9274"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" DROP CONSTRAINT "FK_5e51e566f7eb7ff47a8d9c11c50"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" DROP CONSTRAINT "FK_7db69d7207d704e770bb40a0c5a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" DROP CONSTRAINT "FK_RunbookCredential_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" DROP CONSTRAINT "FK_RunbookCredential_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" DROP CONSTRAINT "FK_RunbookCredential_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerLabel" DROP CONSTRAINT "FK_c88840425bae4caee4e45539275"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerLabel" DROP CONSTRAINT "FK_d14e093b375792c7507fb6f8e24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunner" DROP CONSTRAINT "FK_RunbookCredentialRunbookAgent_credentialId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunner" DROP CONSTRAINT "FK_RunbookCredentialRunbookAgent_agentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunner" DROP CONSTRAINT "FK_dfcaca6663d57a8ca0cd045339d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunner" DROP CONSTRAINT "FK_6b1307a959a26116c4a3f2a33ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" DROP CONSTRAINT "FK_AutoRemediationRuleRunner_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" DROP CONSTRAINT "FK_AutoRemediationRuleRunner_runnerId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e18db257015a927b10be53cf3"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_RunnerJob_origin"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_RunnerJob_aiRunId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_RunnerJob_autoRemediationSuggestionId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e13e6bd687869dfd16ddcc7900"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ccc385027b89b731641a3cabd4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b95313deeb5e7debf39b9e6791"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c9d1810e0fda27177cd41ea73"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a653cf53a14952d83acaa39e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1c4d4dc5b58c7a827157edcd0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_RunbookCredential_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c88840425bae4caee4e4553927"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d14e093b375792c7507fb6f8e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_RunbookCredentialRunbookAgent_credentialId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_RunbookCredentialRunbookAgent_agentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfcaca6663d57a8ca0cd045339"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6b1307a959a26116c4a3f2a33a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_AutoRemediationRuleRunner_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_AutoRemediationRuleRunner_runnerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23efcfe0ab553e8df446688751" ON "Runner" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae3a5a76e4f41e2cadc64f0fe4" ON "RunnerJob" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a87e518083b98d1b3f6d4c027" ON "RunnerJob" ("runbookExecutionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b79fb5b099da00b1a9d916cb4b" ON "RunnerJob" ("origin") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b00bb73780f07afa0f53e71e7" ON "RunnerJob" ("aiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c042d9bda26200862d30d69b3a" ON "RunnerJob" ("autoRemediationSuggestionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_982bfed9833766cf459946cd1f" ON "RunnerJob" ("targetAgentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de84537bb755f34e7451089902" ON "RunnerJob" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5144d0de37b0f040ca2d71abad" ON "RunnerOwnerTeam" ("runnerId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a5b7e91e8b9ee59041517906c" ON "RunnerOwnerUser" ("runnerId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a75f29cdea3ff7dba3c40b0fda" ON "RunbookCredential" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e419c705eb2427a25ebbd25d2b" ON "RunnerLabel" ("runnerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f1e57a89b85eb1fa3a297ea2cd" ON "RunnerLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5aa84c7f64afb3dd7187361dbb" ON "RunbookCredentialRunner" ("runbookCredentialId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15034c6db149d8f31e45438609" ON "RunbookCredentialRunner" ("runnerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_175e23650199160ea69e8205e0" ON "RunbookSecretRunner" ("runbookSecretId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae13289f6fbaec2692acab6bee" ON "RunbookSecretRunner" ("runnerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fdc125a172a2667a5a2b55cddd" ON "AutoRemediationRuleRunner" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08c6fa7642878ac3f149a6b771" ON "AutoRemediationRuleRunner" ("runnerId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_37628de4a8e6ed41498d7298f4e" FOREIGN KEY ("incidentInvestigationMinimumSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD CONSTRAINT "FK_23efcfe0ab553e8df4466887517" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD CONSTRAINT "FK_41205fd908fa5fd2a8787ca282d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD CONSTRAINT "FK_061a38aa6652632acd0baad8652" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "FK_ae3a5a76e4f41e2cadc64f0fe42" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "FK_4a87e518083b98d1b3f6d4c027a" FOREIGN KEY ("runbookExecutionId") REFERENCES "RunbookExecution"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "FK_982bfed9833766cf459946cd1f4" FOREIGN KEY ("targetAgentId") REFERENCES "Runner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" ADD CONSTRAINT "FK_4bb2c38c51fd229b38ffdb576ec" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" ADD CONSTRAINT "FK_0795ca17c23c7282c3884f7f450" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" ADD CONSTRAINT "FK_fc9f3a232f564c5d46eeb13349b" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" ADD CONSTRAINT "FK_5f368198815fa9fb962368056b8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" ADD CONSTRAINT "FK_e1487fbd5600dd8f16488388341" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" ADD CONSTRAINT "FK_7ea1fef6dff47c625a83a60c5dc" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" ADD CONSTRAINT "FK_5dbe10a683ff258d91d8a652d53" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" ADD CONSTRAINT "FK_13a6a4b7a9eff714c666b58c27d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" ADD CONSTRAINT "FK_af97b803a230416ef84ee7215cb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" ADD CONSTRAINT "FK_002a65d1dc9c02c705979d8d8c2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" ADD CONSTRAINT "FK_a75f29cdea3ff7dba3c40b0fda2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" ADD CONSTRAINT "FK_d547b77443a21432851aa7e8c28" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" ADD CONSTRAINT "FK_7ed39b6b7bf5d7c3eeba79adcab" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerLabel" ADD CONSTRAINT "FK_e419c705eb2427a25ebbd25d2b7" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerLabel" ADD CONSTRAINT "FK_f1e57a89b85eb1fa3a297ea2cd0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunner" ADD CONSTRAINT "FK_5aa84c7f64afb3dd7187361dbb8" FOREIGN KEY ("runbookCredentialId") REFERENCES "RunbookCredential"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunner" ADD CONSTRAINT "FK_15034c6db149d8f31e45438609d" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunner" ADD CONSTRAINT "FK_175e23650199160ea69e8205e04" FOREIGN KEY ("runbookSecretId") REFERENCES "RunbookSecret"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunner" ADD CONSTRAINT "FK_ae13289f6fbaec2692acab6beef" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" ADD CONSTRAINT "FK_fdc125a172a2667a5a2b55cddda" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" ADD CONSTRAINT "FK_08c6fa7642878ac3f149a6b771a" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" DROP CONSTRAINT "FK_08c6fa7642878ac3f149a6b771a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" DROP CONSTRAINT "FK_fdc125a172a2667a5a2b55cddda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunner" DROP CONSTRAINT "FK_ae13289f6fbaec2692acab6beef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunner" DROP CONSTRAINT "FK_175e23650199160ea69e8205e04"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunner" DROP CONSTRAINT "FK_15034c6db149d8f31e45438609d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunner" DROP CONSTRAINT "FK_5aa84c7f64afb3dd7187361dbb8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerLabel" DROP CONSTRAINT "FK_f1e57a89b85eb1fa3a297ea2cd0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerLabel" DROP CONSTRAINT "FK_e419c705eb2427a25ebbd25d2b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" DROP CONSTRAINT "FK_7ed39b6b7bf5d7c3eeba79adcab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" DROP CONSTRAINT "FK_d547b77443a21432851aa7e8c28"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" DROP CONSTRAINT "FK_a75f29cdea3ff7dba3c40b0fda2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" DROP CONSTRAINT "FK_002a65d1dc9c02c705979d8d8c2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" DROP CONSTRAINT "FK_af97b803a230416ef84ee7215cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" DROP CONSTRAINT "FK_13a6a4b7a9eff714c666b58c27d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" DROP CONSTRAINT "FK_5dbe10a683ff258d91d8a652d53"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" DROP CONSTRAINT "FK_7ea1fef6dff47c625a83a60c5dc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" DROP CONSTRAINT "FK_e1487fbd5600dd8f16488388341"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" DROP CONSTRAINT "FK_5f368198815fa9fb962368056b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" DROP CONSTRAINT "FK_fc9f3a232f564c5d46eeb13349b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" DROP CONSTRAINT "FK_0795ca17c23c7282c3884f7f450"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" DROP CONSTRAINT "FK_4bb2c38c51fd229b38ffdb576ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP CONSTRAINT "FK_982bfed9833766cf459946cd1f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP CONSTRAINT "FK_4a87e518083b98d1b3f6d4c027a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP CONSTRAINT "FK_ae3a5a76e4f41e2cadc64f0fe42"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" DROP CONSTRAINT "FK_061a38aa6652632acd0baad8652"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" DROP CONSTRAINT "FK_41205fd908fa5fd2a8787ca282d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" DROP CONSTRAINT "FK_23efcfe0ab553e8df4466887517"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP CONSTRAINT "FK_37628de4a8e6ed41498d7298f4e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08c6fa7642878ac3f149a6b771"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fdc125a172a2667a5a2b55cddd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae13289f6fbaec2692acab6bee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_175e23650199160ea69e8205e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15034c6db149d8f31e45438609"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5aa84c7f64afb3dd7187361dbb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f1e57a89b85eb1fa3a297ea2cd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e419c705eb2427a25ebbd25d2b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a75f29cdea3ff7dba3c40b0fda"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a5b7e91e8b9ee59041517906c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5144d0de37b0f040ca2d71abad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de84537bb755f34e7451089902"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_982bfed9833766cf459946cd1f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c042d9bda26200862d30d69b3a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b00bb73780f07afa0f53e71e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b79fb5b099da00b1a9d916cb4b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a87e518083b98d1b3f6d4c027"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae3a5a76e4f41e2cadc64f0fe4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_23efcfe0ab553e8df446688751"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AutoRemediationRuleRunner_runnerId" ON "AutoRemediationRuleRunner" ("runnerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AutoRemediationRuleRunner_ruleId" ON "AutoRemediationRuleRunner" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6b1307a959a26116c4a3f2a33a" ON "RunbookSecretRunner" ("runnerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dfcaca6663d57a8ca0cd045339" ON "RunbookSecretRunner" ("runbookSecretId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunbookCredentialRunbookAgent_agentId" ON "RunbookCredentialRunner" ("runnerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunbookCredentialRunbookAgent_credentialId" ON "RunbookCredentialRunner" ("runbookCredentialId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d14e093b375792c7507fb6f8e2" ON "RunnerLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c88840425bae4caee4e4553927" ON "RunnerLabel" ("runnerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunbookCredential_projectId" ON "RunbookCredential" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b1c4d4dc5b58c7a827157edcd0" ON "RunnerOwnerUser" ("projectId", "runnerId", "userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a653cf53a14952d83acaa39e1" ON "RunnerOwnerTeam" ("projectId", "runnerId", "teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c9d1810e0fda27177cd41ea73" ON "RunnerJob" ("targetAgentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b95313deeb5e7debf39b9e6791" ON "RunnerJob" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccc385027b89b731641a3cabd4" ON "RunnerJob" ("runbookExecutionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e13e6bd687869dfd16ddcc7900" ON "RunnerJob" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunnerJob_autoRemediationSuggestionId" ON "RunnerJob" ("autoRemediationSuggestionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunnerJob_aiRunId" ON "RunnerJob" ("aiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunnerJob_origin" ON "RunnerJob" ("origin") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e18db257015a927b10be53cf3" ON "Runner" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" ADD CONSTRAINT "FK_AutoRemediationRuleRunner_runnerId" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" ADD CONSTRAINT "FK_AutoRemediationRuleRunner_ruleId" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunner" ADD CONSTRAINT "FK_6b1307a959a26116c4a3f2a33ae" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunner" ADD CONSTRAINT "FK_dfcaca6663d57a8ca0cd045339d" FOREIGN KEY ("runbookSecretId") REFERENCES "RunbookSecret"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunner" ADD CONSTRAINT "FK_RunbookCredentialRunbookAgent_agentId" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunner" ADD CONSTRAINT "FK_RunbookCredentialRunbookAgent_credentialId" FOREIGN KEY ("runbookCredentialId") REFERENCES "RunbookCredential"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerLabel" ADD CONSTRAINT "FK_d14e093b375792c7507fb6f8e24" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerLabel" ADD CONSTRAINT "FK_c88840425bae4caee4e45539275" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" ADD CONSTRAINT "FK_RunbookCredential_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" ADD CONSTRAINT "FK_RunbookCredential_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredential" ADD CONSTRAINT "FK_RunbookCredential_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" ADD CONSTRAINT "FK_7db69d7207d704e770bb40a0c5a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" ADD CONSTRAINT "FK_5e51e566f7eb7ff47a8d9c11c50" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" ADD CONSTRAINT "FK_c0d14dc88c9c009c0e352fa9274" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" ADD CONSTRAINT "FK_2b1b7db69ee94cef9eab74b85ae" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" ADD CONSTRAINT "FK_545f95aef235cd8abbd2d4a11ca" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" ADD CONSTRAINT "FK_92018b0daeac19524b45c43cb7f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" ADD CONSTRAINT "FK_72c74137f08535200785cec3eb3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" ADD CONSTRAINT "FK_59cd65c91e9ae10bd861103bb10" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" ADD CONSTRAINT "FK_060e3fdce32f2ae3e8af08113af" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" ADD CONSTRAINT "FK_a24dd370690da68a5101fba0827" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "FK_5c9d1810e0fda27177cd41ea738" FOREIGN KEY ("targetAgentId") REFERENCES "Runner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "FK_ccc385027b89b731641a3cabd48" FOREIGN KEY ("runbookExecutionId") REFERENCES "RunbookExecution"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "FK_e13e6bd687869dfd16ddcc7900c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD CONSTRAINT "FK_7c2ccd1de68f9f805ef8fe26e0d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD CONSTRAINT "FK_936a55c9ef76c806615a869de57" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD CONSTRAINT "FK_8e18db257015a927b10be53cf30" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD CONSTRAINT "FK_Project_incidentInvestigationMinimumSeverityId" FOREIGN KEY ("incidentInvestigationMinimumSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
