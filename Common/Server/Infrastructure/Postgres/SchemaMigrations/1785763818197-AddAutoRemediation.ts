import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAutoRemediation1785763818197 implements MigrationInterface {
  name = "AddAutoRemediation1785763818197";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "triggerEntityType" character varying(100) NOT NULL, "executionMode" character varying(100) NOT NULL DEFAULT 'Suggest', "aiSelectsRunbook" boolean NOT NULL DEFAULT false, "titlePattern" character varying(500), "descriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_91acdfed9d7dc43c56c3a44f2b5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_44ff2246dc8d63d4d1df02d64e" ON "AutoRemediationRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bef71ed2ab76ebe313a646a922" ON "AutoRemediationRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_700f2cda31fa44c49c35d1f6f4" ON "AutoRemediationRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2b9375a13487c5413dc2d1b8e1" ON "AutoRemediationRule" ("triggerEntityType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_125f815f589564e17d270ff522" ON "AutoRemediationRule" ("executionMode") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationSuggestion" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "autoRemediationRuleId" uuid, "ruleNameSnapshot" character varying(100), "incidentId" uuid, "alertId" uuid, "runbookId" uuid, "runbookNameSnapshot" character varying(100), "status" character varying(100) NOT NULL, "executionMode" character varying(100) NOT NULL, "rationaleMarkdown" text, "aiRunId" uuid, "runbookExecutionId" uuid, "approvedByUserId" uuid, "approvedAt" TIMESTAMP WITH TIME ZONE, "dismissedByUserId" uuid, "dismissedAt" TIMESTAMP WITH TIME ZONE, "deletedByUserId" uuid, CONSTRAINT "PK_091abf3e79091db806488547f5a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d61256c71e2b64361e1f7e4128" ON "AutoRemediationSuggestion" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_68cff66e715e3b98756c8e6b3f" ON "AutoRemediationSuggestion" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f5f825e9d20fd9c23518230213" ON "AutoRemediationSuggestion" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8f9bc9c1db4b135b648561671" ON "AutoRemediationSuggestion" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f5e776a9a69c8f3d93762910c1" ON "AutoRemediationSuggestion" ("runbookId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_49b797c5a69ad2d0af66b0f3f1" ON "AutoRemediationSuggestion" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_545f902a5242c5a5dec94b02e1" ON "AutoRemediationSuggestion" ("aiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7a673953acc4784dd10f609138" ON "AutoRemediationSuggestion" ("runbookExecutionId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleMonitor" ("autoRemediationRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_55d399c198840f7e3e957fc4ddb" PRIMARY KEY ("autoRemediationRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f69d26e7322b2e3fa10b07c386" ON "AutoRemediationRuleMonitor" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4ce0f121da7f53b94d37906f7c" ON "AutoRemediationRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleIncidentSeverity" ("autoRemediationRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_ec4639e525e747f08f831beeb9b" PRIMARY KEY ("autoRemediationRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c51521fc2a533801daf32efd9e" ON "AutoRemediationRuleIncidentSeverity" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a22cf4349b302e94b4b43fade9" ON "AutoRemediationRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleAlertSeverity" ("autoRemediationRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_1fde5867430ba6d96f2fe01a015" PRIMARY KEY ("autoRemediationRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f5603dd26b29001aa83107a25b" ON "AutoRemediationRuleAlertSeverity" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6a6c4e47dfd6e08262929f48c" ON "AutoRemediationRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleLabel" ("autoRemediationRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_14ebf5854417757c55becba3c97" PRIMARY KEY ("autoRemediationRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6210b65a53f0dc12902750b314" ON "AutoRemediationRuleLabel" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0d880246785c98a86566d5a83b" ON "AutoRemediationRuleLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleMonitorLabel" ("autoRemediationRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ddbd36f62055ea9097f93c01cd7" PRIMARY KEY ("autoRemediationRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_36995449cac3f73cf305bba824" ON "AutoRemediationRuleMonitorLabel" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_66e369fd7259e007f108d2cd59" ON "AutoRemediationRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleRunbook" ("autoRemediationRuleId" uuid NOT NULL, "runbookId" uuid NOT NULL, CONSTRAINT "PK_bdfacfcd708a392c2d5fc68471d" PRIMARY KEY ("autoRemediationRuleId", "runbookId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_03800017767033af03bfa51e55" ON "AutoRemediationRuleRunbook" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32cda0b95b051f27f86c0a33d5" ON "AutoRemediationRuleRunbook" ("runbookId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutoRemediation" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "triggeredByAutoRemediationSuggestionId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e665c06d75022079ded5f7041f" ON "AIRun" ("triggeredByAutoRemediationSuggestionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD CONSTRAINT "FK_44ff2246dc8d63d4d1df02d64e3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD CONSTRAINT "FK_5b882b2356c3cca9f6386aadf63" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD CONSTRAINT "FK_75cf58839e0a41f054da5b2f139" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_d61256c71e2b64361e1f7e41285" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_68cff66e715e3b98756c8e6b3fc" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_f5f825e9d20fd9c235182302134" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_b8f9bc9c1db4b135b648561671e" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_f5e776a9a69c8f3d93762910c14" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_f3584bcd6dd1b1a9e772d4b1dbc" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_1bba2d4805f5d8a7bbefb72f01d" FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_aeda2fc77a2d566d9da8ca089ff" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleMonitor" ADD CONSTRAINT "FK_f69d26e7322b2e3fa10b07c386b" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleMonitor" ADD CONSTRAINT "FK_4ce0f121da7f53b94d37906f7cc" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleIncidentSeverity" ADD CONSTRAINT "FK_c51521fc2a533801daf32efd9e4" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleIncidentSeverity" ADD CONSTRAINT "FK_a22cf4349b302e94b4b43fade95" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleAlertSeverity" ADD CONSTRAINT "FK_f5603dd26b29001aa83107a25be" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleAlertSeverity" ADD CONSTRAINT "FK_c6a6c4e47dfd6e08262929f48c4" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleLabel" ADD CONSTRAINT "FK_6210b65a53f0dc12902750b3148" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleLabel" ADD CONSTRAINT "FK_0d880246785c98a86566d5a83b0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleMonitorLabel" ADD CONSTRAINT "FK_36995449cac3f73cf305bba824a" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleMonitorLabel" ADD CONSTRAINT "FK_66e369fd7259e007f108d2cd59c" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunbook" ADD CONSTRAINT "FK_03800017767033af03bfa51e55b" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunbook" ADD CONSTRAINT "FK_32cda0b95b051f27f86c0a33d5e" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunbook" DROP CONSTRAINT "FK_32cda0b95b051f27f86c0a33d5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunbook" DROP CONSTRAINT "FK_03800017767033af03bfa51e55b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleMonitorLabel" DROP CONSTRAINT "FK_66e369fd7259e007f108d2cd59c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleMonitorLabel" DROP CONSTRAINT "FK_36995449cac3f73cf305bba824a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleLabel" DROP CONSTRAINT "FK_0d880246785c98a86566d5a83b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleLabel" DROP CONSTRAINT "FK_6210b65a53f0dc12902750b3148"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleAlertSeverity" DROP CONSTRAINT "FK_c6a6c4e47dfd6e08262929f48c4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleAlertSeverity" DROP CONSTRAINT "FK_f5603dd26b29001aa83107a25be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleIncidentSeverity" DROP CONSTRAINT "FK_a22cf4349b302e94b4b43fade95"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleIncidentSeverity" DROP CONSTRAINT "FK_c51521fc2a533801daf32efd9e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleMonitor" DROP CONSTRAINT "FK_4ce0f121da7f53b94d37906f7cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleMonitor" DROP CONSTRAINT "FK_f69d26e7322b2e3fa10b07c386b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_aeda2fc77a2d566d9da8ca089ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_1bba2d4805f5d8a7bbefb72f01d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_f3584bcd6dd1b1a9e772d4b1dbc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_f5e776a9a69c8f3d93762910c14"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_b8f9bc9c1db4b135b648561671e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_f5f825e9d20fd9c235182302134"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_68cff66e715e3b98756c8e6b3fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_d61256c71e2b64361e1f7e41285"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP CONSTRAINT "FK_75cf58839e0a41f054da5b2f139"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP CONSTRAINT "FK_5b882b2356c3cca9f6386aadf63"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP CONSTRAINT "FK_44ff2246dc8d63d4d1df02d64e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e665c06d75022079ded5f7041f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "triggeredByAutoRemediationSuggestionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutoRemediation"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32cda0b95b051f27f86c0a33d5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_03800017767033af03bfa51e55"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleRunbook"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_66e369fd7259e007f108d2cd59"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_36995449cac3f73cf305bba824"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0d880246785c98a86566d5a83b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6210b65a53f0dc12902750b314"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6a6c4e47dfd6e08262929f48c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5603dd26b29001aa83107a25b"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a22cf4349b302e94b4b43fade9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c51521fc2a533801daf32efd9e"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleIncidentSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ce0f121da7f53b94d37906f7c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f69d26e7322b2e3fa10b07c386"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7a673953acc4784dd10f609138"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_545f902a5242c5a5dec94b02e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_49b797c5a69ad2d0af66b0f3f1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5e776a9a69c8f3d93762910c1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8f9bc9c1db4b135b648561671"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5f825e9d20fd9c23518230213"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_68cff66e715e3b98756c8e6b3f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d61256c71e2b64361e1f7e4128"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationSuggestion"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_125f815f589564e17d270ff522"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2b9375a13487c5413dc2d1b8e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_700f2cda31fa44c49c35d1f6f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bef71ed2ab76ebe313a646a922"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_44ff2246dc8d63d4d1df02d64e"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRule"`);
  }
}
