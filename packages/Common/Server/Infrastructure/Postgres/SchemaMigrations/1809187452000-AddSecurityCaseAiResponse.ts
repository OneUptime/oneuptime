import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * OneUptime AI works a security case end to end (#10352,
 * Types/SecurityCase/SecurityCaseAi):
 *
 *   - "SecurityCaseAiAction": OneUptime AI's log of a case it works - each
 *     thing it did, asked a person about or left to a person, and why, with
 *     the playbook engine's run that carried it out, when it asked and when
 *     a person decided, and when somebody undid it.
 *   - "Project" gains "enableAutomaticSecurityCaseResponse", off for every
 *     project that exists: an upgrade never lets OneUptime AI change a case
 *     unasked. A project created from now on starts with it on
 *     (ProjectService NEW_PROJECT_AI_DEFAULT_COLUMNS). Beside it, what
 *     OneUptime AI may do on a case, one column a kind of action, each
 *     defaulting to the recommended mode, and who let each containment kind
 *     run on its own ("securityCaseAiOnItsOwnStamps"). Constant defaults:
 *     adding them does not rewrite the table.
 *   - "SecurityCase" gains where OneUptime AI stands on the case, why it
 *     last handed it to people, when it looks at it next, when it took it
 *     and when it closed it. Empty on every existing case. The index the
 *     every-minute look reads ("aiNextLookAt") is built online, in
 *     AddSecurityCaseAiNextLookIndex1809187452010.
 *
 * The new table is empty, so its indexes and foreign keys are built here.
 */
export class AddSecurityCaseAiResponse1809187452000
  implements MigrationInterface
{
  public name: string = "AddSecurityCaseAiResponse1809187452000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityCaseAiAction" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "securityCaseId" uuid NOT NULL, "aiRunId" uuid, "kind" character varying(100) NOT NULL, "area" character varying(100), "mode" character varying(100), "status" character varying(100) NOT NULL, "reason" character varying(100) NOT NULL, "handOffReason" character varying(100), "stepKey" character varying(100), "target" character varying(500), "securityPlaybookRunId" uuid, "detectionRuleId" uuid, "evidence" jsonb, "report" text, "askedAt" TIMESTAMP WITH TIME ZONE, "decidedAt" TIMESTAMP WITH TIME ZONE, "decidedByUserId" uuid, "doneAt" TIMESTAMP WITH TIME ZONE, "undoneAt" TIMESTAMP WITH TIME ZONE, "undoneByUserId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_537138c8ebc0894cddbeda10c6a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_727899b74be413cd191768a9c5" ON "SecurityCaseAiAction" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a0a0c31f58f06c8f3a7b0f6b1" ON "SecurityCaseAiAction" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2c736ca52d05506fccf59311ef" ON "SecurityCaseAiAction" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d14a12bcd3c38145bab5c4d637" ON "SecurityCaseAiAction" ("securityPlaybookRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4c7621b268d816a0631ab08abe" ON "SecurityCaseAiAction" ("detectionRuleId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticSecurityCaseResponse" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseAiCaseMode" character varying(100) NOT NULL DEFAULT 'OnItsOwn'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseAiEdgeMode" character varying(100) NOT NULL DEFAULT 'Ask'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseAiAccountsMode" character varying(100) NOT NULL DEFAULT 'Ask'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseAiHostsMode" character varying(100) NOT NULL DEFAULT 'Ask'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseAiCodeMode" character varying(100) NOT NULL DEFAULT 'OnItsOwn'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseAiCloseMode" character varying(100) NOT NULL DEFAULT 'Ask'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseAiOnItsOwnStamps" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiResponseState" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiHandOffReason" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiNextLookAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiTookCaseAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "aiClosedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseAiAction" ADD CONSTRAINT "FK_727899b74be413cd191768a9c55" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseAiAction" ADD CONSTRAINT "FK_4a0a0c31f58f06c8f3a7b0f6b11" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseAiAction" ADD CONSTRAINT "FK_c6a8de96b66f741f44396065dde" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseAiAction" ADD CONSTRAINT "FK_d949d9b2a8c90207b5efd1dc8d9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseAiAction" DROP CONSTRAINT "FK_d949d9b2a8c90207b5efd1dc8d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseAiAction" DROP CONSTRAINT "FK_c6a8de96b66f741f44396065dde"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseAiAction" DROP CONSTRAINT "FK_4a0a0c31f58f06c8f3a7b0f6b11"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseAiAction" DROP CONSTRAINT "FK_727899b74be413cd191768a9c55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiClosedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiTookCaseAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiNextLookAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiHandOffReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "aiResponseState"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseAiOnItsOwnStamps"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseAiCloseMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseAiCodeMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseAiHostsMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseAiAccountsMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseAiEdgeMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseAiCaseMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticSecurityCaseResponse"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4c7621b268d816a0631ab08abe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d14a12bcd3c38145bab5c4d637"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2c736ca52d05506fccf59311ef"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a0a0c31f58f06c8f3a7b0f6b1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_727899b74be413cd191768a9c5"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCaseAiAction"`);
  }
}
