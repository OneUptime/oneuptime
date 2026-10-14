import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Security cases and response playbooks - the SOC half of Security Events.
 *
 * SecurityCase is the unit an analyst works: detections from detection
 * rules, threat intelligence and connected security products are grouped
 * into it by the entity they are about (SecurityDetection). Its timeline is
 * SecurityCaseFeed, its private notes SecurityCaseNote and its labels
 * SecurityCaseLabel. SecurityPlaybook is a response that runs against a case
 * - by itself when a case opens or grows, or when someone runs it - and
 * SecurityPlaybookRun is one run of it, step by step.
 *
 * Project.securityCaseCounter numbers each project's cases. Detection rules
 * and threat intelligence feeds open cases unless switched off
 * (shouldCreateCase), and a connection opens cases for the alerts it imports
 * at or above caseMinimumSeverity.
 *
 * Generated with npm run generate-postgres-migration, then renumbered to the
 * next round slot above the registered migrations
 * (SchemaMigrationsOrdering.test). The tables are new, so their indexes and
 * foreign keys are built while nothing writes to them. The four columns
 * added to existing tables carry constant defaults, which Postgres records
 * in the catalog without rewriting a row.
 */
export class AddSecurityCases1802150000000 implements MigrationInterface {
  public name: string = "AddSecurityCases1802150000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityCase" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "caseNumber" integer, "caseNumberWithPrefix" character varying(100), "title" character varying(500) NOT NULL, "description" text, "status" character varying(100) NOT NULL DEFAULT 'New', "priority" character varying(100) NOT NULL DEFAULT 'Medium', "verdict" character varying(100), "closingNote" text, "assignedToUserId" uuid, "assignedToTeamId" uuid, "source" character varying(100), "entities" jsonb, "mitreTactics" jsonb, "mitreTechniques" jsonb, "detectionCount" integer NOT NULL DEFAULT '0', "firstDetectedAt" TIMESTAMP WITH TIME ZONE, "lastDetectedAt" TIMESTAMP WITH TIME ZONE, "acknowledgedAt" TIMESTAMP WITH TIME ZONE, "containedAt" TIMESTAMP WITH TIME ZONE, "closedAt" TIMESTAMP WITH TIME ZONE, "closedByUserId" uuid, "groupingKey" character varying(500), "incidentId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a20890edaea9b9bdcda98069557" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_09e5dc09556f7abf35215ab71c" ON "SecurityCase" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f44d0bf1a8b82b047d14e231c3" ON "SecurityCase" ("caseNumber") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b845ed92cfae3be744524365ad" ON "SecurityCase" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d861cfa4e61db2db02aeaf7908" ON "SecurityCase" ("priority") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4ca30c05a198b0d38194119206" ON "SecurityCase" ("assignedToUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08b2d70b49ff73c070018eadde" ON "SecurityCase" ("assignedToTeamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e2a8cd911f397582f7d0d627cc" ON "SecurityCase" ("lastDetectedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d604ee8a05db963bb4ac6759e2" ON "SecurityCase" ("closedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_18d99667f9326782caeef7dcb9" ON "SecurityCase" ("projectId", "groupingKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_18bfa595b4bb4f4c15745b0f07" ON "SecurityCase" ("projectId", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityCaseFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityCaseId" uuid NOT NULL, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "securityCaseFeedEventType" character varying(100) NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_4c2433c6ded0abc1830f7600e8f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1c748d303b4f0f2ed76788ce18" ON "SecurityCaseFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b08773c7902c89740c9df5146f" ON "SecurityCaseFeed" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_193be1368f896d46189595cc8f" ON "SecurityCaseFeed" ("securityCaseId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityCaseNote" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityCaseId" uuid NOT NULL, "note" text NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a2590bb16df5da6cbf57a941864" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a0ad9bdcf401ed66f25e6ce2d" ON "SecurityCaseNote" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a821b820d94deb172f93a506c" ON "SecurityCaseNote" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fad8ed1893cede7996b754b468" ON "SecurityCaseNote" ("securityCaseId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityDetection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityCaseId" uuid NOT NULL, "title" character varying(500) NOT NULL, "description" text, "severity" character varying(100) NOT NULL DEFAULT 'Medium', "source" character varying(100) NOT NULL, "fingerprint" character varying(500) NOT NULL, "ruleName" character varying(500), "detectionRuleId" uuid, "threatIntelFeedId" uuid, "securityEventConnectionId" uuid, "groupValue" character varying(500), "entities" jsonb, "mitreTactics" jsonb, "mitreTechniques" jsonb, "eventCount" integer NOT NULL DEFAULT '0', "fireCount" integer NOT NULL DEFAULT '1', "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "sampleMessage" text, "eventUid" character varying(500), "deletedByUserId" uuid, CONSTRAINT "PK_8c6cf5420e38b510385b56dea97" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7148656e949c5a849392512eed" ON "SecurityDetection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_956d9a8eedd44e1199541f7c07" ON "SecurityDetection" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fb86377fed34047620216246de" ON "SecurityDetection" ("detectionRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_434fef2da2bb83b02c67b6646b" ON "SecurityDetection" ("securityCaseId", "lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_692d26c039afda1fbe838a9079" ON "SecurityDetection" ("projectId", "fingerprint") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityPlaybook" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "trigger" character varying(100) NOT NULL DEFAULT 'Case Opened', "minimumPriority" character varying(100), "detectionSource" character varying(100), "detectionRuleIds" jsonb, "steps" jsonb, "runCount" integer NOT NULL DEFAULT '0', "lastRunAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c36f8d6705e7505a5ceaf0c29f8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_11fd7883c4620ced021c6a2d01" ON "SecurityPlaybook" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cb3de2a5ecbac647051b6827e3" ON "SecurityPlaybook" ("projectId", "isEnabled", "trigger") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityPlaybookRun" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityCaseId" uuid NOT NULL, "securityPlaybookId" uuid, "playbookName" character varying(50), "trigger" character varying(100), "triggeredByUserId" uuid, "status" character varying(100) NOT NULL DEFAULT 'Queued', "steps" jsonb, "stepResults" jsonb, "currentStepIndex" integer NOT NULL DEFAULT '0', "threatIntelMatched" boolean NOT NULL DEFAULT false, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "errorMessage" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_52c8f43f30132cecb32d8de8f21" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e2dc419c3847975684ecd8bbd8" ON "SecurityPlaybookRun" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_04c185859f826b7ebed95856d4" ON "SecurityPlaybookRun" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_009c2972203664923e3b3bd080" ON "SecurityPlaybookRun" ("securityPlaybookId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6e0fb6b327ebc3bba09aceeff9" ON "SecurityPlaybookRun" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4249d1121d2ba292b733584072" ON "SecurityPlaybookRun" ("securityCaseId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityCaseLabel" ("securityCaseId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_87cfd50075fee8804543f937310" PRIMARY KEY ("securityCaseId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6e6d91b4642db2f916444dc4e5" ON "SecurityCaseLabel" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_764462bf766f95caeca2c7de1e" ON "SecurityCaseLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseCounter" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "shouldCreateCase" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" ADD "caseMinimumSeverity" character varying(100) DEFAULT 'High'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ADD "shouldCreateCase" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD CONSTRAINT "FK_09e5dc09556f7abf35215ab71c5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD CONSTRAINT "FK_4ca30c05a198b0d381941192063" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD CONSTRAINT "FK_08b2d70b49ff73c070018eadded" FOREIGN KEY ("assignedToTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD CONSTRAINT "FK_ccaff17a7d194cd3818f205e678" FOREIGN KEY ("closedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD CONSTRAINT "FK_cdb94d76dcf480f39d0785a9fc0" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD CONSTRAINT "FK_115b35fbd6068c6334128a2a132" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD CONSTRAINT "FK_1213a537d995da221db0e3025fb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseFeed" ADD CONSTRAINT "FK_1c748d303b4f0f2ed76788ce18c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseFeed" ADD CONSTRAINT "FK_b08773c7902c89740c9df5146f1" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseFeed" ADD CONSTRAINT "FK_e805ead1b0f97b2b9f83aeac38c" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseFeed" ADD CONSTRAINT "FK_dad88672d78f55208d1057c5ff3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseFeed" ADD CONSTRAINT "FK_7494ed1931845b9f84d28397db5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNote" ADD CONSTRAINT "FK_3a0ad9bdcf401ed66f25e6ce2d2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNote" ADD CONSTRAINT "FK_9a821b820d94deb172f93a506c2" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNote" ADD CONSTRAINT "FK_c7dd504d5d665365f4e6be9ccd9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNote" ADD CONSTRAINT "FK_70a8069bb41a167809de24f9336" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" ADD CONSTRAINT "FK_7148656e949c5a849392512eeda" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" ADD CONSTRAINT "FK_956d9a8eedd44e1199541f7c076" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" ADD CONSTRAINT "FK_fb86377fed34047620216246dec" FOREIGN KEY ("detectionRuleId") REFERENCES "DetectionRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" ADD CONSTRAINT "FK_eb46802d7f5630ac9f657c86f85" FOREIGN KEY ("threatIntelFeedId") REFERENCES "ThreatIntelFeed"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" ADD CONSTRAINT "FK_ce8ba5d559e190a2695bd3561e3" FOREIGN KEY ("securityEventConnectionId") REFERENCES "SecurityEventConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" ADD CONSTRAINT "FK_01804e55ef0b3fc7ff3035b5444" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" ADD CONSTRAINT "FK_11fd7883c4620ced021c6a2d010" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" ADD CONSTRAINT "FK_b1166d8cb0ccbd3e06d5f56d2fa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" ADD CONSTRAINT "FK_fa9e8ee4cd66bb18595e975c0ed" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" ADD CONSTRAINT "FK_e2dc419c3847975684ecd8bbd87" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" ADD CONSTRAINT "FK_04c185859f826b7ebed95856d4d" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" ADD CONSTRAINT "FK_009c2972203664923e3b3bd0808" FOREIGN KEY ("securityPlaybookId") REFERENCES "SecurityPlaybook"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" ADD CONSTRAINT "FK_b1730daebf1d04172f5534862ff" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" ADD CONSTRAINT "FK_5bfc3a5c397e6b6cce61cb2fb7c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" ADD CONSTRAINT "FK_4a9fc56bd0566682a1c6c455819" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseLabel" ADD CONSTRAINT "FK_6e6d91b4642db2f916444dc4e5f" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseLabel" ADD CONSTRAINT "FK_764462bf766f95caeca2c7de1ed" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseLabel" DROP CONSTRAINT "FK_764462bf766f95caeca2c7de1ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseLabel" DROP CONSTRAINT "FK_6e6d91b4642db2f916444dc4e5f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" DROP CONSTRAINT "FK_4a9fc56bd0566682a1c6c455819"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" DROP CONSTRAINT "FK_5bfc3a5c397e6b6cce61cb2fb7c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" DROP CONSTRAINT "FK_b1730daebf1d04172f5534862ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" DROP CONSTRAINT "FK_009c2972203664923e3b3bd0808"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" DROP CONSTRAINT "FK_04c185859f826b7ebed95856d4d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" DROP CONSTRAINT "FK_e2dc419c3847975684ecd8bbd87"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" DROP CONSTRAINT "FK_fa9e8ee4cd66bb18595e975c0ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" DROP CONSTRAINT "FK_b1166d8cb0ccbd3e06d5f56d2fa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" DROP CONSTRAINT "FK_11fd7883c4620ced021c6a2d010"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" DROP CONSTRAINT "FK_01804e55ef0b3fc7ff3035b5444"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" DROP CONSTRAINT "FK_ce8ba5d559e190a2695bd3561e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" DROP CONSTRAINT "FK_eb46802d7f5630ac9f657c86f85"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" DROP CONSTRAINT "FK_fb86377fed34047620216246dec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" DROP CONSTRAINT "FK_956d9a8eedd44e1199541f7c076"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" DROP CONSTRAINT "FK_7148656e949c5a849392512eeda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNote" DROP CONSTRAINT "FK_70a8069bb41a167809de24f9336"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNote" DROP CONSTRAINT "FK_c7dd504d5d665365f4e6be9ccd9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNote" DROP CONSTRAINT "FK_9a821b820d94deb172f93a506c2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNote" DROP CONSTRAINT "FK_3a0ad9bdcf401ed66f25e6ce2d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseFeed" DROP CONSTRAINT "FK_7494ed1931845b9f84d28397db5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseFeed" DROP CONSTRAINT "FK_dad88672d78f55208d1057c5ff3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseFeed" DROP CONSTRAINT "FK_e805ead1b0f97b2b9f83aeac38c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseFeed" DROP CONSTRAINT "FK_b08773c7902c89740c9df5146f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseFeed" DROP CONSTRAINT "FK_1c748d303b4f0f2ed76788ce18c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP CONSTRAINT "FK_1213a537d995da221db0e3025fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP CONSTRAINT "FK_115b35fbd6068c6334128a2a132"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP CONSTRAINT "FK_cdb94d76dcf480f39d0785a9fc0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP CONSTRAINT "FK_ccaff17a7d194cd3818f205e678"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP CONSTRAINT "FK_08b2d70b49ff73c070018eadded"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP CONSTRAINT "FK_4ca30c05a198b0d381941192063"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP CONSTRAINT "FK_09e5dc09556f7abf35215ab71c5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP COLUMN "shouldCreateCase"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" DROP COLUMN "caseMinimumSeverity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "shouldCreateCase"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseCounter"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_764462bf766f95caeca2c7de1e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e6d91b4642db2f916444dc4e5"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCaseLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4249d1121d2ba292b733584072"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e0fb6b327ebc3bba09aceeff9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_009c2972203664923e3b3bd080"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_04c185859f826b7ebed95856d4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2dc419c3847975684ecd8bbd8"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityPlaybookRun"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cb3de2a5ecbac647051b6827e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_11fd7883c4620ced021c6a2d01"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityPlaybook"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_692d26c039afda1fbe838a9079"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_434fef2da2bb83b02c67b6646b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fb86377fed34047620216246de"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_956d9a8eedd44e1199541f7c07"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7148656e949c5a849392512eed"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityDetection"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fad8ed1893cede7996b754b468"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a821b820d94deb172f93a506c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a0ad9bdcf401ed66f25e6ce2d"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCaseNote"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_193be1368f896d46189595cc8f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b08773c7902c89740c9df5146f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1c748d303b4f0f2ed76788ce18"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCaseFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_18bfa595b4bb4f4c15745b0f07"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_18d99667f9326782caeef7dcb9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d604ee8a05db963bb4ac6759e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2a8cd911f397582f7d0d627cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08b2d70b49ff73c070018eadde"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ca30c05a198b0d38194119206"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d861cfa4e61db2db02aeaf7908"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b845ed92cfae3be744524365ad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f44d0bf1a8b82b047d14e231c3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_09e5dc09556f7abf35215ab71c"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCase"`);
  }
}
