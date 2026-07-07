import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated via `npm run generate-postgres-migration`, then trimmed to only
 * the statements belonging to this feature (the generator also emitted
 * unrelated constraint-name drift on IncidentReminderRuleLabel /
 * AlertReminderRuleLabel / OnCallDutyPolicyScheduleLayer, which was removed).
 */
export class AddAIChatModels1783363279075 implements MigrationInterface {
  public name = "AddAIChatModels1783363279075";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AIConversation" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "title" character varying(100), "lastMessageAt" TIMESTAMP WITH TIME ZONE, "deletedByUserId" uuid, "createdByUserId" uuid, CONSTRAINT "PK_f9ae2849d2382ff411b526a1645" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fc2d5528985dbd00d3243ef77" ON "AIConversation" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_19e03fd4c8ae71e0a5c64a8701" ON "AIConversation" ("createdByUserId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIConversationMessage" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "conversationId" uuid NOT NULL, "userId" uuid, "role" character varying(100) NOT NULL, "contentInMarkdown" text, "status" character varying(100) NOT NULL DEFAULT 'Pending', "aiRunId" uuid, "citations" jsonb, "errorMessage" character varying(500), "deletedByUserId" uuid, "createdByUserId" uuid, CONSTRAINT "PK_a6f2d3fc75abcec2c7237fd42cc" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0bbb53963364a2c8153a891a9e" ON "AIConversationMessage" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e660119718045d3396ef56f67c" ON "AIConversationMessage" ("conversationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4533fdeffdf903fc39d84962db" ON "AIConversationMessage" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5769a1fdc026fa498ca31b8d5c" ON "AIConversationMessage" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1beee3451a31dc92b12683565b" ON "AIConversationMessage" ("aiRunId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIRun" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "runType" character varying(100) NOT NULL, "status" character varying(100) NOT NULL DEFAULT 'Running', "userId" uuid, "conversationId" uuid, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "lastHeartbeatAt" TIMESTAMP WITH TIME ZONE, "llmCallCount" integer DEFAULT '0', "toolCallCount" integer DEFAULT '0', "totalTokens" integer DEFAULT '0', "totalCostInUSDCents" integer DEFAULT '0', "egressManifest" jsonb, "errorMessage" character varying(500), "deletedByUserId" uuid, "createdByUserId" uuid, CONSTRAINT "PK_a71750bd07ca6019818ed65a2c5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23729c7401ec1b0daf86a724da" ON "AIRun" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6744710383a6aac64954eede2" ON "AIRun" ("runType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7bd25907183e34a6f349135c19" ON "AIRun" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8cd3e8e58dc28ca23e9b924dbc" ON "AIRun" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_349eb329160e8d711ef05a65b4" ON "AIRun" ("conversationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIRunEvent" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "aiRunId" uuid NOT NULL, "userId" uuid, "sequence" integer NOT NULL DEFAULT '0', "eventType" character varying(100) NOT NULL, "toolName" character varying(100), "toolArguments" jsonb, "resultSummary" jsonb, "citationId" character varying(100), "deletedByUserId" uuid, "createdByUserId" uuid, CONSTRAINT "PK_19b30c343e59e5e016b96e8e6a3" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fdbbcfad6f57e0bae84a500338" ON "AIRunEvent" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dce6a1de62fcb9d2048193eec7" ON "AIRunEvent" ("aiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_277cea453e287633b7b459e373" ON "AIRunEvent" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4896cb21f9b5d4a72b353e2cc5" ON "AIRunEvent" ("eventType") `,
    );
    await queryRunner.query(`ALTER TABLE "LlmLog" ADD "aiRunId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_0f6b41bb3c1f675ac55f5e9a06" ON "LlmLog" ("aiRunId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" ADD CONSTRAINT "FK_1fc2d5528985dbd00d3243ef771" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" ADD CONSTRAINT "FK_17a3378eefeacaaff1aac421a75" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" ADD CONSTRAINT "FK_19e03fd4c8ae71e0a5c64a87013" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" ADD CONSTRAINT "FK_0bbb53963364a2c8153a891a9ec" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" ADD CONSTRAINT "FK_e660119718045d3396ef56f67c0" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" ADD CONSTRAINT "FK_4533fdeffdf903fc39d84962db7" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" ADD CONSTRAINT "FK_86d4a9000d6505b1df390835582" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" ADD CONSTRAINT "FK_bbb0e64455f8db0cf88a1a6e41c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD CONSTRAINT "FK_23729c7401ec1b0daf86a724dad" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD CONSTRAINT "FK_8cd3e8e58dc28ca23e9b924dbc4" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD CONSTRAINT "FK_349eb329160e8d711ef05a65b4c" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD CONSTRAINT "FK_d43a154faca8c5073d3072b9a14" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD CONSTRAINT "FK_81b7bd8f4b697f16ff85dbe0b19" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" ADD CONSTRAINT "FK_fdbbcfad6f57e0bae84a5003383" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" ADD CONSTRAINT "FK_dce6a1de62fcb9d2048193eec70" FOREIGN KEY ("aiRunId") REFERENCES "AIRun"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" ADD CONSTRAINT "FK_277cea453e287633b7b459e373d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" ADD CONSTRAINT "FK_23c6b5f0bfd37523850372f7828" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" ADD CONSTRAINT "FK_a11507527559882e51476fff1fe" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" DROP CONSTRAINT "FK_a11507527559882e51476fff1fe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" DROP CONSTRAINT "FK_23c6b5f0bfd37523850372f7828"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" DROP CONSTRAINT "FK_277cea453e287633b7b459e373d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" DROP CONSTRAINT "FK_dce6a1de62fcb9d2048193eec70"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRunEvent" DROP CONSTRAINT "FK_fdbbcfad6f57e0bae84a5003383"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP CONSTRAINT "FK_81b7bd8f4b697f16ff85dbe0b19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP CONSTRAINT "FK_d43a154faca8c5073d3072b9a14"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP CONSTRAINT "FK_349eb329160e8d711ef05a65b4c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP CONSTRAINT "FK_8cd3e8e58dc28ca23e9b924dbc4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP CONSTRAINT "FK_23729c7401ec1b0daf86a724dad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" DROP CONSTRAINT "FK_bbb0e64455f8db0cf88a1a6e41c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" DROP CONSTRAINT "FK_86d4a9000d6505b1df390835582"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" DROP CONSTRAINT "FK_4533fdeffdf903fc39d84962db7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" DROP CONSTRAINT "FK_e660119718045d3396ef56f67c0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversationMessage" DROP CONSTRAINT "FK_0bbb53963364a2c8153a891a9ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" DROP CONSTRAINT "FK_19e03fd4c8ae71e0a5c64a87013"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" DROP CONSTRAINT "FK_17a3378eefeacaaff1aac421a75"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" DROP CONSTRAINT "FK_1fc2d5528985dbd00d3243ef771"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f6b41bb3c1f675ac55f5e9a06"`,
    );
    await queryRunner.query(`ALTER TABLE "LlmLog" DROP COLUMN "aiRunId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4896cb21f9b5d4a72b353e2cc5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_277cea453e287633b7b459e373"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dce6a1de62fcb9d2048193eec7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fdbbcfad6f57e0bae84a500338"`,
    );
    await queryRunner.query(`DROP TABLE "AIRunEvent"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_349eb329160e8d711ef05a65b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8cd3e8e58dc28ca23e9b924dbc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7bd25907183e34a6f349135c19"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6744710383a6aac64954eede2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_23729c7401ec1b0daf86a724da"`,
    );
    await queryRunner.query(`DROP TABLE "AIRun"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1beee3451a31dc92b12683565b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5769a1fdc026fa498ca31b8d5c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4533fdeffdf903fc39d84962db"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e660119718045d3396ef56f67c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0bbb53963364a2c8153a891a9e"`,
    );
    await queryRunner.query(`DROP TABLE "AIConversationMessage"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_19e03fd4c8ae71e0a5c64a8701"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1fc2d5528985dbd00d3243ef77"`,
    );
    await queryRunner.query(`DROP TABLE "AIConversation"`);
  }
}
