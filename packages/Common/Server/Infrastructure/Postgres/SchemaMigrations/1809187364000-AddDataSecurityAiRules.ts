import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. The index on AIRun's new column is built
 * online by the next migration (AddAIRunDataSecurityIssueIndex1809187364100).
 *
 * OneUptime AI works on Data Security issues (#10364):
 *
 *   - DataSecurityAiProposal: what it proposes for an issue, and where each
 *     proposal stands; DataSecurityAiDecision: why it did, or did not, act.
 *     Two new tables, so their indexes and keys are built here.
 *   - AutoRemediationRule: a Data Security AI rule's four kinds of work and
 *     its conditions, and the join table of the store labels it matches.
 *     Every column is empty on every existing rule: only a rule whose
 *     trigger is DataSecurityIssue reads them.
 *   - Project.enableAutomaticDataSecurityAi: whether OneUptime AI works on
 *     new issues on its own. Off for every project that exists, so an
 *     upgrade spends no AI credits unasked; a project created from now on
 *     starts with it on (ProjectService NEW_PROJECT_AI_DEFAULT_COLUMNS).
 *   - AIRun.triggeredByDataSecurityIssueId: the issue a run is about.
 *
 * Nothing to backfill: every new column is empty, and the switch's constant
 * default adds a NOT NULL column without rewriting a row.
 */
export class AddDataSecurityAiRules1809187364000 implements MigrationInterface {
  public name: string = "AddDataSecurityAiRules1809187364000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataSecurityAiProposal" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataSecurityIssueId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "work" character varying(100) NOT NULL, "safety" character varying(100) NOT NULL, "status" character varying(100) NOT NULL DEFAULT 'Proposed', "title" character varying(500) NOT NULL, "changeMarkdown" text, "reasonMarkdown" text, "proofMarkdown" text, "undoMarkdown" text, "plan" jsonb, "planKey" character varying(100) NOT NULL, "planFingerprint" character varying(100) NOT NULL, "result" jsonb, "riskScore" integer NOT NULL DEFAULT '0', "autonomy" character varying(100) NOT NULL, "askReason" character varying(100), "autoRemediationRuleId" uuid, "autoRemediationRuleName" character varying(100), "aiRunId" uuid, "firstApprovedByUserId" uuid, "firstApprovedAt" TIMESTAMP WITH TIME ZONE, "firstApprovedPlanFingerprint" character varying(100), "approvedByUserId" uuid, "approvedAt" TIMESTAMP WITH TIME ZONE, "appliedAt" TIMESTAMP WITH TIME ZONE, "dismissedByUserId" uuid, "dismissedAt" TIMESTAMP WITH TIME ZONE, "dismissReason" character varying(500), "undoneByUserId" uuid, "undoneAt" TIMESTAMP WITH TIME ZONE, "expiredAt" TIMESTAMP WITH TIME ZONE, "failedAt" TIMESTAMP WITH TIME ZONE, "failureMessage" character varying(500), "verifiedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_b284862ebe44fc34b3d6716b6c0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d1e5cf3917508be5862caa432a" ON "DataSecurityAiProposal" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6761c0a8cab96e2baaed1a8c98" ON "DataSecurityAiProposal" ("dataSecurityIssueId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_022e71b028c23ab0307240dbf6" ON "DataSecurityAiProposal" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9f24b8156bf3c2fa8462ed0ffc" ON "DataSecurityAiProposal" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_968222d0f8de5034ef76388075" ON "DataSecurityAiProposal" ("appliedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b87f3e191a7bbba7097577cc6e" ON "DataSecurityAiProposal" ("projectId", "dataSecurityIssueId", "kind") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5dcd0a47bac478539fc7d5f3f0" ON "DataSecurityAiProposal" ("projectId", "status", "riskScore") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DataSecurityAiDecision" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataSecurityIssueId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "didAct" boolean NOT NULL DEFAULT false, "skipReason" character varying(100), "entries" jsonb, "issueReopenCount" integer NOT NULL DEFAULT '0', "didAnalyze" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_b422bcb652a42eb150bfaa2474c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2f81321f05ae2fc1cce7e55eb5" ON "DataSecurityAiDecision" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b4e3dd400de6884e7cd8b9088" ON "DataSecurityAiDecision" ("dataSecurityIssueId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2a7add8331a5c2f8bb038ed5d9" ON "DataSecurityAiDecision" ("dataStoreId", "didAct", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_05dcbdc4ee3258d03e64e733fb" ON "DataSecurityAiDecision" ("projectId", "didAct", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleDataStoreLabel" ("autoRemediationRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_d77604e1c004c96e647c5869e40" PRIMARY KEY ("autoRemediationRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da1c3c450521343a094f542e6d" ON "AutoRemediationRuleDataStoreLabel" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c693dc5144f812b2d2e0fac054" ON "AutoRemediationRuleDataStoreLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticDataSecurityAi" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "triggeredByDataSecurityIssueId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataSecurityAnalyze" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataSecurityContain" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataSecurityFix" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataSecurityJudge" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataSecurityChecks" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataSecurityCheckGroups" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataSecuritySeverities" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataStoreSensitivities" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataStoreKinds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataStoreProviders" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataStoreEnvironments" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "dataCategories" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ADD CONSTRAINT "FK_d1e5cf3917508be5862caa432a1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ADD CONSTRAINT "FK_6761c0a8cab96e2baaed1a8c98c" FOREIGN KEY ("dataSecurityIssueId") REFERENCES "DataSecurityIssue"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ADD CONSTRAINT "FK_022e71b028c23ab0307240dbf6a" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ADD CONSTRAINT "FK_dd0f5a1b967da6e9b88b9ce3aea" FOREIGN KEY ("firstApprovedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ADD CONSTRAINT "FK_8fd9cc20bc5c9d4c857d5eaa155" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ADD CONSTRAINT "FK_0f014d69bebaef26b53a2cad674" FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" ADD CONSTRAINT "FK_4d41037322c5f8c54723190ff56" FOREIGN KEY ("undoneByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiDecision" ADD CONSTRAINT "FK_2f81321f05ae2fc1cce7e55eb51" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiDecision" ADD CONSTRAINT "FK_8b4e3dd400de6884e7cd8b90883" FOREIGN KEY ("dataSecurityIssueId") REFERENCES "DataSecurityIssue"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiDecision" ADD CONSTRAINT "FK_fbe51e4354912e8a6358fc831e7" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleDataStoreLabel" ADD CONSTRAINT "FK_da1c3c450521343a094f542e6d2" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleDataStoreLabel" ADD CONSTRAINT "FK_c693dc5144f812b2d2e0fac054d" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleDataStoreLabel" DROP CONSTRAINT "FK_c693dc5144f812b2d2e0fac054d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleDataStoreLabel" DROP CONSTRAINT "FK_da1c3c450521343a094f542e6d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiDecision" DROP CONSTRAINT "FK_fbe51e4354912e8a6358fc831e7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiDecision" DROP CONSTRAINT "FK_8b4e3dd400de6884e7cd8b90883"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiDecision" DROP CONSTRAINT "FK_2f81321f05ae2fc1cce7e55eb51"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" DROP CONSTRAINT "FK_4d41037322c5f8c54723190ff56"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" DROP CONSTRAINT "FK_0f014d69bebaef26b53a2cad674"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" DROP CONSTRAINT "FK_8fd9cc20bc5c9d4c857d5eaa155"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" DROP CONSTRAINT "FK_dd0f5a1b967da6e9b88b9ce3aea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" DROP CONSTRAINT "FK_022e71b028c23ab0307240dbf6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" DROP CONSTRAINT "FK_6761c0a8cab96e2baaed1a8c98c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityAiProposal" DROP CONSTRAINT "FK_d1e5cf3917508be5862caa432a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataCategories"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataStoreEnvironments"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataStoreProviders"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataStoreKinds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataStoreSensitivities"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataSecuritySeverities"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataSecurityCheckGroups"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataSecurityChecks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataSecurityJudge"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataSecurityFix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataSecurityContain"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "dataSecurityAnalyze"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "triggeredByDataSecurityIssueId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticDataSecurityAi"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c693dc5144f812b2d2e0fac054"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da1c3c450521343a094f542e6d"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleDataStoreLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_05dcbdc4ee3258d03e64e733fb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2a7add8331a5c2f8bb038ed5d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b4e3dd400de6884e7cd8b9088"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2f81321f05ae2fc1cce7e55eb5"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityAiDecision"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5dcd0a47bac478539fc7d5f3f0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b87f3e191a7bbba7097577cc6e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_968222d0f8de5034ef76388075"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f24b8156bf3c2fa8462ed0ffc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_022e71b028c23ab0307240dbf6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6761c0a8cab96e2baaed1a8c98"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d1e5cf3917508be5862caa432a"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityAiProposal"`);
  }
}
